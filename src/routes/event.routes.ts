import { Router } from 'express';
import * as controller from '../controllers/event.controllers';
import * as attendeeController from '../controllers/attendee.controllers';
import { validate } from '../middlewares/validate.middleware';
import {
  createEventSchema,
  createEventFromSheetSchema,
  eventIdParamSchema,
  updateEventSchema,
} from '../validators/event.validators';
import { listAttendeesQuerySchema } from '../validators/attendee.validators';

export const eventRouter = Router();

eventRouter.post('/', validate(createEventSchema), controller.create);
eventRouter.post('/sheet', validate(createEventFromSheetSchema), controller.createFromSheet);
eventRouter.get('/', controller.list);
// Must come before '/:id' — otherwise 'trash' is parsed as an event id.
eventRouter.get('/trash', controller.listTrash);
eventRouter.get('/:id', validate(eventIdParamSchema, 'params'), controller.getOne);

eventRouter.patch(
  '/:id',
  validate(eventIdParamSchema, 'params'),
  validate(updateEventSchema),
  controller.update,
);

// Soft delete — moves the event to trash. Hard delete lives at DELETE /:id/permanent.
eventRouter.delete('/:id', validate(eventIdParamSchema, 'params'), controller.trash);
eventRouter.post('/:id/restore', validate(eventIdParamSchema, 'params'), controller.restore);
eventRouter.delete(
  '/:id/permanent',
  validate(eventIdParamSchema, 'params'),
  controller.permanentDelete,
);

eventRouter.get(
  '/:id/attendees',
  validate(eventIdParamSchema, 'params'),
  validate(listAttendeesQuerySchema, 'query'),
  attendeeController.listByEvent,
);

eventRouter.post('/:id/sync-sheet', validate(eventIdParamSchema, 'params'), controller.syncSheet);
