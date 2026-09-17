import { Request, Response } from 'express';
import * as eventService from '../services/event.services';

export async function create(req: Request, res: Response) {
  const user = req.user!; // guaranteed by requireAuth on the /events router
  const event = await eventService.createEventWithAttendees(req.body, {
    id: String(user._id),
    name: user.displayName,
    picture: user.picture,
  });
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
  const event = await eventService.updateEvent(String(req.params.id), req.body);
  res.json(event);
}

export async function trash(req: Request, res: Response) {
  const event = await eventService.trashEvent(String(req.params.id));
  res.json(event);
}

export async function restore(req: Request, res: Response) {
  const event = await eventService.restoreEvent(String(req.params.id));
  res.json(event);
}

export async function permanentDelete(req: Request, res: Response) {
  await eventService.permanentlyDeleteEvent(String(req.params.id));
  res.json({ ok: true });
}

export async function listTrash(_req: Request, res: Response) {
  res.json(await eventService.listTrash());
}

export async function createFromSheet(req: Request, res: Response) {
  const user = req.user!;
  const event = await eventService.createEventFromSheet(req.body, {
    id: String(user._id),
    name: user.displayName,
    picture: user.picture,
  });
  res.status(201).json(event);
}

export async function syncSheet(req: Request, res: Response) {
  const result = await eventService.syncEventSheet(String(req.params.id));
  res.json(result);
}
