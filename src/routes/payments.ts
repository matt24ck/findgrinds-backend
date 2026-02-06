import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware } from '../middleware/auth';
import { Session } from '../models/Session';
import { Transaction } from '../models/Transaction';

const router = Router();

// Mock payment service - simulates Stripe behavior
const mockPaymentService = {
  createPaymentIntent: async (amount: number, currency: string = 'eur') => {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 500));

    // 95% success rate for mock payments
    const success = Math.random() > 0.05;

    if (success) {
      return {
        id: `pi_${uuidv4()}`,
        clientSecret: `pi_${uuidv4()}_secret_${uuidv4().slice(0, 8)}`,
        amount,
        currency,
        status: 'requires_payment_method',
      };
    } else {
      throw new Error('Payment service temporarily unavailable');
    }
  },

  confirmPayment: async (paymentIntentId: string) => {
    await new Promise(resolve => setTimeout(resolve, 300));
    return {
      id: paymentIntentId,
      status: 'succeeded',
    };
  },
};

// POST /api/payments/create-intent - Create payment intent for session booking
router.post('/create-intent', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { sessionId, amount } = req.body;

    if (!sessionId || !amount) {
      return res.status(400).json({ error: 'Session ID and amount required' });
    }

    // Verify session exists and is pending
    const session = await Session.findByPk(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (session.status !== 'PENDING') {
      return res.status(400).json({ error: 'Session is not pending payment' });
    }

    // Create payment intent (mock)
    const paymentIntent = await mockPaymentService.createPaymentIntent(
      Math.round(amount * 100) // Convert to cents
    );

    res.json({
      success: true,
      data: {
        clientSecret: paymentIntent.clientSecret,
        paymentIntentId: paymentIntent.id,
      },
    });
  } catch (error) {
    console.error('Create payment intent error:', error);
    res.status(500).json({ error: 'Failed to create payment' });
  }
});

// POST /api/payments/confirm - Confirm payment (mock)
router.post('/confirm', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { paymentIntentId, sessionId } = req.body;

    if (!paymentIntentId || !sessionId) {
      return res.status(400).json({ error: 'Payment intent ID and session ID required' });
    }

    // Confirm payment (mock)
    const result = await mockPaymentService.confirmPayment(paymentIntentId);

    if (result.status === 'succeeded') {
      // Update session status
      const session = await Session.findByPk(sessionId);
      if (session) {
        session.status = 'CONFIRMED';
        await session.save();

        // Create transaction record
        await Transaction.create({
          type: 'SESSION_BOOKING',
          userId: (req as any).user.userId,
          relatedId: sessionId,
          amount: session.price,
          platformFee: session.platformFee,
          status: 'COMPLETED',
          stripeTransactionId: paymentIntentId,
        });
      }

      res.json({
        success: true,
        message: 'Payment successful! Your session is confirmed.',
        data: { sessionId, status: 'CONFIRMED' },
      });
    } else {
      res.status(400).json({ error: 'Payment failed' });
    }
  } catch (error) {
    console.error('Confirm payment error:', error);
    res.status(500).json({ error: 'Failed to confirm payment' });
  }
});

// POST /api/payments/resource-purchase - Purchase a resource
router.post('/resource-purchase', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { resourceId, amount } = req.body;

    if (!resourceId || !amount) {
      return res.status(400).json({ error: 'Resource ID and amount required' });
    }

    // Create and immediately confirm payment (mock)
    const paymentIntent = await mockPaymentService.createPaymentIntent(
      Math.round(amount * 100)
    );

    const result = await mockPaymentService.confirmPayment(paymentIntent.id);

    if (result.status === 'succeeded') {
      // Create transaction record
      const platformFee = amount * 0.15; // 15% for resources

      await Transaction.create({
        type: 'RESOURCE_PURCHASE',
        userId: (req as any).user.userId,
        relatedId: resourceId,
        amount,
        platformFee,
        status: 'COMPLETED',
        stripeTransactionId: paymentIntent.id,
      });

      res.json({
        success: true,
        message: 'Purchase successful!',
        data: { resourceId, transactionId: paymentIntent.id },
      });
    } else {
      res.status(400).json({ error: 'Payment failed' });
    }
  } catch (error) {
    console.error('Resource purchase error:', error);
    res.status(500).json({ error: 'Failed to complete purchase' });
  }
});

// GET /api/payments/history - Get payment history
router.get('/history', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const { type, page = 1, pageSize = 20 } = req.query;

    const where: any = { userId };
    if (type) where.type = type;

    const offset = (Number(page) - 1) * Number(pageSize);

    const { rows: transactions, count: total } = await Transaction.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: Number(pageSize),
      offset,
    });

    res.json({
      success: true,
      data: {
        items: transactions,
        total,
        page: Number(page),
        pageSize: Number(pageSize),
        totalPages: Math.ceil(total / Number(pageSize)),
      },
    });
  } catch (error) {
    console.error('Get payment history error:', error);
    res.status(500).json({ error: 'Failed to get payment history' });
  }
});

export default router;
