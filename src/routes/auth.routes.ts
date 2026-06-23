import { Router } from 'express';
import * as controller from '../controllers/auth.controllers';
import { validate } from '../middlewares/validate.middleware';
import { asyncHandler } from '../utils/asyncHandler';
import { requireAuth } from '../middlewares/requireAuth.middleware';
import { googleAuthSchema, updateMeSchema } from '../validators/auth.validators';

export const authRouter = Router();

authRouter.post('/google', validate(googleAuthSchema), asyncHandler(controller.googleLogin));
authRouter.get('/me', asyncHandler(requireAuth), asyncHandler(controller.me));
authRouter.patch(
  '/me',
  asyncHandler(requireAuth),
  validate(updateMeSchema),
  asyncHandler(controller.updateMe),
);
authRouter.post('/logout', asyncHandler(requireAuth), asyncHandler(controller.logout));
