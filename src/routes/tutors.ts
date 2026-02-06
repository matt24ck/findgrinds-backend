import { Router, Request, Response } from 'express';
import { Op } from 'sequelize';
import { Tutor } from '../models/Tutor';
import { User } from '../models/User';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// GET /api/tutors - Search tutors
router.get('/', async (req: Request, res: Response) => {
  try {
    const {
      subject,
      level,
      minPrice,
      maxPrice,
      minRating,
      teachesInIrish,
      sortBy = 'featured',
      page = 1,
      pageSize = 12,
    } = req.query;

    // Build query conditions
    const where: any = {};

    if (subject) {
      where.subjects = { [Op.contains]: [subject] };
    }

    if (level) {
      where.levels = { [Op.contains]: [level] };
    }

    if (minPrice || maxPrice) {
      where.baseHourlyRate = {};
      if (minPrice) where.baseHourlyRate[Op.gte] = Number(minPrice);
      if (maxPrice) where.baseHourlyRate[Op.lte] = Number(maxPrice);
    }

    if (minRating) {
      where.rating = { [Op.gte]: Number(minRating) };
    }

    if (teachesInIrish === 'true') {
      where.teachesInIrish = true;
    }

    // Determine sort order
    let order: any[] = [];
    switch (sortBy) {
      case 'rating':
        order = [['rating', 'DESC']];
        break;
      case 'price_asc':
        order = [['baseHourlyRate', 'ASC']];
        break;
      case 'price_desc':
        order = [['baseHourlyRate', 'DESC']];
        break;
      case 'featured':
      default:
        // Featured tutors first, then by rating
        order = [
          ['featuredTier', 'DESC'],
          ['rating', 'DESC'],
        ];
        break;
    }

    const offset = (Number(page) - 1) * Number(pageSize);

    const { rows: tutors, count: total } = await Tutor.findAndCountAll({
      where,
      order,
      limit: Number(pageSize),
      offset,
      include: [{
        model: User,
        attributes: ['firstName', 'lastName', 'profilePhotoUrl', 'gardaVettingVerified'],
      }],
    });

    res.json({
      success: true,
      data: {
        items: tutors,
        total,
        page: Number(page),
        pageSize: Number(pageSize),
        totalPages: Math.ceil(total / Number(pageSize)),
      },
    });
  } catch (error) {
    console.error('Tutor search error:', error);
    res.status(500).json({ error: 'Failed to search tutors' });
  }
});

// GET /api/tutors/me - Get current tutor's profile (must be before :id route)
router.get('/me', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;

    const tutor = await Tutor.findOne({
      where: { userId },
      include: [{
        model: User,
        attributes: ['firstName', 'lastName', 'email', 'profilePhotoUrl', 'gardaVettingVerified'],
      }],
    });

    if (!tutor) {
      return res.status(404).json({ error: 'Tutor profile not found' });
    }

    res.json({ success: true, data: tutor });
  } catch (error) {
    console.error('Get my tutor profile error:', error);
    res.status(500).json({ error: 'Failed to get tutor profile' });
  }
});

// PUT /api/tutors/me - Update current tutor's profile
router.put('/me', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const {
      headline,
      bio,
      subjects,
      levels,
      qualifications,
      baseHourlyRate,
      cancellationPolicy,
      teachesInIrish,
    } = req.body;

    const tutor = await Tutor.findOne({ where: { userId } });

    if (!tutor) {
      return res.status(404).json({ error: 'Tutor profile not found' });
    }

    // Update fields if provided
    if (headline !== undefined) tutor.headline = headline;
    if (bio !== undefined) tutor.bio = bio;
    if (subjects !== undefined) tutor.subjects = subjects;
    if (levels !== undefined) tutor.levels = levels;
    if (qualifications !== undefined) tutor.qualifications = qualifications;
    if (baseHourlyRate !== undefined) tutor.baseHourlyRate = baseHourlyRate;
    if (cancellationPolicy !== undefined) tutor.cancellationPolicy = cancellationPolicy;
    if (teachesInIrish !== undefined) tutor.teachesInIrish = teachesInIrish;

    await tutor.save();

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: tutor,
    });
  } catch (error) {
    console.error('Update tutor profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// GET /api/tutors/:id - Get tutor profile
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const tutorId = req.params.id as string;
    const tutor = await Tutor.findByPk(tutorId, {
      include: [{
        model: User,
        attributes: ['firstName', 'lastName', 'email', 'profilePhotoUrl', 'gardaVettingVerified'],
      }],
    });

    if (!tutor) {
      return res.status(404).json({ error: 'Tutor not found' });
    }

    res.json({ success: true, data: tutor });
  } catch (error) {
    console.error('Get tutor error:', error);
    res.status(500).json({ error: 'Failed to get tutor' });
  }
});

// GET /api/tutors/:id/availability - Get tutor availability
router.get('/:id/availability', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query;
    const tutorId = req.params.id as string;

    const tutor = await Tutor.findByPk(tutorId);
    if (!tutor) {
      return res.status(404).json({ error: 'Tutor not found' });
    }

    // Generate available slots for next 30 days
    // In production, this would check against booked sessions
    const slots = [];
    const start = startDate ? new Date(startDate as string) : new Date();
    const end = endDate ? new Date(endDate as string) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
      // Skip weekends for demo (tutors can set their own availability)
      const dayOfWeek = date.getDay();
      if (dayOfWeek === 0) continue; // Skip Sunday

      // Add evening slots (5pm - 9pm)
      const dateStr = date.toISOString().split('T')[0];
      for (let hour = 17; hour < 21; hour++) {
        slots.push({
          date: dateStr,
          startTime: `${hour}:00`,
          endTime: `${hour + 1}:00`,
          available: Math.random() > 0.3, // 70% available for demo
          price: tutor.baseHourlyRate,
        });
      }
    }

    res.json({
      success: true,
      data: {
        tutorId: req.params.id,
        slots,
      },
    });
  } catch (error) {
    console.error('Get availability error:', error);
    res.status(500).json({ error: 'Failed to get availability' });
  }
});

// GET /api/tutors/:id/reviews - Get tutor reviews
router.get('/:id/reviews', async (req: Request, res: Response) => {
  try {
    const { page = 1, pageSize = 10 } = req.query;

    // In production, fetch from Session model where rating is not null
    // For now, return mock reviews
    const mockReviews = [
      {
        id: '1',
        studentName: 'Sarah M.',
        rating: 5,
        text: 'Excellent tutor! Really helped me understand calculus.',
        date: '2025-12-15',
        subject: 'MATHS',
      },
      {
        id: '2',
        studentName: 'John D.',
        rating: 4,
        text: 'Very patient and explains things clearly.',
        date: '2025-12-10',
        subject: 'MATHS',
      },
      {
        id: '3',
        studentName: 'Emma K.',
        rating: 5,
        text: 'Best grinds tutor I\'ve had. Highly recommend!',
        date: '2025-12-05',
        subject: 'MATHS',
      },
    ];

    res.json({
      success: true,
      data: {
        items: mockReviews,
        total: mockReviews.length,
        page: Number(page),
        pageSize: Number(pageSize),
        totalPages: 1,
        averageRating: 4.7,
        ratingBreakdown: {
          5: 65,
          4: 25,
          3: 7,
          2: 2,
          1: 1,
        },
      },
    });
  } catch (error) {
    console.error('Get reviews error:', error);
    res.status(500).json({ error: 'Failed to get reviews' });
  }
});

export default router;
