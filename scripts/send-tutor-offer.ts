/**
 * One-off: email every active tutor the "0% fees" offer (Sept 2026).
 * Tutors already on the Professional plan are skipped (the offer includes a free month of it).
 *
 * Usage (from findgrinds-backend/):
 *   npx ts-node scripts/send-tutor-offer.ts --sender-name "Name"                       # dry run: list recipients, preview email
 *   npx ts-node scripts/send-tutor-offer.ts --sender-name "Name" --test you@example.com # send ONE copy to yourself
 *   npx ts-node scripts/send-tutor-offer.ts --sender-name "Name" --send                 # send to all recipients
 *
 * Options:
 *   --consented-only        only tutors with marketing_consent = true
 *   --exclude a@x.ie,b@y.ie skip these addresses (e.g. your own test accounts)
 *
 * Safe to re-run: each send is recorded in scripts/.tutor-offer-sent.json and skipped next time,
 * and Resend's idempotency key blocks duplicates for 24h even if that file is lost.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { Sequelize, QueryTypes } from 'sequelize';
import { Resend } from 'resend';

dotenv.config();

const FROM = 'support@findgrinds.ie';
const REPLY_TO = 'support@findgrinds.ie';
const SUBJECT = 'Book one of your students on FindGrinds, pay 0% fees';
const CAMPAIGN = 'tutor-offer-2026-09';
const SENT_LOG = path.join(__dirname, '.tutor-offer-sent.json');
const DELAY_MS = 600; // stays under Resend's default 2 requests/second
const UNSUBSCRIBE_URL = `mailto:${REPLY_TO}?subject=Unsubscribe&body=Please%20stop%20sending%20me%20FindGrinds%20offer%20emails.`;

interface Tutor {
  user_id: string;
  email: string;
  first_name: string;
  marketing_consent: boolean;
  featured_tier: 'FREE' | 'PROFESSIONAL' | 'ENTERPRISE';
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}
const flag = (name: string) => process.argv.includes(name);

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function buildEmail(firstName: string, senderName: string) {
  const text = `Hi ${firstName},

I'm ${senderName}, founder of FindGrinds. Thanks for being one of our first tutors.

Here's an offer: ask one of your current students to book their next lesson with you through FindGrinds instead of arranging it privately. Do that before 31 October and you'll get:

• 0% platform fees on any student you bring to FindGrinds, for the rest of this school year!
• A free month of Professional (priority search placement), to activate at a time of your choosing!

Any questions, just reply. I read every email.

Thanks,
${senderName}
Founder, FindGrinds
findgrinds.ie

--
Don't want emails like this? Unsubscribe: ${UNSUBSCRIBE_URL}`;

  const f = escapeHtml(firstName);
  const s = escapeHtml(senderName);
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #2C3E50; max-width: 600px; margin: 0 auto; padding: 20px;">
<div style="text-align: center; margin-bottom: 30px;">
  <h1 style="color: #2D9B6E; margin: 0;">FindGrinds</h1>
  <p style="color: #5D6D7E; margin: 5px 0 0 0;">Find the Right Grinds Tutor</p>
</div>
<p>Hi ${f},</p>
<p>I'm ${s}, founder of FindGrinds. Thanks for being one of our first tutors.</p>
<p>Here's an offer: ask one of your current students to book their next lesson with you through FindGrinds instead of arranging it privately. Do that before 31 October and you'll get:</p>
<ul style="padding-left: 20px;">
  <li>0% platform fees on any student you bring to FindGrinds, for the rest of this school year!</li>
  <li>A free month of Professional (priority search placement), to activate at a time of your choosing!</li>
</ul>
<p>Any questions, just reply. I read every email.</p>
<p>Thanks,<br>${s}<br>Founder, FindGrinds<br><a href="https://findgrinds.ie" style="color: #2D9B6E;">findgrinds.ie</a></p>
<hr style="border: none; border-top: 1px solid #E5E7EB; margin: 30px 0;">
<p style="color: #9CA3AF; font-size: 12px; text-align: center;">
  FindGrinds | Dublin, Ireland<br>
  <a href="https://findgrinds.ie" style="color: #2D9B6E;">findgrinds.ie</a><br><br>
  Don't want emails like this? <a href="${UNSUBSCRIBE_URL}" style="color: #9CA3AF;">Unsubscribe</a>
</p>
</body></html>`;

  return { text, html };
}

function loadSent(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(SENT_LOG, 'utf-8'));
  } catch {
    return {};
  }
}

async function main() {
  const senderName = arg('--sender-name');
  const testTo = arg('--test');
  const send = flag('--send');
  const consentedOnly = flag('--consented-only');
  const exclude = new Set((arg('--exclude') || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean));

  if (!senderName) {
    console.error('Missing --sender-name "Your Name" (used in the greeting and sign-off).');
    process.exit(1);
  }
  if (send && testTo) {
    console.error('Use either --test or --send, not both.');
    process.exit(1);
  }

  // Prefer the public URL: under `railway run`, DATABASE_URL points at postgres.railway.internal,
  // which only resolves inside Railway's network.
  const databaseUrl = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL!;
  const sequelize = new Sequelize(databaseUrl, { dialect: 'postgres', logging: false });
  let tutors: Tutor[];
  try {
    tutors = await sequelize.query<Tutor>(
      `SELECT u.id AS user_id, u.email, u.first_name, u.marketing_consent, t.featured_tier
         FROM tutors t
         JOIN users u ON u.id = t.user_id
        WHERE u.account_status = 'ACTIVE'
        ORDER BY u.created_at`,
      { type: QueryTypes.SELECT }
    );
  } finally {
    await sequelize.close();
  }

  const consented = tutors.filter((t) => t.marketing_consent).length;
  const tierCount = (tier: Tutor['featured_tier']) => tutors.filter((t) => t.featured_tier === tier).length;
  const recipients = tutors
    .filter((t) => t.featured_tier !== 'PROFESSIONAL')
    .filter((t) => !consentedOnly || t.marketing_consent)
    .filter((t) => !exclude.has(t.email.toLowerCase()));
  const sent = loadSent();
  const pending = recipients.filter((t) => !sent[t.user_id]);

  console.log(`Active tutors: ${tutors.length} (${consented} with marketing consent, ${tutors.length - consented} without)`);
  console.log(`Plans: ${tierCount('FREE')} Free, ${tierCount('PROFESSIONAL')} Professional (skipped), ${tierCount('ENTERPRISE')} Enterprise`);
  console.log(`Recipients after filters: ${recipients.length} | already sent: ${recipients.length - pending.length} | to send: ${pending.length}\n`);

  if (testTo) {
    const sample = recipients[0]?.first_name || 'there';
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { text, html } = buildEmail(sample, senderName);
    const { data, error } = await resend.emails.send({
      from: `${senderName} at FindGrinds <${FROM}>`,
      to: testTo,
      replyTo: REPLY_TO,
      subject: `[TEST] ${SUBJECT}`,
      text,
      html,
    });
    if (error) throw new Error(`Test send failed: ${JSON.stringify(error)}`);
    console.log(`Test email sent to ${testTo} (id ${data?.id}), addressed to "${sample}".`);
    return;
  }

  if (!send) {
    for (const t of pending) {
      console.log(`  ${t.first_name.padEnd(15)} ${t.email}${t.marketing_consent ? '' : '   (no marketing consent)'}`);
    }
    console.log('\n--- Preview (first recipient) ---\n');
    console.log(buildEmail(pending[0]?.first_name || 'there', senderName).text);
    console.log('\nDry run only. Nothing was sent. Add --test <email> to send yourself a copy, or --send to send for real.');
    return;
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  let ok = 0;
  const failed: string[] = [];
  for (const t of pending) {
    const { text, html } = buildEmail(t.first_name, senderName);
    const { data, error } = await resend.emails.send(
      {
        from: `${senderName} at FindGrinds <${FROM}>`,
        to: t.email,
        replyTo: REPLY_TO,
        subject: SUBJECT,
        text,
        html,
        headers: { 'List-Unsubscribe': `<${UNSUBSCRIBE_URL}>` },
        tags: [{ name: 'campaign', value: CAMPAIGN }],
      },
      { idempotencyKey: `${CAMPAIGN}/${t.user_id}` }
    );
    if (error) {
      failed.push(t.email);
      console.error(`  ✗ ${t.email}: ${error.message}`);
    } else {
      sent[t.user_id] = data?.id || 'sent';
      fs.writeFileSync(SENT_LOG, JSON.stringify(sent, null, 2));
      ok++;
      console.log(`  ✓ ${t.email}`);
    }
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  console.log(`\nDone. Sent ${ok}, failed ${failed.length}.`);
  if (failed.length) console.log('Re-run the same command to retry the failures; successful sends are skipped.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
