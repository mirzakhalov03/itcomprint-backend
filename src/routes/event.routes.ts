import { Router } from 'express';
import * as controller from '../controllers/event.controllers';
import * as attendeeController from '../controllers/attendee.controllers';
import { validate } from '../middlewares/validate.middleware';
import {
  createEventSchema,
  eventIdParamSchema,
  setEventTemplateSchema,
} from '../validators/event.validators';
import { listAttendeesQuerySchema } from '../validators/attendee.validators';

export const eventRouter = Router();

eventRouter.post('/', validate(createEventSchema), controller.create);
eventRouter.get('/', controller.list);
eventRouter.get('/:id', validate(eventIdParamSchema, 'params'), controller.getOne);

eventRouter.patch(
  '/:id',
  validate(eventIdParamSchema, 'params'),
  validate(setEventTemplateSchema),
  controller.setTemplate,
);

eventRouter.get(
  '/:id/attendees',
  validate(eventIdParamSchema, 'params'),
  validate(listAttendeesQuerySchema, 'query'),
  attendeeController.listByEvent,
);
