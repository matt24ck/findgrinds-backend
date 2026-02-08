import { Router, Request, Response } from 'express';
import { Op } from 'sequelize';
import { Resource } from '../models/Resource';
import { Tutor } from '../models/Tutor';
import { User } from '../models/User';
import { ResourcePurchase } from '../models/ResourcePurchase';
import { ResourceReport } from '../models/ResourceReport';
import { stripeService } from '../services/stripeService';
import { authMiddleware } from '../middleware/auth';
import { resolveUrl } from '../services/storageService';

const router = Router();

// Helper: strip raw file keys and resolve preview URLs for public responses
async function sanitizeResourceForPublic(resource: any): Promise<any> {
  const data = typeof resource.toJSON === 'function' ? resource.toJSON() : { ...resource };
  data.previewUrl = await resolveUrl(data.previewUrl);
  delete data.fileUrl; // Never expose raw file key/URL in public listings
  return data;
}

// GET /api/resources - Search resources
router.get('/', async (req: Request, res: Response) => {
  try {
    const {
      subject,
      level,
      resourceType,
      minPrice,
      maxPrice,
      sortBy = 'sales',
      page = 1,
      pageSize = 12,
    } = req.query;

    const where: any = { status: 'PUBLISHED' };

    if (subject) where.subject = subject;
    if (level) where.level = level;
    if (resourceType) where.resourceType = resourceType;

    if (minPrice || maxPrice) {
      where.price = {};
      if (minPrice) where.price[Op.gte] = Number(minPrice);
      if (maxPrice) where.price[Op.lte] = Number(maxPrice);
    }

    let order: any[] = [];
    switch (sortBy) {
      case 'rating':
        order = [['rating', 'DESC']];
        break;
      case 'price_asc':
        order = [['price', 'ASC']];
        break;
      case 'price_desc':
        order = [['price', 'DESC']];
        break;
      case 'newest':
        order = [['createdAt', 'DESC']];
        break;
      case 'sales':
      default:
        order = [['salesCount', 'DESC']];
        break;
    }

    const offset = (Number(page) - 1) * Number(pageSize);

    const { rows: resources, count: total } = await Resource.findAndCountAll({
      where,
      order,
      limit: Number(pageSize),
      offset,
      include: [{
        model: Tutor,
        as: 'tutor',
        attributes: ['id', 'headline'],
        include: [{ model: User, attributes: ['firstName', 'lastName'] }],
      }],
    });

    const sanitized = await Promise.all(resources.map(sanitizeResourceForPublic));

    res.json({
      success: true,
      data: {
        items: sanitized,
        total,
        page: Number(page),
        pageSize: Number(pageSize),
        totalPages: Math.ceil(total / Number(pageSize)),
      },
    });
  } catch (error) {
    console.error('Resource search error:', error);
    res.status(500).json({ error: 'Failed to search resources' });
  }
});

// GET /api/resources/purchased - Get student's purchased resources
router.get('/purchased', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const purchases = await ResourcePurchase.findAll({
      where: { userId, status: 'COMPLETED' },
      include: [{
        model: Resource,
        as: 'resource',
        include: [{
          model: Tutor,
          as: 'tutor',
          include: [{ model: User, attributes: ['firstName', 'lastName'] }],
        }],
      }],
      order: [['createdAt', 'DESC']],
    });
    res.json({ success: true, data: purchases });
  } catch (error) {
    console.error('Get purchased resources error:', error);
    res.status(500).json({ error: 'Failed to get purchased resources' });
  }
});

// GET /api/resources/:id - Get resource details
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const resource = await Resource.findByPk(req.params.id as string, {
      include: [{
        model: Tutor,
        as: 'tutor',
        include: [{ model: User, attributes: ['firstName', 'lastName'] }],
      }],
    });

    if (!resource) {
      return res.status(404).json({ error: 'Resource not found' });
    }

    const sanitized = await sanitizeResourceForPublic(resource);

    res.json({ success: true, data: sanitized });
  } catch (error) {
    console.error('Get resource error:', error);
    res.status(500).json({ error: 'Failed to get resource' });
  }
});

// POST /api/resources - Create resource (tutor only)
router.post('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userType = (req as any).user.userType;
    if (userType !== 'TUTOR') {
      return res.status(403).json({ error: 'Only tutors can create resources' });
    }

    const tutor = await Tutor.findOne({ where: { userId: (req as any).user.userId } });
    if (!tutor) {
      return res.status(404).json({ error: 'Tutor profile not found' });
    }

    const {
      title,
      description,
      fileUrl,
      fileKey,
      previewUrl,
      previewKey,
      resourceType,
      subject,
      level,
      price,
    } = req.body;

    // Accept S3 key or legacy URL
    const resolvedFileUrl = fileKey || fileUrl;
    const resolvedPreviewUrl = previewKey || previewUrl;

    // Validate required fields
    if (!title || !resolvedFileUrl || !subject || !level || !price) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate price
    const priceNum = Number(price);
    if (!price || isNaN(priceNum) || priceNum < 0.50) {
      return res.status(400).json({ error: 'Price must be at least €0.50' });
    }
    // Ensure max 2 decimal places
    if (Math.round(priceNum * 100) !== priceNum * 100) {
      return res.status(400).json({ error: 'Price must have at most 2 decimal places' });
    }

    const resource = await Resource.create({
      tutorId: tutor.id,
      title,
      description,
      fileUrl: resolvedFileUrl,
      previewUrl: resolvedPreviewUrl,
      resourceType: resourceType || 'PDF',
      subject,
      level,
      price,
      status: 'PUBLISHED',
    });

    res.status(201).json({
      success: true,
      data: resource,
      message: 'Resource created successfully.',
    });
  } catch (error) {
    console.error('Create resource error:', error);
    res.status(500).json({ error: 'Failed to create resource' });
  }
});

// DELETE /api/resources/:id - Delete (soft) a resource (tutor only)
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userType = (req as any).user.userType;
    if (userType !== 'TUTOR') {
      return res.status(403).json({ error: 'Only tutors can delete resources' });
    }

    const tutor = await Tutor.findOne({ where: { userId: (req as any).user.userId } });
    if (!tutor) {
      return res.status(404).json({ error: 'Tutor profile not found' });
    }

    const resource = await Resource.findByPk(req.params.id as string);
    if (!resource) {
      return res.status(404).json({ error: 'Resource not found' });
    }

    if (resource.tutorId !== tutor.id) {
      return res.status(403).json({ error: 'You can only delete your own resources' });
    }

    if (resource.status === 'SUSPENDED') {
      return res.status(400).json({ error: 'Resource is already deleted' });
    }

    await resource.update({ status: 'SUSPENDED' });

    res.json({ success: true, message: 'Resource deleted successfully' });
  } catch (error) {
    console.error('Delete resource error:', error);
    res.status(500).json({ error: 'Failed to delete resource' });
  }
});

// POST /api/resources/:id/purchase - Initiate resource purchase via Stripe Checkout
router.post('/:id/purchase', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const resource = await Resource.findByPk(req.params.id as string, {
      include: [{
        model: Tutor,
        as: 'tutor',
      }],
    });

    if (!resource) {
      return res.status(404).json({ error: 'Resource not found' });
    }

    if (resource.status !== 'PUBLISHED') {
      return res.status(400).json({ error: 'Resource not available for purchase' });
    }

    // Check if already purchased
    const existingPurchase = await ResourcePurchase.findOne({
      where: { userId, resourceId: resource.id, status: 'COMPLETED' },
    });
    if (existingPurchase) {
      return res.status(400).json({ error: 'You have already purchased this resource' });
    }

    const tutor = (resource as any).tutor as Tutor;
    if (!tutor || !tutor.stripeConnectAccountId || !tutor.stripeConnectOnboarded) {
      return res.status(400).json({ error: 'This tutor is not set up to accept payments yet' });
    }

    const buyer = await User.findByPk(userId);
    if (!buyer) {
      return res.status(404).json({ error: 'User not found' });
    }

    const tutorUser = await User.findByPk(tutor.userId);
    if (!tutorUser) {
      return res.status(404).json({ error: 'Tutor user not found' });
    }

    // Calculate fees (15% platform fee)
    const price = Number(resource.price);
    const platformFee = price * 0.15;
    const tutorEarnings = price - platformFee;

    // Create pending purchase record
    const purchase = await ResourcePurchase.create({
      userId,
      resourceId: resource.id,
      price,
      platformFee,
      tutorEarnings,
    });

    // Create Stripe Checkout session
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const checkoutUrl = await stripeService.createResourceCheckout({
      buyer,
      resource,
      tutor,
      tutorUser,
      purchaseId: purchase.id,
      successUrl: `${frontendUrl}/resources/${resource.id}/success`,
      cancelUrl: `${frontendUrl}/resources/${resource.id}`,
    });

    res.json({ url: checkoutUrl, purchaseId: purchase.id });
  } catch (error) {
    console.error('Purchase resource error:', error);
    res.status(500).json({ error: 'Failed to initiate purchase' });
  }
});

// GET /api/resources/:id/download - Secure download for purchased resource
router.get('/:id/download', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;

    // Check that the user has a completed purchase
    const purchase = await ResourcePurchase.findOne({
      where: {
        userId,
        resourceId: req.params.id as string,
        status: 'COMPLETED',
      },
    });

    if (!purchase) {
      return res.status(403).json({ error: 'You have not purchased this resource' });
    }

    const resource = await Resource.findByPk(req.params.id as string);
    if (!resource) {
      return res.status(404).json({ error: 'Resource not found' });
    }

    // Increment download count
    await purchase.update({ downloadCount: purchase.downloadCount + 1 });

    // Generate a signed download URL (15 min expiry)
    const downloadUrl = await resolveUrl(resource.fileUrl, 900);

    res.json({
      success: true,
      data: {
        downloadUrl,
        title: resource.title,
        resourceType: resource.resourceType,
      },
    });
  } catch (error) {
    console.error('Download resource error:', error);
    res.status(500).json({ error: 'Failed to download resource' });
  }
});

// GET /api/resources/:id/ownership - Check if user purchased this resource
router.get('/:id/ownership', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;

    const purchase = await ResourcePurchase.findOne({
      where: {
        userId,
        resourceId: req.params.id as string,
        status: 'COMPLETED',
      },
    });

    res.json({
      success: true,
      data: {
        owned: !!purchase,
        purchasedAt: purchase?.createdAt || null,
      },
    });
  } catch (error) {
    console.error('Check ownership error:', error);
    res.status(500).json({ error: 'Failed to check ownership' });
  }
});

// GET /api/resources/tutor/:tutorId - Get tutor's resources
router.get('/tutor/:tutorId', async (req: Request, res: Response) => {
  try {
    const resources = await Resource.findAll({
      where: {
        tutorId: req.params.tutorId as string,
        status: 'PUBLISHED',
      },
      order: [['salesCount', 'DESC']],
      limit: 10,
    });

    const sanitized = await Promise.all(resources.map(sanitizeResourceForPublic));
    res.json({ success: true, data: sanitized });
  } catch (error) {
    console.error('Get tutor resources error:', error);
    res.status(500).json({ error: 'Failed to get resources' });
  }
});

// POST /api/resources/:id/report - Report a purchased resource
router.post('/:id/report', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const resourceId = req.params.id as string;
    const { reason, details } = req.body;

    const validReasons = ['misleading_content', 'poor_quality', 'wrong_subject', 'incomplete', 'other'];
    if (!reason || !validReasons.includes(reason)) {
      return res.status(400).json({ error: 'Invalid or missing reason' });
    }

    // Verify user has purchased this resource
    const purchase = await ResourcePurchase.findOne({
      where: { userId, resourceId, status: 'COMPLETED' },
    });
    if (!purchase) {
      return res.status(403).json({ error: 'You must purchase this resource before reporting it' });
    }

    // Prevent duplicate reports
    const existing = await ResourceReport.findOne({
      where: { reporterId: userId, resourceId },
    });
    if (existing) {
      return res.status(400).json({ error: 'You have already reported this resource' });
    }

    const report = await ResourceReport.create({
      resourceId,
      purchaseId: purchase.id,
      reporterId: userId,
      reason,
      details: details || null,
    });

    res.status(201).json({
      success: true,
      data: report,
      message: 'Report submitted. Our team will review it shortly.',
    });
  } catch (error) {
    console.error('Report resource error:', error);
    res.status(500).json({ error: 'Failed to submit report' });
  }
});

// GET /api/resources/:id/report-status - Check if user has reported this resource
router.get('/:id/report-status', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const resourceId = req.params.id as string;

    const report = await ResourceReport.findOne({
      where: { reporterId: userId, resourceId },
    });

    res.json({
      success: true,
      data: { reported: !!report },
    });
  } catch (error) {
    console.error('Check report status error:', error);
    res.status(500).json({ error: 'Failed to check report status' });
  }
});

export default router;
