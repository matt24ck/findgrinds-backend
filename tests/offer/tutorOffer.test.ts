import request from 'supertest';
import { app } from '../helpers/app';
import { User } from '../../src/models/User';
import { Tutor } from '../../src/models/Tutor';
import { Session } from '../../src/models/Session';
import { TutorDateOverride } from '../../src/models/TutorDateOverride';
import { sequelize } from '../../src/config/database';
import { stripeService } from '../../src/services/stripeService';
import { FEE_WAIVER_ENDS, tutorOfferService } from '../../src/services/tutorOfferService';
import {
  ADULT_DOB,
  authHeader,
  createParent,
  createSession,
  createStudent,
  createTutor,
  linkParent,
} from '../helpers/factories';

async function referredStudent(tutor: Tutor): Promise<User> {
  const student = await createStudent({ dateOfBirth: ADULT_DOB });
  await student.update({ referredByTutorId: tutor.id, referredAt: new Date() });
  return student;
}

/** A paid, fee-waived booking made before the 31 Oct deadline. */
async function qualifyingBooking(tutor: Tutor, student: User): Promise<Session> {
  const session = await createSession(tutor, student, { paymentStatus: 'paid' });
  await session.update({ referralFeeWaived: true, platformFee: 0 });
  await sequelize.query(`UPDATE sessions SET created_at = '2026-10-15T12:00:00Z' WHERE id = :id`, {
    replacements: { id: session.id },
  });
  return session;
}

describe('join link attribution at signup', () => {
  const signup = (body: Record<string, unknown>) =>
    request(app).post('/api/auth/signup').send({
      password: 'Password123!',
      firstName: 'Sam',
      lastName: 'Student',
      dateOfBirth: ADULT_DOB,
      ...body,
    });

  test('a student signing up through a tutor link is tagged to that tutor', async () => {
    const { tutor } = await createTutor();
    const code = await tutorOfferService.ensureInviteCode(tutor);

    const res = await signup({ email: 'joined@example.test', userType: 'STUDENT', inviteCode: code });
    expect(res.status).toBe(201);

    const user = (await User.findOne({ where: { email: 'joined@example.test' } }))!;
    expect(user.referredByTutorId).toBe(tutor.id);
    expect(user.referredAt).toBeTruthy();
  });

  test('an unknown code is ignored and signup still succeeds', async () => {
    const res = await signup({ email: 'badcode@example.test', userType: 'STUDENT', inviteCode: 'nosuchcode' });
    expect(res.status).toBe(201);
    const user = (await User.findOne({ where: { email: 'badcode@example.test' } }))!;
    expect(user.referredByTutorId).toBeFalsy();
  });

  test('tutors signing up through a link are not tagged', async () => {
    const { tutor } = await createTutor();
    const code = await tutorOfferService.ensureInviteCode(tutor);
    const res = await signup({ email: 'othertutor@example.test', userType: 'TUTOR', inviteCode: code });
    expect(res.status).toBe(201);
    const user = (await User.findOne({ where: { email: 'othertutor@example.test' } }))!;
    expect(user.referredByTutorId).toBeFalsy();
  });

  test('the public join lookup names the tutor', async () => {
    const { user, tutor } = await createTutor();
    const code = await tutorOfferService.ensureInviteCode(tutor);
    const res = await request(app).get(`/api/tutor-offer/join/${code}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ tutorId: tutor.id, firstName: user.firstName });

    const missing = await request(app).get('/api/tutor-offer/join/nosuchcode');
    expect(missing.status).toBe(404);
  });
});

describe('platform fee', () => {
  const lesson = new Date('2026-12-01T17:00:00Z');

  test('0% for a student who joined through this tutor, 15% otherwise', async () => {
    const { tutor } = await createTutor();
    const { tutor: otherTutor } = await createTutor();
    const referred = await referredStudent(tutor);
    const organic = await createStudent({ dateOfBirth: ADULT_DOB });

    await expect(
      tutorOfferService.getSessionFee({ tutorId: tutor.id, studentId: referred.id, price: 40, scheduledAt: lesson })
    ).resolves.toEqual({ platformFee: 0, referralFeeWaived: true });

    await expect(
      tutorOfferService.getSessionFee({ tutorId: tutor.id, studentId: organic.id, price: 40, scheduledAt: lesson })
    ).resolves.toEqual({ platformFee: 6, referralFeeWaived: false });

    // Referred by a different tutor: no waiver with this one.
    await expect(
      tutorOfferService.getSessionFee({ tutorId: otherTutor.id, studentId: referred.id, price: 40, scheduledAt: lesson })
    ).resolves.toEqual({ platformFee: 6, referralFeeWaived: false });
  });

  test('the waiver ends for lessons from 1 July 2027', async () => {
    const { tutor } = await createTutor();
    const referred = await referredStudent(tutor);
    await expect(
      tutorOfferService.getSessionFee({ tutorId: tutor.id, studentId: referred.id, price: 40, scheduledAt: FEE_WAIVER_ENDS })
    ).resolves.toEqual({ platformFee: 6, referralFeeWaived: false });
  });

  test('a parent who joined through the link gets the waiver when booking for their child', async () => {
    const { tutor } = await createTutor();
    const parent = await createParent();
    await parent.update({ referredByTutorId: tutor.id });
    const child = await createStudent({ dateOfBirth: ADULT_DOB });
    await linkParent(child, parent);

    await expect(
      tutorOfferService.getSessionFee({ tutorId: tutor.id, studentId: child.id, bookerId: parent.id, price: 40, scheduledAt: lesson })
    ).resolves.toEqual({ platformFee: 0, referralFeeWaived: true });
  });

  test('checkout stores a zero fee and passes it to Stripe', async () => {
    const createBookingCheckout = jest.fn().mockResolvedValue('https://checkout.test/abc');
    (stripeService as any).createBookingCheckout = createBookingCheckout;

    const { tutor } = await createTutor();
    await tutor.update({ stripeConnectAccountId: 'acct_test', stripeConnectOnboarded: true });
    const student = await referredStudent(tutor);

    const scheduledAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    scheduledAt.setHours(17, 0, 0, 0);
    await TutorDateOverride.create({
      tutorId: tutor.id,
      date: scheduledAt.toISOString().split('T')[0],
      startTime: '17:00',
      medium: 'VIDEO',
      isAvailable: true,
    });

    const res = await request(app)
      .post('/api/stripe/checkout/session')
      .set(authHeader(student))
      .send({ tutorId: tutor.id, subject: 'MATHS', level: 'LC', sessionType: 'VIDEO', scheduledAt: scheduledAt.toISOString(), durationMins: 30 });
    expect(res.status).toBe(200);

    const session = (await Session.findByPk(res.body.sessionId))!;
    expect(Number(session.platformFee)).toBe(0);
    expect(session.referralFeeWaived).toBe(true);
    expect(createBookingCheckout).toHaveBeenCalledWith(expect.objectContaining({ platformFee: 0 }));
  });
});

describe('free Professional month', () => {
  const createSubscriptionCheckout = jest.fn().mockResolvedValue('https://checkout.test/trial');
  beforeEach(() => {
    createSubscriptionCheckout.mockClear();
    (stripeService as any).createSubscriptionCheckout = createSubscriptionCheckout;
  });

  test('cannot be started before a referred student has paid for a booking', async () => {
    const { user } = await createTutor();
    const res = await request(app).post('/api/tutor-offer/pro-month/activate').set(authHeader(user));
    expect(res.status).toBe(400);
    expect(res.body.code).toMatch(/not_qualified|deadline_passed/);
    expect(createSubscriptionCheckout).not.toHaveBeenCalled();
  });

  test('once qualified, starts a 30-day Stripe trial of Professional', async () => {
    const { user, tutor } = await createTutor();
    await qualifyingBooking(tutor, await referredStudent(tutor));

    const status = await request(app).get('/api/tutor-offer/status').set(authHeader(user));
    expect(status.status).toBe(200);
    expect(status.body.data.proMonth).toMatchObject({ qualified: true, canActivate: true });
    expect(status.body.data.inviteCode).toMatch(/^[a-z2-9]{8}$/);

    const res = await request(app).post('/api/tutor-offer/pro-month/activate').set(authHeader(user));
    expect(res.status).toBe(200);
    expect(res.body.data.url).toBe('https://checkout.test/trial');
    expect(createSubscriptionCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ tier: 'PROFESSIONAL', trialDays: 30, promo: 'pro_month' })
    );
  });

  test('is blocked once used', async () => {
    const { user, tutor } = await createTutor();
    await qualifyingBooking(tutor, await referredStudent(tutor));
    await tutor.update({ proMonthActivatedAt: new Date(), proMonthEndsAt: new Date(Date.now() + 86400000) });

    const res = await request(app).post('/api/tutor-offer/pro-month/activate').set(authHeader(user));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('already_activated');
  });

  test('is blocked for tutors already on a paid plan', async () => {
    const { user, tutor } = await createTutor();
    await qualifyingBooking(tutor, await referredStudent(tutor));
    await tutor.update({ featuredTier: 'PROFESSIONAL' });

    const res = await request(app).post('/api/tutor-offer/pro-month/activate').set(authHeader(user));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('already_on_paid_plan');
  });

  test('is blocked for anyone with a Stripe subscription on record, even if their tier says Free', async () => {
    const { user, tutor } = await createTutor();
    await qualifyingBooking(tutor, await referredStudent(tutor));
    await tutor.update({ stripeSubscriptionId: 'sub_existing' });

    const res = await request(app).post('/api/tutor-offer/pro-month/activate').set(authHeader(user));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('already_on_paid_plan');
    expect(createSubscriptionCheckout).not.toHaveBeenCalled();
  });

  test('a booking made after 31 October does not qualify', async () => {
    const { tutor } = await createTutor();
    const session = await qualifyingBooking(tutor, await referredStudent(tutor));
    await sequelize.query(`UPDATE sessions SET created_at = '2026-11-01T00:00:01Z' WHERE id = :id`, {
      replacements: { id: session.id },
    });
    await expect(tutorOfferService.hasQualifiedForProMonth(tutor.id)).resolves.toBe(false);
  });
});
