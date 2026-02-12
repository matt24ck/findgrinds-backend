import { Router, Request, Response } from 'express';
import { Op } from 'sequelize';
import { Tutor } from '../models/Tutor';
import { User } from '../models/User';
import { Session } from '../models/Session';
import { Resource } from '../models/Resource';
import { ResourcePurchase } from '../models/ResourcePurchase';
import { authMiddleware } from '../middleware/auth';
import { computeAvailability } from './availability';
import { resolveUrl } from '../services/storageService';

const router = Router();

// Helper to resolve profile photo URLs in tutor results
async function resolveTutorProfilePhoto(tutor: any): Promise<void> {
  const user = tutor.User || tutor.user;
  if (user && user.profilePhotoUrl) {
    user.profilePhotoUrl = await resolveUrl(user.profilePhotoUrl);
  }
}

// GET /api/tutors - Search tutors
router.get('/', async (req: Request, res: Response) => {
  try {
    const {
      subject,
      level,
      area,
      minPrice,
      maxPrice,
      minRating,
      teachesInIrish,
      sortBy = 'featured',
      page = 1,
      pageSize = 12,
    } = req.query;

    // Build query conditions
    const where: any = { isVisible: true };

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

    if (area) {
      where.area = area;
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

    // Resolve S3 keys to signed URLs for profile photos
    const tutorData = tutors.map(t => t.toJSON());
    await Promise.all(tutorData.map(resolveTutorProfilePhoto));

    // Normalize 'BOTH' → ['JC', 'LC'] for all tutors
    for (const td of tutorData) {
      if (td.levels?.includes('BOTH')) {
        const expanded = new Set(td.levels.flatMap((l: string) => l === 'BOTH' ? ['JC', 'LC'] : [l]));
        td.levels = Array.from(expanded);
      }
    }

    // Compute real session counts
    await Promise.all(tutorData.map(async (td: any) => {
      td.totalBookings = await Session.count({
        where: {
          tutorId: td.id,
          status: { [Op.in]: ['CONFIRMED', 'COMPLETED'] },
        },
      });
    }));

    res.json({
      success: true,
      data: {
        items: tutorData,
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

    const tutorData = tutor.toJSON();
    await resolveTutorProfilePhoto(tutorData);

    res.json({ success: true, data: tutorData });
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
      cancellationNoticeHours,
      lateCancellationRefundPercent,
      teachesInIrish,
      isVisible,
      area,
      organisationName,
      organisationWebsite,
      maxGroupSize,
      minGroupSize,
      groupHourlyRate,
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
    if (cancellationNoticeHours !== undefined) {
      if (![6, 12, 24, 48, 72].includes(cancellationNoticeHours)) {
        return res.status(400).json({ error: 'cancellationNoticeHours must be 6, 12, 24, 48, or 72' });
      }
      tutor.cancellationNoticeHours = cancellationNoticeHours;
    }
    if (lateCancellationRefundPercent !== undefined) {
      if (![0, 25, 50, 75, 100].includes(lateCancellationRefundPercent)) {
        return res.status(400).json({ error: 'lateCancellationRefundPercent must be 0, 25, 50, 75, or 100' });
      }
      tutor.lateCancellationRefundPercent = lateCancellationRefundPercent;
    }
    if (teachesInIrish !== undefined) tutor.teachesInIrish = teachesInIrish;
    if (isVisible !== undefined) tutor.isVisible = isVisible;
    if (area !== undefined) tutor.area = area;
    if (maxGroupSize !== undefined) {
      if (maxGroupSize < 2 || maxGroupSize > 20) {
        return res.status(400).json({ error: 'maxGroupSize must be between 2 and 20' });
      }
      tutor.maxGroupSize = maxGroupSize;
    }
    if (minGroupSize !== undefined) {
      if (minGroupSize < 2 || minGroupSize > (maxGroupSize ?? tutor.maxGroupSize)) {
        return res.status(400).json({ error: 'minGroupSize must be between 2 and maxGroupSize' });
      }
      tutor.minGroupSize = minGroupSize;
    }
    if (groupHourlyRate !== undefined) {
      if (groupHourlyRate !== null && groupHourlyRate <= 0) {
        return res.status(400).json({ error: 'groupHourlyRate must be greater than 0' });
      }
      tutor.groupHourlyRate = groupHourlyRate;
    }
    if (organisationName !== undefined || organisationWebsite !== undefined) {
      if (tutor.featuredTier !== 'ENTERPRISE') {
        return res.status(400).json({ error: 'Organisation linking is only available for Enterprise tutors' });
      }
      if (organisationName !== undefined) tutor.organisationName = organisationName || null;
      if (organisationWebsite !== undefined) {
        if (organisationWebsite && !organisationWebsite.startsWith('http://') && !organisationWebsite.startsWith('https://')) {
          return res.status(400).json({ error: 'Organisation website must start with http:// or https://' });
        }
        tutor.organisationWebsite = organisationWebsite || null;
      }
    }

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

// GET /api/tutors/me/stats - Get tutor earnings and stats
router.get('/me/stats', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const tutor = await Tutor.findOne({ where: { userId } });
    if (!tutor) {
      return res.status(404).json({ error: 'Tutor not found' });
    }

    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    // Session earnings this month (CONFIRMED = paid via Stripe, COMPLETED = session held)
    const sessionsThisMonth = await Session.findAll({
      where: {
        tutorId: tutor.id,
        status: { [Op.in]: ['CONFIRMED', 'COMPLETED'] },
        paymentStatus: 'paid',
        scheduledAt: { [Op.gte]: thisMonthStart },
      },
    });
    const sessionEarnings = sessionsThisMonth.reduce(
      (sum, s) => sum + (Number(s.price) - Number(s.platformFee)), 0
    );

    // Sessions last month
    const sessionsLastMonth = await Session.findAll({
      where: {
        tutorId: tutor.id,
        status: { [Op.in]: ['CONFIRMED', 'COMPLETED'] },
        paymentStatus: 'paid',
        scheduledAt: { [Op.gte]: lastMonthStart, [Op.lt]: thisMonthStart },
      },
    });
    const sessionEarningsLastMonth = sessionsLastMonth.reduce(
      (sum, s) => sum + (Number(s.price) - Number(s.platformFee)), 0
    );

    // Resource earnings this month
    const tutorResources = await Resource.findAll({
      where: { tutorId: tutor.id },
      attributes: ['id'],
    });
    const resourceIds = tutorResources.map(r => r.id);

    let resourceEarnings = 0;
    let resourcesSoldThisMonth = 0;
    let resourceEarningsLastMonth = 0;

    if (resourceIds.length > 0) {
      const purchasesThisMonth = await ResourcePurchase.findAll({
        where: {
          resourceId: { [Op.in]: resourceIds },
          status: 'COMPLETED',
          createdAt: { [Op.gte]: thisMonthStart },
        },
      });
      resourceEarnings = purchasesThisMonth.reduce(
        (sum, p) => sum + Number(p.tutorEarnings), 0
      );
      resourcesSoldThisMonth = purchasesThisMonth.length;

      const purchasesLastMonth = await ResourcePurchase.findAll({
        where: {
          resourceId: { [Op.in]: resourceIds },
          status: 'COMPLETED',
          createdAt: { [Op.gte]: lastMonthStart, [Op.lt]: thisMonthStart },
        },
      });
      resourceEarningsLastMonth = purchasesLastMonth.reduce(
        (sum, p) => sum + Number(p.tutorEarnings), 0
      );
    }

    const thisMonth = Math.round((sessionEarnings + resourceEarnings) * 100) / 100;
    const lastMonth = Math.round((sessionEarningsLastMonth + resourceEarningsLastMonth) * 100) / 100;

    res.json({
      success: true,
      data: {
        thisMonth,
        lastMonth,
        sessionsThisMonth: sessionsThisMonth.length,
        resourcesSoldThisMonth,
        sessionEarnings: Math.round(sessionEarnings * 100) / 100,
        resourceEarnings: Math.round(resourceEarnings * 100) / 100,
      },
    });
  } catch (error) {
    console.error('Get tutor stats error:', error);
    res.status(500).json({ error: 'Failed to get tutor stats' });
  }
});

// GET /api/tutors/:id - Get tutor profile
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const tutorId = req.params.id as string;
    const tutor = await Tutor.findByPk(tutorId, {
      include: [{
        model: User,
        attributes: ['firstName', 'lastName', 'profilePhotoUrl', 'gardaVettingVerified'],
      }],
    });

    if (!tutor || !tutor.isVisible) {
      return res.status(404).json({ error: 'Tutor not found' });
    }

    const tutorData = tutor.toJSON();
    await resolveTutorProfilePhoto(tutorData);

    // Compute real session count
    const sessionCount = await Session.count({
      where: {
        tutorId,
        status: { [Op.in]: ['CONFIRMED', 'COMPLETED'] },
      },
    });
    tutorData.totalBookings = sessionCount;

    // Normalize 'BOTH' → ['JC', 'LC']
    if (tutorData.levels?.includes('BOTH')) {
      const expanded = new Set(tutorData.levels.flatMap((l: string) => l === 'BOTH' ? ['JC', 'LC'] : [l]));
      tutorData.levels = Array.from(expanded);
    }

    res.json({ success: true, data: tutorData });
  } catch (error) {
    console.error('Get tutor error:', error);
    res.status(500).json({ error: 'Failed to get tutor' });
  }
});

// GET /api/tutors/:id/availability - Get tutor availability (real data)
router.get('/:id/availability', async (req: Request, res: Response) => {
  try {
    const tutorId = req.params.id as string;
    const medium = (req.query.medium as string) || 'VIDEO';
    const startDate = (req.query.startDate as string) || new Date().toISOString().split('T')[0];
    const endDateParam = req.query.endDate as string;
    const endDate = endDateParam || (() => {
      const d = new Date();
      d.setDate(d.getDate() + 30);
      return d.toISOString().split('T')[0];
    })();

    const tutor = await Tutor.findByPk(tutorId);
    if (!tutor) {
      return res.status(404).json({ error: 'Tutor not found' });
    }

    const data = await computeAvailability(tutorId, startDate, endDate, medium as any);

    res.json({
      success: true,
      data,
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
    const tutorId = req.params.id as string;
    const offset = (Number(page) - 1) * Number(pageSize);

    const { rows, count } = await Session.findAndCountAll({
      where: {
        tutorId,
        rating: { [Op.ne]: null as any },
        status: { [Op.in]: ['CONFIRMED', 'COMPLETED'] },
      },
      order: [['updatedAt', 'DESC']],
      limit: Number(pageSize),
      offset,
      include: [{ model: User, as: 'student', attributes: ['firstName', 'lastName'] }],
    });

    const items = rows.map((s: any) => ({
      id: s.id,
      studentName: s.student ? `${s.student.firstName} ${s.student.lastName.charAt(0)}.` : 'Student',
      rating: s.rating,
      text: s.reviewText || '',
      date: s.updatedAt,
      subject: s.subject,
    }));

    // Get the tutor's stored average rating
    const tutor = await Tutor.findByPk(tutorId);
    const averageRating = tutor ? Number(tutor.rating) : 0;

    // Compute rating breakdown from all reviews
    const allRatings = await Session.findAll({
      where: { tutorId, rating: { [Op.ne]: null as any }, status: { [Op.in]: ['CONFIRMED', 'COMPLETED'] } },
      attributes: ['rating'],
    });
    const breakdown: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    allRatings.forEach((s: any) => {
      const r = Math.round(Number(s.rating));
      if (r >= 1 && r <= 5) breakdown[r]++;
    });
    // Convert to percentages
    const total = allRatings.length || 1;
    const ratingBreakdown: Record<number, number> = {
      5: Math.round((breakdown[5] / total) * 100),
      4: Math.round((breakdown[4] / total) * 100),
      3: Math.round((breakdown[3] / total) * 100),
      2: Math.round((breakdown[2] / total) * 100),
      1: Math.round((breakdown[1] / total) * 100),
    };

    res.json({
      success: true,
      data: {
        items,
        total: count,
        page: Number(page),
        pageSize: Number(pageSize),
        totalPages: Math.ceil(count / Number(pageSize)),
        averageRating,
        ratingBreakdown,
      },
    });
  } catch (error) {
    console.error('Get reviews error:', error);
    res.status(500).json({ error: 'Failed to get reviews' });
  }
});

export default router;
