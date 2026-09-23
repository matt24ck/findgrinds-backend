import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { Transaction } from '../models/Transaction';

const router = Router();

// Real payments go through Stripe (routes/stripe.ts). The old mock
// create-intent/confirm/resource-purchase routes were removed: they let any
// logged-in user confirm sessions or obtain resources without paying.

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
