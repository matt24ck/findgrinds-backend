import Stripe from 'stripe';
import { User } from '../models/User';
import { Tutor } from '../models/Tutor';
import { Session } from '../models/Session';
import { Resource } from '../models/Resource';
import { ResourcePurchase } from '../models/ResourcePurchase';
import { Transaction } from '../models/Transaction';
import { emailService } from './emailService';
import { zoomService } from './zoomService';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2024-12-18.acacia',
});

const PLATFORM_FEE_PERCENT = 15; // 15% platform fee

export const stripeService = {
  // ============================================
  // CUSTOMER MANAGEMENT (for students/parents)
  // ============================================

  /**
   * Create or retrieve a Stripe customer for a user
   */
  async getOrCreateCustomer(user: User): Promise<string> {
    if (user.stripeCustomerId) {
      return user.stripeCustomerId;
    }

    const customer = await stripe.customers.create({
      email: user.email,
      name: `${user.firstName} ${user.lastName}`,
      metadata: {
        userId: user.id,
        userType: user.userType,
      },
    });

    await user.update({ stripeCustomerId: customer.id });
    return customer.id;
  },

  // ============================================
  // STRIPE CONNECT (for tutors)
  // ============================================

  /**
   * Create a Stripe Connect account for a tutor
   */
  async createConnectAccount(tutor: Tutor, user: User): Promise<string> {
    if (tutor.stripeConnectAccountId) {
      return tutor.stripeConnectAccountId;
    }

    const account = await stripe.accounts.create({
      type: 'express',
      country: 'IE',
      email: user.email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      business_type: 'individual',
      metadata: {
        tutorId: tutor.id,
        userId: user.id,
      },
    });

    await tutor.update({ stripeConnectAccountId: account.id });
    return account.id;
  },

  /**
   * Create an onboarding link for a tutor to complete Stripe Connect setup
   */
  async createConnectOnboardingLink(
    accountId: string,
    returnUrl: string,
    refreshUrl: string
  ): Promise<string> {
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });

    return accountLink.url;
  },

  /**
   * Create a login link for tutors to access their Stripe Express dashboard
   */
  async createConnectLoginLink(accountId: string): Promise<string> {
    const loginLink = await stripe.accounts.createLoginLink(accountId);
    return loginLink.url;
  },

  /**
   * Check if a Connect account has completed onboarding
   */
  async checkConnectAccountStatus(accountId: string): Promise<{
    onboarded: boolean;
    payoutsEnabled: boolean;
    chargesEnabled: boolean;
  }> {
    const account = await stripe.accounts.retrieve(accountId);
    return {
      onboarded: account.details_submitted || false,
      payoutsEnabled: account.payouts_enabled || false,
      chargesEnabled: account.charges_enabled || false,
    };
  },

  // ============================================
  // SESSION BOOKING PAYMENTS
  // ============================================

  /**
   * Create a checkout session for booking a tutoring session
   */
  async createBookingCheckout(params: {
    student: User;
    tutor: Tutor;
    tutorUser: User;
    sessionId: string;
    subject: string;
    scheduledAt: Date;
    durationMins: number;
    price: number;
    successUrl: string;
    cancelUrl: string;
  }): Promise<string> {
    const {
      student,
      tutor,
      tutorUser,
      sessionId,
      subject,
      scheduledAt,
      durationMins,
      price,
      successUrl,
      cancelUrl,
    } = params;

    // Ensure student has a Stripe customer ID
    const customerId = await this.getOrCreateCustomer(student);

    // Ensure tutor has a Connect account
    if (!tutor.stripeConnectAccountId) {
      throw new Error('Tutor has not set up payment processing');
    }

    // Calculate platform fee (15%)
    const platformFee = Math.round(price * (PLATFORM_FEE_PERCENT / 100) * 100); // in cents
    const totalAmount = price * 100; // in cents

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: `${subject} Tutoring Session`,
              description: `${durationMins} minute session with ${tutorUser.firstName} ${tutorUser.lastName} on ${scheduledAt.toLocaleDateString('en-IE')}`,
            },
            unit_amount: totalAmount,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      payment_intent_data: {
        application_fee_amount: platformFee,
        transfer_data: {
          destination: tutor.stripeConnectAccountId,
        },
        metadata: {
          sessionId,
          tutorId: tutor.id,
          studentId: student.id,
        },
      },
      success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl,
      metadata: {
        sessionId,
        type: 'session_booking',
      },
    });

    return session.url || '';
  },

  // ============================================
  // RESOURCE PURCHASE PAYMENTS
  // ============================================

  /**
   * Create a checkout session for purchasing a resource
   */
  async createResourceCheckout(params: {
    buyer: User;
    resource: Resource;
    tutor: Tutor;
    tutorUser: User;
    purchaseId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<string> {
    const { buyer, resource, tutor, tutorUser, purchaseId, successUrl, cancelUrl } = params;

    // Ensure buyer has a Stripe customer ID
    const customerId = await this.getOrCreateCustomer(buyer);

    // Ensure tutor has a Connect account
    if (!tutor.stripeConnectAccountId) {
      throw new Error('Tutor has not set up payment processing');
    }

    const totalAmount = Math.round(Number(resource.price) * 100); // in cents
    const platformFee = Math.round(Number(resource.price) * (PLATFORM_FEE_PERCENT / 100) * 100); // in cents

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: resource.title,
              description: `${resource.resourceType} resource by ${tutorUser.firstName} ${tutorUser.lastName}`,
            },
            unit_amount: totalAmount,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      payment_intent_data: {
        application_fee_amount: platformFee,
        transfer_data: {
          destination: tutor.stripeConnectAccountId,
        },
        metadata: {
          purchaseId,
          resourceId: resource.id,
          tutorId: tutor.id,
          buyerId: buyer.id,
        },
      },
      success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl,
      metadata: {
        purchaseId,
        resourceId: resource.id,
        type: 'resource_purchase',
      },
    });

    return session.url || '';
  },

  // ============================================
  // TUTOR SUBSCRIPTIONS (Professional/Enterprise)
  // ============================================

  /**
   * Create a subscription checkout for tutor tiers
   */
  async createSubscriptionCheckout(params: {
    tutor: Tutor;
    user: User;
    priceId: string;
    tier: 'PROFESSIONAL' | 'ENTERPRISE';
    successUrl: string;
    cancelUrl: string;
  }): Promise<string> {
    const { tutor, user, priceId, tier, successUrl, cancelUrl } = params;

    // Ensure user has a Stripe customer ID
    const customerId = await this.getOrCreateCustomer(user);

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl,
      metadata: {
        tutorId: tutor.id,
        tier,
        type: 'tutor_subscription',
      },
    });

    return session.url || '';
  },

  /**
   * Cancel a tutor's subscription
   */
  async cancelSubscription(subscriptionId: string): Promise<void> {
    await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });
  },

  // ============================================
  // REFUNDS
  // ============================================

  /**
   * Refund a session payment (full or partial).
   * Uses reverse_transfer and refund_application_fee to proportionally
   * reverse both the tutor transfer and platform fee.
   */
  async refundSession(params: {
    paymentIntentId: string;
    amountInCents?: number; // omit for full refund
    reason?: string;
  }): Promise<{ refundId: string; amountRefunded: number }> {
    const { paymentIntentId, amountInCents, reason } = params;

    const refundParams: Stripe.RefundCreateParams = {
      payment_intent: paymentIntentId,
      reason: 'requested_by_customer',
      reverse_transfer: true,
      refund_application_fee: true,
      metadata: {
        refundReason: reason || 'Session cancelled',
      },
    };

    if (amountInCents !== undefined) {
      refundParams.amount = amountInCents;
    }

    const refund = await stripe.refunds.create(refundParams);

    return {
      refundId: refund.id,
      amountRefunded: refund.amount / 100,
    };
  },

  /**
   * Refund a subscription's latest invoice (goodwill refund).
   * Does NOT cancel the subscription — tutor keeps their tier.
   */
  async refundSubscriptionInvoice(stripeSubscriptionId: string): Promise<{
    refundId: string;
    amountRefunded: number;
  }> {
    const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId, {
      expand: ['latest_invoice'],
    });

    const latestInvoice = subscription.latest_invoice as Stripe.Invoice;
    if (!latestInvoice || !latestInvoice.payment_intent) {
      throw new Error('No payment found for this subscription');
    }

    const paymentIntentId = typeof latestInvoice.payment_intent === 'string'
      ? latestInvoice.payment_intent
      : latestInvoice.payment_intent.id;

    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      reason: 'requested_by_customer',
      metadata: {
        refundReason: 'Admin-initiated subscription refund',
      },
    });

    return {
      refundId: refund.id,
      amountRefunded: refund.amount / 100,
    };
  },

  // ============================================
  // WEBHOOK HANDLING
  // ============================================

  /**
   * Construct and verify a webhook event
   */
  constructWebhookEvent(payload: Buffer, signature: string): Stripe.Event {
    return stripe.webhooks.constructEvent(
      payload,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET || ''
    );
  },

  /**
   * Handle checkout.session.completed event
   */
  async handleCheckoutComplete(session: Stripe.Checkout.Session): Promise<void> {
    const { metadata } = session;

    if (metadata?.type === 'session_booking' && metadata?.sessionId) {
      // Update session payment status
      const bookingSession = await Session.findByPk(metadata.sessionId);
      if (bookingSession) {
        await bookingSession.update({
          status: 'CONFIRMED',
          paymentStatus: 'paid',
          stripePaymentIntentId: session.payment_intent as string,
        });

        // Generate Zoom meeting for VIDEO sessions
        let meetingLink: string | undefined;
        if (bookingSession.sessionType === 'VIDEO') {
          try {
            const student = await User.findByPk(bookingSession.studentId);
            const tutor = await Tutor.findByPk(bookingSession.tutorId, {
              include: [{ model: User }],
            });
            const tutorUser = tutor ? (tutor as any).User as User : null;

            const meeting = await zoomService.createMeeting({
              topic: `${bookingSession.subject} Session - ${student?.firstName || 'Student'} with ${tutorUser?.firstName || 'Tutor'}`,
              startTime: new Date(bookingSession.scheduledAt),
              durationMins: bookingSession.durationMins,
            });

            meetingLink = meeting.joinUrl;
            await bookingSession.update({ meetingLink });
            console.log(`[Zoom] Meeting created for session ${bookingSession.id}: ${meetingLink}`);
          } catch (zoomError) {
            console.error('[Zoom] Failed to create meeting:', zoomError);
            // Don't throw - booking is still confirmed even if Zoom fails
          }
        }

        // Send confirmation emails to student and tutor
        try {
          const student = await User.findByPk(bookingSession.studentId);
          const tutor = await Tutor.findByPk(bookingSession.tutorId, {
            include: [{ model: User }],
          });

          if (student && tutor) {
            const tutorUser = (tutor as any).User as User;
            const scheduledDate = new Date(bookingSession.scheduledAt);
            const dateStr = scheduledDate.toLocaleDateString('en-IE', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            });
            const timeStr = scheduledDate.toLocaleTimeString('en-IE', {
              hour: '2-digit',
              minute: '2-digit',
            });

            const tutorEarnings = Number(bookingSession.price) - Number(bookingSession.platformFee);

            await emailService.sendBookingConfirmation(
              student.email,
              tutorUser.email,
              {
                studentName: `${student.firstName} ${student.lastName}`,
                tutorName: `${tutorUser.firstName} ${tutorUser.lastName}`,
                subject: bookingSession.subject,
                date: dateStr,
                time: timeStr,
                price: `€${Number(bookingSession.price).toFixed(2)}`,
                tutorEarnings: `€${tutorEarnings.toFixed(2)}`,
                sessionType: bookingSession.sessionType as 'VIDEO' | 'IN_PERSON' | 'GROUP',
                meetingLink,
              }
            );
          }
        } catch (emailError) {
          console.error('Failed to send booking confirmation emails:', emailError);
          // Don't throw - booking is still confirmed even if email fails
        }
      }
    } else if (metadata?.type === 'tutor_subscription' && metadata?.tutorId) {
      // Update tutor subscription status
      const tutor = await Tutor.findByPk(metadata.tutorId);
      if (tutor && session.subscription) {
        await tutor.update({
          stripeSubscriptionId: session.subscription as string,
          stripeSubscriptionStatus: 'active',
          featuredTier: metadata.tier as 'PROFESSIONAL' | 'ENTERPRISE',
        });

        // Send subscription confirmation email
        const tutorUser = await User.findByPk(tutor.userId);
        if (tutorUser) {
          const tierName = metadata.tier === 'ENTERPRISE' ? 'Enterprise' : 'Professional';
          const price = metadata.tier === 'ENTERPRISE' ? '\u20AC99' : '\u20AC19';
          emailService.sendSubscriptionConfirmation(tutorUser.email, {
            firstName: tutorUser.firstName,
            tierName,
            price,
          });
        }
      }
    } else if (metadata?.type === 'resource_purchase' && metadata?.purchaseId) {
      // Update resource purchase record
      const purchase = await ResourcePurchase.findByPk(metadata.purchaseId);
      if (purchase) {
        await purchase.update({
          status: 'COMPLETED',
          stripePaymentIntentId: session.payment_intent as string,
        });

        // Increment the resource sales count
        const resource = await Resource.findByPk(purchase.resourceId);
        if (resource) {
          await resource.update({
            salesCount: resource.salesCount + 1,
          });
        }

        // Create transaction record for payment history
        await Transaction.create({
          type: 'RESOURCE_PURCHASE',
          userId: purchase.userId,
          relatedId: purchase.resourceId,
          amount: Number(purchase.price),
          platformFee: Number(purchase.platformFee),
          status: 'COMPLETED',
          stripeTransactionId: session.payment_intent as string,
        });
      }
    }
  },

  /**
   * Handle invoice.payment_failed event
   */
  async handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    if (invoice.subscription) {
      const tutor = await Tutor.findOne({
        where: { stripeSubscriptionId: invoice.subscription as string },
      });
      if (tutor) {
        await tutor.update({ stripeSubscriptionStatus: 'past_due' });
      }
    }
  },

  /**
   * Handle customer.subscription.deleted event
   */
  async handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    const tutor = await Tutor.findOne({
      where: { stripeSubscriptionId: subscription.id },
    });
    if (tutor) {
      await tutor.update({
        stripeSubscriptionId: null,
        stripeSubscriptionStatus: null,
        featuredTier: 'FREE',
      });
    }
  },

  /**
   * Handle account.updated event for Connect accounts
   */
  async handleConnectAccountUpdated(account: Stripe.Account): Promise<void> {
    const tutor = await Tutor.findOne({
      where: { stripeConnectAccountId: account.id },
    });
    if (tutor) {
      await tutor.update({
        stripeConnectOnboarded: account.details_submitted || false,
      });
    }
  },
};
