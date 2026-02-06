import { Router, Request, Response } from 'express';
import { stripeService } from '../services/stripeService';
import { authMiddleware } from '../middleware/auth';
import { User } from '../models/User';
import { Tutor } from '../models/Tutor';
import { Session } from '../models/Session';

const router = Router();

// ============================================
// STRIPE CONNECT (Tutor Onboarding)
// ============================================

/**
 * Create a Stripe Connect account and get onboarding link
 * POST /api/stripe/connect/onboard
 */
router.post('/connect/onboard', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const user = await User.findByPk(userId);

    if (!user || user.userType !== 'TUTOR') {
      return res.status(403).json({ error: 'Only tutors can set up payment processing' });
    }

    const tutor = await Tutor.findOne({ where: { userId } });
    if (!tutor) {
      return res.status(404).json({ error: 'Tutor profile not found' });
    }

    // Create Connect account if not exists
    const accountId = await stripeService.createConnectAccount(tutor, user);

    // Create onboarding link
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const onboardingUrl = await stripeService.createConnectOnboardingLink(
      accountId,
      `${frontendUrl}/dashboard/tutor?stripe=success`,
      `${frontendUrl}/dashboard/tutor?stripe=refresh`
    );

    res.json({ url: onboardingUrl });
  } catch (error) {
    console.error('Error creating Connect onboarding:', error);
    res.status(500).json({ error: 'Failed to create onboarding link' });
  }
});

/**
 * Get Stripe Connect account status
 * GET /api/stripe/connect/status
 */
router.get('/connect/status', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const tutor = await Tutor.findOne({ where: { userId } });

    if (!tutor) {
      return res.status(404).json({ error: 'Tutor profile not found' });
    }

    if (!tutor.stripeConnectAccountId) {
      return res.json({
        hasAccount: false,
        onboarded: false,
        payoutsEnabled: false,
        chargesEnabled: false,
      });
    }

    const status = await stripeService.checkConnectAccountStatus(tutor.stripeConnectAccountId);

    // Update local record if status changed
    if (status.onboarded !== tutor.stripeConnectOnboarded) {
      await tutor.update({ stripeConnectOnboarded: status.onboarded });
    }

    res.json({
      hasAccount: true,
      ...status,
    });
  } catch (error) {
    console.error('Error getting Connect status:', error);
    res.status(500).json({ error: 'Failed to get account status' });
  }
});

/**
 * Get Stripe Express dashboard link for tutor
 * GET /api/stripe/connect/dashboard
 */
router.get('/connect/dashboard', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const tutor = await Tutor.findOne({ where: { userId } });

    if (!tutor || !tutor.stripeConnectAccountId) {
      return res.status(404).json({ error: 'Stripe account not found' });
    }

    const url = await stripeService.createConnectLoginLink(tutor.stripeConnectAccountId);
    res.json({ url });
  } catch (error) {
    console.error('Error creating dashboard link:', error);
    res.status(500).json({ error: 'Failed to create dashboard link' });
  }
});

// ============================================
// SESSION BOOKING CHECKOUT
// ============================================

/**
 * Create a checkout session for booking a tutoring session
 * POST /api/stripe/checkout/session
 */
router.post('/checkout/session', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const { tutorId, subject, level, sessionType, scheduledAt, durationMins } = req.body;

    // Get student
    const student = await User.findByPk(userId);
    if (!student) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get tutor and user
    const tutor = await Tutor.findByPk(tutorId);
    if (!tutor) {
      return res.status(404).json({ error: 'Tutor not found' });
    }

    const tutorUser = await User.findByPk(tutor.userId);
    if (!tutorUser) {
      return res.status(404).json({ error: 'Tutor user not found' });
    }

    // Check if tutor can accept payments
    if (!tutor.stripeConnectAccountId || !tutor.stripeConnectOnboarded) {
      return res.status(400).json({ error: 'This tutor is not set up to accept payments yet' });
    }

    // Calculate price
    const price = Number(tutor.baseHourlyRate) * (durationMins / 60);
    const platformFee = price * 0.15;

    // Create session record
    const session = await Session.create({
      tutorId: tutor.id,
      studentId: userId,
      subject,
      level,
      sessionType: sessionType || 'VIDEO',
      scheduledAt: new Date(scheduledAt),
      durationMins: durationMins || 60,
      price,
      platformFee,
      status: 'PENDING',
      paymentStatus: 'pending',
    });

    // Create Stripe checkout
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const checkoutUrl = await stripeService.createBookingCheckout({
      student,
      tutor,
      tutorUser,
      sessionId: session.id,
      subject,
      scheduledAt: new Date(scheduledAt),
      durationMins: durationMins || 60,
      price,
      successUrl: `${frontendUrl}/booking/success`,
      cancelUrl: `${frontendUrl}/tutors/${tutor.id}`,
    });

    res.json({ url: checkoutUrl, sessionId: session.id });
  } catch (error) {
    console.error('Error creating checkout:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// ============================================
// TUTOR SUBSCRIPTION CHECKOUT
// ============================================

// Price IDs - create these in Stripe Dashboard
// FREE tier has no price (it's the default tier)
const SUBSCRIPTION_PRICES = {
  PROFESSIONAL: process.env.STRIPE_PRICE_PROFESSIONAL || 'price_professional',
  ENTERPRISE: process.env.STRIPE_PRICE_ENTERPRISE || 'price_enterprise',
};

/**
 * Create a subscription checkout for tutor tiers
 * POST /api/stripe/checkout/subscription
 */
router.post('/checkout/subscription', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const { tier } = req.body;

    if (!['PROFESSIONAL', 'ENTERPRISE'].includes(tier)) {
      return res.status(400).json({ error: 'Invalid subscription tier' });
    }

    const user = await User.findByPk(userId);
    if (!user || user.userType !== 'TUTOR') {
      return res.status(403).json({ error: 'Only tutors can subscribe to tiers' });
    }

    const tutor = await Tutor.findOne({ where: { userId } });
    if (!tutor) {
      return res.status(404).json({ error: 'Tutor profile not found' });
    }

    const priceId = SUBSCRIPTION_PRICES[tier as keyof typeof SUBSCRIPTION_PRICES];
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    const checkoutUrl = await stripeService.createSubscriptionCheckout({
      tutor,
      user,
      priceId,
      tier: tier as 'PROFESSIONAL' | 'ENTERPRISE',
      successUrl: `${frontendUrl}/dashboard/tutor?subscription=success`,
      cancelUrl: `${frontendUrl}/dashboard/tutor?subscription=cancelled`,
    });

    res.json({ url: checkoutUrl });
  } catch (error) {
    console.error('Error creating subscription checkout:', error);
    res.status(500).json({ error: 'Failed to create subscription checkout' });
  }
});

/**
 * Cancel tutor subscription
 * POST /api/stripe/subscription/cancel
 */
router.post('/subscription/cancel', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const tutor = await Tutor.findOne({ where: { userId } });

    if (!tutor || !tutor.stripeSubscriptionId) {
      return res.status(404).json({ error: 'No active subscription found' });
    }

    await stripeService.cancelSubscription(tutor.stripeSubscriptionId);

    res.json({ message: 'Subscription will be cancelled at the end of the billing period' });
  } catch (error) {
    console.error('Error cancelling subscription:', error);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

// ============================================
// BOOKING DETAILS (for success page)
// ============================================

/**
 * Get booking details from Stripe checkout session
 * GET /api/stripe/booking/:checkoutSessionId
 */
router.get('/booking/:checkoutSessionId', async (req: Request, res: Response) => {
  try {
    const { checkoutSessionId } = req.params;

    // Get session from Stripe to verify and get metadata
    const Stripe = require('stripe');
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

    const checkoutSession = await stripe.checkout.sessions.retrieve(checkoutSessionId);

    if (!checkoutSession.metadata?.sessionId) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    // Get our session with tutor details
    const session = await Session.findByPk(checkoutSession.metadata.sessionId, {
      include: [
        {
          model: Tutor,
          as: 'tutor',
          include: [{
            model: User,
            attributes: ['firstName', 'lastName', 'email', 'profilePhotoUrl'],
          }],
        },
      ],
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Get student details
    const student = await User.findByPk(session.studentId, {
      attributes: ['firstName', 'lastName', 'email'],
    });

    res.json({
      success: true,
      data: {
        id: session.id,
        subject: session.subject,
        level: session.level,
        sessionType: session.sessionType,
        scheduledAt: session.scheduledAt,
        durationMins: session.durationMins,
        price: session.price,
        status: session.status,
        tutor: {
          id: (session as any).tutor?.id,
          firstName: (session as any).tutor?.User?.firstName,
          lastName: (session as any).tutor?.User?.lastName,
          profilePhotoUrl: (session as any).tutor?.User?.profilePhotoUrl,
        },
        student: {
          firstName: student?.firstName,
          lastName: student?.lastName,
        },
      },
    });
  } catch (error) {
    console.error('Error getting booking details:', error);
    res.status(500).json({ error: 'Failed to get booking details' });
  }
});

// ============================================
// WEBHOOKS
// ============================================

/**
 * Stripe webhook handler
 * POST /api/stripe/webhook
 */
router.post('/webhook', async (req: Request, res: Response) => {
  const signature = req.headers['stripe-signature'] as string;

  try {
    const event = stripeService.constructWebhookEvent(req.body, signature);

    switch (event.type) {
      case 'checkout.session.completed':
        await stripeService.handleCheckoutComplete(event.data.object as any);
        break;

      case 'invoice.payment_failed':
        await stripeService.handlePaymentFailed(event.data.object as any);
        break;

      case 'customer.subscription.deleted':
        await stripeService.handleSubscriptionDeleted(event.data.object as any);
        break;

      case 'account.updated':
        await stripeService.handleConnectAccountUpdated(event.data.object as any);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(400).json({ error: 'Webhook error' });
  }
});

export default router;
