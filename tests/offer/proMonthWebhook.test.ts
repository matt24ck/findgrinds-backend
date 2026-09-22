/**
 * The free Professional month is a Stripe trial. These tests run the REAL stripeService
 * webhook handler (the global mock is lifted for this file) against a fake Stripe client.
 */
jest.unmock('../../src/services/stripeService');

const TRIAL_END = Math.floor(new Date('2026-11-20T10:00:00Z').getTime() / 1000);
const retrieve = jest.fn();
const cancel = jest.fn();
const checkoutCreate = jest.fn();

jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({
    subscriptions: { retrieve, cancel },
    checkout: { sessions: { create: checkoutCreate } },
    customers: { create: jest.fn().mockResolvedValue({ id: 'cus_test' }) },
  }))
);

import { Tutor } from '../../src/models/Tutor';
import { User } from '../../src/models/User';
import { TutorSubscription } from '../../src/models/TutorSubscription';
import { stripeService } from '../../src/services/stripeService';
import { emailService } from '../../src/services/emailService';
import { createTutor } from '../helpers/factories';

beforeEach(() => {
  retrieve.mockReset().mockResolvedValue({
    id: 'sub_trial',
    status: 'trialing',
    trial_end: TRIAL_END,
    current_period_start: TRIAL_END - 30 * 86400,
    current_period_end: TRIAL_END,
    items: { data: [{ price: { id: 'price_pro' } }] },
  });
  checkoutCreate.mockReset().mockResolvedValue({ url: 'https://checkout.stripe.test/s' });
  cancel.mockReset().mockResolvedValue({});
});

const completedCheckout = (tutorId: string, promo?: string, subscription = 'sub_trial') =>
  ({
    subscription,
    metadata: { type: 'tutor_subscription', tutorId, tier: 'PROFESSIONAL', ...(promo && { promo }) },
  }) as any;

test('trial checkout asks Stripe for a 30-day trial with the card collected up front', async () => {
  const { user, tutor } = await createTutor();
  await user.update({ stripeCustomerId: 'cus_existing' });

  await stripeService.createSubscriptionCheckout({
    tutor,
    user: (await User.findByPk(user.id))!,
    priceId: 'price_pro',
    tier: 'PROFESSIONAL',
    trialDays: 30,
    promo: 'pro_month',
    successUrl: 'http://x/ok',
    cancelUrl: 'http://x/cancel',
  });

  expect(checkoutCreate).toHaveBeenCalledWith(
    expect.objectContaining({
      mode: 'subscription',
      payment_method_collection: 'always',
      subscription_data: expect.objectContaining({ trial_period_days: 30 }),
      metadata: expect.objectContaining({ type: 'tutor_subscription', promo: 'pro_month' }),
    })
  );
});

test('completing the trial checkout records the free month and grants Professional', async () => {
  const { tutor } = await createTutor();

  await stripeService.handleCheckoutComplete(completedCheckout(tutor.id, 'pro_month'));

  const t = (await Tutor.findByPk(tutor.id))!;
  expect(t.featuredTier).toBe('PROFESSIONAL');
  expect(t.stripeSubscriptionId).toBe('sub_trial');
  expect(t.proMonthActivatedAt).toBeTruthy();
  expect(t.proMonthEndsAt!.getTime()).toBe(TRIAL_END * 1000);

  const sub = (await TutorSubscription.findOne({ where: { tutorId: tutor.id } }))!;
  expect(sub).toMatchObject({ tier: 'PROFESSIONAL', status: 'ACTIVE', stripeSubscriptionId: 'sub_trial' });

  expect(emailService.sendSubscriptionConfirmation).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ trialEndsAt: new Date(TRIAL_END * 1000) })
  );
});

test('a normal paid subscription does not use up the free month', async () => {
  const { tutor } = await createTutor();
  retrieve.mockResolvedValueOnce({
    id: 'sub_trial',
    status: 'active',
    trial_end: null,
    current_period_start: 1,
    current_period_end: 2,
    items: { data: [{ price: { id: 'price_pro' } }] },
  });

  await stripeService.handleCheckoutComplete(completedCheckout(tutor.id));

  const t = (await Tutor.findByPk(tutor.id))!;
  expect(t.featuredTier).toBe('PROFESSIONAL');
  expect(t.proMonthActivatedAt).toBeFalsy();
});

test('a second free-month trial is cancelled immediately and changes nothing', async () => {
  const { tutor } = await createTutor();
  await stripeService.handleCheckoutComplete(completedCheckout(tutor.id, 'pro_month', 'sub_trial'));
  const before = (await Tutor.findByPk(tutor.id))!;

  await stripeService.handleCheckoutComplete(completedCheckout(tutor.id, 'pro_month', 'sub_second'));

  expect(cancel).toHaveBeenCalledTimes(1);
  expect(cancel).toHaveBeenCalledWith('sub_second');
  const after = (await Tutor.findByPk(tutor.id))!;
  expect(after.stripeSubscriptionId).toBe('sub_trial');
  expect(after.proMonthActivatedAt!.getTime()).toBe(before.proMonthActivatedAt!.getTime());
});

test('a free-month trial on top of an existing paid subscription is cancelled', async () => {
  const { tutor } = await createTutor();
  await tutor.update({ stripeSubscriptionId: 'sub_paid', featuredTier: 'PROFESSIONAL' });

  await stripeService.handleCheckoutComplete(completedCheckout(tutor.id, 'pro_month', 'sub_trial'));

  expect(cancel).toHaveBeenCalledWith('sub_trial');
  const t = (await Tutor.findByPk(tutor.id))!;
  expect(t.stripeSubscriptionId).toBe('sub_paid');
  expect(t.proMonthActivatedAt).toBeFalsy();
});

test('a redelivered webhook for the same trial is not cancelled', async () => {
  const { tutor } = await createTutor();
  await stripeService.handleCheckoutComplete(completedCheckout(tutor.id, 'pro_month'));
  await stripeService.handleCheckoutComplete(completedCheckout(tutor.id, 'pro_month'));

  expect(cancel).not.toHaveBeenCalled();
  expect((await Tutor.findByPk(tutor.id))!.stripeSubscriptionId).toBe('sub_trial');
});
