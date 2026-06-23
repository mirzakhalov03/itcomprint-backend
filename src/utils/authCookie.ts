import { Response } from 'express';
import { env, isProd } from '../config/env';
import { SESSION_MAX_AGE_MS } from './jwt';

export const SESSION_COOKIE = 'session';

// Cross-origin (frontend on a different domain) needs SameSite=None; Secure in
// production. In dev, frontend and API share the localhost site, so Lax works
// and avoids the Secure requirement over http.
function baseOptions() {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: (isProd ? 'none' : 'lax') as 'none' | 'lax',
    domain: env.COOKIE_DOMAIN,
    path: '/',
  };
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, { ...baseOptions(), maxAge: SESSION_MAX_AGE_MS });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, baseOptions());
}
