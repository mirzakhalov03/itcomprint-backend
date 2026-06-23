import { Request, Response } from 'express';
import * as authService from '../services/auth.services';
import { signSession } from '../utils/jwt';
import { setSessionCookie, clearSessionCookie } from '../utils/authCookie';

export async function googleLogin(req: Request, res: Response) {
  const { idToken } = req.body as { idToken: string };
  let profile;
  try {
    profile = await authService.verifyGoogleIdToken(idToken);
  } catch {
    return res.status(401).json({ error: 'Invalid Google token' });
  }
  const { user, isNewUser } = await authService.upsertUserFromGoogle(profile);
  setSessionCookie(res, signSession(String(user._id)));
  res.json({ user: authService.toPublicUser(user), isNewUser });
}

export async function me(req: Request, res: Response) {
  res.json({ user: authService.toPublicUser(req.user!) });
}

export async function updateMe(req: Request, res: Response) {
  const { displayName } = req.body as { displayName: string };
  const user = await authService.updateDisplayName(String(req.user!._id), displayName);
  res.json({ user: authService.toPublicUser(user!) });
}

export async function logout(_req: Request, res: Response) {
  clearSessionCookie(res);
  res.status(204).end();
}
