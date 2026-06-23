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
  if (!event) return res.status(404).json({ error: 'Event not found' });
  res.json(event);
}
