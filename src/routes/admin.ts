import { Router, Request, Response, NextFunction } from 'express';
import { User } from '../models/User';
import { Tutor } from '../models/Tutor';
import { TutorSubscription, SubscriptionTier } from '../models/TutorSubscription';
import { Session } from '../models/Session';
import { Resource } from '../models/Resource';
import { ResourceReport } from '../models/ResourceReport';
import { ResourcePurchase } from '../models/ResourcePurchase';
import { authMiddleware } from '../middleware/auth';
import { stripeService } from '../services/stripeService';
import { Op } from 'sequelize';

const router = Router();

// Admin middleware - must come after authMiddleware
const adminMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.userId;
    const user = await User.findByPk(userId);

    if (!user || !user.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    (req as any).adminUser = user;
    next();
  } catch (error) {
    res.status(500).json({ error: 'Failed to verify admin status' });
  }
};

// Apply auth and admin middleware to all routes
router.use(authMiddleware, adminMiddleware);

// ============ USER MANAGEMENT ============

// GET /api/admin/users - List all users with filtering
router.get('/users', async (req: Request, res: Response) => {
  try {
    const {
      page = 1,
      limit = 20,
      userType,
      status,
      search,
      sortBy = 'createdAt',
      sortOrder = 'DESC'
    } = req.query;

    const offset = (Number(page) - 1) * Number(limit);
    const where: any = {};

    if (userType) {
      where.userType = userType;
    }

    if (status) {
      where.accountStatus = status;
    }

    if (search) {
      where[Op.or] = [
        { firstName: { [Op.iLike]: `%${search}%` } },
        { lastName: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const { rows: users, count: total } = await User.findAndCountAll({
      where,
      attributes: { exclude: ['password'] },
      order: [[sortBy as string, sortOrder as string]],
      limit: Number(limit),
      offset,
    });

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit)),
        },
      },
    });
  } catch (error) {
    console.error('Admin list users error:', error);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

// GET /api/admin/users/:id - Get detailed user info
router.get('/users/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const user = await User.findByPk(id, {
      attributes: { exclude: ['password'] },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get additional data based on user type
    let tutorProfile = null;
    let subscription = null;
    let stats: any = {};

    if (user.userType === 'TUTOR') {
      tutorProfile = await Tutor.findOne({ where: { userId: id } });
      if (tutorProfile) {
        subscription = await TutorSubscription.findOne({ where: { tutorId: tutorProfile.id } });
        stats.totalSessions = await Session.count({ where: { tutorId: tutorProfile.id } });
        stats.totalResources = await Resource.count({ where: { tutorId: tutorProfile.id } });
      }
    } else {
      stats.totalBookings = await Session.count({ where: { studentId: id } });
    }

    res.json({
      success: true,
      data: {
        user,
        tutorProfile,
        subscription,
        stats,
      },
    });
  } catch (error) {
    console.error('Admin get user error:', error);
    res.status(500).json({ error: 'Failed to get user details' });
  }
});

// PUT /api/admin/users/:id/suspend - Suspend a user account
router.put('/users/:id/suspend', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const adminUserId = (req as any).user.userId;

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.isAdmin) {
      return res.status(400).json({ error: 'Cannot suspend admin accounts' });
    }

    if (user.accountStatus === 'SUSPENDED') {
      return res.status(400).json({ error: 'Account is already suspended' });
    }

    user.accountStatus = 'SUSPENDED';
    user.suspensionReason = reason || 'No reason provided';
    user.suspendedAt = new Date();
    user.suspendedBy = adminUserId;
    await user.save();

    res.json({
      success: true,
      message: 'Account suspended successfully',
      data: {
        id: user.id,
        accountStatus: user.accountStatus,
        suspendedAt: user.suspendedAt,
      },
    });
  } catch (error) {
    console.error('Admin suspend user error:', error);
    res.status(500).json({ error: 'Failed to suspend user' });
  }
});

// PUT /api/admin/users/:id/unsuspend - Reactivate a suspended account
router.put('/users/:id/unsuspend', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.accountStatus !== 'SUSPENDED') {
      return res.status(400).json({ error: 'Account is not suspended' });
    }

    user.accountStatus = 'ACTIVE';
    user.suspensionReason = undefined;
    user.suspendedAt = undefined;
    user.suspendedBy = undefined;
    await user.save();

    res.json({
      success: true,
      message: 'Account reactivated successfully',
      data: {
        id: user.id,
        accountStatus: user.accountStatus,
      },
    });
  } catch (error) {
    console.error('Admin unsuspend user error:', error);
    res.status(500).json({ error: 'Failed to reactivate user' });
  }
});

// DELETE /api/admin/users/:id - Permanently delete/remove a user
router.delete('/users/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { hardDelete } = req.query; // If true, actually delete. Otherwise, soft delete.

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.isAdmin) {
      return res.status(400).json({ error: 'Cannot delete admin accounts' });
    }

    if (hardDelete === 'true') {
      // Hard delete - actually remove the user and their data
      if (user.userType === 'TUTOR') {
        const tutor = await Tutor.findOne({ where: { userId: id } });
        if (tutor) {
          await TutorSubscription.destroy({ where: { tutorId: tutor.id } });
          await Resource.destroy({ where: { tutorId: tutor.id } });
          await Session.update({ tutorId: null as any }, { where: { tutorId: tutor.id } });
          await tutor.destroy();
        }
      } else {
        await Session.update({ studentId: null as any }, { where: { studentId: id } });
      }
      await user.destroy();

      res.json({
        success: true,
        message: 'User permanently deleted',
      });
    } else {
      // Soft delete - mark as deleted
      user.accountStatus = 'DELETED';
      await user.save();

      res.json({
        success: true,
        message: 'User account marked as deleted',
        data: {
          id: user.id,
          accountStatus: user.accountStatus,
        },
      });
    }
  } catch (error) {
    console.error('Admin delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// ============ SUBSCRIPTION/TIER MANAGEMENT ============

// GET /api/admin/subscriptions - List all subscriptions
router.get('/subscriptions', async (req: Request, res: Response) => {
  try {
    const { tier, isAdminGranted, status } = req.query;

    const where: any = {};
    if (tier) where.tier = tier;
    if (isAdminGranted !== undefined) where.isAdminGranted = isAdminGranted === 'true';
    if (status) where.status = status;

    const subscriptions = await TutorSubscription.findAll({
      where,
      order: [['createdAt', 'DESC']],
    });

    // Get tutor and user info for each subscription
    const subscriptionsWithDetails = await Promise.all(
      subscriptions.map(async (sub) => {
        const tutor = await Tutor.findByPk(sub.tutorId);
        const user = tutor ? await User.findByPk(tutor.userId, { attributes: { exclude: ['password'] } }) : null;
        return {
          ...sub.toJSON(),
          tutor: tutor ? { id: tutor.id, headline: tutor.headline } : null,
          user: user ? { id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email } : null,
        };
      })
    );

    res.json({
      success: true,
      data: subscriptionsWithDetails,
    });
  } catch (error) {
    console.error('Admin list subscriptions error:', error);
    res.status(500).json({ error: 'Failed to list subscriptions' });
  }
});

// POST /api/admin/subscriptions/:id/refund - Refund a subscription's latest invoice
router.post('/subscriptions/:id/refund', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const subscription = await TutorSubscription.findByPk(id);
    if (!subscription) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    if (subscription.isAdminGranted) {
      return res.status(400).json({ error: 'Cannot refund an admin-granted subscription. Use "Remove tier" instead.' });
    }

    if (!subscription.stripeSubscriptionId) {
      return res.status(400).json({ error: 'No Stripe subscription found to refund' });
    }

    const result = await stripeService.refundSubscriptionInvoice(subscription.stripeSubscriptionId);

    res.json({
      success: true,
      message: `Latest invoice refunded (€${result.amountRefunded.toFixed(2)}). Tutor keeps their current tier.`,
      data: {
        refundId: result.refundId,
        amountRefunded: result.amountRefunded,
        subscriptionId: id,
      },
    });
  } catch (error) {
    console.error('Admin refund subscription error:', error);
    res.status(500).json({ error: 'Failed to refund subscription' });
  }
});

// PUT /api/admin/users/:id/tier - Set a tutor's tier (admin grant)
router.put('/users/:id/tier', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { tier, reason } = req.body as { tier: SubscriptionTier; reason?: string };
    const adminUserId = (req as any).user.userId;

    // Validate tier
    if (!['FREE', 'VERIFIED', 'PROFESSIONAL'].includes(tier)) {
      return res.status(400).json({ error: 'Invalid tier. Must be FREE, VERIFIED, or PROFESSIONAL' });
    }

    // Find user
    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.userType !== 'TUTOR') {
      return res.status(400).json({ error: 'User is not a tutor' });
    }

    // Find tutor profile
    const tutor = await Tutor.findOne({ where: { userId: id } });
    if (!tutor) {
      return res.status(404).json({ error: 'Tutor profile not found' });
    }

    // Find or create subscription
    let subscription = await TutorSubscription.findOne({ where: { tutorId: tutor.id } });

    if (subscription) {
      // Update existing subscription
      subscription.tier = tier;
      subscription.isAdminGranted = true;
      subscription.adminGrantedBy = adminUserId;
      subscription.adminGrantedAt = new Date();
      subscription.adminGrantedReason = reason || 'Admin granted';
      subscription.status = 'ACTIVE';
      // Keep stripe info intact - don't cancel their payment subscription
      // They just get upgraded for free
      await subscription.save();
    } else {
      // Create new subscription
      subscription = await TutorSubscription.create({
        tutorId: tutor.id,
        tier,
        isAdminGranted: true,
        adminGrantedBy: adminUserId,
        adminGrantedAt: new Date(),
        adminGrantedReason: reason || 'Admin granted',
        status: 'ACTIVE',
      });
    }

    res.json({
      success: true,
      message: `Tier updated to ${tier} successfully`,
      data: {
        userId: id,
        tutorId: tutor.id,
        tier: subscription.tier,
        isAdminGranted: subscription.isAdminGranted,
        adminGrantedReason: subscription.adminGrantedReason,
      },
    });
  } catch (error) {
    console.error('Admin set tier error:', error);
    res.status(500).json({ error: 'Failed to update tier' });
  }
});

// DELETE /api/admin/users/:id/tier - Remove admin-granted tier (revert to paid or free)
router.delete('/users/:id/tier', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const user = await User.findByPk(id);
    if (!user || user.userType !== 'TUTOR') {
      return res.status(404).json({ error: 'Tutor not found' });
    }

    const tutor = await Tutor.findOne({ where: { userId: id } });
    if (!tutor) {
      return res.status(404).json({ error: 'Tutor profile not found' });
    }

    const subscription = await TutorSubscription.findOne({ where: { tutorId: tutor.id } });
    if (!subscription) {
      return res.status(404).json({ error: 'No subscription found' });
    }

    if (!subscription.isAdminGranted) {
      return res.status(400).json({ error: 'Subscription is not admin-granted' });
    }

    // If they have an active Stripe subscription, keep their paid tier
    // Otherwise revert to FREE
    if (subscription.stripeSubscriptionId) {
      subscription.isAdminGranted = false;
      subscription.adminGrantedBy = undefined;
      subscription.adminGrantedAt = undefined;
      subscription.adminGrantedReason = undefined;
      // Keep their current tier since they're paying for it
      await subscription.save();

      res.json({
        success: true,
        message: 'Admin grant removed. User retains paid subscription.',
        data: { tier: subscription.tier },
      });
    } else {
      subscription.tier = 'FREE';
      subscription.isAdminGranted = false;
      subscription.adminGrantedBy = undefined;
      subscription.adminGrantedAt = undefined;
      subscription.adminGrantedReason = undefined;
      await subscription.save();

      res.json({
        success: true,
        message: 'Admin grant removed. Tier reverted to FREE.',
        data: { tier: 'FREE' },
      });
    }
  } catch (error) {
    console.error('Admin remove tier error:', error);
    res.status(500).json({ error: 'Failed to remove tier' });
  }
});

// ============ ADMIN STATS ============

// GET /api/admin/stats - Get platform statistics
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const totalUsers = await User.count({ where: { accountStatus: 'ACTIVE' } });
    const totalTutors = await User.count({ where: { userType: 'TUTOR', accountStatus: 'ACTIVE' } });
    const totalStudents = await User.count({ where: { userType: 'STUDENT', accountStatus: 'ACTIVE' } });
    const suspendedUsers = await User.count({ where: { accountStatus: 'SUSPENDED' } });

    const verifiedSubscriptions = await TutorSubscription.count({ where: { tier: 'VERIFIED', status: 'ACTIVE' } });
    const professionalSubscriptions = await TutorSubscription.count({ where: { tier: 'PROFESSIONAL', status: 'ACTIVE' } });
    const adminGrantedSubscriptions = await TutorSubscription.count({ where: { isAdminGranted: true, status: 'ACTIVE' } });

    const totalSessions = await Session.count();
    const completedSessions = await Session.count({ where: { status: 'COMPLETED' } });

    res.json({
      success: true,
      data: {
        users: {
          total: totalUsers,
          tutors: totalTutors,
          students: totalStudents,
          suspended: suspendedUsers,
        },
        subscriptions: {
          verified: verifiedSubscriptions,
          professional: professionalSubscriptions,
          adminGranted: adminGrantedSubscriptions,
        },
        sessions: {
          total: totalSessions,
          completed: completedSessions,
        },
      },
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

// POST /api/admin/make-admin/:id - Make a user an admin (super admin only)
router.post('/make-admin/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.isAdmin = true;
    await user.save();

    res.json({
      success: true,
      message: 'User is now an admin',
      data: { id: user.id, isAdmin: user.isAdmin },
    });
  } catch (error) {
    console.error('Make admin error:', error);
    res.status(500).json({ error: 'Failed to make user admin' });
  }
});

// ============ RESOURCE REPORTS ============

// GET /api/admin/resources/reports - List resource reports
router.get('/resources/reports', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  try {
    const status = (req.query.status as string) || 'PENDING';

    const reports = await ResourceReport.findAll({
      where: { status },
      include: [
        {
          model: Resource,
          as: 'resource',
          attributes: ['id', 'title', 'subject', 'level', 'price', 'resourceType', 'status'],
        },
        {
          model: ResourcePurchase,
          as: 'purchase',
          attributes: ['id', 'price', 'stripePaymentIntentId', 'status'],
        },
        {
          model: User,
          as: 'reporter',
          attributes: ['id', 'firstName', 'lastName', 'email'],
        },
      ],
      order: [['createdAt', 'DESC']],
    });

    res.json({
      success: true,
      data: reports,
      count: reports.length,
    });
  } catch (error) {
    console.error('Get resource reports error:', error);
    res.status(500).json({ error: 'Failed to get resource reports' });
  }
});

// POST /api/admin/resources/reports/:id/action - Take action on a resource report
router.post('/resources/reports/:id/action', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  try {
    const reportId = req.params.id as string;
    const { action } = req.body;
    const adminUserId = (req as any).user.userId;

    if (!['refund', 'dismiss', 'suspend'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action. Must be refund, dismiss, or suspend' });
    }

    const report = await ResourceReport.findByPk(reportId, {
      include: [
        { model: ResourcePurchase, as: 'purchase' },
        { model: Resource, as: 'resource' },
      ],
    });

    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    if (report.status !== 'PENDING') {
      return res.status(400).json({ error: 'Report has already been reviewed' });
    }

    const purchase = (report as any).purchase as ResourcePurchase;
    const resource = (report as any).resource as Resource;

    if (action === 'refund' || action === 'suspend') {
      // Process refund if purchase has a payment intent
      if (purchase && purchase.stripePaymentIntentId && purchase.status === 'COMPLETED') {
        try {
          await stripeService.refundSession({
            paymentIntentId: purchase.stripePaymentIntentId,
            reason: 'Resource reported by buyer',
          });
          await purchase.update({ status: 'REFUNDED' });
        } catch (stripeError) {
          console.error('Resource refund failed:', stripeError);
          return res.status(500).json({ error: 'Failed to process refund via Stripe' });
        }
      }

      report.status = 'REFUNDED';

      // If suspend, also remove resource from marketplace
      if (action === 'suspend' && resource) {
        await resource.update({ status: 'SUSPENDED' });
      }
    } else {
      // dismiss
      report.status = 'DISMISSED';
    }

    report.reviewedBy = adminUserId;
    report.reviewedAt = new Date();
    await report.save();

    res.json({
      success: true,
      message: action === 'dismiss'
        ? 'Report dismissed'
        : action === 'suspend'
          ? 'Resource suspended and purchase refunded'
          : 'Purchase refunded',
      data: report,
    });
  } catch (error) {
    console.error('Resource report action error:', error);
    res.status(500).json({ error: 'Failed to process report action' });
  }
});

export default router;
