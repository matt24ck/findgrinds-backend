import request from 'supertest';
import { app } from '../helpers/app';
import { User } from '../../src/models/User';
import { Session } from '../../src/models/Session';
import { Message } from '../../src/models/Message';
import { completeFinishedSessions } from '../../src/services/groupSessionScheduler';
import { clearAccountStatusCache } from '../../src/middleware/auth';
import {
  ADULT_DOB,
  authHeader,
  createAdmin,
  createConversation,
  createSession,
  createStudent,
  createTutor,
  hoursFromNow,
} from '../helpers/factories';

describe('suspension is enforced', () => {
  test('a suspended user is rejected by authenticated routes and at login', async () => {
    const student = await createStudent({ dateOfBirth: ADULT_DOB });
    const admin = await createAdmin();

    expect((await request(app).get('/api/sessions').set(authHeader(student))).status).toBe(200);

    const suspend = await request(app)
      .put(`/api/admin/users/${student.id}/suspend`)
      .set(authHeader(admin))
      .send({ reason: 'test' });
    expect(suspend.status).toBe(200);

    const res = await request(app).get('/api/sessions').set(authHeader(student));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_SUSPENDED');

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: student.email, password: 'Password123!' });
    expect(login.status).toBe(403);
  });

  test('a suspended tutor disappears from search and their profile 404s', async () => {
    const { user, tutor } = await createTutor();
    expect((await request(app).get(`/api/tutors/${tutor.id}`)).status).toBe(200);

    await user.update({ accountStatus: 'SUSPENDED' });
    clearAccountStatusCache(user.id);

    expect((await request(app).get(`/api/tutors/${tutor.id}`)).status).toBe(404);
    const search = await request(app).get('/api/tutors');
    expect(search.status).toBe(200);
    expect(search.body.data.items.map((t: any) => t.id)).not.toContain(tutor.id);
  });
});

describe('finished sessions', () => {
  test('confirmed sessions are marked COMPLETED once they have ended', async () => {
    const student = await createStudent({ dateOfBirth: ADULT_DOB });
    const { tutor } = await createTutor();
    const past = await createSession(tutor, student, { status: 'CONFIRMED', scheduledAt: hoursFromNow(-3) });
    const future = await createSession(tutor, student, { status: 'CONFIRMED', scheduledAt: hoursFromNow(3) });

    await completeFinishedSessions();

    expect((await Session.findByPk(past.id))!.status).toBe('COMPLETED');
    expect((await Session.findByPk(future.id))!.status).toBe('CONFIRMED');
  });

  test('a session that has started cannot be cancelled for a refund', async () => {
    const student = await createStudent({ dateOfBirth: ADULT_DOB });
    const { tutor, user: tutorUser } = await createTutor({ lateCancellationRefundPercent: 100 });
    const session = await createSession(tutor, student, { status: 'CONFIRMED', scheduledAt: hoursFromNow(-2) });

    const byStudent = await request(app).put(`/api/sessions/${session.id}/cancel`).set(authHeader(student));
    expect(byStudent.status).toBe(400);
    const byTutor = await request(app).put(`/api/sessions/${session.id}/cancel`).set(authHeader(tutorUser));
    expect(byTutor.status).toBe(400);
    expect((await Session.findByPk(session.id))!.status).toBe('CONFIRMED');
  });
});

describe('account deletion', () => {
  test('a student with past sessions and messages can delete their account', async () => {
    const student = await createStudent({ dateOfBirth: ADULT_DOB });
    const { user: tutorUser, tutor } = await createTutor();
    const session = await createSession(tutor, student, { status: 'CONFIRMED', scheduledAt: hoursFromNow(-48) });
    const { message } = await createConversation(student, tutorUser);

    const res = await request(app)
      .delete('/api/gdpr/delete-account')
      .set(authHeader(student))
      .send({ confirmEmail: student.email });
    expect(res.status).toBe(200);

    const after = (await User.findByPk(student.id))!;
    expect(after.accountStatus).toBe('DELETED');
    expect(after.email).not.toBe(student.email);
    expect(after.firstName).toBe('Deleted');
    expect(after.dateOfBirth).toBeFalsy();
    // History is kept (anonymised) so other users' records stay intact
    expect(await Session.findByPk(session.id)).not.toBeNull();
    expect(await Message.findByPk(message.id)).not.toBeNull();

    // The old token no longer works and the email can sign up again
    expect((await request(app).get('/api/sessions').set(authHeader(student))).status).toBe(401);
  });

  test('an upcoming session blocks deletion', async () => {
    const student = await createStudent({ dateOfBirth: ADULT_DOB });
    const { tutor } = await createTutor();
    await createSession(tutor, student, { status: 'CONFIRMED', scheduledAt: hoursFromNow(48) });

    const res = await request(app)
      .delete('/api/gdpr/delete-account')
      .set(authHeader(student))
      .send({ confirmEmail: student.email });
    expect(res.status).toBe(400);
    expect((await User.findByPk(student.id))!.accountStatus).toBe('ACTIVE');
  });

  test('a tutor is hidden and their data scrubbed on deletion', async () => {
    const { user, tutor } = await createTutor();
    const res = await request(app)
      .delete('/api/gdpr/delete-account')
      .set(authHeader(user))
      .send({ confirmEmail: user.email });
    expect(res.status).toBe(200);
    await tutor.reload();
    expect(tutor.isVisible).toBe(false);
    expect(tutor.headline).toBeFalsy();
    expect((await request(app).get(`/api/tutors/${tutor.id}`)).status).toBe(404);
  });
});

describe('mock payment routes are gone', () => {
  test('POST /api/payments/confirm no longer confirms sessions', async () => {
    const student = await createStudent({ dateOfBirth: ADULT_DOB });
    const { tutor } = await createTutor();
    const session = await createSession(tutor, student, { status: 'PENDING', scheduledAt: hoursFromNow(48) });

    const res = await request(app)
      .post('/api/payments/confirm')
      .set(authHeader(student))
      .send({ paymentIntentId: 'pi_fake', sessionId: session.id });
    expect(res.status).toBe(404);
    expect((await Session.findByPk(session.id))!.status).toBe('PENDING');
  });
});
