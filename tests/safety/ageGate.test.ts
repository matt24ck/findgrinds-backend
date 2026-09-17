import request from 'supertest';
import { app } from '../helpers/app';
import { isMinorFromDateOfBirth, validateDateOfBirth, calculateAge, parseIsoDate } from '../../src/utils/age';
import { User } from '../../src/models/User';
import {
  ADULT_DOB,
  MINOR_DOB,
  authHeader,
  createConversation,
  createParent,
  createStudent,
  createTutor,
  dobYearsAgo,
  linkParent,
} from '../helpers/factories';

describe('age policy: fail closed', () => {
  const today = new Date(Date.UTC(2026, 8, 17)); // 2026-09-17

  test.each([
    [undefined, 'missing'],
    [null, 'null'],
    ['', 'empty'],
    ['not-a-date', 'garbage'],
    ['2010-02-30', 'impossible calendar date'],
    ['17/03/2009', 'wrong format'],
  ])('treats %p (%s) as a minor', (dob) => {
    expect(isMinorFromDateOfBirth(dob as any, today)).toBe(true);
  });

  test('a real 17-year-old is a minor and a real 30-year-old is not', () => {
    expect(isMinorFromDateOfBirth('2009-03-17', today)).toBe(true);
    expect(isMinorFromDateOfBirth('1996-03-17', today)).toBe(false);
  });

  test('turns 18 on the birthday itself, not the day before', () => {
    expect(isMinorFromDateOfBirth('2008-09-17', today)).toBe(false); // 18 today
    expect(isMinorFromDateOfBirth('2008-09-18', today)).toBe(true); // 18 tomorrow
  });

  test('implausible dates fail closed', () => {
    expect(isMinorFromDateOfBirth('2030-01-01', today)).toBe(true); // future
    expect(isMinorFromDateOfBirth('1850-01-01', today)).toBe(true); // 176 years old
  });

  test('calculateAge and parseIsoDate agree with the calendar', () => {
    expect(calculateAge(parseIsoDate('2008-09-17') as Date, today)).toBe(18);
    expect(calculateAge(parseIsoDate('2008-09-18') as Date, today)).toBe(17);
    expect(parseIsoDate('2024-02-29')).not.toBeNull();
    expect(parseIsoDate('2023-02-29')).toBeNull();
  });

  test('validateDateOfBirth rejects missing, malformed, future and implausible values', () => {
    expect(validateDateOfBirth(undefined, today)).toEqual({ ok: false, error: 'Date of birth is required' });
    expect(validateDateOfBirth('', today).ok).toBe(false);
    expect(validateDateOfBirth('2009-13-01', today).ok).toBe(false);
    expect(validateDateOfBirth('2027-01-01', today).ok).toBe(false);
    expect(validateDateOfBirth('1800-01-01', today).ok).toBe(false);
    expect(validateDateOfBirth(' 2009-03-17 ', today)).toEqual({ ok: true, value: '2009-03-17' });
  });

  test('User.isMinor() fails closed when no date of birth is stored', async () => {
    const noDob = await createStudent();
    const adult = await createStudent({ dateOfBirth: ADULT_DOB });
    const minor = await createStudent({ dateOfBirth: MINOR_DOB });
    expect((await User.findByPk(noDob.id))!.isMinor()).toBe(true);
    expect((await User.findByPk(adult.id))!.isMinor()).toBe(false);
    expect((await User.findByPk(minor.id))!.isMinor()).toBe(true);
  });
});

describe('signup requires a date of birth for students', () => {
  const base = { password: 'Password123!', firstName: 'Aoife', lastName: 'Byrne' };

  test('student without a date of birth is rejected', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ ...base, email: 'aoife1@example.test', userType: 'STUDENT' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('DOB_REQUIRED');
    expect(await User.count()).toBe(0);
  });

  test.each([['2030-01-01', 'future'], ['17/03/2009', 'wrong format'], ['2009-02-30', 'impossible'], ['1800-01-01', 'implausible']])(
    'student with date of birth %s (%s) is rejected',
    async (dateOfBirth) => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send({ ...base, email: 'aoife2@example.test', userType: 'STUDENT', dateOfBirth });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('DOB_INVALID');
    }
  );

  test('student with a valid date of birth is created and the value is stored', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ ...base, email: 'aoife3@example.test', userType: 'STUDENT', dateOfBirth: '2009-03-17' });
    expect(res.status).toBe(201);
    expect(res.body.data.token).toBeTruthy();
    const user = await User.findOne({ where: { email: 'aoife3@example.test' } });
    expect(user?.dateOfBirth).toBe('2009-03-17');
    expect(user?.isMinor()).toBe(true);
  });

  test('parents and tutors may sign up without a date of birth, but a supplied one is validated', async () => {
    const parent = await request(app)
      .post('/api/auth/signup')
      .send({ ...base, email: 'parent@example.test', userType: 'PARENT' });
    expect(parent.status).toBe(201);

    const tutorBad = await request(app)
      .post('/api/auth/signup')
      .send({ ...base, email: 'tutor@example.test', userType: 'TUTOR', dateOfBirth: 'yesterday' });
    expect(tutorBad.status).toBe(400);
    expect(tutorBad.body.code).toBe('DOB_INVALID');
  });

  test('unknown user types are rejected', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ ...base, email: 'x@example.test', userType: 'ADMIN', dateOfBirth: ADULT_DOB });
    expect(res.status).toBe(400);
  });
});

describe('messaging age gate', () => {
  async function conversationFor(student: User) {
    const { user: tutorUser } = await createTutor();
    const { conversation } = await createConversation(student, tutorUser);
    return { tutorUser, conversation };
  }

  test('student with no date of birth is restricted to predefined messages', async () => {
    const student = await createStudent();
    const { conversation } = await conversationFor(student);

    const view = await request(app).get(`/api/messages/conversations/${conversation.id}`).set(authHeader(student));
    expect(view.status).toBe(200);
    expect(view.body.data.permission).toEqual({ isMinor: true, hasLinkedParent: false, canFreeText: false });

    const free = await request(app)
      .post(`/api/messages/conversations/${conversation.id}`)
      .set(authHeader(student))
      .send({ message: 'Here is my number 087 123 4567' });
    expect(free.status).toBe(403);
    expect(free.body.code).toBe('PREDEFINED_ONLY');

    const canned = await request(app)
      .post(`/api/messages/conversations/${conversation.id}`)
      .set(authHeader(student))
      .send({ predefinedMessageId: 1 });
    expect(canned.status).toBe(201);
    expect(canned.body.data.isPredefined).toBe(true);
    expect(canned.body.data.content).toBe('What subjects and levels do you teach?');
  });

  test('predefined message ids outside the list are rejected', async () => {
    const student = await createStudent({ dateOfBirth: MINOR_DOB });
    const { conversation } = await conversationFor(student);
    const res = await request(app)
      .post(`/api/messages/conversations/${conversation.id}`)
      .set(authHeader(student))
      .send({ predefinedMessageId: 99 });
    expect(res.status).toBe(400);
  });

  test('a minor with an active parent link may send free text', async () => {
    const student = await createStudent({ dateOfBirth: MINOR_DOB });
    const parent = await createParent();
    await linkParent(student, parent);
    const { conversation } = await conversationFor(student);

    const res = await request(app)
      .post(`/api/messages/conversations/${conversation.id}`)
      .set(authHeader(student))
      .send({ message: 'Can we do Thursday at 6?' });
    expect(res.status).toBe(201);
    expect(res.body.data.isPredefined).toBe(false);
  });

  test('an adult student may send free text', async () => {
    const student = await createStudent({ dateOfBirth: ADULT_DOB });
    const { conversation } = await conversationFor(student);
    const res = await request(app)
      .post(`/api/messages/conversations/${conversation.id}`)
      .set(authHeader(student))
      .send({ message: 'Can we do Thursday at 6?' });
    expect(res.status).toBe(201);
  });

  test('starting a conversation is gated the same way', async () => {
    const student = await createStudent();
    const { user: tutorUser } = await createTutor();
    const blocked = await request(app)
      .post('/api/messages/conversations')
      .set(authHeader(student))
      .send({ tutorId: tutorUser.id, message: 'hi' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('PREDEFINED_ONLY');

    const ok = await request(app)
      .post('/api/messages/conversations')
      .set(authHeader(student))
      .send({ tutorId: tutorUser.id, predefinedMessageId: 0 });
    expect(ok.status).toBe(201);
  });
});

describe('PUT /api/auth/date-of-birth (one-time self-service)', () => {
  test('a student with no date of birth can set it once, which unlocks free text if they are an adult', async () => {
    const student = await createStudent();
    const { user: tutorUser } = await createTutor();
    const { conversation } = await createConversation(student, tutorUser);

    const set = await request(app)
      .put('/api/auth/date-of-birth')
      .set(authHeader(student))
      .send({ dateOfBirth: dobYearsAgo(20) });
    expect(set.status).toBe(200);
    expect(set.body.data.isMinor).toBe(false);

    const free = await request(app)
      .post(`/api/messages/conversations/${conversation.id}`)
      .set(authHeader(student))
      .send({ message: 'Thanks!' });
    expect(free.status).toBe(201);

    const again = await request(app)
      .put('/api/auth/date-of-birth')
      .set(authHeader(student))
      .send({ dateOfBirth: dobYearsAgo(30) });
    expect(again.status).toBe(400);
    expect(again.body.code).toBe('DOB_LOCKED');
  });

  test('a minor cannot age up by re-submitting', async () => {
    const student = await createStudent({ dateOfBirth: MINOR_DOB });
    const res = await request(app)
      .put('/api/auth/date-of-birth')
      .set(authHeader(student))
      .send({ dateOfBirth: ADULT_DOB });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('DOB_LOCKED');
    expect((await User.findByPk(student.id))!.dateOfBirth).toBe(MINOR_DOB);
  });

  test('invalid values are rejected and nothing is stored', async () => {
    const student = await createStudent();
    const res = await request(app)
      .put('/api/auth/date-of-birth')
      .set(authHeader(student))
      .send({ dateOfBirth: '2031-01-01' });
    expect(res.status).toBe(400);
    expect((await User.findByPk(student.id))!.dateOfBirth).toBeFalsy();
  });

  test('requires authentication', async () => {
    const res = await request(app).put('/api/auth/date-of-birth').send({ dateOfBirth: ADULT_DOB });
    expect(res.status).toBe(401);
  });
});
