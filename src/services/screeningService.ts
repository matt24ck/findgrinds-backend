import { Message } from '../models/Message';
import { MessageReport } from '../models/MessageReport';
import { Conversation } from '../models/Conversation';
import { User } from '../models/User';
import { notifyAdminOfMessageReport } from './reportNotifications';

/**
 * Client for the message screening service (screening-service/, Python).
 *
 * Screens tutor messages sent to minors for off-platform contact solicitation
 * (phone numbers, WhatsApp/Snapchat handles, "let's move to...", meet-up
 * requests). A positive result is FLAGGED into the message report queue with
 * reason `off_platform_contact`; the message is never blocked or delayed.
 *
 * Failure mode: if the service is unreachable or slow, the message is still
 * delivered and the failure is logged. The screener is a detector feeding
 * human review, not a gate, so delivery fails open while age fails closed.
 */

export interface ScreeningMatch {
  category: string;
  pattern: string;
  excerpt: string;
}

export interface ScreeningResult {
  flagged: boolean;
  score: number;
  threshold: number;
  categories: string[];
  matches: ScreeningMatch[];
  version: string;
}

export interface ScreeningContext {
  messageId?: string;
  senderRole?: 'TUTOR' | 'STUDENT' | 'PARENT';
  recipientIsMinor?: boolean;
}

export const AUTO_SCREENING_REASON = 'off_platform_contact' as const;

const DEFAULT_TIMEOUT_MS = 2500;
let warnedDisabled = false;

function serviceUrl(): string | null {
  const url = process.env.SCREENING_SERVICE_URL;
  if (!url) {
    if (!warnedDisabled && process.env.NODE_ENV !== 'test') {
      warnedDisabled = true;
      console.warn('[screening] SCREENING_SERVICE_URL not set - tutor messages to minors are NOT being screened.');
    }
    return null;
  }
  return url.replace(/\/$/, '');
}

export const screeningService = {
  isEnabled(): boolean {
    return !!serviceUrl();
  },

  /** Call the screening service. Returns null (and logs) on any failure. */
  async screenText(text: string, context: ScreeningContext = {}): Promise<ScreeningResult | null> {
    const base = serviceUrl();
    if (!base) return null;
    const timeoutMs = Number(process.env.SCREENING_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
    try {
      const res = await fetch(`${base}/screen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          message_id: context.messageId ?? null,
          sender_role: context.senderRole ?? null,
          recipient_is_minor: context.recipientIsMinor ?? null,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        console.error(`[screening] service returned HTTP ${res.status}`);
        return null;
      }
      const data = (await res.json()) as Partial<ScreeningResult>;
      if (typeof data.flagged !== 'boolean' || typeof data.score !== 'number') {
        console.error('[screening] malformed response from service');
        return null;
      }
      return {
        flagged: data.flagged,
        score: data.score,
        threshold: typeof data.threshold === 'number' ? data.threshold : 0,
        categories: Array.isArray(data.categories) ? data.categories : [],
        matches: Array.isArray(data.matches) ? data.matches : [],
        version: typeof data.version === 'string' ? data.version : 'unknown',
      };
    } catch (err: any) {
      console.error(
        '[screening] request failed:',
        err?.name === 'TimeoutError' ? 'timeout' : err?.message || err
      );
      return null;
    }
  },

  /**
   * Screen a freshly-sent message if (and only if) it was sent by the tutor in
   * the conversation to a student who must be treated as a minor.
   * Returns the created (or pre-existing) automated report, or null.
   */
  async screenTutorMessage(message: Message, conversation: Conversation): Promise<MessageReport | null> {
    if (message.senderId !== conversation.tutorId) return null;
    if (!this.isEnabled()) return null;

    const student = await User.findByPk(conversation.studentId, { attributes: ['id', 'dateOfBirth'] });
    if (!student || !student.isMinor()) return null;

    const result = await this.screenText(message.content, {
      messageId: message.id,
      senderRole: 'TUTOR',
      recipientIsMinor: true,
    });
    if (!result || !result.flagged) return null;

    const existing = await MessageReport.findOne({ where: { messageId: message.id, source: 'auto_screening' } });
    if (existing) return existing;

    const categories = result.categories.length ? result.categories.join(', ') : 'unspecified';
    let report: MessageReport;
    try {
      report = await MessageReport.create({
        messageId: message.id,
        reporterId: null,
        source: 'auto_screening',
        reason: AUTO_SCREENING_REASON,
        details:
          'Automated screening flagged possible off-platform contact solicitation in a tutor message to a minor ' +
          `(signals: ${categories}; score ${result.score.toFixed(2)}, threshold ${result.threshold.toFixed(2)}). ` +
          'The message was delivered, not blocked. Please review.',
        metadata: {
          score: result.score,
          threshold: result.threshold,
          categories: result.categories,
          matches: result.matches,
          screenerVersion: result.version,
        },
      });
    } catch (err: any) {
      // Partial unique index on message_id where source = 'auto_screening':
      // a concurrent screen of the same message already created the report.
      if (err?.name === 'SequelizeUniqueConstraintError') {
        return MessageReport.findOne({ where: { messageId: message.id, source: 'auto_screening' } });
      }
      throw err;
    }

    const sender = await User.findByPk(message.senderId, { attributes: ['firstName', 'lastName'] });
    await notifyAdminOfMessageReport({
      reportId: report.id,
      messageId: message.id,
      reason: AUTO_SCREENING_REASON,
      source: 'auto_screening',
      senderName: sender ? `${sender.firstName} ${sender.lastName}` : undefined,
      summary: `signals: ${categories}`,
    });

    return report;
  },
};
