import { Resend } from 'resend';

/**
 * Admin notification for a new message report.
 *
 * Deliberately does NOT include the message text: email is an uncontrolled
 * channel (forwarded, cached, indexed by the mail provider), and the content
 * can involve a minor. Admins review the message itself in the admin queue,
 * which is behind auth.
 */
export interface MessageReportNotification {
  reportId: string;
  messageId: string;
  reason: string;
  source: 'user' | 'auto_screening';
  reporterName?: string;
  senderName?: string;
  /** Short, non-content summary (e.g. screening categories). */
  summary?: string;
}

export function adminQueueUrl(): string {
  const base = (process.env.FRONTEND_URL || 'https://findgrinds.ie').replace(/\/$/, '');
  return `${base}/admin/reports`;
}

export async function notifyAdminOfMessageReport(n: MessageReportNotification): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const to = process.env.ADMIN_NOTIFICATION_EMAIL || process.env.FROM_EMAIL || 'info@findgrinds.ie';
    const from = process.env.FROM_EMAIL || 'FindGrinds <noreply@findgrinds.ie>';
    const origin =
      n.source === 'auto_screening' ? 'Raised by: automated message screening' : `Reported by: ${n.reporterName || 'a user'}`;
    const lines = [
      'A message has been reported and is waiting in the review queue.',
      '',
      `Reason: ${n.reason}`,
      origin,
      n.senderName ? `Message from: ${n.senderName}` : null,
      n.summary ? `Summary: ${n.summary}` : null,
      `Report ID: ${n.reportId}`,
      `Message ID: ${n.messageId}`,
      '',
      `Review it here: ${adminQueueUrl()}`,
      '',
      'Message content is intentionally not included in this email.',
    ].filter((l): l is string => l !== null);

    await resend.emails.send({
      from,
      to,
      subject: `[FindGrinds] Message report - ${n.reason}${n.source === 'auto_screening' ? ' (automated)' : ''}`,
      text: lines.join('\n'),
    });
  } catch (err) {
    console.error('Failed to send report notification email:', err);
  }
}
