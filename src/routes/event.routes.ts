import { Router } from 'express';
import * as controller from '../controllers/event.controllers';
import * as attendeeController from '../controllers/attendee.controllers';
import { validate } from '../middlewares/validate.middleware';
import { asyncHandler } from '../utils/asyncHandler';
import { createEventSchema, eventIdParamSchema } from '../validators/event.validators';
import { listAttendeesQuerySchema } from '../validators/attendee.validators';

export const eventRouter = Router();

eventRouter.post('/', validate(createEventSchema), asyncHandler(controller.create));
eventRouter.get('/', asyncHandler(controller.list));
eventRouter.get('/:id', validate(eventIdParamSchema, 'params'), asyncHandler(controller.getOne));

eventRouter.get(
  '/:id/attendees',
  validate(eventIdParamSchema, 'params'),
  validate(listAttendeesQuerySchema, 'query'),
  asyncHandler(attendeeController.listByEvent),
);
