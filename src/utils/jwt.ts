import jwt from 'jsonwebtoken';
import { env } from '../config/env';

const TTL_DAYS = 30;
export const SESSION_MAX_AGE_MS = TTL_DAYS * 24 * 60 * 60 * 1000;

export interface SessionPayload {
  uid: string;
}

export function signSession(uid: string): string {
  // Use numeric seconds (not a "30d" string): @types/jsonwebtoken types the
  // string form as a branded literal, so a template string won't type-check.
  return jwt.sign({ uid }, env.JWT_SECRET, { expiresIn: SESSION_MAX_AGE_MS / 1000 });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    if (
      typeof decoded === 'object' &&
      decoded !== null &&
      typeof (decoded as { uid?: unknown }).uid === 'string'
    ) {
      return { uid: (decoded as { uid: string }).uid };
    }
    return null;
  } catch {
    return null;
  }
}
