import { Router } from 'express';
import * as controller from '../controllers/activity.controllers';
import { validate } from '../middlewares/validate.middleware';
import {
  listActivityQuerySchema,
  logPrinterActivitySchema,
} from '../validators/activity.validators';

export const activityRouter = Router();

activityRouter.get('/', validate(listActivityQuerySchema, 'query'), controller.list);
activityRouter.post('/printer', validate(logPrinterActivitySchema), controller.logPrinter);
