import { Router } from 'express';
import * as controller from '../controllers/template.controllers';
import { validate } from '../middlewares/validate.middleware';
import {
  createTemplateSchema,
  updateTemplateSchema,
  templateIdParamSchema,
} from '../validators/template.validators';

export const templateRouter = Router();

// `/field-keys` must precede `/:id` so it isn't parsed as an ObjectId.
templateRouter.get('/field-keys', controller.fieldKeys);
templateRouter.get('/', controller.list);
templateRouter.post('/', validate(createTemplateSchema), controller.create);
templateRouter.get('/:id', validate(templateIdParamSchema, 'params'), controller.getOne);
templateRouter.put(
  '/:id',
  validate(templateIdParamSchema, 'params'),
  validate(updateTemplateSchema),
  controller.update,
);
templateRouter.delete('/:id', validate(templateIdParamSchema, 'params'), controller.remove);
