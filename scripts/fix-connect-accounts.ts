/**
 * One-off: bring existing tutor Stripe Connect accounts in line with how new
 * ones are created (see createConnectAccount in src/services/stripeService.ts),
 * so Stripe stops asking tutors for a business website, industry etc.
 *
 * For every Express account on the platform it fills in
 * business_profile.mcc / product_description / url if missing, so Express
 * onboarding stops asking tutors for them.
 *
 * It does NOT remove `card_payments`: Stripe rejects transfers-only accounts
 * unless the platform has been approved for them by Stripe support.
 *
 * Accounts are collected from both Stripe's account list and the
 * tutors.stripe_connect_account_id column (Stripe's list can omit some
 * accounts). If the database is unreachable it carries on with Stripe's list.
 * Accounts that don't exist in the current Stripe mode (test vs live) are skipped.
 *
 * Usage (from findgrinds-backend/):
 *   npx ts-node scripts/fix-connect-accounts.ts            # dry run: print what would change
 *   npx ts-node scripts/fix-connect-accounts.ts --apply    # make the changes
 *
 * To run against LIVE accounts, use the production env from Railway:
 *   railway run npx ts-node scripts/fix-connect-accounts.ts
 *   railway run npx ts-node scripts/fix-connect-accounts.ts --apply
 *
 * Safe to re-run: accounts that are already correct are skipped.
 */
import dotenv from 'dotenv';
import Stripe from 'stripe';
import { Sequelize, QueryTypes } from 'sequelize';

dotenv.config(); // never overrides variables already set (e.g. by `railway run`)

const APPLY = process.argv.includes('--apply');
const MCC = '8299'; // Schools and educational services
const PRODUCT_DESCRIPTION = 'Private tutoring sessions and study resources sold via FindGrinds';

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
  const mode = key.startsWith('sk_live') || key.startsWith('rk_live') ? 'LIVE' : 'TEST';

  const frontendUrl = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
  const canSetUrl = !!frontendUrl && !frontendUrl.includes('localhost');

  console.log(`Stripe mode: ${mode}   ${APPLY ? 'APPLYING CHANGES' : 'DRY RUN (pass --apply to change anything)'}`);
  if (!canSetUrl) console.log('FRONTEND_URL is unset or localhost, so profile URLs will not be filled in.');
  console.log('');

  const stripe = new Stripe(key, { apiVersion: '2025-02-24.acacia' });
  let checked = 0, changed = 0, failed = 0, notInMode = 0;

  const ids = new Set<string>();
  for await (const a of stripe.accounts.list({ limit: 100 })) ids.add(a.id);
  const fromStripe = ids.size;
  // Railway's DATABASE_URL is a private hostname that only resolves inside Railway;
  // from your own machine pass the Postgres service's public URL as DATABASE_PUBLIC_URL.
  const dbUrl = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (dbUrl) {
    const db = new Sequelize(dbUrl, {
      dialect: 'postgres',
      logging: false,
      dialectOptions: { connectionTimeoutMillis: 10000 },
    });
    try {
      const rows = await db.query<{ id: string }>(
        'SELECT stripe_connect_account_id AS id FROM tutors WHERE stripe_connect_account_id IS NOT NULL',
        { type: QueryTypes.SELECT }
      );
      rows.forEach((r) => ids.add(r.id));
      console.log(`${fromStripe} account(s) from Stripe's list, ${rows.length} from the tutors table, ${ids.size} unique.`);
    } catch (err: any) {
      console.log(`Could not read tutors table (${err?.message}); using Stripe's list only.`);
    } finally {
      await db.close();
    }
  } else {
    console.log("DATABASE_URL not set; using Stripe's list only.");
  }
  console.log('');

  for (const id of ids) {
    let account: Stripe.Account;
    try {
      account = await stripe.accounts.retrieve(id);
    } catch (err: any) {
      if (err?.code === 'resource_missing' || /no such account/i.test(err?.message || '')) {
        notInMode++;
        continue;
      }
      console.log(`FAILED   ${id}: ${err?.message || err}`);
      failed++;
      continue;
    }
    if (account.type !== 'express') continue;
    checked++;

    const update: Stripe.AccountUpdateParams = {};
    const notes: string[] = [];

    const bp: Partial<Stripe.Account.BusinessProfile> = account.business_profile || {};
    const profile: Stripe.AccountUpdateParams.BusinessProfile = {};
    if (!bp.mcc) profile.mcc = MCC;
    if (!bp.product_description) profile.product_description = PRODUCT_DESCRIPTION;
    const tutorId = account.metadata?.tutorId;
    if (!bp.url && canSetUrl && tutorId) profile.url = `${frontendUrl}/tutors/${tutorId}`;
    if (Object.keys(profile).length) {
      update.business_profile = profile;
      notes.push(`set ${Object.keys(profile).join(', ')}`);
    }

    const label = `${account.id} (tutor ${tutorId || 'unknown'}, ${account.email || 'no email'})`;
    if (!notes.length) {
      console.log(`ok       ${label}`);
      continue;
    }

    if (!APPLY) {
      console.log(`would    ${label}: ${notes.join('; ')}`);
      changed++;
      continue;
    }

    try {
      await stripe.accounts.update(account.id, update);
      console.log(`updated  ${label}: ${notes.join('; ')}`);
      changed++;
    } catch (err: any) {
      console.log(`FAILED   ${label}: ${err?.message || err}`);
      failed++;
    }
  }

  console.log('');
  console.log(`${checked} Express account(s) checked, ${changed} ${APPLY ? 'updated' : 'need changes'}, ${failed} failed.`);
  if (notInMode) console.log(`${notInMode} account id(s) from the database don't exist in ${mode} mode and were skipped.`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
