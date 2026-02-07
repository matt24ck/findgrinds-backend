import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

interface JwtPayload {
  userId: string;
  userType: string;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || 'dev-secret'
    ) as JwtPayload;

    // Attach user info to request
    (req as any).user = decoded;

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
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
