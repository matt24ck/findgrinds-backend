import { Router, Request, Response } from 'express';
import { GardaVetting } from '../models/GardaVetting';
import { User } from '../models/User';
import { Tutor } from '../models/Tutor';
import { authMiddleware } from '../middleware/auth';
import { emailService } from '../services/emailService';

const router = Router();

// POST /api/verification/garda-vetting/upload - Upload Garda vetting document
router.post('/garda-vetting/upload', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const { documentUrl, documentName } = req.body;

    // Verify user is a tutor
    const user = await User.findByPk(userId);
    if (!user || user.userType !== 'TUTOR') {
      return res.status(403).json({ error: 'Only tutors can upload Garda vetting documents' });
    }

    // Get tutor profile
    const tutor = await Tutor.findOne({ where: { userId } });
    if (!tutor) {
      return res.status(404).json({ error: 'Tutor profile not found' });
    }

    // Check for existing pending submission
    const existingPending = await GardaVetting.findOne({
      where: { tutorId: tutor.id, status: 'PENDING' },
    });

    if (existingPending) {
      return res.status(400).json({
        error: 'You already have a pending verification request. Please wait for admin review.'
      });
    }

    // Create new verification request
    const verification = await GardaVetting.create({
      tutorId: tutor.id,
      documentUrl,
      documentName,
    });

    res.status(201).json({
      success: true,
      message: 'Document uploaded successfully. It will be reviewed by our team.',
      data: {
        id: verification.id,
        status: verification.status,
        submittedAt: verification.submittedAt,
      },
    });
  } catch (error) {
    console.error('Garda vetting upload error:', error);
    res.status(500).json({ error: 'Failed to upload document' });
  }
});

// GET /api/verification/garda-vetting/status - Get current verification status
router.get('/garda-vetting/status', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;

    const user = await User.findByPk(userId);
    if (!user || user.userType !== 'TUTOR') {
      return res.status(403).json({ error: 'Only tutors can check verification status' });
    }

    const tutor = await Tutor.findOne({ where: { userId } });
    if (!tutor) {
      return res.status(404).json({ error: 'Tutor profile not found' });
    }

    // Get all verification requests
    const verifications = await GardaVetting.findAll({
      where: { tutorId: tutor.id },
      order: [['submittedAt', 'DESC']],
    });

    res.json({
      success: true,
      data: {
        isVerified: user.gardaVettingVerified,
        selfDeclared: user.gardaVettingSelfDeclared,
        verifications: verifications.map(v => ({
          id: v.id,
          documentName: v.documentName,
          status: v.status,
          submittedAt: v.submittedAt,
          reviewedAt: v.reviewedAt,
          reviewNotes: v.status === 'REJECTED' ? v.reviewNotes : undefined,
        })),
      },
    });
  } catch (error) {
    console.error('Verification status error:', error);
    res.status(500).json({ error: 'Failed to get verification status' });
  }
});

// ============ ADMIN ROUTES ============

// Middleware to check if user is admin
const adminMiddleware = async (req: Request, res: Response, next: Function) => {
  const userId = (req as any).user?.userId;
  const user = await User.findByPk(userId);

  // For now, check a simple admin flag or email domain
  // In production, you'd have a proper admin role system
  if (!user || !(user as any).isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// GET /api/verification/admin/pending - Get all pending verifications
router.get('/admin/pending', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  try {
    const pendingVerifications = await GardaVetting.findAll({
      where: { status: 'PENDING' },
      order: [['submittedAt', 'ASC']],
    });

    // Get tutor and user info for each verification
    const verificationsWithDetails = await Promise.all(
      pendingVerifications.map(async (v) => {
        const tutor = await Tutor.findByPk(v.tutorId);
        const user = tutor ? await User.findByPk(tutor.userId) : null;

        return {
          id: v.id,
          documentUrl: v.documentUrl,
          documentName: v.documentName,
          submittedAt: v.submittedAt,
          tutor: tutor ? {
            id: tutor.id,
            headline: tutor.headline,
            subjects: tutor.subjects,
          } : null,
          user: user ? {
            id: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
          } : null,
        };
      })
    );

    res.json({
      success: true,
      data: verificationsWithDetails,
      count: verificationsWithDetails.length,
    });
  } catch (error) {
    console.error('Admin pending verifications error:', error);
    res.status(500).json({ error: 'Failed to get pending verifications' });
  }
});

// POST /api/verification/admin/review/:id - Approve or reject a verification
router.post('/admin/review/:id', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  try {
    const verificationId = req.params.id as string;
    const { action, notes } = req.body; // action: 'approve' | 'reject'
    const adminUserId = (req as any).user.userId;

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action. Must be "approve" or "reject"' });
    }

    const verification = await GardaVetting.findByPk(verificationId);
    if (!verification) {
      return res.status(404).json({ error: 'Verification not found' });
    }

    if (verification.status !== 'PENDING') {
      return res.status(400).json({ error: 'Verification has already been reviewed' });
    }

    // Get tutor and user info for email notification
    const tutor = await Tutor.findByPk(verification.tutorId);
    const user = tutor ? await User.findByPk(tutor.userId) : null;

    // Update verification status
    verification.status = action === 'approve' ? 'APPROVED' : 'REJECTED';
    verification.reviewedAt = new Date();
    verification.reviewedBy = adminUserId;
    verification.reviewNotes = notes || null;
    await verification.save();

    // If approved, update user's verified status
    if (action === 'approve' && user) {
      user.gardaVettingVerified = true;
      await user.save();

      // Send approval email
      emailService.sendGardaVettingApproved(user.email, user.firstName);
    } else if (action === 'reject' && user) {
      // Send rejection email
      emailService.sendGardaVettingRejected(user.email, user.firstName, notes);
    }

    res.json({
      success: true,
      message: `Verification ${action === 'approve' ? 'approved' : 'rejected'} successfully`,
      data: {
        id: verification.id,
        status: verification.status,
        reviewedAt: verification.reviewedAt,
      },
    });
  } catch (error) {
    console.error('Admin review error:', error);
    res.status(500).json({ error: 'Failed to review verification' });
  }
});

// GET /api/verification/admin/stats - Get verification statistics
router.get('/admin/stats', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  try {
    const pending = await GardaVetting.count({ where: { status: 'PENDING' } });
    const approved = await GardaVetting.count({ where: { status: 'APPROVED' } });
    const rejected = await GardaVetting.count({ where: { status: 'REJECTED' } });

    res.json({
      success: true,
      data: {
        pending,
        approved,
        rejected,
        total: pending + approved + rejected,
      },
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

export default router;
