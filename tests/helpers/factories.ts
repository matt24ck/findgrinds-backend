import bcrypt from 'bcryptjs';
import { User } from '../../src/models/User';
import { Tutor } from '../../src/models/Tutor';
import { Session } from '../../src/models/Session';
import { Conversation } from '../../src/models/Conversation';
import { Message } from '../../src/models/Message';
import { ParentLink } from '../../src/models/ParentLink';
import { SessionDispute } from '../../src/models/SessionDispute';
import { signToken } from '../../src/config/jwt';

let seq = 0;
const PASSWORD_HASH = bcrypt.hashSync('Password123!', 4);

/** YYYY-MM-DD for someone who turned `years` exactly `offsetDays` days ago (negative = in the future). */
export function dobYearsAgo(years: number, offsetDays = 0): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() - offsetDays);
  return d.toISOString().slice(0, 10);
}

export const ADULT_DOB = dobYearsAgo(25);
export const MINOR_DOB = dobYearsAgo(15);

type UserType = 'STUDENT' | 'PARENT' | 'TUTOR';

export async function createUser(
  userType: UserType,
  overrides: { dateOfBirth?: string | null; isAdmin?: boolean; firstName?: string; lastName?: string; email?: string } = {}
): Promise<User> {
  seq += 1;
  const { dateOfBirth, ...rest } = overrides;
  return User.create({
    email: rest.email ?? `${userType.toLowerCase()}${seq}@example.test`,
    password: PASSWORD_HASH,
    firstName: rest.firstName ?? `${userType[0]}${userType.slice(1).toLowerCase()}`,
    lastName: rest.lastName ?? `Test${seq}`,
    userType,
    dateOfBirth: dateOfBirth === null ? undefined : dateOfBirth,
    isAdmin: rest.isAdmin ?? false,
  });
}

/** Student with no date of birth on file (the fail-closed case) unless one is given. */
export function createStudent(opts: { dateOfBirth?: string | null } = {}): Promise<User> {
  return createUser('STUDENT', { dateOfBirth: opts.dateOfBirth ?? null });
}

export function createParent(): Promise<User> {
  return createUser('PARENT', { dateOfBirth: ADULT_DOB });
}

export function createAdmin(): Promise<User> {
  return createUser('PARENT', { dateOfBirth: ADULT_DOB, isAdmin: true });
}

export async function createTutor(
  overrides: { cancellationNoticeHours?: number; lateCancellationRefundPercent?: number; baseHourlyRate?: number } = {}
): Promise<{ user: User; tutor: Tutor }> {
  const user = await createUser('TUTOR', { dateOfBirth: ADULT_DOB });
  const tutor = await Tutor.create({
    userId: user.id,
    headline: `${user.firstName} ${user.lastName} - Tutor`,
    qualifications: [],
    subjects: ['MATHS'],
    levels: ['LC'],
    baseHourlyRate: overrides.baseHourlyRate ?? 40,
    cancellationNoticeHours: overrides.cancellationNoticeHours ?? 24,
    lateCancellationRefundPercent: overrides.lateCancellationRefundPercent ?? 0,
  });
  return { user, tutor };
}

export function tokenFor(user: User): string {
  return signToken({ userId: user.id, userType: user.userType });
}

export function authHeader(user: User): { Authorization: string } {
  return { Authorization: `Bearer ${tokenFor(user)}` };
}

export async function linkParent(student: User, parent: User): Promise<ParentLink> {
  return ParentLink.create({
    studentId: student.id,
    parentId: parent.id,
    code: `LNK${String(++seq).padStart(3, '0')}`,
    status: 'ACTIVE',
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
    linkedAt: new Date(),
  });
}

export async function createConversation(
  student: User,
  tutorUser: User,
  firstMessage = 'Hi, could you help with maths?'
): Promise<{ conversation: Conversation; message: Message }> {
  const conversation = await Conversation.create({
    studentId: student.id,
    tutorId: tutorUser.id,
    lastMessageAt: new Date(),
  });
  const message = await Message.create({
    conversationId: conversation.id,
    senderId: student.id,
    content: firstMessage,
  });
  return { conversation, message };
}

export function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 3600 * 1000);
}

export async function createSession(
  tutor: Tutor,
  student: User,
  overrides: Partial<{
    status: 'PENDING' | 'RESERVED' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
    scheduledAt: Date;
    paymentStatus: 'pending' | 'paid' | 'refunded' | 'failed';
    stripePaymentIntentId: string | undefined;
    price: number;
    sessionType: 'VIDEO' | 'IN_PERSON' | 'GROUP';
  }> = {}
): Promise<Session> {
  const price = overrides.price ?? 40;
  return Session.create({
    tutorId: tutor.id,
    studentId: student.id,
    subject: 'MATHS',
    level: 'LC',
    sessionType: overrides.sessionType ?? 'VIDEO',
    scheduledAt: overrides.scheduledAt ?? hoursFromNow(-24),
    durationMins: 60,
    price,
    platformFee: price * 0.15,
    status: overrides.status ?? 'COMPLETED',
    paymentStatus: overrides.paymentStatus ?? 'paid',
    // Explicit `undefined` means "no payment intent on record"; only an omitted key gets the default.
    stripePaymentIntentId: 'stripePaymentIntentId' in overrides ? overrides.stripePaymentIntentId : 'pi_test_123',
  });
}

export async function createDispute(session: Session, student: User): Promise<SessionDispute> {
  return SessionDispute.create({
    sessionId: session.id,
    reporterId: student.id,
    reason: 'tutor_no_show',
    details: 'Tutor did not join the call.',
  });
}

/** Screening service stub: install a fetch mock returning the given result. */
export function mockScreening(result: { flagged: boolean; score?: number; categories?: string[] } | Error) {
  const fetchMock = jest.fn(async () => {
    if (result instanceof Error) throw result;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        flagged: result.flagged,
        score: result.score ?? (result.flagged ? 0.9 : 0.05),
        threshold: 0.5,
        categories: result.categories ?? (result.flagged ? ['phone_number'] : []),
        matches: [],
        version: 'test',
      }),
    } as unknown as Response;
  });
  (global as any).fetch = fetchMock;
  return fetchMock;
}
