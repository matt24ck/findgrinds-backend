import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { Session } from '../models/Session';
import { Tutor } from '../models/Tutor';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// POST /api/sessions - Create booking
router.post('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const {
      tutorId,
      subject,
      level,
      sessionType,
      scheduledAt,
      durationMins = 60,
    } = req.body;

    // Validate tutor exists
    const tutor = await Tutor.findByPk(tutorId);
    if (!tutor) {
      return res.status(404).json({ error: 'Tutor not found' });
    }

    // Calculate price and platform fee (15%)
    const hourlyRate = tutor.baseHourlyRate;
    const price = (hourlyRate * durationMins) / 60;
    const platformFee = price * 0.15; // 15% commission

    // Generate Zoom link (mock for now)
    const zoomLink = `https://zoom.us/j/${uuidv4().replace(/-/g, '').slice(0, 10)}`;

    // Create session
    const session = await Session.create({
      tutorId,
      studentId: (req as any).user.userId,
      subject,
      level,
      sessionType: sessionType || 'VIDEO',
      scheduledAt: new Date(scheduledAt),
      durationMins,
      price,
      platformFee,
      zoomLink,
      status: 'PENDING',
    });

    res.status(201).json({
      success: true,
      data: session,
      message: 'Session booked successfully. Payment required.',
    });
  } catch (error) {
    console.error('Create session error:', error);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// GET /api/sessions - Get user's sessions
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const userType = (req as any).user.userType;
    const { status, upcoming } = req.query;

    const where: any = {};

    // Filter by user role
    if (userType === 'TUTOR') {
      where.tutorId = userId;
    } else {
      where.studentId = userId;
    }

    if (status) {
      where.status = status;
    }

    if (upcoming === 'true') {
      where.scheduledAt = { $gte: new Date() };
      where.status = ['PENDING', 'CONFIRMED'];
    }

    const sessions = await Session.findAll({
      where,
      order: [['scheduledAt', 'ASC']],
      include: [
        { model: Tutor, as: 'tutor' },
      ],
    });

    res.json({ success: true, data: sessions });
  } catch (error) {
    console.error('Get sessions error:', error);
    res.status(500).json({ error: 'Failed to get sessions' });
  }
});

// GET /api/sessions/:id - Get session details
router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const session = await Session.findByPk(req.params.id, {
      include: [{ model: Tutor, as: 'tutor' }],
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Verify user has access
    const userId = (req as any).user.userId;
    if (session.studentId !== userId && session.tutorId !== userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    res.json({ success: true, data: session });
  } catch (error) {
    console.error('Get session error:', error);
    res.status(500).json({ error: 'Failed to get session' });
  }
});

// PUT /api/sessions/:id/cancel - Cancel session
router.put('/:id/cancel', authMiddleware, async (req: Request, res: Response) => {
  try {
    const session = await Session.findByPk(req.params.id);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Verify user has access
    const userId = (req as any).user.userId;
    if (session.studentId !== userId && session.tutorId !== userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Check if session can be cancelled
    if (session.status === 'COMPLETED') {
      return res.status(400).json({ error: 'Cannot cancel completed session' });
    }

    if (session.status === 'CANCELLED') {
      return res.status(400).json({ error: 'Session already cancelled' });
    }

    // Update status
    session.status = 'CANCELLED';
    await session.save();

    res.json({
      success: true,
      data: session,
      message: 'Session cancelled successfully',
    });
  } catch (error) {
    console.error('Cancel session error:', error);
    res.status(500).json({ error: 'Failed to cancel session' });
  }
});

// POST /api/sessions/:id/review - Submit review
router.post('/:id/review', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { rating, reviewText } = req.body;
    const session = await Session.findByPk(req.params.id);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Only student can review
    const userId = (req as any).user.userId;
    if (session.studentId !== userId) {
      return res.status(403).json({ error: 'Only student can review' });
    }

    // Check session is completed
    if (session.status !== 'COMPLETED') {
      return res.status(400).json({ error: 'Can only review completed sessions' });
    }

    // Validate rating
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }

    // Update session with review
    session.rating = rating;
    session.reviewText = reviewText;
    await session.save();

    // Update tutor's average rating (simplified)
    const tutor = await Tutor.findByPk(session.tutorId);
    if (tutor) {
      const newRating = ((tutor.rating * tutor.reviewCount) + rating) / (tutor.reviewCount + 1);
      tutor.rating = Math.round(newRating * 10) / 10;
      tutor.reviewCount += 1;
      await tutor.save();
    }

    res.json({
      success: true,
      data: session,
      message: 'Review submitted successfully',
    });
  } catch (error) {
    console.error('Submit review error:', error);
    res.status(500).json({ error: 'Failed to submit review' });
  }
});

export default router;
