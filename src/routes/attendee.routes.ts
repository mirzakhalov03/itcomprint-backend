import { Router } from 'express';
import * as controller from '../controllers/attendee.controllers';
import { validate } from '../middlewares/validate.middleware';
import { attendeeIdParamSchema } from '../validators/attendee.validators';

export const attendeeRouter = Router();

attendeeRouter.post('/:id/print', validate(attendeeIdParamSchema, 'params'), controller.print);
