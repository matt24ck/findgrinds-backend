import request from 'supertest';
import { app } from '../helpers/app';
import { ParentLink } from '../../src/models/ParentLink';
import { MINOR_DOB, authHeader, createConversation, createParent, createStudent, createTutor } from '../helpers/factories';

describe('parent linking', () => {
  test('a student generates a 6-character code that is reused while it is still pending', async () => {
    const student = await createStudent({ dateOfBirth: MINOR_DOB });

    const first = await request(app).post('/api/parent/generate-code').set(authHeader(student));
    expect(first.status).toBe(201);
    expect(first.body.data.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    expect(first.body.data.isExisting).toBe(false);

    const second = await request(app).post('/api/parent/generate-code').set(authHeader(student));
    expect(second.status).toBe(200);
    expect(second.body.data.code).toBe(first.body.data.code);
    expect(second.body.data.isExisting).toBe(true);

    const mine = await request(app).get('/api/parent/my-code').set(authHeader(student));
    expect(mine.body.data.pendingCode.code).toBe(first.body.data.code);
    expect(mine.body.data.linkedParents).toEqual([]);
  });

  test('only students can generate codes', async () => {
    const parent = await createParent();
    const { user: tutorUser } = await createTutor();
    expect((await request(app).post('/api/parent/generate-code').set(authHeader(parent))).status).toBe(403);
    expect((await request(app).post('/api/parent/generate-code').set(authHeader(tutorUser))).status).toBe(403);
  });

  test('a parent links with the code and the link unlocks free-text messaging for the minor', async () => {
    const student = await createStudent({ dateOfBirth: MINOR_DOB });
    const parent = await createParent();
    const { user: tutorUser } = await createTutor();
    const { conversation } = await createConversation(student, tutorUser);

    const before = await request(app)
      .post(`/api/messages/conversations/${conversation.id}`)
      .set(authHeader(student))
      .send({ message: 'free text' });
    expect(before.status).toBe(403);

    const gen = await request(app).post('/api/parent/generate-code').set(authHeader(student));
    const link = await request(app)
      .post('/api/parent/link')
      .set(authHeader(parent))
      .send({ code: gen.body.data.code.toLowerCase() }); // normalised to upper case
    expect(link.status).toBe(200);
    expect(link.body.data.studentId).toBe(student.id);

    const stored = await ParentLink.findOne({ where: { studentId: student.id } });
    expect(stored?.status).toBe('ACTIVE');
    expect(stored?.parentId).toBe(parent.id);
    expect(stored?.linkedAt).toBeTruthy();

    const after = await request(app)
      .post(`/api/messages/conversations/${conversation.id}`)
      .set(authHeader(student))
      .send({ message: 'free text' });
    expect(after.status).toBe(201);

    const view = await request(app).get(`/api/messages/conversations/${conversation.id}`).set(authHeader(student));
    expect(view.body.data.permission).toEqual({ isMinor: true, hasLinkedParent: true, canFreeText: true });
  });

  test('a code cannot be used twice', async () => {
    const student = await createStudent({ dateOfBirth: MINOR_DOB });
    const parentA = await createParent();
    const parentB = await createParent();
    const gen = await request(app).post('/api/parent/generate-code').set(authHeader(student));
    const code = gen.body.data.code;

    expect((await request(app).post('/api/parent/link').set(authHeader(parentA)).send({ code })).status).toBe(200);
    const reuse = await request(app).post('/api/parent/link').set(authHeader(parentB)).send({ code });
    expect(reuse.status).toBe(404);
    expect(await ParentLink.count({ where: { studentId: student.id, status: 'ACTIVE' } })).toBe(1);
  });

  test('expired and unknown codes are rejected', async () => {
    const student = await createStudent({ dateOfBirth: MINOR_DOB });
    const parent = await createParent();
    await ParentLink.create({
      studentId: student.id,
      code: 'EXPIRD',
      status: 'PENDING',
      expiresAt: new Date(Date.now() - 60_000),
    });
    expect((await request(app).post('/api/parent/link').set(authHeader(parent)).send({ code: 'EXPIRD' })).status).toBe(404);
    expect((await request(app).post('/api/parent/link').set(authHeader(parent)).send({ code: 'NOPE99' })).status).toBe(404);
    expect((await request(app).post('/api/parent/link').set(authHeader(parent)).send({})).status).toBe(400);
  });

  test('only parent accounts can link', async () => {
    const student = await createStudent({ dateOfBirth: MINOR_DOB });
    const other = await createStudent({ dateOfBirth: MINOR_DOB });
    const gen = await request(app).post('/api/parent/generate-code').set(authHeader(student));
    const res = await request(app).post('/api/parent/link').set(authHeader(other)).send({ code: gen.body.data.code });
    expect(res.status).toBe(403);
  });

  test('a parent only sees dashboards and messages of students they are linked to', async () => {
    const student = await createStudent({ dateOfBirth: MINOR_DOB });
    const parent = await createParent();
    const stranger = await createParent();
    const { user: tutorUser } = await createTutor();
    const { conversation } = await createConversation(student, tutorUser);

    const gen = await request(app).post('/api/parent/generate-code').set(authHeader(student));
    await request(app).post('/api/parent/link').set(authHeader(parent)).send({ code: gen.body.data.code });

    expect((await request(app).get(`/api/parent/students/${student.id}/dashboard`).set(authHeader(parent))).status).toBe(200);
    expect((await request(app).get(`/api/parent/students/${student.id}/dashboard`).set(authHeader(stranger))).status).toBe(403);
    expect((await request(app).get(`/api/parent/students/${student.id}/messages`).set(authHeader(stranger))).status).toBe(403);
    expect(
      (await request(app).get(`/api/parent/students/${student.id}/messages/${conversation.id}`).set(authHeader(stranger))).status
    ).toBe(403);

    const list = await request(app).get('/api/parent/students').set(authHeader(parent));
    expect(list.body.data.map((s: any) => s.studentId)).toEqual([student.id]);
  });

  test('unlinking removes parent access and re-applies the messaging restriction', async () => {
    const student = await createStudent({ dateOfBirth: MINOR_DOB });
    const parent = await createParent();
    const { user: tutorUser } = await createTutor();
    const { conversation } = await createConversation(student, tutorUser);

    const gen = await request(app).post('/api/parent/generate-code').set(authHeader(student));
    await request(app).post('/api/parent/link').set(authHeader(parent)).send({ code: gen.body.data.code });

    const unlink = await request(app).delete(`/api/parent/students/${student.id}`).set(authHeader(parent));
    expect(unlink.status).toBe(200);
    expect((await request(app).get(`/api/parent/students/${student.id}/dashboard`).set(authHeader(parent))).status).toBe(403);

    const msg = await request(app)
      .post(`/api/messages/conversations/${conversation.id}`)
      .set(authHeader(student))
      .send({ message: 'free text again?' });
    expect(msg.status).toBe(403);
    expect(msg.body.code).toBe('PREDEFINED_ONLY');
  });

  test('a parent can message a tutor on behalf of a linked child and the message is attributed', async () => {
    const student = await createStudent({ dateOfBirth: MINOR_DOB });
    const parent = await createParent();
    const { user: tutorUser } = await createTutor();
    const { conversation } = await createConversation(student, tutorUser);
    const gen = await request(app).post('/api/parent/generate-code').set(authHeader(student));
    await request(app).post('/api/parent/link').set(authHeader(parent)).send({ code: gen.body.data.code });

    const res = await request(app)
      .post(`/api/parent/students/${student.id}/messages/${conversation.id}`)
      .set(authHeader(parent))
      .send({ message: 'Hello from the parent' });
    expect(res.status).toBe(201);
    expect(res.body.data.senderId).toBe(parent.id);
    expect(res.body.data.onBehalfOfStudentId).toBe(student.id);
  });
});
