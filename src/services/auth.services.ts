import { OAuth2Client } from 'google-auth-library';
import { UserModel, UserDoc } from '../models/user.model';
import { env, isTest } from '../config/env';

export interface GoogleProfile {
  sub: string;
  email: string;
  name: string;
  picture: string;
}

const client = new OAuth2Client(env.GOOGLE_CLIENT_ID);

/**
 * Verify a Google ID token and return the profile.
 *
 * TEST BYPASS: when NODE_ENV=test, a token of the form
 *   test|{"sub":"...","email":"...","name":"...","picture":"..."}
 * is parsed directly, so scripts/verify.ts can exercise auth without
 * minting real Google-signed tokens. `isTest` is false in dev and prod,
 * so this branch is dead code outside the harness.
 */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleProfile> {
  if (isTest && idToken.startsWith('test|')) {
    return JSON.parse(idToken.slice('test|'.length)) as GoogleProfile;
  }
  const ticket = await client.verifyIdToken({ idToken, audience: env.GOOGLE_CLIENT_ID });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email) {
    throw new Error('Invalid Google token payload');
  }
  return {
    sub: payload.sub,
    email: payload.email,
    name: payload.name ?? payload.email,
    picture: payload.picture ?? '',
  };
}

export async function upsertUserFromGoogle(
  profile: GoogleProfile,
): Promise<{ user: UserDoc; isNewUser: boolean }> {
  const existing = await UserModel.findOne({ googleId: profile.sub });
  if (existing) {
    existing.email = profile.email;
    existing.googleName = profile.name;
    existing.picture = profile.picture;
    existing.lastLoginAt = new Date();
    await existing.save();
    return { user: existing, isNewUser: false };
  }
  const user = await UserModel.create({
    googleId: profile.sub,
    email: profile.email,
    displayName: profile.name, // sensible default until the user confirms it
    googleName: profile.name,
    picture: profile.picture,
    onboardedAt: null,
    lastLoginAt: new Date(),
  });
  return { user, isNewUser: true };
}

export async function getUserById(id: string): Promise<UserDoc | null> {
  return UserModel.findById(id);
}

export async function updateDisplayName(id: string, displayName: string): Promise<UserDoc | null> {
  const user = await UserModel.findById(id);
  if (!user) return null;
  user.displayName = displayName;
  if (!user.onboardedAt) user.onboardedAt = new Date();
  await user.save();
  return user;
}

export function toPublicUser(user: UserDoc) {
  return {
    id: String(user._id),
    email: user.email,
    displayName: user.displayName,
    picture: user.picture,
    onboardedAt: user.onboardedAt,
  };
}
