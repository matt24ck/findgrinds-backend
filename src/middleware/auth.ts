import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { verifyToken } from '../config/jwt';
import { User } from '../models/User';

// Account status is looked up on every authenticated request so suspension and
// deletion take effect immediately instead of when the JWT expires. A short
// cache keeps this to roughly one query per user per 30 seconds.
const STATUS_TTL_MS = 30_000;
const statusCache = new Map<string, { status: string | null; at: number }>();

async function getAccountStatus(userId: string): Promise<string | null> {
  const cached = statusCache.get(userId);
  if (cached && Date.now() - cached.at < STATUS_TTL_MS) return cached.status;
  const user = await User.findByPk(userId, { attributes: ['accountStatus'] });
  const status = user?.accountStatus ?? null;
  statusCache.set(userId, { status, at: Date.now() });
  return status;
}

/** Drop a user's cached status (call after suspending/reactivating/deleting). */
export function clearAccountStatusCache(userId: string) {
  statusCache.delete(userId);
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  let decoded;
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const token = authHeader.split(' ')[1];
    decoded = verifyToken(token);
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }

  try {
    const status = await getAccountStatus(decoded.userId);
    if (status === null || status === 'DELETED') {
      return res.status(401).json({ error: 'Account not found' });
    }
    if (status === 'SUSPENDED') {
      return res.status(403).json({ error: 'Your account has been suspended. Contact support@findgrinds.ie.', code: 'ACCOUNT_SUSPENDED' });
    }
  } catch (error) {
    console.error('Account status check failed:', error);
    return res.status(500).json({ error: 'Failed to verify account' });
  }

  // Attach user info to request
  (req as any).user = decoded;
  next();
}

export function tutorOnly(req: Request, res: Response, next: NextFunction) {
  if ((req as any).user?.userType !== 'TUTOR') {
    return res.status(403).json({ error: 'Tutor access required' });
  }
  next();
}

export function studentOnly(req: Request, res: Response, next: NextFunction) {
  if ((req as any).user?.userType !== 'STUDENT' && (req as any).user?.userType !== 'PARENT') {
    return res.status(403).json({ error: 'Student access required' });
  }
  next();
}

export function parentOnly(req: Request, res: Response, next: NextFunction) {
  if ((req as any).user?.userType !== 'PARENT') {
    return res.status(403).json({ error: 'Parent access required' });
  }
  next();
}
