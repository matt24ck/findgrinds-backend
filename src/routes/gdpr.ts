import { Router, Request, Response } from 'express';
import { User } from '../models/User';
import { Tutor } from '../models/Tutor';
import { Session } from '../models/Session';
import { Resource } from '../models/Resource';
import { Transaction } from '../models/Transaction';
import { authMiddleware } from '../middleware/auth';
import { emailService } from '../services/emailService';

const router = Router();

// GET /api/gdpr/export - Export all user data (GDPR Article 20 - Right to data portability)
router.get('/export', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;

    // Fetch all user data
    const user = await User.findByPk(userId, {
      attributes: { exclude: ['password'] },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Fetch related data based on user type
    let tutorProfile = null;
    let tutorResources: any[] = [];
    let sessions: any[] = [];
    let transactions: any[] = [];

    if (user.userType === 'TUTOR') {
      tutorProfile = await Tutor.findOne({ where: { userId } });
      if (tutorProfile) {
        tutorResources = await Resource.findAll({ where: { tutorId: tutorProfile.id } });
        sessions = await Session.findAll({ where: { tutorId: tutorProfile.id } });
      }
    } else {
      sessions = await Session.findAll({ where: { studentId: userId } });
    }

    transactions = await Transaction.findAll({ where: { userId } });

    // Compile all data
    const exportData = {
      exportDate: new Date().toISOString(),
      dataController: 'FindGrinds Limited',
      dataControllerContact: 'privacy@findgrinds.ie',
      userData: {
        profile: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          userType: user.userType,
          profilePhotoUrl: user.profilePhotoUrl,
          gardaVettingVerified: user.gardaVettingVerified,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
        tutorProfile: tutorProfile ? {
          bio: tutorProfile.bio,
          headline: tutorProfile.headline,
          qualifications: tutorProfile.qualifications,
          subjects: tutorProfile.subjects,
          levels: tutorProfile.levels,
          baseHourlyRate: tutorProfile.baseHourlyRate,
          rating: tutorProfile.rating,
          reviewCount: tutorProfile.reviewCount,
          totalBookings: tutorProfile.totalBookings,
        } : null,
        sessions: sessions.map(s => ({
          id: s.id,
          subject: s.subject,
          level: s.level,
          scheduledAt: s.scheduledAt,
          durationMins: s.durationMins,
          price: s.price,
          status: s.status,
          rating: s.rating,
          reviewText: s.reviewText,
          createdAt: s.createdAt,
        })),
        resources: tutorResources.map(r => ({
          id: r.id,
          title: r.title,
          description: r.description,
          subject: r.subject,
          level: r.level,
          price: r.price,
          salesCount: r.salesCount,
          createdAt: r.createdAt,
        })),
        transactions: transactions.map(t => ({
          id: t.id,
          type: t.type,
          amount: t.amount,
          platformFee: t.platformFee,
          status: t.status,
          createdAt: t.createdAt,
        })),
      },
    };

    // Set headers for file download
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="findgrinds-data-export-${userId}.json"`);

    res.json(exportData);
  } catch (error) {
    console.error('Data export error:', error);
    res.status(500).json({ error: 'Failed to export data' });
  }
});

// DELETE /api/gdpr/delete-account - Delete user account (GDPR Article 17 - Right to erasure)
router.delete('/delete-account', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const { confirmEmail, reason } = req.body;

    // Fetch user
    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify email confirmation
    if (confirmEmail !== user.email) {
      return res.status(400).json({ error: 'Email confirmation does not match' });
    }

    // Check for pending sessions
    const pendingSessions = await Session.count({
      where: {
        [user.userType === 'TUTOR' ? 'tutorId' : 'studentId']:
          user.userType === 'TUTOR' ? (await Tutor.findOne({ where: { userId } }))?.id : userId,
        status: ['PENDING', 'CONFIRMED'],
      },
    });

    if (pendingSessions > 0) {
      return res.status(400).json({
        error: 'Cannot delete account with pending sessions. Please cancel or complete all sessions first.',
        pendingSessions,
      });
    }

    // If tutor, handle tutor-specific data
    if (user.userType === 'TUTOR') {
      const tutor = await Tutor.findOne({ where: { userId } });
      if (tutor) {
        // Anonymize resources (keep for buyers but remove tutor info)
        await Resource.update(
          { tutorId: null as any, status: 'DRAFT' },
          { where: { tutorId: tutor.id } }
        );

        // Anonymize session history
        await Session.update(
          { tutorId: null as any },
          { where: { tutorId: tutor.id } }
        );

        // Delete tutor profile
        await tutor.destroy();
      }
    } else {
      // Anonymize student session history
      await Session.update(
        { studentId: null as any },
        { where: { studentId: userId } }
      );
    }

    // Anonymize transactions
    await Transaction.update(
      { userId: null as any },
      { where: { userId } }
    );

    // Log deletion request (for audit)
    console.log(`Account deletion: User ${userId}, Reason: ${reason || 'Not provided'}, Date: ${new Date().toISOString()}`);

    // Capture email before deletion for confirmation
    const userEmail = user.email;
    const userFirstName = user.firstName;

    // Delete user
    await user.destroy();

    // Send deletion confirmation email (fire-and-forget)
    emailService.sendAccountDeletedEmail(userEmail, userFirstName);

    res.json({
      success: true,
      message: 'Your account and personal data have been deleted. Some anonymized records may be retained for legal and financial purposes.',
    });
  } catch (error) {
    console.error('Account deletion error:', error);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

// GET /api/gdpr/consent-status - Get user's consent status
router.get('/consent-status', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const user = await User.findByPk(userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      data: {
        marketingConsent: (user as any).marketingConsent || false,
        analyticsConsent: (user as any).analyticsConsent || false,
        consentDate: (user as any).consentDate || null,
      },
    });
  } catch (error) {
    console.error('Consent status error:', error);
    res.status(500).json({ error: 'Failed to get consent status' });
  }
});

// PUT /api/gdpr/update-consent - Update consent preferences
router.put('/update-consent', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const { marketingConsent, analyticsConsent } = req.body;

    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update consent (you'd need to add these fields to User model)
    (user as any).marketingConsent = marketingConsent;
    (user as any).analyticsConsent = analyticsConsent;
    (user as any).consentDate = new Date();
    await user.save();

    res.json({
      success: true,
      message: 'Consent preferences updated',
    });
  } catch (error) {
    console.error('Update consent error:', error);
    res.status(500).json({ error: 'Failed to update consent' });
  }
});

export default router;
