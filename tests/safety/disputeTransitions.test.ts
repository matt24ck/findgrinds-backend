import request from 'supertest';
import { app } from '../helpers/app';
import { SessionDispute } from '../../src/models/SessionDispute';
import {
  ADULT_DOB,
  authHeader,
  createAdmin,
  createDispute,
  createSession,
  createStudent,
  createTutor,
  hoursFromNow,
} from '../helpers/factories';

async function fixture() {
  const student = await createStudent({ dateOfBirth: ADULT_DOB });
  const { user: tutorUser, tutor } = await createTutor();
  const admin = await createAdmin();
  return { student, tutorUser, tutor, admin };
}

const VALID = { reason: 'tutor_no_show', details: 'Waited 20 minutes on the call, nobody joined.' };

describe('raising a dispute', () => {
  test('only the student of a past confirmed/completed session can raise one, once', async () => {
    const { student, tutorUser, tutor } = await fixture();
    const session = await createSession(tutor, student, { status: 'COMPLETED', scheduledAt: hoursFromNow(-24) });

    expect((await request(app).post(`/api/sessions/${session.id}/dispute`).set(authHeader(tutorUser)).send(VALID)).status).toBe(403);

    const created = await request(app).post(`/api/sessions/${session.id}/dispute`).set(authHeader(student)).send(VALID);
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe('PENDING');
    expect(created.body.data.reporterId).toBe(student.id);

    const dup = await request(app).post(`/api/sessions/${session.id}/dispute`).set(authHeader(student)).send(VALID);
    expect(dup.status).toBe(400);
    expect(await SessionDispute.count({ where: { sessionId: session.id } })).toBe(1);
  });

  test.each([
    ['PENDING', -24, 'unpaid/unconfirmed session'],
    ['CANCELLED', -24, 'cancelled session'],
    ['CONFIRMED', 24, 'session in the future'],
  ])('cannot dispute a %s session (%s)', async (status, hours) => {
    const { student, tutor } = await fixture();
    const session = await createSession(tutor, student, { status: status as any, scheduledAt: hoursFromNow(hours as number) });
    const res = await request(app).post(`/api/sessions/${session.id}/dispute`).set(authHeader(student)).send(VALID);
    expect(res.status).toBe(400);
    expect(await SessionDispute.count()).toBe(0);
  });

  test('a past CONFIRMED session can be disputed', async () => {
    const { student, tutor } = await fixture();
    const session = await createSession(tutor, student, { status: 'CONFIRMED', scheduledAt: hoursFromNow(-2) });
    const res = await request(app).post(`/api/sessions/${session.id}/dispute`).set(authHeader(student)).send(VALID);
    expect(res.status).toBe(201);
  });

  test('reason and details are validated', async () => {
    const { student, tutor } = await fixture();
    const session = await createSession(tutor, student);
    expect(
      (await request(app).post(`/api/sessions/${session.id}/dispute`).set(authHeader(student)).send({ reason: 'bad_vibes', details: 'x' })).status
    ).toBe(400);
    expect(
      (await request(app).post(`/api/sessions/${session.id}/dispute`).set(authHeader(student)).send({ reason: 'poor_quality', details: '   ' })).status
    ).toBe(400);
    expect(await SessionDispute.count()).toBe(0);
  });
});

describe('tutor response', () => {
  test('only the session tutor can respond, once, while the dispute is pending', async () => {
    const { student, tutorUser, tutor } = await fixture();
    const { user: otherTutor } = await createTutor();
    const session = await createSession(tutor, student);
    await createDispute(session, student);

    const body = { tutorResponse: 'I was on the call at the agreed time; screenshot attached.' };
    expect((await request(app).post(`/api/sessions/${session.id}/dispute/respond`).set(authHeader(student)).send(body)).status).toBe(403);
    expect((await request(app).post(`/api/sessions/${session.id}/dispute/respond`).set(authHeader(otherTutor)).send(body)).status).toBe(403);
    expect((await request(app).post(`/api/sessions/${session.id}/dispute/respond`).set(authHeader(tutorUser)).send({ tutorResponse: ' ' })).status).toBe(400);

    const ok = await request(app).post(`/api/sessions/${session.id}/dispute/respond`).set(authHeader(tutorUser)).send(body);
    expect(ok.status).toBe(200);
    expect(ok.body.data.respondedAt).toBeTruthy();
    expect(ok.body.data.status).toBe('PENDING');

    const twice = await request(app).post(`/api/sessions/${session.id}/dispute/respond`).set(authHeader(tutorUser)).send(body);
    expect(twice.status).toBe(400);
  });

  test('cannot respond after the dispute has been resolved', async () => {
    const { student, tutorUser, tutor, admin } = await fixture();
    const session = await createSession(tutor, student);
    const dispute = await createDispute(session, student);
    await request(app).post(`/api/admin/session-disputes/${dispute.id}/action`).set(authHeader(admin)).send({ action: 'dismiss' });

    const res = await request(app)
      .post(`/api/sessions/${session.id}/dispute/respond`)
      .set(authHeader(tutorUser))
      .send({ tutorResponse: 'too late?' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already been resolved/i);
  });

  test('responding to a session with no dispute is a 404', async () => {
    const { student, tutorUser, tutor } = await fixture();
    const session = await createSession(tutor, student);
    const res = await request(app)
      .post(`/api/sessions/${session.id}/dispute/respond`)
      .set(authHeader(tutorUser))
      .send({ tutorResponse: 'hello?' });
    expect(res.status).toBe(404);
  });
});

describe('admin resolution', () => {
  test('non-admins cannot act on disputes', async () => {
    const { student, tutorUser, tutor } = await fixture();
    const session = await createSession(tutor, student);
    const dispute = await createDispute(session, student);
    for (const user of [student, tutorUser]) {
      const res = await request(app).post(`/api/admin/session-disputes/${dispute.id}/action`).set(authHeader(user)).send({ action: 'dismiss' });
      expect(res.status).toBe(403);
    }
    expect((await SessionDispute.findByPk(dispute.id))!.status).toBe('PENDING');
  });

  test('PENDING -> DISMISSED is recorded with reviewer and time, and is terminal', async () => {
    const { student, tutor, admin } = await fixture();
    const session = await createSession(tutor, student);
    const dispute = await createDispute(session, student);

    expect((await request(app).post(`/api/admin/session-disputes/${dispute.id}/action`).set(authHeader(admin)).send({ action: 'escalate' })).status).toBe(400);

    const dismissed = await request(app).post(`/api/admin/session-disputes/${dispute.id}/action`).set(authHeader(admin)).send({ action: 'dismiss' });
    expect(dismissed.status).toBe(200);
    const stored = (await SessionDispute.findByPk(dispute.id))!;
    expect(stored.status).toBe('DISMISSED');
    expect(stored.reviewedBy).toBe(admin.id);
    expect(stored.reviewedAt).toBeTruthy();

    for (const action of ['refund', 'dismiss']) {
      const again = await request(app).post(`/api/admin/session-disputes/${dispute.id}/action`).set(authHeader(admin)).send({ action });
      expect(again.status).toBe(400);
    }
    expect((await SessionDispute.findByPk(dispute.id))!.status).toBe('DISMISSED');
  });

  test('the queue is filtered by status', async () => {
    const { student, tutor, admin } = await fixture();
    const s1 = await createSession(tutor, student);
    const s2 = await createSession(tutor, student);
    const d1 = await createDispute(s1, student);
    const d2 = await createDispute(s2, student);
    await request(app).post(`/api/admin/session-disputes/${d1.id}/action`).set(authHeader(admin)).send({ action: 'dismiss' });

    const pending = await request(app).get('/api/admin/session-disputes').set(authHeader(admin));
    expect(pending.body.data.map((d: any) => d.id)).toEqual([d2.id]);
    const dismissed = await request(app).get('/api/admin/session-disputes?status=DISMISSED').set(authHeader(admin));
    expect(dismissed.body.data.map((d: any) => d.id)).toEqual([d1.id]);
  });

  test('unknown dispute ids are a 404', async () => {
    const { admin } = await fixture();
    const res = await request(app)
      .post('/api/admin/session-disputes/00000000-0000-4000-8000-000000000000/action')
      .set(authHeader(admin))
      .send({ action: 'dismiss' });
    expect(res.status).toBe(404);
  });
});
