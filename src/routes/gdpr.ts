import { Router, Request, Response } from 'express';
import { User } from '../models/User';
import { Tutor } from '../models/Tutor';
import { Session } from '../models/Session';
import { Resource } from '../models/Resource';
import { Transaction } from '../models/Transaction';
import { Message } from '../models/Message';
import { Conversation } from '../models/Conversation';
import { ParentLink } from '../models/ParentLink';
import { ResourcePurchase } from '../models/ResourcePurchase';
import { GardaVetting } from '../models/GardaVetting';
import { authMiddleware, clearAccountStatusCache } from '../middleware/auth';
import { emailService } from '../services/emailService';
import { stripeService } from '../services/stripeService';
import { deleteObject } from '../services/storageService';
import { Op } from 'sequelize';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

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

    const [sentMessages, conversations, parentLinks, purchases, vetting] = await Promise.all([
      Message.findAll({ where: { senderId: userId }, order: [['createdAt', 'ASC']] }),
      Conversation.findAll({ where: { [Op.or]: [{ studentId: userId }, { tutorId: userId }] } }),
      ParentLink.findAll({ where: { [Op.or]: [{ studentId: userId }, { parentId: userId }] } }),
      ResourcePurchase.findAll({ where: { userId } }),
      tutorProfile ? GardaVetting.findAll({ where: { tutorId: tutorProfile.id } }) : Promise.resolve([]),
    ]);

    // Compile all data
    const exportData = {
      exportDate: new Date().toISOString(),
      dataController: 'Matthew Callinan Keenan, trading as FindGrinds',
      dataControllerContact: 'privacy@findgrinds.ie',
      userData: {
        profile: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          userType: user.userType,
          dateOfBirth: user.dateOfBirth,
          profilePhotoUrl: user.profilePhotoUrl,
          gardaVettingSelfDeclared: user.gardaVettingSelfDeclared,
          gardaVettingVerified: user.gardaVettingVerified,
          marketingConsent: user.marketingConsent,
          analyticsConsent: user.analyticsConsent,
          consentDate: user.consentDate,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
        tutorProfile: tutorProfile ? {
          bio: tutorProfile.bio,
          headline: tutorProfile.headline,
          qualifications: tutorProfile.qualifications,
          subjects: tutorProfile.subjects,
          levels: tutorProfile.levels,
          area: tutorProfile.area,
          organisationName: tutorProfile.organisationName,
          organisationWebsite: tutorProfile.organisationWebsite,
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
        conversations: conversations.map(c => ({
          id: c.id,
          role: c.studentId === userId ? 'student' : 'tutor',
          createdAt: c.createdAt,
        })),
        messagesSent: sentMessages.map(m => ({
          id: m.id,
          conversationId: m.conversationId,
          content: m.content,
          sentAt: m.createdAt,
        })),
        parentLinks: parentLinks.map(l => ({
          role: l.studentId === userId ? 'student' : 'parent',
          status: l.status,
          linkedAt: l.linkedAt,
        })),
        resourcePurchases: purchases.map(p => ({
          id: p.id,
          resourceId: p.resourceId,
          status: p.status,
          createdAt: p.createdAt,
        })),
        gardaVettingSubmissions: (vetting as GardaVetting[]).map(v => ({
          documentName: v.documentName,
          status: v.status,
          submittedAt: v.submittedAt,
          reviewedAt: v.reviewedAt,
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

    const tutor = user.userType === 'TUTOR' ? await Tutor.findOne({ where: { userId } }) : null;

    // Only UPCOMING sessions block deletion; past ones are just history.
    const upcomingSessions = await Session.count({
      where: {
        ...(tutor ? { tutorId: tutor.id } : { studentId: userId }),
        status: { [Op.in]: ['PENDING', 'RESERVED', 'CONFIRMED'] },
        scheduledAt: { [Op.gt]: new Date() },
      },
    });

    if (upcomingSessions > 0) {
      return res.status(400).json({
        error: 'Please cancel your upcoming sessions before deleting your account.',
        pendingSessions: upcomingSessions,
      });
    }

    // Sessions, messages, transactions and purchases reference the user row with
    // NOT NULL foreign keys, so the row is anonymised in place rather than
    // destroyed. Messages are kept (without the sender's identity) for
    // safeguarding and dispute purposes; see the Privacy Policy.
    if (tutor) {
      if (tutor.stripeSubscriptionId && tutor.stripeSubscriptionStatus !== 'canceled') {
        try {
          await stripeService.cancelSubscriptionImmediately(tutor.stripeSubscriptionId);
        } catch (err) {
          console.error('Account deletion: failed to cancel subscription', err);
          return res.status(500).json({ error: 'Failed to cancel your subscription. Please contact support.' });
        }
      }

      // Take resources off sale; existing buyers keep access to what they bought.
      await Resource.update({ status: 'SUSPENDED' }, { where: { tutorId: tutor.id } });

      const vettingDocs = await GardaVetting.findAll({ where: { tutorId: tutor.id } });
      for (const doc of vettingDocs) {
        if (doc.documentUrl && !doc.documentUrl.startsWith('http')) {
          await deleteObject(doc.documentUrl).catch((err) => console.error('Vetting doc delete failed:', err));
        }
        await doc.destroy();
      }

      await tutor.update({
        isVisible: false,
        bio: null as any,
        headline: null as any,
        area: null as any,
        qualifications: [],
        organisationName: null as any,
        organisationWebsite: null as any,
        inviteCode: null as any,
      });
    }

    await ParentLink.destroy({ where: { [Op.or]: [{ studentId: userId }, { parentId: userId }] } });

    if (user.profilePhotoUrl && !user.profilePhotoUrl.startsWith('http')) {
      await deleteObject(user.profilePhotoUrl).catch((err) => console.error('Photo delete failed:', err));
    }

    // Log deletion request (for audit)
    console.log(`Account deletion: User ${userId}, Reason: ${reason || 'Not provided'}, Date: ${new Date().toISOString()}`);

    // Capture email before anonymising for confirmation
    const userEmail = user.email;
    const userFirstName = user.firstName;

    await user.update({
      email: `deleted-${user.id}@deleted.invalid`,
      firstName: 'Deleted',
      lastName: 'User',
      password: await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12),
      dateOfBirth: null as any,
      profilePhotoUrl: null as any,
      stripeCustomerId: null as any,
      resetPasswordToken: null as any,
      resetPasswordExpires: null as any,
      marketingConsent: false,
      analyticsConsent: false,
      accountStatus: 'DELETED',
    });
    clearAccountStatusCache(userId);

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
