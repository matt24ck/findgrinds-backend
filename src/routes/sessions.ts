import { Router, Request, Response } from 'express';
import { Op } from 'sequelize';
import { Session } from '../models/Session';
import { Tutor } from '../models/Tutor';
import { User } from '../models/User';
import { ParentLink } from '../models/ParentLink';
import { authMiddleware } from '../middleware/auth';
import { emailService } from '../services/emailService';
import { stripeService } from '../services/stripeService';
import { videoService } from '../services/videoService';
import { ReviewReport } from '../models/ReviewReport';
import { SessionDispute } from '../models/SessionDispute';
import { resolveUrl } from '../services/storageService';

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

    // Create session first (meeting creation happens after payment in stripeService webhook)
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
      const tutor = await Tutor.findOne({ where: { userId } });
      if (!tutor) {
        return res.status(404).json({ error: 'Tutor not found' });
      }
      where.tutorId = tutor.id;
    } else {
      where.studentId = userId;
    }

    if (status) {
      where.status = status;
    }

    if (upcoming === 'true') {
      where.scheduledAt = { [Op.gte]: new Date() };
      where.status = { [Op.in]: ['PENDING', 'CONFIRMED'] };
    }

    const sessions = await Session.findAll({
      where,
      order: [['scheduledAt', 'ASC']],
      include: [
        { model: Tutor, as: 'tutor', include: [{ model: User, attributes: ['firstName', 'lastName'] }] },
        { model: User, as: 'student', attributes: ['firstName', 'lastName'] },
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
    const session = await Session.findByPk(req.params.id as string, {
      include: [
        { model: Tutor, as: 'tutor', include: [{ model: User, attributes: ['firstName', 'lastName'] }] },
        { model: User, as: 'student', attributes: ['firstName', 'lastName'] },
      ],
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Verify user has access
    const userId = (req as any).user.userId;
    const tutor = (session as any).tutor;
    if (session.studentId !== userId && (!tutor || tutor.userId !== userId)) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    res.json({ success: true, data: session });
  } catch (error) {
    console.error('Get session error:', error);
    res.status(500).json({ error: 'Failed to get session' });
  }
});

// PUT /api/sessions/:id/cancel - Cancel session with refund
router.put('/:id/cancel', authMiddleware, async (req: Request, res: Response) => {
  try {
    const session = await Session.findByPk(req.params.id as string);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const userId = (req as any).user.userId;

    // Determine who is cancelling
    const tutor = await Tutor.findByPk(session.tutorId);
    if (!tutor) {
      return res.status(404).json({ error: 'Tutor not found' });
    }

    const isTutor = tutor.userId === userId;
    const isStudent = session.studentId === userId;

    // Check parent authorization
    let isParent = false;
    if (!isTutor && !isStudent) {
      const link = await ParentLink.findOne({
        where: { parentId: userId, studentId: session.studentId, status: 'ACTIVE' },
      });
      isParent = !!link;
    }

    if (!isTutor && !isStudent && !isParent) {
      return res.status(403).json({ error: 'Not authorized to cancel this session' });
    }

    if (session.status === 'COMPLETED') {
      return res.status(400).json({ error: 'Cannot cancel completed session' });
    }

    if (session.status === 'CANCELLED') {
      return res.status(400).json({ error: 'Session already cancelled' });
    }

    // Determine refund percentage
    let refundPercent = 0;
    let refundStatus: 'none' | 'full' | 'partial' | 'failed' = 'none';

    if (session.paymentStatus === 'paid' && session.stripePaymentIntentId) {
      if (isTutor) {
        // Tutor cancels → always 100% refund
        refundPercent = 100;
      } else {
        // Student/parent cancels → check notice period
        const now = new Date();
        const sessionStart = new Date(session.scheduledAt);
        const hoursUntilSession = (sessionStart.getTime() - now.getTime()) / (1000 * 60 * 60);

        if (hoursUntilSession >= tutor.cancellationNoticeHours) {
          refundPercent = 100;
        } else {
          refundPercent = tutor.lateCancellationRefundPercent;
        }
      }

      // Process Stripe refund
      if (refundPercent > 0) {
        try {
          const totalInCents = Math.round(Number(session.price) * 100);
          const refundAmountCents = refundPercent === 100
            ? undefined
            : Math.round(totalInCents * (refundPercent / 100));

          const result = await stripeService.refundSession({
            paymentIntentId: session.stripePaymentIntentId,
            amountInCents: refundAmountCents,
            reason: isTutor ? 'Cancelled by tutor' : 'Cancelled by student',
          });

          session.refundAmount = result.amountRefunded;
          refundStatus = refundPercent === 100 ? 'full' : 'partial';
          session.paymentStatus = 'refunded';
        } catch (stripeError) {
          console.error('Stripe refund failed:', stripeError);
          refundStatus = 'failed';
        }
      }
    }

    // Delete video meeting if one exists (fire-and-forget)
    const meetingId = session.dailyRoomName || session.zoomMeetingId;
    if (meetingId) {
      videoService.deleteMeeting(meetingId).catch((err) => {
        console.error('Failed to delete video meeting:', err);
      });
    }

    // Update session
    session.status = 'CANCELLED';
    session.cancelledBy = userId;
    session.refundStatus = refundStatus;
    await session.save();

    // Send cancellation emails to both parties (fire-and-forget)
    try {
      const [student, tutorUser] = await Promise.all([
        User.findByPk(session.studentId, { attributes: ['email', 'firstName'] }),
        User.findByPk(tutor.userId, { attributes: ['email', 'firstName'] }),
      ]);

      const cancelledBy = isTutor ? 'tutor' : 'student';
      const sessionDate = session.scheduledAt
        ? new Date(session.scheduledAt).toLocaleDateString('en-IE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
        : 'TBC';
      const sessionTime = session.scheduledAt
        ? new Date(session.scheduledAt).toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' })
        : 'TBC';

      if (student) {
        emailService.sendSessionCancelledEmail(student.email, {
          recipientName: student.firstName,
          otherPartyName: tutorUser?.firstName || 'your tutor',
          subject: session.subject || 'Session',
          date: sessionDate,
          time: sessionTime,
          cancelledBy,
          dashboardUrl: 'https://findgrinds.ie/dashboard/student',
        });
      }

      if (tutorUser) {
        emailService.sendSessionCancelledEmail(tutorUser.email, {
          recipientName: tutorUser.firstName,
          otherPartyName: student?.firstName || 'the student',
          subject: session.subject || 'Session',
          date: sessionDate,
          time: sessionTime,
          cancelledBy,
          dashboardUrl: 'https://findgrinds.ie/dashboard/tutor',
        });
      }
    } catch (emailError) {
      console.error('Failed to send cancellation emails:', emailError);
    }

    // Build response message
    let message = 'Session cancelled.';
    if (refundPercent > 0 && refundStatus !== 'failed') {
      message = `Session cancelled. ${refundPercent}% refund (€${(session.refundAmount || 0).toFixed(2)}) is being processed.`;
    } else if (refundStatus === 'failed') {
      message = 'Session cancelled but refund failed. Please contact support.';
    } else if (session.paymentStatus === 'paid') {
      message = 'Session cancelled. No refund applicable based on the cancellation policy.';
    }

    res.json({
      success: true,
      data: { ...session.toJSON(), refundPercent },
      message,
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
    const session = await Session.findByPk(req.params.id as string);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Only student can review
    const userId = (req as any).user.userId;
    if (session.studentId !== userId) {
      return res.status(403).json({ error: 'Only student can review' });
    }

    // Check session is completed or confirmed and in the past
    if (session.status !== 'COMPLETED' && session.status !== 'CONFIRMED') {
      return res.status(400).json({ error: 'Can only review completed sessions' });
    }
    if (new Date(session.scheduledAt) > new Date()) {
      return res.status(400).json({ error: 'Cannot review a session before it has taken place' });
    }

    // Prevent duplicate reviews
    if (session.rating) {
      return res.status(400).json({ error: 'You have already reviewed this session' });
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

// POST /api/sessions/:id/review/report - Flag a review as abusive
router.post('/:id/review/report', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { reason, details } = req.body;
    const session = await Session.findByPk(req.params.id as string);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (!session.rating) {
      return res.status(400).json({ error: 'This session has no review to report' });
    }

    // Only the tutor of this session can report the review
    const userId = (req as any).user.userId;
    const tutor = await Tutor.findOne({ where: { userId } });
    if (!tutor || tutor.id !== session.tutorId) {
      return res.status(403).json({ error: 'Only the tutor of this session can report the review' });
    }

    // Prevent duplicate reports
    const existing = await ReviewReport.findOne({
      where: { sessionId: session.id, reporterId: userId },
    });
    if (existing) {
      return res.status(400).json({ error: 'You have already reported this review' });
    }

    if (!reason || !['inappropriate', 'harassment', 'false_claims', 'other'].includes(reason)) {
      return res.status(400).json({ error: 'Invalid reason' });
    }

    const report = await ReviewReport.create({
      sessionId: session.id,
      reporterId: userId,
      reason,
      details: details || null,
    });

    res.json({ success: true, data: report });
  } catch (error) {
    console.error('Report review error:', error);
    res.status(500).json({ error: 'Failed to report review' });
  }
});

// POST /api/sessions/:id/dispute - Student raises a dispute
router.post('/:id/dispute', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { reason, details, evidenceKeys } = req.body;
    const userId = (req as any).user.userId;
    const session = await Session.findByPk(req.params.id as string, {
      include: [
        { model: Tutor, as: 'tutor' },
        { model: User, as: 'student', attributes: ['firstName', 'lastName'] },
      ],
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Only student can raise dispute
    if (session.studentId !== userId) {
      return res.status(403).json({ error: 'Only the student can raise a dispute' });
    }

    // Session must be confirmed/completed and in the past
    if (!['CONFIRMED', 'COMPLETED'].includes(session.status)) {
      return res.status(400).json({ error: 'Can only dispute confirmed or completed sessions' });
    }
    if (new Date(session.scheduledAt) > new Date()) {
      return res.status(400).json({ error: 'Cannot dispute a session that has not taken place yet' });
    }

    // Prevent duplicate disputes
    const existing = await SessionDispute.findOne({ where: { sessionId: session.id } });
    if (existing) {
      return res.status(400).json({ error: 'A dispute has already been raised for this session' });
    }

    // Validate reason
    const validReasons = ['tutor_no_show', 'poor_quality', 'inappropriate_behavior', 'other'];
    if (!reason || !validReasons.includes(reason)) {
      return res.status(400).json({ error: 'Invalid reason' });
    }

    if (!details || details.trim().length === 0) {
      return res.status(400).json({ error: 'Please provide details about the dispute' });
    }

    const dispute = await SessionDispute.create({
      sessionId: session.id,
      reporterId: userId,
      reason,
      details,
      evidenceKeys: evidenceKeys || [],
    });

    // Send email to tutor
    const tutor = (session as any).tutor;
    const student = (session as any).student;
    if (tutor) {
      const tutorUser = await User.findByPk(tutor.userId, { attributes: ['email', 'firstName'] });
      if (tutorUser) {
        const reasonLabels: Record<string, string> = {
          tutor_no_show: 'Tutor did not show up',
          poor_quality: 'Poor quality session',
          inappropriate_behavior: 'Inappropriate behavior',
          other: 'Other',
        };
        const sessionDate = new Date(session.scheduledAt).toLocaleDateString('en-IE', {
          weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        });

        emailService.sendSessionDisputeRaisedEmail(tutorUser.email, {
          tutorName: tutorUser.firstName,
          studentName: student ? `${student.firstName} ${student.lastName}` : 'A student',
          subject: session.subject || 'Session',
          date: sessionDate,
          reason: reasonLabels[reason] || reason,
        });
      }
    }

    res.status(201).json({ success: true, data: dispute });
  } catch (error) {
    console.error('Create dispute error:', error);
    res.status(500).json({ error: 'Failed to create dispute' });
  }
});

// GET /api/sessions/:id/dispute - Get dispute for a session
router.get('/:id/dispute', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const session = await Session.findByPk(req.params.id as string);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Check authorization (student or tutor)
    const tutor = await Tutor.findByPk(session.tutorId);
    const isTutor = tutor && tutor.userId === userId;
    const isStudent = session.studentId === userId;

    if (!isTutor && !isStudent) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const dispute = await SessionDispute.findOne({
      where: { sessionId: session.id },
      include: [
        { model: User, as: 'reporter', attributes: ['id', 'firstName', 'lastName', 'email'] },
      ],
    });

    if (!dispute) {
      return res.json({ success: true, data: null });
    }

    // Resolve evidence URLs
    const disputeData = dispute.toJSON() as any;
    if (disputeData.evidenceKeys?.length > 0) {
      disputeData.evidenceUrls = await Promise.all(
        disputeData.evidenceKeys.map((key: string) => resolveUrl(key))
      );
    }
    if (disputeData.tutorEvidenceKeys?.length > 0) {
      disputeData.tutorEvidenceUrls = await Promise.all(
        disputeData.tutorEvidenceKeys.map((key: string) => resolveUrl(key))
      );
    }

    res.json({ success: true, data: disputeData });
  } catch (error) {
    console.error('Get dispute error:', error);
    res.status(500).json({ error: 'Failed to get dispute' });
  }
});

// POST /api/sessions/:id/dispute/respond - Tutor responds to dispute
router.post('/:id/dispute/respond', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { tutorResponse, tutorEvidenceKeys } = req.body;
    const userId = (req as any).user.userId;
    const session = await Session.findByPk(req.params.id as string);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Only tutor can respond
    const tutor = await Tutor.findByPk(session.tutorId);
    if (!tutor || tutor.userId !== userId) {
      return res.status(403).json({ error: 'Only the tutor can respond to a dispute' });
    }

    const dispute = await SessionDispute.findOne({ where: { sessionId: session.id } });
    if (!dispute) {
      return res.status(404).json({ error: 'No dispute found for this session' });
    }

    if (dispute.status !== 'PENDING') {
      return res.status(400).json({ error: 'This dispute has already been resolved' });
    }

    if (dispute.tutorResponse) {
      return res.status(400).json({ error: 'You have already responded to this dispute' });
    }

    if (!tutorResponse || tutorResponse.trim().length === 0) {
      return res.status(400).json({ error: 'Please provide a response' });
    }

    dispute.tutorResponse = tutorResponse;
    dispute.tutorEvidenceKeys = tutorEvidenceKeys || [];
    dispute.respondedAt = new Date();
    await dispute.save();

    res.json({ success: true, data: dispute });
  } catch (error) {
    console.error('Dispute respond error:', error);
    res.status(500).json({ error: 'Failed to respond to dispute' });
  }
});

// GET /api/sessions/:id/token - Get video meeting token
router.get('/:id/token', authMiddleware, async (req: Request, res: Response) => {
  try {
    const session = await Session.findByPk(req.params.id as string, {
      include: [
        { model: Tutor, as: 'tutor', include: [{ model: User, attributes: ['firstName', 'lastName'] }] },
        { model: User, as: 'student', attributes: ['firstName', 'lastName'] },
      ],
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Verify user is the student or tutor for this session
    const userId = (req as any).user.userId;
    const tutor = (session as any).tutor;
    const isTutor = tutor && tutor.userId === userId;
    const isStudent = session.studentId === userId;

    if (!isTutor && !isStudent) {
      return res.status(403).json({ error: 'Not authorized to join this session' });
    }

    const provider = videoService.getProvider();

    if (provider === 'zoom') {
      // Zoom uses external links, no token needed
      return res.json({
        success: true,
        data: {
          provider: 'zoom',
          meetingLink: session.meetingLink,
        },
      });
    }

    // Daily.co — generate a meeting token
    if (!session.dailyRoomName) {
      return res.status(400).json({ error: 'No video room found for this session' });
    }

    const user = await User.findByPk(userId, { attributes: ['firstName', 'lastName'] });
    const userName = user ? `${user.firstName} ${user.lastName}` : 'Participant';
    const expiresAt = new Date(new Date(session.scheduledAt).getTime() + session.durationMins * 60 * 1000);

    const tokenData = await videoService.createToken(
      session.dailyRoomName,
      userId,
      userName,
      expiresAt
    );

    res.json({
      success: true,
      data: {
        provider: 'daily',
        token: tokenData?.token,
        roomUrl: tokenData?.roomUrl,
        roomName: session.dailyRoomName,
      },
    });
  } catch (error) {
    console.error('Get session token error:', error);
    res.status(500).json({ error: 'Failed to get session token' });
  }
});

export default router;
