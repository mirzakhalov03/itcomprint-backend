import { z } from 'zod';

export const googleAuthSchema = z.object({
  idToken: z.string().min(1),
});

export const updateMeSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
});
