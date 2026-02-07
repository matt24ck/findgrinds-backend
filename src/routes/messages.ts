import { Router, Request, Response } from 'express';
import { Op, fn, col, literal } from 'sequelize';
import { authMiddleware } from '../middleware/auth';
import { Conversation } from '../models/Conversation';
import { Message } from '../models/Message';
import { MessageReport } from '../models/MessageReport';
import { User } from '../models/User';
import { ParentLink } from '../models/ParentLink';
import { Tutor } from '../models/Tutor';
import { Resend } from 'resend';
import { emailService } from '../services/emailService';

const router = Router();

// All routes require auth
router.use(authMiddleware);

// Predefined messages for under-18 students without linked parents
const PREDEFINED_MESSAGES = [
  "Hi, I'm interested in booking a session. Could you tell me more about your availability?",
  'What subjects and levels do you teach?',
  'What is your cancellation policy?',
  'Do you offer online or in-person sessions?',
  'Can you help me prepare for my exams?',
  'What resources do you recommend for my level?',
];

// Helper: check if a student is a minor without a linked parent
async function getMessagingPermission(userId: string): Promise<{
  isMinor: boolean;
  hasLinkedParent: boolean;
  canFreeText: boolean;
}> {
  const user = await User.findByPk(userId);
  if (!user) return { isMinor: false, hasLinkedParent: false, canFreeText: true };

  const minor = user.isMinor();
  if (!minor) return { isMinor: false, hasLinkedParent: false, canFreeText: true };

  const parentLink = await ParentLink.findOne({
    where: { studentId: userId, status: 'ACTIVE' },
  });

  return {
    isMinor: true,
    hasLinkedParent: !!parentLink,
    canFreeText: !!parentLink,
  };
}

// GET /api/messages/predefined - Get list of predefined messages
router.get('/predefined', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: PREDEFINED_MESSAGES.map((text, index) => ({ id: index, text })),
  });
});

// GET /api/messages/conversations - List user's conversations
router.get('/conversations', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const userType = (req as any).user.userType;

    // Find conversations where user is either student or tutor
    let where: any;
    if (userType === 'TUTOR') {
      // Tutors: find by tutorId (which is the user's ID as tutor)
      const tutor = await Tutor.findOne({ where: { userId } });
      if (!tutor) {
        return res.json({ success: true, data: [] });
      }
      where = { tutorId: tutor.userId };
    } else {
      where = { studentId: userId };
    }

    const conversations = await Conversation.findAll({
      where,
      include: [
        { model: User, as: 'student', attributes: ['id', 'firstName', 'lastName', 'profilePhotoUrl'] },
        { model: User, as: 'tutor', attributes: ['id', 'firstName', 'lastName', 'profilePhotoUrl'] },
      ],
      order: [['lastMessageAt', 'DESC']],
    });

    // Get last message and unread count for each conversation
    const conversationsWithDetails = await Promise.all(
      conversations.map(async (conv) => {
        const lastMessage = await Message.findOne({
          where: { conversationId: conv.id },
          order: [['createdAt', 'DESC']],
          include: [{ model: User, as: 'sender', attributes: ['id', 'firstName', 'lastName'] }],
        });

        const unreadCount = await Message.count({
          where: {
            conversationId: conv.id,
            senderId: { [Op.ne]: userId },
            readAt: null,
          },
        });

        return {
          id: conv.id,
          student: (conv as any).student,
          tutor: (conv as any).tutor,
          lastMessage: lastMessage
            ? {
                content: lastMessage.content,
                senderId: lastMessage.senderId,
                senderName: `${(lastMessage as any).sender.firstName} ${(lastMessage as any).sender.lastName}`,
                createdAt: lastMessage.createdAt,
                onBehalfOfStudentId: lastMessage.onBehalfOfStudentId,
              }
            : null,
          unreadCount,
          lastMessageAt: conv.lastMessageAt,
          createdAt: conv.createdAt,
        };
      })
    );

    res.json({ success: true, data: conversationsWithDetails });
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ error: 'Failed to get conversations' });
  }
});

// GET /api/messages/conversations/:id - Get messages for a conversation
router.get('/conversations/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const conversationId = req.params.id as string;
    const page = Number(req.query.page) || 1;
    const pageSize = Number(req.query.pageSize) || 50;

    const conversation = await Conversation.findByPk(conversationId, {
      include: [
        { model: User, as: 'student', attributes: ['id', 'firstName', 'lastName', 'profilePhotoUrl'] },
        { model: User, as: 'tutor', attributes: ['id', 'firstName', 'lastName', 'profilePhotoUrl'] },
      ],
    });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Verify user is a participant
    if (conversation.studentId !== userId && conversation.tutorId !== userId) {
      return res.status(403).json({ error: 'Not a participant in this conversation' });
    }

    const offset = (page - 1) * pageSize;

    const { rows: messages, count: total } = await Message.findAndCountAll({
      where: { conversationId },
      include: [
        { model: User, as: 'sender', attributes: ['id', 'firstName', 'lastName', 'profilePhotoUrl'] },
      ],
      order: [['createdAt', 'ASC']],
      limit: pageSize,
      offset,
    });

    // Mark unread messages as read
    await Message.update(
      { readAt: new Date() },
      {
        where: {
          conversationId,
          senderId: { [Op.ne]: userId },
          readAt: null,
        },
      }
    );

    // Get messaging permission for the current user
    const permission = await getMessagingPermission(userId);

    res.json({
      success: true,
      data: {
        conversation: {
          id: conversation.id,
          student: (conversation as any).student,
          tutor: (conversation as any).tutor,
        },
        messages: messages.map((msg) => ({
          id: msg.id,
          content: msg.content,
          senderId: msg.senderId,
          sender: (msg as any).sender,
          isPredefined: msg.isPredefined,
          onBehalfOfStudentId: msg.onBehalfOfStudentId,
          readAt: msg.readAt,
          createdAt: msg.createdAt,
        })),
        total,
        page,
        totalPages: Math.ceil(total / pageSize),
        permission,
      },
    });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

// POST /api/messages/conversations - Start a new conversation
router.post('/conversations', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const userType = (req as any).user.userType;
    const { tutorId, message, predefinedMessageId } = req.body;

    if (!tutorId) {
      return res.status(400).json({ error: 'Tutor ID is required' });
    }

    // Verify tutor exists
    const tutorUser = await User.findByPk(tutorId);
    if (!tutorUser || tutorUser.userType !== 'TUTOR') {
      return res.status(404).json({ error: 'Tutor not found' });
    }

    // Students only
    if (userType !== 'STUDENT') {
      return res.status(403).json({ error: 'Only students can start conversations with tutors' });
    }

    // Check for existing conversation
    let conversation = await Conversation.findOne({
      where: { studentId: userId, tutorId },
    });

    if (conversation) {
      return res.json({
        success: true,
        data: { conversationId: conversation.id, isExisting: true },
      });
    }

    // Determine message content based on age-gate
    const permission = await getMessagingPermission(userId);
    let messageContent: string;
    let isPredefined = false;

    if (permission.isMinor && !permission.canFreeText) {
      // Under-18 without linked parent: predefined only
      if (predefinedMessageId === undefined || predefinedMessageId === null) {
        return res.status(403).json({
          error: 'Students under 18 must select a predefined message. Link a parent account to send custom messages.',
          code: 'PREDEFINED_ONLY',
          predefinedMessages: PREDEFINED_MESSAGES.map((text, i) => ({ id: i, text })),
        });
      }
      if (predefinedMessageId < 0 || predefinedMessageId >= PREDEFINED_MESSAGES.length) {
        return res.status(400).json({ error: 'Invalid predefined message ID' });
      }
      messageContent = PREDEFINED_MESSAGES[predefinedMessageId];
      isPredefined = true;
    } else {
      // 18+ or has linked parent: free text allowed
      if (!message || typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({ error: 'Message is required' });
      }
      messageContent = message.trim();
    }

    // Create conversation + first message
    conversation = await Conversation.create({
      studentId: userId,
      tutorId,
      lastMessageAt: new Date(),
    });

    await Message.create({
      conversationId: conversation.id,
      senderId: userId,
      content: messageContent,
      isPredefined,
    });

    // Send email notification to tutor (fire-and-forget)
    const sender = await User.findByPk(userId, { attributes: ['firstName', 'lastName'] });
    if (sender) {
      emailService.sendNewMessageNotification(tutorUser.email, {
        recipientName: tutorUser.firstName,
        senderName: `${sender.firstName} ${sender.lastName}`,
        messagePreview: messageContent.substring(0, 150),
        conversationUrl: `https://findgrinds.ie/dashboard/tutor`,
      });
    }

    res.status(201).json({
      success: true,
      data: { conversationId: conversation.id, isExisting: false },
    });
  } catch (error) {
    console.error('Start conversation error:', error);
    res.status(500).json({ error: 'Failed to start conversation' });
  }
});

// POST /api/messages/conversations/:id - Send a message in existing conversation
router.post('/conversations/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const conversationId = req.params.id as string;
    const { message, predefinedMessageId } = req.body;

    const conversation = await Conversation.findByPk(conversationId);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Verify user is a participant
    if (conversation.studentId !== userId && conversation.tutorId !== userId) {
      return res.status(403).json({ error: 'Not a participant in this conversation' });
    }

    // Determine message content based on age-gate (only for students)
    let messageContent: string;
    let isPredefined = false;

    if (conversation.studentId === userId) {
      const permission = await getMessagingPermission(userId);

      if (permission.isMinor && !permission.canFreeText) {
        if (predefinedMessageId === undefined || predefinedMessageId === null) {
          return res.status(403).json({
            error: 'Students under 18 must select a predefined message. Link a parent account to send custom messages.',
            code: 'PREDEFINED_ONLY',
            predefinedMessages: PREDEFINED_MESSAGES.map((text, i) => ({ id: i, text })),
          });
        }
        if (predefinedMessageId < 0 || predefinedMessageId >= PREDEFINED_MESSAGES.length) {
          return res.status(400).json({ error: 'Invalid predefined message ID' });
        }
        messageContent = PREDEFINED_MESSAGES[predefinedMessageId];
        isPredefined = true;
      } else {
        if (!message || typeof message !== 'string' || !message.trim()) {
          return res.status(400).json({ error: 'Message is required' });
        }
        messageContent = message.trim();
      }
    } else {
      // Tutor sending: free text always
      if (!message || typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({ error: 'Message is required' });
      }
      messageContent = message.trim();
    }

    const newMessage = await Message.create({
      conversationId,
      senderId: userId,
      content: messageContent,
      isPredefined,
    });

    // Update conversation lastMessageAt
    await conversation.update({ lastMessageAt: new Date() });

    // Send email notification to the other party (fire-and-forget)
    const recipientId = conversation.studentId === userId ? conversation.tutorId : conversation.studentId;
    const [sender, recipient] = await Promise.all([
      User.findByPk(userId, { attributes: ['firstName', 'lastName'] }),
      User.findByPk(recipientId, { attributes: ['email', 'firstName', 'userType'] }),
    ]);
    if (sender && recipient) {
      emailService.sendNewMessageNotification(recipient.email, {
        recipientName: recipient.firstName,
        senderName: `${sender.firstName} ${sender.lastName}`,
        messagePreview: messageContent.substring(0, 150),
        conversationUrl: `https://findgrinds.ie/dashboard/${recipient.userType.toLowerCase()}`,
      });
    }

    // Fetch with sender info
    const messageWithSender = await Message.findByPk(newMessage.id, {
      include: [{ model: User, as: 'sender', attributes: ['id', 'firstName', 'lastName', 'profilePhotoUrl'] }],
    });

    res.status(201).json({ success: true, data: messageWithSender });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// GET /api/messages/unread-count - Get total unread message count
router.get('/unread-count', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const userType = (req as any).user.userType;

    // Get all conversation IDs where user is a participant
    let where: any;
    if (userType === 'TUTOR') {
      where = { tutorId: userId };
    } else {
      where = { studentId: userId };
    }

    const conversations = await Conversation.findAll({
      where,
      attributes: ['id'],
    });

    const conversationIds = conversations.map((c) => c.id);

    if (conversationIds.length === 0) {
      return res.json({ success: true, data: { count: 0 } });
    }

    const count = await Message.count({
      where: {
        conversationId: { [Op.in]: conversationIds },
        senderId: { [Op.ne]: userId },
        readAt: null,
      },
    });

    res.json({ success: true, data: { count } });
  } catch (error) {
    console.error('Unread count error:', error);
    res.status(500).json({ error: 'Failed to get unread count' });
  }
});

// POST /api/messages/:messageId/report - Report a message
router.post('/:messageId/report', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const messageId = req.params.messageId as string;
    const { reason, details } = req.body;

    const validReasons = ['inappropriate', 'harassment', 'spam', 'safety_concern', 'other'];
    if (!reason || !validReasons.includes(reason)) {
      return res.status(400).json({ error: 'Valid reason is required' });
    }

    // Verify message exists
    const message = await Message.findByPk(messageId, {
      include: [{ model: Conversation, as: 'conversation' }],
    });

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Verify user is a participant in the conversation
    const conversation = (message as any).conversation as Conversation;
    if (conversation.studentId !== userId && conversation.tutorId !== userId) {
      return res.status(403).json({ error: 'Not a participant in this conversation' });
    }

    // Check for duplicate report
    const existingReport = await MessageReport.findOne({
      where: { messageId, reporterId: userId },
    });

    if (existingReport) {
      return res.status(400).json({ error: 'You have already reported this message' });
    }

    const report = await MessageReport.create({
      messageId,
      reporterId: userId,
      reason,
      details: details || null,
    });

    // Notify admin via email
    try {
      if (process.env.RESEND_API_KEY) {
        const resend = new Resend(process.env.RESEND_API_KEY);
        const reporter = await User.findByPk(userId);
        const sender = await User.findByPk(message.senderId);
        if (reporter && sender) {
          await resend.emails.send({
            from: process.env.FROM_EMAIL || 'FindGrinds <noreply@findgrinds.ie>',
            to: process.env.FROM_EMAIL || 'info@findgrinds.ie',
            subject: `[FindGrinds] Message Report - ${reason}`,
            text: `A message has been reported.\n\nReported by: ${reporter.firstName} ${reporter.lastName} (${reporter.email})\nMessage from: ${sender.firstName} ${sender.lastName} (${sender.email})\nReason: ${reason}\nDetails: ${details || 'N/A'}\nMessage content: ${message.content}`,
          });
        }
      }
    } catch (emailErr) {
      console.error('Failed to send report notification email:', emailErr);
    }

    res.status(201).json({
      success: true,
      message: 'Message reported successfully. Our team will review it.',
      data: { id: report.id },
    });
  } catch (error) {
    console.error('Report message error:', error);
    res.status(500).json({ error: 'Failed to report message' });
  }
});

// ============ ADMIN ROUTES ============

const adminMiddleware = async (req: Request, res: Response, next: Function) => {
  const userId = (req as any).user?.userId;
  const user = await User.findByPk(userId);
  if (!user || !user.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// GET /api/messages/admin/reports - List pending message reports
router.get('/admin/reports', adminMiddleware, async (req: Request, res: Response) => {
  try {
    const status = (req.query.status as string) || 'PENDING';

    const reports = await MessageReport.findAll({
      where: { status },
      include: [
        {
          model: Message,
          as: 'message',
          include: [
            { model: User, as: 'sender', attributes: ['id', 'firstName', 'lastName', 'email'] },
            { model: Conversation, as: 'conversation' },
          ],
        },
        { model: User, as: 'reporter', attributes: ['id', 'firstName', 'lastName', 'email'] },
      ],
      order: [['createdAt', 'ASC']],
    });

    res.json({ success: true, data: reports, count: reports.length });
  } catch (error) {
    console.error('Admin reports error:', error);
    res.status(500).json({ error: 'Failed to get reports' });
  }
});

// POST /api/messages/admin/reports/:id/review - Review a report
router.post('/admin/reports/:id/review', adminMiddleware, async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { action } = req.body; // 'reviewed' or 'dismissed'
    const adminUserId = (req as any).user.userId;

    if (!['reviewed', 'dismissed'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action' });
    }

    const report = await MessageReport.findByPk(id);
    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    if (report.status !== 'PENDING') {
      return res.status(400).json({ error: 'Report has already been reviewed' });
    }

    report.status = action === 'reviewed' ? 'REVIEWED' : 'DISMISSED';
    report.reviewedBy = adminUserId;
    report.reviewedAt = new Date();
    await report.save();

    res.json({
      success: true,
      message: `Report ${action} successfully`,
      data: { id: report.id, status: report.status },
    });
  } catch (error) {
    console.error('Admin review report error:', error);
    res.status(500).json({ error: 'Failed to review report' });
  }
});

export default router;
