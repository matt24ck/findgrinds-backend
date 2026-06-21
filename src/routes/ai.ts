import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { aiService, ChatMessage, ChatUser } from '../services/aiService';
import { User } from '../models/User';

const router = Router();

/**
 * Best-effort lookup of the signed-in user for personalization.
 * Never blocks the request — any failure just yields an anonymous chat.
 */
async function optionalUser(req: Request): Promise<ChatUser | undefined> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return undefined;
  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret') as {
      userId: string;
      userType: string;
    };
    const user = await User.findByPk(decoded.userId, { attributes: ['firstName'] });
    return { firstName: user?.firstName, userType: decoded.userType };
  } catch {
    return undefined;
  }
}

// POST /api/ai/chat - Public AI assistant. Stateless: full history sent each turn.
router.post('/chat', async (req: Request, res: Response) => {
  try {
    const messages: ChatMessage[] = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const clean = messages.filter(
      (m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'
    );

    if (clean.length === 0 || clean[clean.length - 1].role !== 'user') {
      return res
        .status(400)
        .json({ error: 'Expected a non-empty message history ending with a user message.' });
    }

    const result = await aiService.chat(clean, { user: await optionalUser(req) });
    res.json(result);
  } catch (error: any) {
    console.error('AI chat error:', error?.message || error);
    res.status(500).json({ error: 'The assistant is unavailable right now. Please try again.' });
  }
});

export default router;
