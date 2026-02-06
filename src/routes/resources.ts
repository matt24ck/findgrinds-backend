import { Router, Request, Response } from 'express';
import { Op } from 'sequelize';
import { Resource } from '../models/Resource';
import { Tutor } from '../models/Tutor';
import { User } from '../models/User';
import { ResourcePurchase } from '../models/ResourcePurchase';
import { stripeService } from '../services/stripeService';
import { authMiddleware } from '../middleware/auth';

const router = Router();

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
      }],
    });

    res.json({
      success: true,
      data: {
        items: resources,
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

// GET /api/resources/:id - Get resource details
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const resource = await Resource.findByPk(req.params.id, {
      include: [{
        model: Tutor,
        as: 'tutor',
      }],
    });

    if (!resource) {
      return res.status(404).json({ error: 'Resource not found' });
    }

    res.json({ success: true, data: resource });
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

    const {
      title,
      description,
      fileUrl,
      previewUrl,
      resourceType,
      subject,
      level,
      price,
    } = req.body;

    // Validate required fields
    if (!title || !fileUrl || !subject || !level || !price) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate price range
    if (price < 2 || price > 25) {
      return res.status(400).json({ error: 'Price must be between €2 and €25' });
    }

    const resource = await Resource.create({
      tutorId: (req as any).user.userId,
      title,
      description,
      fileUrl,
      previewUrl,
      resourceType: resourceType || 'PDF',
      subject,
      level,
      price,
      status: 'PENDING_REVIEW', // Requires QA review
    });

    res.status(201).json({
      success: true,
      data: resource,
      message: 'Resource submitted for review. It will be live within 24 hours.',
    });
  } catch (error) {
    console.error('Create resource error:', error);
    res.status(500).json({ error: 'Failed to create resource' });
  }
});

// POST /api/resources/:id/purchase - Initiate resource purchase via Stripe Checkout
router.post('/:id/purchase', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const resource = await Resource.findByPk(req.params.id, {
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
        resourceId: req.params.id,
        status: 'COMPLETED',
      },
    });

    if (!purchase) {
      return res.status(403).json({ error: 'You have not purchased this resource' });
    }

    const resource = await Resource.findByPk(req.params.id);
    if (!resource) {
      return res.status(404).json({ error: 'Resource not found' });
    }

    // Increment download count
    await purchase.update({ downloadCount: purchase.downloadCount + 1 });

    // Return the file URL
    // In production with S3, this should generate a signed URL with expiry
    res.json({
      success: true,
      data: {
        downloadUrl: resource.fileUrl,
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
        resourceId: req.params.id,
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
        tutorId: req.params.tutorId,
        status: 'PUBLISHED',
      },
      order: [['salesCount', 'DESC']],
      limit: 10,
    });

    res.json({ success: true, data: resources });
  } catch (error) {
    console.error('Get tutor resources error:', error);
    res.status(500).json({ error: 'Failed to get resources' });
  }
});

export default router;
