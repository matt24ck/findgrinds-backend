import request from 'supertest';
import { app } from '../helpers/app';
import { Session } from '../../src/models/Session';
import { SessionDispute } from '../../src/models/SessionDispute';
import { stripeService } from '../../src/services/stripeService';
import {
  ADULT_DOB,
  MINOR_DOB,
  authHeader,
  createAdmin,
  createDispute,
  createParent,
  createSession,
  createStudent,
  createTutor,
  hoursFromNow,
  linkParent,
} from '../helpers/factories';

const refundSession = stripeService.refundSession as jest.Mock;

beforeEach(() => {
  refundSession.mockResolvedValue({ refundId: 're_test', amountRefunded: 40 });
});

describe('dispute refunds', () => {
  test('refunding a paid session calls Stripe once and marks session and dispute', async () => {
    const student = await createStudent({ dateOfBirth: ADULT_DOB });
    const { tutor } = await createTutor();
    const admin = await createAdmin();
    const session = await createSession(tutor, student, { paymentStatus: 'paid', stripePaymentIntentId: 'pi_paid_1' });
    const dispute = await createDispute(session, student);

    const res = await request(app).post(`/api/admin/session-disputes/${dispute.id}/action`).set(authHeader(admin)).send({ action: 'refund' });
    expect(res.status).toBe(200);

    expect(refundSession).toHaveBeenCalledTimes(1);
    expect(refundSession).toHaveBeenCalledWith({
      paymentIntentId: 'pi_paid_1',
      reason: expect.stringMatching(/dispute/i),
    });

    const s = (await Session.findByPk(session.id))!;
    expect(s.paymentStatus).toBe('refunded');
    expect(s.refundStatus).toBe('full');
    const d = (await SessionDispute.findByPk(dispute.id))!;
    expect(d.status).toBe('REFUNDED');
    expect(d.reviewedBy).toBe(admin.id);
  });

  test('a Stripe failure leaves the dispute pending and the session paid', async () => {
    refundSession.mockRejectedValueOnce(new Error('card_declined'));
    const student = await createStudent({ dateOfBirth: ADULT_DOB });
    const { tutor } = await createTutor();
    const admin = await createAdmin();
    const session = await createSession(tutor, student, { paymentStatus: 'paid' });
    const dispute = await createDispute(session, student);

    const res = await request(app).post(`/api/admin/session-disputes/${dispute.id}/action`).set(authHeader(admin)).send({ action: 'refund' });
    expect(res.status).toBe(500);

    expect((await SessionDispute.findByPk(dispute.id))!.status).toBe('PENDING');
    const s = (await Session.findByPk(session.id))!;
    expect(s.paymentStatus).toBe('paid');
    expect(s.refundStatus).toBe('none');

    // The admin can retry once Stripe is healthy.
    const retry = await request(app).post(`/api/admin/session-disputes/${dispute.id}/action`).set(authHeader(admin)).send({ action: 'refund' });
    expect(retry.status).toBe(200);
    expect((await SessionDispute.findByPk(dispute.id))!.status).toBe('REFUNDED');
  });

  test.each([
    ['pending', 'pi_x', 'unpaid session'],
    ['refunded', 'pi_x', 'already refunded session'],
    ['paid', undefined, 'paid session with no payment intent on record'],
  ])('does not call Stripe for a %s session with intent %p (%s) but still resolves the dispute', async (paymentStatus, intent) => {
    const student = await createStudent({ dateOfBirth: ADULT_DOB });
    const { tutor } = await createTutor();
    const admin = await createAdmin();
    const session = await createSession(tutor, student, {
      paymentStatus: paymentStatus as any,
      stripePaymentIntentId: intent as string | undefined,
    });
    const dispute = await createDispute(session, student);

    const res = await request(app).post(`/api/admin/session-disputes/${dispute.id}/action`).set(authHeader(admin)).send({ action: 'refund' });
    expect(res.status).toBe(200);
    expect(refundSession).not.toHaveBeenCalled();
    expect((await SessionDispute.findByPk(dispute.id))!.status).toBe('REFUNDED');
  });

  test('dismissing never touches Stripe', async () => {
    const student = await createStudent({ dateOfBirth: ADULT_DOB });
    const { tutor } = await createTutor();
    const admin = await createAdmin();
    const session = await createSession(tutor, student, { paymentStatus: 'paid' });
    const dispute = await createDispute(session, student);
    await request(app).post(`/api/admin/session-disputes/${dispute.id}/action`).set(authHeader(admin)).send({ action: 'dismiss' });
    expect(refundSession).not.toHaveBeenCalled();
    expect((await Session.findByPk(session.id))!.paymentStatus).toBe('paid');
  });
});

describe('cancellation refunds', () => {
  test('tutor cancellation always refunds in full', async () => {
    const student = await createStudent({ dateOfBirth: ADULT_DOB });
    const { user: tutorUser, tutor } = await createTutor({ cancellationNoticeHours: 24, lateCancellationRefundPercent: 0 });
    const session = await createSession(tutor, student, { status: 'CONFIRMED', scheduledAt: hoursFromNow(1), price: 40 });

    const res = await request(app).put(`/api/sessions/${session.id}/cancel`).set(authHeader(tutorUser));
    expect(res.status).toBe(200);
    expect(res.body.data.refundPercent).toBe(100);
    expect(refundSession).toHaveBeenCalledWith({ paymentIntentId: 'pi_test_123', amountInCents: undefined, reason: 'Cancelled by tutor' });

    const s = (await Session.findByPk(session.id))!;
    expect(s.status).toBe('CANCELLED');
    expect(s.cancelledBy).toBe(tutorUser.id);
    expect(s.paymentStatus).toBe('refunded');
    expect(s.refundStatus).toBe('full');
    expect(Number(s.refundAmount)).toBe(40);
  });

  test('student cancelling with enough notice gets a full refund', async () => {
    const student = await createStudent({ dateOfBirth: ADULT_DOB });
    const { tutor } = await createTutor({ cancellationNoticeHours: 24 });
    const session = await createSession(tutor, student, { status: 'CONFIRMED', scheduledAt: hoursFromNow(48) });

    const res = await request(app).put(`/api/sessions/${session.id}/cancel`).set(authHeader(student));
    expect(res.status).toBe(200);
    expect(res.body.data.refundPercent).toBe(100);
    expect(refundSession).toHaveBeenCalledWith(expect.objectContaining({ amountInCents: undefined, reason: 'Cancelled by student' }));
    expect((await Session.findByPk(session.id))!.refundStatus).toBe('full');
  });

  test('late student cancellation refunds the tutor-configured percentage', async () => {
    refundSession.mockResolvedValueOnce({ refundId: 're_partial', amountRefunded: 20 });
    const student = await createStudent({ dateOfBirth: ADULT_DOB });
    const { tutor } = await createTutor({ cancellationNoticeHours: 24, lateCancellationRefundPercent: 50 });
    const session = await createSession(tutor, student, { status: 'CONFIRMED', scheduledAt: hoursFromNow(2), price: 40 });

    const res = await request(app).put(`/api/sessions/${session.id}/cancel`).set(authHeader(student));
    expect(res.status).toBe(200);
    expect(res.body.data.refundPercent).toBe(50);
    expect(refundSession).toHaveBeenCalledWith(expect.objectContaining({ amountInCents: 2000 }));

    const s = (await Session.findByPk(session.id))!;
    expect(s.refundStatus).toBe('partial');
    expect(s.paymentStatus).toBe('refunded');
    expect(Number(s.refundAmount)).toBe(20);
  });

  test('late cancellation with a 0% policy cancels without any refund', async () => {
    const student = await createStudent({ dateOfBirth: ADULT_DOB });
    const { tutor } = await createTutor({ cancellationNoticeHours: 24, lateCancellationRefundPercent: 0 });
    const session = await createSession(tutor, student, { status: 'CONFIRMED', scheduledAt: hoursFromNow(2) });

    const res = await request(app).put(`/api/sessions/${session.id}/cancel`).set(authHeader(student));
    expect(res.status).toBe(200);
    expect(res.body.data.refundPercent).toBe(0);
    expect(res.body.message).toMatch(/no refund/i);
    expect(refundSession).not.toHaveBeenCalled();

    const s = (await Session.findByPk(session.id))!;
    expect(s.status).toBe('CANCELLED');
    expect(s.paymentStatus).toBe('paid');
    expect(s.refundStatus).toBe('none');
  });

  test('a Stripe failure still cancels the session but records the failed refund', async () => {
    refundSession.mockRejectedValueOnce(new Error('stripe down'));
    const student = await createStudent({ dateOfBirth: ADULT_DOB });
    const { user: tutorUser, tutor } = await createTutor();
    const session = await createSession(tutor, student, { status: 'CONFIRMED', scheduledAt: hoursFromNow(10) });

    const res = await request(app).put(`/api/sessions/${session.id}/cancel`).set(authHeader(tutorUser));
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/refund failed/i);

    const s = (await Session.findByPk(session.id))!;
    expect(s.status).toBe('CANCELLED');
    expect(s.refundStatus).toBe('failed');
    expect(s.paymentStatus).toBe('paid'); // money not yet returned: visible to support
  });

  test('unpaid sessions cancel without touching Stripe', async () => {
    const student = await createStudent({ dateOfBirth: ADULT_DOB });
    const { tutor } = await createTutor();
    const session = await createSession(tutor, student, { status: 'PENDING', scheduledAt: hoursFromNow(10), paymentStatus: 'pending', stripePaymentIntentId: undefined });
    const res = await request(app).put(`/api/sessions/${session.id}/cancel`).set(authHeader(student));
    expect(res.status).toBe(200);
    expect(refundSession).not.toHaveBeenCalled();
    expect((await Session.findByPk(session.id))!.refundStatus).toBe('none');
  });

  test('reserved group places cancel with no charge and no refund call', async () => {
    const student = await createStudent({ dateOfBirth: ADULT_DOB });
    const { tutor } = await createTutor();
    const session = await createSession(tutor, student, { status: 'RESERVED', sessionType: 'GROUP', scheduledAt: hoursFromNow(10), paymentStatus: 'pending' });
    const res = await request(app).put(`/api/sessions/${session.id}/cancel`).set(authHeader(student));
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/no charge/i);
    expect(refundSession).not.toHaveBeenCalled();
    expect((await Session.findByPk(session.id))!.status).toBe('CANCELLED');
  });

  test('completed and already-cancelled sessions cannot be cancelled again', async () => {
    const student = await createStudent({ dateOfBirth: ADULT_DOB });
    const { tutor } = await createTutor();
    const done = await createSession(tutor, student, { status: 'COMPLETED' });
    const gone = await createSession(tutor, student, { status: 'CANCELLED' });
    expect((await request(app).put(`/api/sessions/${done.id}/cancel`).set(authHeader(student))).status).toBe(400);
    expect((await request(app).put(`/api/sessions/${gone.id}/cancel`).set(authHeader(student))).status).toBe(400);
    expect(refundSession).not.toHaveBeenCalled();
  });

  test('a linked parent may cancel for a minor; strangers may not', async () => {
    const student = await createStudent({ dateOfBirth: MINOR_DOB });
    const parent = await createParent();
    const stranger = await createParent();
    await linkParent(student, parent);
    const { tutor } = await createTutor();
    const session = await createSession(tutor, student, { status: 'CONFIRMED', scheduledAt: hoursFromNow(48) });

    expect((await request(app).put(`/api/sessions/${session.id}/cancel`).set(authHeader(stranger))).status).toBe(403);
    expect((await Session.findByPk(session.id))!.status).toBe('CONFIRMED');

    const res = await request(app).put(`/api/sessions/${session.id}/cancel`).set(authHeader(parent));
    expect(res.status).toBe(200);
    expect(res.body.data.refundPercent).toBe(100);
    expect((await Session.findByPk(session.id))!.cancelledBy).toBe(parent.id);
  });
});
