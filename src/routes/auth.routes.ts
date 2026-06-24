import { Router } from 'express';
import * as controller from '../controllers/auth.controllers';
import { validate } from '../middlewares/validate.middleware';
import { requireAuth } from '../middlewares/requireAuth.middleware';
import { googleAuthSchema, updateMeSchema } from '../validators/auth.validators';

export const authRouter = Router();

authRouter.post('/google', validate(googleAuthSchema), controller.googleLogin);
authRouter.get('/me', requireAuth, controller.me);
authRouter.patch('/me', requireAuth, validate(updateMeSchema), controller.updateMe);
authRouter.post('/logout', requireAuth, controller.logout);
