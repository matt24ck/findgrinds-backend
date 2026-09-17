import request from 'supertest';
import { app } from '../helpers/app';
import { MessageReport } from '../../src/models/MessageReport';
import { Message } from '../../src/models/Message';
import { screeningService } from '../../src/services/screeningService';
import {
  ADULT_DOB,
  MINOR_DOB,
  authHeader,
  createAdmin,
  createConversation,
  createParent,
  createStudent,
  createTutor,
  linkParent,
  mockScreening,
} from '../helpers/factories';

const originalFetch = (global as any).fetch;
afterEach(() => {
  (global as any).fetch = originalFetch;
  process.env.SCREENING_SERVICE_URL = 'http://screening.test.invalid';
  delete process.env.RESEND_API_KEY;
});

describe('user message reports', () => {
  test('a participant can report a message once; the other participant can report it too', async () => {
    const student = await createStudent({ dateOfBirth: ADULT_DOB });
    const { user: tutorUser } = await createTutor();
    const { message } = await createConversation(student, tutorUser);

    const first = await request(app)
      .post(`/api/messages/${message.id}/report`)
      .set(authHeader(tutorUser))
      .send({ reason: 'spam', details: 'looks automated' });
    expect(first.status).toBe(201);

    const dup = await request(app)
      .post(`/api/messages/${message.id}/report`)
      .set(authHeader(tutorUser))
      .send({ reason: 'harassment' });
    expect(dup.status).toBe(400);
    expect(dup.body.error).toMatch(/already reported/i);

    const other = await request(app)
      .post(`/api/messages/${message.id}/report`)
      .set(authHeader(student))
      .send({ reason: 'other' });
    expect(other.status).toBe(201);

    expect(await MessageReport.count({ where: { messageId: message.id } })).toBe(2);
    const stored = await MessageReport.findAll({ where: { messageId: message.id } });
    expect(stored.every((r) => r.source === 'user' && r.status === 'PENDING')).toBe(true);
  });

  test('non-participants cannot report, and unknown reasons are rejected', async () => {
    const student = await createStudent({ dateOfBirth: ADULT_DOB });
    const stranger = await createStudent({ dateOfBirth: ADULT_DOB });
    const { user: tutorUser } = await createTutor();
    const { message } = await createConversation(student, tutorUser);

    expect(
      (await request(app).post(`/api/messages/${message.id}/report`).set(authHeader(stranger)).send({ reason: 'spam' })).status
    ).toBe(403);
    expect(
      (await request(app).post(`/api/messages/${message.id}/report`).set(authHeader(student)).send({ reason: 'rude' })).status
    ).toBe(400);
    expect(await MessageReport.count()).toBe(0);
  });

  test('the new off_platform_contact reason is accepted from users', async () => {
    const student = await createStudent({ dateOfBirth: ADULT_DOB });
    const { user: tutorUser } = await createTutor();
    const { message } = await createConversation(student, tutorUser);
    const res = await request(app)
      .post(`/api/messages/${message.id}/report`)
      .set(authHeader(tutorUser))
      .send({ reason: 'off_platform_contact' });
    expect(res.status).toBe(201);
  });

  test('admins review a report exactly once', async () => {
    const student = await createStudent({ dateOfBirth: ADULT_DOB });
    const { user: tutorUser } = await createTutor();
    const admin = await createAdmin();
    const { message } = await createConversation(student, tutorUser);
    const created = await request(app)
      .post(`/api/messages/${message.id}/report`)
      .set(authHeader(tutorUser))
      .send({ reason: 'spam' });
    const reportId = created.body.data.id;

    expect((await request(app).get('/api/messages/admin/reports').set(authHeader(student))).status).toBe(403);

    const queue = await request(app).get('/api/messages/admin/reports').set(authHeader(admin));
    expect(queue.status).toBe(200);
    expect(queue.body.data.map((r: any) => r.id)).toEqual([reportId]);

    const review = await request(app)
      .post(`/api/messages/admin/reports/${reportId}/review`)
      .set(authHeader(admin))
      .send({ action: 'dismissed' });
    expect(review.status).toBe(200);
    expect(review.body.data.status).toBe('DISMISSED');

    const again = await request(app)
      .post(`/api/messages/admin/reports/${reportId}/review`)
      .set(authHeader(admin))
      .send({ action: 'reviewed' });
    expect(again.status).toBe(400);

    const stored = await MessageReport.findByPk(reportId);
    expect(stored?.status).toBe('DISMISSED');
    expect(stored?.reviewedBy).toBe(admin.id);
    expect(stored?.reviewedAt).toBeTruthy();
  });
});

describe('automated screening of tutor messages to minors', () => {
  async function tutorSends(content: string) {
    const student = await createStudent(); // no date of birth: treated as a minor
    const { user: tutorUser } = await createTutor();
    const { conversation } = await createConversation(student, tutorUser);
    const res = await request(app)
      .post(`/api/messages/conversations/${conversation.id}`)
      .set(authHeader(tutorUser))
      .send({ message: content });
    return { student, tutorUser, conversation, res };
  }

  test('a flagged tutor message to a minor is delivered AND lands in the report queue', async () => {
    const fetchMock = mockScreening({ flagged: true, score: 0.92, categories: ['phone_number', 'move_off_platform'] });
    const { res, tutorUser } = await tutorSends('text me on 087 123 4567');
    expect(res.status).toBe(201); // never blocked

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://screening.test.invalid/screen');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ text: 'text me on 087 123 4567', sender_role: 'TUTOR', recipient_is_minor: true });

    const report = await MessageReport.findOne({ where: { messageId: res.body.data.id } });
    expect(report).not.toBeNull();
    expect(report).toMatchObject({
      source: 'auto_screening',
      reason: 'off_platform_contact',
      reporterId: null,
      status: 'PENDING',
    });
    expect(report?.metadata).toMatchObject({ score: 0.92, categories: ['phone_number', 'move_off_platform'] });
    expect(report?.details).toMatch(/not blocked/i);

    const sent = await Message.findByPk(res.body.data.id);
    expect(sent?.senderId).toBe(tutorUser.id);
  });

  test('a clean tutor message to a minor creates no report', async () => {
    const fetchMock = mockScreening({ flagged: false });
    const { res } = await tutorSends('See you on the video call at 7');
    expect(res.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await MessageReport.count()).toBe(0);
  });

  test('messages to adult students are not screened', async () => {
    const fetchMock = mockScreening({ flagged: true });
    const student = await createStudent({ dateOfBirth: ADULT_DOB });
    const { user: tutorUser } = await createTutor();
    const { conversation } = await createConversation(student, tutorUser);
    const res = await request(app)
      .post(`/api/messages/conversations/${conversation.id}`)
      .set(authHeader(tutorUser))
      .send({ message: 'text me on 087 123 4567' });
    expect(res.status).toBe(201);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await MessageReport.count()).toBe(0);
  });

  test('messages sent by the student side are not screened', async () => {
    const fetchMock = mockScreening({ flagged: true });
    const student = await createStudent({ dateOfBirth: MINOR_DOB });
    await linkParent(student, await createParent());
    const { user: tutorUser } = await createTutor();
    const { conversation } = await createConversation(student, tutorUser);
    const res = await request(app)
      .post(`/api/messages/conversations/${conversation.id}`)
      .set(authHeader(student))
      .send({ message: 'my number is 087 123 4567' });
    expect(res.status).toBe(201);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('screening the same message twice, even concurrently, yields exactly one report', async () => {
    mockScreening({ flagged: true });
    const { res, conversation } = await tutorSends('add me on snap');
    const message = (await Message.findByPk(res.body.data.id))!;
    const conv = (await conversation.reload())!;

    const [a, b] = await Promise.all([
      screeningService.screenTutorMessage(message, conv),
      screeningService.screenTutorMessage(message, conv),
    ]);
    await screeningService.screenTutorMessage(message, conv);

    const reports = await MessageReport.findAll({ where: { messageId: message.id, source: 'auto_screening' } });
    expect(reports).toHaveLength(1);
    expect(a?.id).toBe(reports[0].id);
    expect(b?.id).toBe(reports[0].id);
  });

  test('an automated report and a user report can coexist on one message', async () => {
    mockScreening({ flagged: true });
    const { res, student } = await tutorSends('whats your number');
    const userReport = await request(app)
      .post(`/api/messages/${res.body.data.id}/report`)
      .set(authHeader(student))
      .send({ reason: 'safety_concern' });
    expect(userReport.status).toBe(201);
    const all = await MessageReport.findAll({ where: { messageId: res.body.data.id } });
    expect(all.map((r) => r.source).sort()).toEqual(['auto_screening', 'user']);
  });

  test('a screening outage never blocks delivery', async () => {
    mockScreening(new Error('ECONNREFUSED'));
    const { res } = await tutorSends('text me on 087 123 4567');
    expect(res.status).toBe(201);
    expect(await MessageReport.count()).toBe(0);

    (global as any).fetch = jest.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    const second = await tutorSends('text me on 087 123 4567');
    expect(second.res.status).toBe(201);
    expect(await MessageReport.count()).toBe(0);
  });

  test('screening is off when SCREENING_SERVICE_URL is not configured', async () => {
    const fetchMock = mockScreening({ flagged: true });
    delete process.env.SCREENING_SERVICE_URL;
    const { res } = await tutorSends('text me on 087 123 4567');
    expect(res.status).toBe(201);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('the admin queue shows automated reports with no reporter and their source', async () => {
    mockScreening({ flagged: true });
    const { res } = await tutorSends('add me on snap');
    const admin = await createAdmin();
    const queue = await request(app).get('/api/messages/admin/reports').set(authHeader(admin));
    expect(queue.status).toBe(200);
    expect(queue.body.data).toHaveLength(1);
    expect(queue.body.data[0]).toMatchObject({
      source: 'auto_screening',
      reason: 'off_platform_contact',
      reporter: null,
      message: { id: res.body.data.id, content: 'add me on snap' },
    });
  });
});

describe('admin report emails', () => {
  test('never contain the message content, for user or automated reports', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    const { __mockSend: send } = jest.requireMock('resend') as { __mockSend: jest.Mock };
    const secret = 'SECRET-CONTENT-4f8c1a';

    mockScreening({ flagged: true });
    const { res, student } = await tutorSends(`${secret} text me on 087 123 4567`);
    await request(app).post(`/api/messages/${res.body.data.id}/report`).set(authHeader(student)).send({ reason: 'safety_concern' });

    expect(send).toHaveBeenCalledTimes(2);
    for (const call of send.mock.calls) {
      const payload = call[0] as { text: string; subject: string; html?: string };
      const everything = `${payload.subject}\n${payload.text}\n${payload.html ?? ''}`;
      expect(everything).not.toContain(secret);
      expect(everything).not.toContain('087 123 4567');
      expect(payload.text).toContain('/admin/reports');
    }
  });

  async function tutorSends(content: string) {
    const student = await createStudent();
    const { user: tutorUser } = await createTutor();
    const { conversation } = await createConversation(student, tutorUser);
    const res = await request(app)
      .post(`/api/messages/conversations/${conversation.id}`)
      .set(authHeader(tutorUser))
      .send({ message: content });
    return { student, tutorUser, conversation, res };
  }
});
