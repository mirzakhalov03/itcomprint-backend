import { Request, Response } from 'express';
import type { Types } from 'mongoose';
import * as eventService from '../services/event.services';
import * as templateService from '../services/template.services';
import { logActivity } from '../services/activity.services';
import type { ActivityAction } from '../models/activity.model';
import type { UpdateEventInput } from '../validators/event.validators';
import { toAuthor } from '../utils/author';

// Event actions log the event as both scope and target; the name is passed so a
// permanently deleted event still gets labelled.
function logEvent(
  req: Request,
  action: ActivityAction,
  event: { _id: Types.ObjectId; name: string },
  targetName = event.name,
) {
  return logActivity(toAuthor(req.user!), {
    action,
    eventId: event._id,
    eventName: event.name,
    targetName,
  });
}

export async function create(req: Request, res: Response) {
  const event = await eventService.createEventWithAttendees(req.body, toAuthor(req.user!));
  await logEvent(req, 'event.create', event);
  res.status(201).json(event);
}

export async function list(_req: Request, res: Response) {
  res.json(await eventService.listEvents());
}

export async function getOne(req: Request, res: Response) {
  const event = await eventService.getEvent(String(req.params.id));
  res.json(event);
}

export async function update(req: Request, res: Response) {
  const input = req.body as UpdateEventInput;
  const event = await eventService.updateEvent(String(req.params.id), input);
  if (input.templateId !== undefined) {
    const templateName = await templateService.getTemplateName(input.templateId);
    await logEvent(req, 'event.template', event, templateName);
  }
  if (input.name !== undefined || input.date !== undefined) {
    await logEvent(req, 'event.update', event);
  }
  res.json(event);
}

export async function trash(req: Request, res: Response) {
  const event = await eventService.trashEvent(String(req.params.id));
  await logEvent(req, 'event.trash', event);
  res.json(event);
}

export async function restore(req: Request, res: Response) {
  const event = await eventService.restoreEvent(String(req.params.id));
  await logEvent(req, 'event.restore', event);
  res.json(event);
}

export async function permanentDelete(req: Request, res: Response) {
  const event = await eventService.permanentlyDeleteEvent(String(req.params.id));
  await logEvent(req, 'event.delete', event);
  res.json({ ok: true });
}

export async function listTrash(_req: Request, res: Response) {
  res.json(await eventService.listTrash());
}

export async function createFromSheet(req: Request, res: Response) {
  const event = await eventService.createEventFromSheet(req.body, toAuthor(req.user!));
  await logEvent(req, 'event.create', event);
  res.status(201).json(event);
}

// Not logged: the kiosk calls this on a 30 s timer, which would drown out real actions.
export async function syncSheet(req: Request, res: Response) {
  const result = await eventService.syncEventSheet(String(req.params.id));
  res.json(result);
}
