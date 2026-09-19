import { Request, Response } from 'express';
import * as activityService from '../services/activity.services';
import { toAuthor } from '../utils/author';
import type { ListActivityQuery, LogPrinterActivityInput } from '../validators/activity.validators';

export async function list(req: Request, res: Response) {
  res.json(await activityService.listActivity(req.query as unknown as ListActivityQuery));
}

export async function logPrinter(req: Request, res: Response) {
  const { action, eventId } = req.body as LogPrinterActivityInput;
  await activityService.logActivity(toAuthor(req.user!), { action: `printer.${action}`, eventId });
  res.status(204).end();
}
