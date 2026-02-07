import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { Op } from 'sequelize';
import { authMiddleware, parentOnly } from '../middleware/auth';
import { ParentLink } from '../models/ParentLink';
import { User } from '../models/User';
import { Session } from '../models/Session';
import { Tutor } from '../models/Tutor';
import { ResourcePurchase } from '../models/ResourcePurchase';
import { Resource } from '../models/Resource';
import { Transaction } from '../models/Transaction';
import { Conversation } from '../models/Conversation';
import { Message } from '../models/Message';

const router = Router();

// All routes require auth
router.use(authMiddleware);

// Helper: generate 6-char code using unambiguous characters
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode(): string {
  const bytes = crypto.randomBytes(6);
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_CHARS[bytes[i] % CODE_CHARS.length];
  }
  return code;
}

// ============================================
// STUDENT: Code Generation
// ============================================

/**
 * POST /api/parent/generate-code
 * Student generates a link code for their parent
 */
router.post('/generate-code', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const userType = (req as any).user.userType;

    if (userType !== 'STUDENT') {
      return res.status(403).json({ error: 'Only students can generate parent link codes' });
    }

    // Lazy-expire stale codes
    await ParentLink.update(
      { status: 'EXPIRED' },
      { where: { status: 'PENDING', expiresAt: { [Op.lt]: new Date() } } }
    );

    // Check if student already has a non-expired PENDING code
    const existingCode = await ParentLink.findOne({
      where: {
        studentId: userId,
        status: 'PENDING',
        expiresAt: { [Op.gt]: new Date() },
      },
    });

    if (existingCode) {
      return res.json({
        success: true,
        data: {
          code: existingCode.code,
          expiresAt: existingCode.expiresAt,
          isExisting: true,
        },
      });
    }

    // Generate code with retry on collision
    let link: ParentLink | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const code = generateCode();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        link = await ParentLink.create({ studentId: userId, code, expiresAt });
        break;
      } catch (err: any) {
        if (attempt === 2) throw err;
      }
    }

    if (!link) {
      return res.status(500).json({ error: 'Failed to generate unique code' });
    }

    res.status(201).json({
      success: true,
      data: {
        code: link.code,
        expiresAt: link.expiresAt,
        isExisting: false,
      },
    });
  } catch (error) {
    console.error('Generate code error:', error);
    res.status(500).json({ error: 'Failed to generate link code' });
  }
});

/**
 * GET /api/parent/my-code
 * Student retrieves their current pending code + linked parents
 */
router.get('/my-code', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const userType = (req as any).user.userType;

    if (userType !== 'STUDENT') {
      return res.status(403).json({ error: 'Only students can view their link code' });
    }

    const pendingCode = await ParentLink.findOne({
      where: {
        studentId: userId,
        status: 'PENDING',
        expiresAt: { [Op.gt]: new Date() },
      },
    });

    const activeLinks = await ParentLink.findAll({
      where: { studentId: userId, status: 'ACTIVE' },
      include: [{ model: User, as: 'parent', attributes: ['firstName', 'lastName', 'email'] }],
    });

    res.json({
      success: true,
      data: {
        pendingCode: pendingCode
          ? { code: pendingCode.code, expiresAt: pendingCode.expiresAt }
          : null,
        linkedParents: activeLinks.map((link) => ({
          linkId: link.id,
          parentName: `${(link as any).parent.firstName} ${(link as any).parent.lastName}`,
          linkedAt: link.linkedAt,
        })),
      },
    });
  } catch (error) {
    console.error('Get my code error:', error);
    res.status(500).json({ error: 'Failed to get link code' });
  }
});

// ============================================
// PARENT: Linking & Dashboard
// ============================================

/**
 * POST /api/parent/link
 * Parent enters a code to link to a student
 */
router.post('/link', parentOnly, async (req: Request, res: Response) => {
  try {
    const parentId = (req as any).user.userId;
    const { code } = req.body;

    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Link code is required' });
    }

    const normalizedCode = code.trim().toUpperCase();

    const link = await ParentLink.findOne({
      where: {
        code: normalizedCode,
        status: 'PENDING',
        expiresAt: { [Op.gt]: new Date() },
      },
      include: [{ model: User, as: 'student', attributes: ['id', 'firstName', 'lastName'] }],
    });

    if (!link) {
      return res.status(404).json({ error: 'Invalid or expired link code' });
    }

    // Check if already linked
    const existingLink = await ParentLink.findOne({
      where: { studentId: link.studentId, parentId, status: 'ACTIVE' },
    });

    if (existingLink) {
      return res.status(400).json({ error: 'You are already linked to this student' });
    }

    await link.update({
      parentId,
      status: 'ACTIVE',
      linkedAt: new Date(),
    });

    const student = (link as any).student;

    res.json({
      success: true,
      data: {
        studentId: link.studentId,
        studentName: `${student.firstName} ${student.lastName}`,
        linkedAt: link.linkedAt,
      },
    });
  } catch (error) {
    console.error('Link error:', error);
    res.status(500).json({ error: 'Failed to link accounts' });
  }
});

/**
 * GET /api/parent/students
 * Parent gets list of linked students
 */
router.get('/students', parentOnly, async (req: Request, res: Response) => {
  try {
    const parentId = (req as any).user.userId;

    const links = await ParentLink.findAll({
      where: { parentId, status: 'ACTIVE' },
      include: [{
        model: User,
        as: 'student',
        attributes: ['id', 'firstName', 'lastName', 'email', 'profilePhotoUrl'],
      }],
      order: [['linkedAt', 'ASC']],
    });

    const students = links.map((link) => ({
      linkId: link.id,
      studentId: link.studentId,
      firstName: (link as any).student.firstName,
      lastName: (link as any).student.lastName,
      email: (link as any).student.email,
      profilePhotoUrl: (link as any).student.profilePhotoUrl,
      linkedAt: link.linkedAt,
    }));

    res.json({ success: true, data: students });
  } catch (error) {
    console.error('Get students error:', error);
    res.status(500).json({ error: 'Failed to get linked students' });
  }
});

/**
 * GET /api/parent/students/:studentId/dashboard
 * Parent views full student dashboard data
 */
router.get('/students/:studentId/dashboard', parentOnly, async (req: Request, res: Response) => {
  try {
    const parentId = (req as any).user.userId;
    const { studentId } = req.params;

    // Validate parent-student link
    const link = await ParentLink.findOne({
      where: { parentId, studentId, status: 'ACTIVE' },
    });

    if (!link) {
      return res.status(403).json({ error: 'You are not linked to this student' });
    }

    // Fetch sessions
    const sessions = await Session.findAll({
      where: { studentId },
      order: [['scheduledAt', 'DESC']],
      include: [{
        model: Tutor,
        as: 'tutor',
        include: [{ model: User, attributes: ['firstName', 'lastName', 'profilePhotoUrl'] }],
      }],
    });

    // Fetch resource purchases
    const purchases = await ResourcePurchase.findAll({
      where: { userId: studentId, status: 'COMPLETED' },
      include: [{ model: Resource, as: 'resource' }],
      order: [['createdAt', 'DESC']],
    });

    // Spending summary
    const completedSessions = sessions.filter((s) => s.status === 'COMPLETED');
    const upcomingSessions = sessions.filter(
      (s) => new Date(s.scheduledAt) > new Date() && ['PENDING', 'CONFIRMED'].includes(s.status)
    );

    const sessionSpending = sessions
      .filter((s) => s.paymentStatus === 'paid')
      .reduce((sum, s) => sum + Number(s.price), 0);

    const resourceSpending = purchases.reduce((sum, p) => sum + Number(p.price), 0);

    res.json({
      success: true,
      data: {
        sessions: sessions.map((s) => ({
          id: s.id,
          subject: s.subject,
          level: s.level,
          sessionType: s.sessionType,
          scheduledAt: s.scheduledAt,
          durationMins: s.durationMins,
          price: s.price,
          status: s.status,
          paymentStatus: s.paymentStatus,
          tutorName: (s as any).tutor?.User
            ? `${(s as any).tutor.User.firstName} ${(s as any).tutor.User.lastName}`
            : 'Unknown',
          tutorId: s.tutorId,
        })),
        resources: purchases.map((p) => ({
          id: p.resourceId,
          title: (p as any).resource?.title,
          resourceType: (p as any).resource?.resourceType,
          subject: (p as any).resource?.subject,
          purchasedAt: p.createdAt,
          price: p.price,
        })),
        summary: {
          totalSpent: sessionSpending + resourceSpending,
          upcomingSessionCount: upcomingSessions.length,
          completedSessionCount: completedSessions.length,
          resourceCount: purchases.length,
        },
      },
    });
  } catch (error) {
    console.error('Get student dashboard error:', error);
    res.status(500).json({ error: 'Failed to get student dashboard data' });
  }
});

/**
 * DELETE /api/parent/students/:studentId
 * Parent unlinks a student
 */
router.delete('/students/:studentId', parentOnly, async (req: Request, res: Response) => {
  try {
    const parentId = (req as any).user.userId;
    const { studentId } = req.params;

    const link = await ParentLink.findOne({
      where: { parentId, studentId, status: 'ACTIVE' },
    });

    if (!link) {
      return res.status(404).json({ error: 'Link not found' });
    }

    await link.destroy();

    res.json({ success: true });
  } catch (error) {
    console.error('Unlink student error:', error);
    res.status(500).json({ error: 'Failed to unlink student' });
  }
});

// ============================================
// PARENT: Messaging on behalf of child
// ============================================

/**
 * GET /api/parent/students/:studentId/messages
 * Parent views their child's conversations
 */
router.get('/students/:studentId/messages', parentOnly, async (req: Request, res: Response) => {
  try {
    const parentId = (req as any).user.userId;
    const { studentId } = req.params;

    // Validate parent-student link
    const link = await ParentLink.findOne({
      where: { parentId, studentId, status: 'ACTIVE' },
    });

    if (!link) {
      return res.status(403).json({ error: 'You are not linked to this student' });
    }

    const conversations = await Conversation.findAll({
      where: { studentId },
      include: [
        { model: User, as: 'student', attributes: ['id', 'firstName', 'lastName', 'profilePhotoUrl'] },
        { model: User, as: 'tutor', attributes: ['id', 'firstName', 'lastName', 'profilePhotoUrl'] },
      ],
      order: [['lastMessageAt', 'DESC']],
    });

    const conversationsWithDetails = await Promise.all(
      conversations.map(async (conv) => {
        const lastMessage = await Message.findOne({
          where: { conversationId: conv.id },
          order: [['createdAt', 'DESC']],
          include: [{ model: User, as: 'sender', attributes: ['id', 'firstName', 'lastName'] }],
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
          lastMessageAt: conv.lastMessageAt,
        };
      })
    );

    res.json({ success: true, data: conversationsWithDetails });
  } catch (error) {
    console.error('Parent get student messages error:', error);
    res.status(500).json({ error: 'Failed to get student messages' });
  }
});

/**
 * GET /api/parent/students/:studentId/messages/:conversationId
 * Parent views a specific conversation of their child
 */
router.get('/students/:studentId/messages/:conversationId', parentOnly, async (req: Request, res: Response) => {
  try {
    const parentId = (req as any).user.userId;
    const { studentId, conversationId } = req.params;

    // Validate parent-student link
    const link = await ParentLink.findOne({
      where: { parentId, studentId, status: 'ACTIVE' },
    });

    if (!link) {
      return res.status(403).json({ error: 'You are not linked to this student' });
    }

    const conversation = await Conversation.findByPk(conversationId, {
      include: [
        { model: User, as: 'student', attributes: ['id', 'firstName', 'lastName', 'profilePhotoUrl'] },
        { model: User, as: 'tutor', attributes: ['id', 'firstName', 'lastName', 'profilePhotoUrl'] },
      ],
    });

    if (!conversation || conversation.studentId !== studentId) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const page = Number(req.query.page) || 1;
    const pageSize = Number(req.query.pageSize) || 50;
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
      },
    });
  } catch (error) {
    console.error('Parent get conversation error:', error);
    res.status(500).json({ error: 'Failed to get conversation' });
  }
});

/**
 * POST /api/parent/students/:studentId/messages/:conversationId
 * Parent sends a message on behalf of their child
 */
router.post('/students/:studentId/messages/:conversationId', parentOnly, async (req: Request, res: Response) => {
  try {
    const parentId = (req as any).user.userId;
    const { studentId, conversationId } = req.params;
    const { message } = req.body;

    // Validate parent-student link
    const link = await ParentLink.findOne({
      where: { parentId, studentId, status: 'ACTIVE' },
    });

    if (!link) {
      return res.status(403).json({ error: 'You are not linked to this student' });
    }

    const conversation = await Conversation.findByPk(conversationId);
    if (!conversation || conversation.studentId !== studentId) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const newMessage = await Message.create({
      conversationId,
      senderId: parentId,
      content: message.trim(),
      onBehalfOfStudentId: studentId,
    });

    await conversation.update({ lastMessageAt: new Date() });

    const messageWithSender = await Message.findByPk(newMessage.id, {
      include: [{ model: User, as: 'sender', attributes: ['id', 'firstName', 'lastName', 'profilePhotoUrl'] }],
    });

    res.status(201).json({ success: true, data: messageWithSender });
  } catch (error) {
    console.error('Parent send message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

/**
 * POST /api/parent/students/:studentId/messages
 * Parent starts a new conversation on behalf of their child
 */
router.post('/students/:studentId/messages', parentOnly, async (req: Request, res: Response) => {
  try {
    const parentId = (req as any).user.userId;
    const { studentId } = req.params;
    const { tutorId, message } = req.body;

    // Validate parent-student link
    const link = await ParentLink.findOne({
      where: { parentId, studentId, status: 'ACTIVE' },
    });

    if (!link) {
      return res.status(403).json({ error: 'You are not linked to this student' });
    }

    if (!tutorId) {
      return res.status(400).json({ error: 'Tutor ID is required' });
    }

    // Verify tutor exists
    const tutorUser = await User.findByPk(tutorId);
    if (!tutorUser || tutorUser.userType !== 'TUTOR') {
      return res.status(404).json({ error: 'Tutor not found' });
    }

    // Check for existing conversation
    let conversation = await Conversation.findOne({
      where: { studentId, tutorId },
    });

    if (conversation) {
      // Conversation exists, send message on behalf
      if (!message || typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({ error: 'Message is required' });
      }

      await Message.create({
        conversationId: conversation.id,
        senderId: parentId,
        content: message.trim(),
        onBehalfOfStudentId: studentId,
      });

      await conversation.update({ lastMessageAt: new Date() });

      return res.json({
        success: true,
        data: { conversationId: conversation.id, isExisting: true },
      });
    }

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    conversation = await Conversation.create({
      studentId,
      tutorId,
      lastMessageAt: new Date(),
    });

    await Message.create({
      conversationId: conversation.id,
      senderId: parentId,
      content: message.trim(),
      onBehalfOfStudentId: studentId,
    });

    res.status(201).json({
      success: true,
      data: { conversationId: conversation.id, isExisting: false },
    });
  } catch (error) {
    console.error('Parent start conversation error:', error);
    res.status(500).json({ error: 'Failed to start conversation' });
  }
});

export default router;
