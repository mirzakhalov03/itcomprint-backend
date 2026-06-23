import { Request, Response, NextFunction } from 'express';
import { verifySession } from '../utils/jwt';
import { SESSION_COOKIE } from '../utils/authCookie';
import { getUserById } from '../services/auth.services';

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const payload = verifySession(token);
  if (!payload) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const user = await getUserById(payload.uid);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  req.user = user;
  next();
}
