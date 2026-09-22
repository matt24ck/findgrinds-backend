import crypto from 'crypto';
import { Op } from 'sequelize';
import { Tutor } from '../models/Tutor';
import { User } from '../models/User';
import { Session } from '../models/Session';
import { stripeService } from './stripeService';

/**
 * Tutor offer (Sept 2026 email to tutors).
 *
 *  - Every tutor has a personal join link: /join/<inviteCode>.
 *  - A student or parent who signs up through that link is tagged to the tutor (User.referredByTutorId).
 *  - Lessons with THAT tutor, scheduled before FEE_WAIVER_ENDS, carry a 0% platform fee.
 *    Students who join any other way pay the standard fee, even with the same tutor.
 *  - A tutor whose referred student makes a paid booking by PRO_MONTH_QUALIFY_BY can start one
 *    free month of Professional, whenever they like before FEE_WAIVER_ENDS. It is a 30-day Stripe
 *    trial of the paid plan: €19/month from the end of the trial unless they cancel.
 */

export const STANDARD_FEE_RATE = 0.15;

// End of the 2026/27 school year: lessons scheduled on or after 1 July 2027 (Irish time) pay the standard fee.
export const FEE_WAIVER_ENDS = new Date('2027-07-01T00:00:00+01:00');
// "Do that before 31 October": bookings made up to the end of 31 Oct 2026, Irish time (GMT by then).
export const PRO_MONTH_QUALIFY_BY = new Date('2026-11-01T00:00:00Z');
export const PRO_MONTH_DAYS = 30;

const INVITE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o/1/l/i

function generateInviteCode(): string {
  const bytes = crypto.randomBytes(8);
  return Array.from(bytes, (b) => INVITE_ALPHABET[b % INVITE_ALPHABET.length]).join('');
}

export const tutorOfferService = {
  /** Returns the tutor's invite code, creating one the first time it's needed. */
  async ensureInviteCode(tutor: Tutor): Promise<string> {
    if (tutor.inviteCode) return tutor.inviteCode;
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateInviteCode();
      const clash = await Tutor.findOne({ where: { inviteCode: code }, attributes: ['id'] });
      if (clash) continue;
      await tutor.update({ inviteCode: code });
      return code;
    }
    throw new Error('Could not generate a unique invite code');
  },

  /** Active tutor for a join-link code, or null. */
  async findTutorByInviteCode(code: string): Promise<Tutor | null> {
    if (!code || typeof code !== 'string' || code.length > 16) return null;
    const tutor = await Tutor.findOne({
      where: { inviteCode: code.trim().toLowerCase() },
      include: [{ model: User, attributes: ['id', 'firstName', 'lastName', 'profilePhotoUrl', 'accountStatus'] }],
    });
    const tutorUser = tutor ? ((tutor as any).User as User | undefined) : undefined;
    if (!tutor || !tutorUser || tutorUser.accountStatus !== 'ACTIVE') return null;
    return tutor;
  },

  /**
   * Platform fee for a lesson. Waived when the student, or the parent booking for them,
   * joined FindGrinds through this tutor's link and the lesson is before FEE_WAIVER_ENDS.
   */
  async getSessionFee(params: {
    tutorId: string;
    studentId: string;
    bookerId?: string;
    price: number;
    scheduledAt: Date;
  }): Promise<{ platformFee: number; referralFeeWaived: boolean }> {
    const { tutorId, studentId, bookerId, price, scheduledAt } = params;
    const standard = { platformFee: price * STANDARD_FEE_RATE, referralFeeWaived: false };

    if (scheduledAt >= FEE_WAIVER_ENDS) return standard;

    const ids = Array.from(new Set([studentId, bookerId].filter(Boolean))) as string[];
    const referred = await User.count({ where: { id: { [Op.in]: ids }, referredByTutorId: tutorId } });
    return referred > 0 ? { platformFee: 0, referralFeeWaived: true } : standard;
  },

  /** True once a referred student has a paid booking with this tutor made before the deadline. */
  async hasQualifiedForProMonth(tutorId: string): Promise<boolean> {
    const count = await Session.count({
      where: {
        tutorId,
        referralFeeWaived: true,
        paymentStatus: 'paid',
        createdAt: { [Op.lt]: PRO_MONTH_QUALIFY_BY },
      },
    });
    return count > 0;
  },

  async getStatus(tutor: Tutor) {
    const now = new Date();
    const inviteCode = await this.ensureInviteCode(tutor);
    const [referredCount, feeWaivedBookings, qualified] = await Promise.all([
      User.count({ where: { referredByTutorId: tutor.id } }),
      Session.count({ where: { tutorId: tutor.id, referralFeeWaived: true, paymentStatus: 'paid' } }),
      this.hasQualifiedForProMonth(tutor.id),
    ]);

    let proMonthBlockedReason: string | null = null;
    if (tutor.proMonthActivatedAt) proMonthBlockedReason = 'already_activated';
    else if (!qualified) proMonthBlockedReason = now >= PRO_MONTH_QUALIFY_BY ? 'deadline_passed' : 'not_qualified';
    else if (now >= FEE_WAIVER_ENDS) proMonthBlockedReason = 'offer_ended';
    else if (tutor.featuredTier !== 'FREE' || tutor.stripeSubscriptionId) proMonthBlockedReason = 'already_on_paid_plan';

    return {
      inviteCode,
      feeWaiverEndsAt: FEE_WAIVER_ENDS,
      referredCount,
      feeWaivedBookings,
      proMonth: {
        qualifyBy: PRO_MONTH_QUALIFY_BY,
        qualified,
        activatedAt: tutor.proMonthActivatedAt ?? null,
        endsAt: tutor.proMonthEndsAt ?? null,
        canActivate: proMonthBlockedReason === null,
        blockedReason: proMonthBlockedReason,
      },
    };
  },

  /**
   * Starts the free Professional month: a Stripe Checkout for the Professional plan with a
   * PRO_MONTH_DAYS trial. The card is collected now and billed when the trial ends unless the
   * tutor cancels first. The month is recorded when Stripe confirms the checkout (webhook).
   * Throws with a reason code if the tutor can't activate.
   */
  async startProMonthCheckout(tutor: Tutor): Promise<{ url: string }> {
    const status = await this.getStatus(tutor);
    if (!status.proMonth.canActivate) {
      const err = new Error(status.proMonth.blockedReason || 'not_allowed');
      (err as any).code = status.proMonth.blockedReason;
      throw err;
    }

    const user = await User.findByPk(tutor.userId);
    if (!user) throw new Error('Tutor user not found');

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const url = await stripeService.createSubscriptionCheckout({
      tutor,
      user,
      priceId: process.env.STRIPE_PRICE_PROFESSIONAL || 'price_professional',
      tier: 'PROFESSIONAL',
      trialDays: PRO_MONTH_DAYS,
      promo: 'pro_month',
      successUrl: `${frontendUrl}/dashboard/tutor?subscription=success`,
      cancelUrl: `${frontendUrl}/dashboard/tutor`,
    });
    return { url };
  },
};

export default tutorOfferService;
