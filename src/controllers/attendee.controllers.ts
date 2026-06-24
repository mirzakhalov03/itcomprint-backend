import { Request, Response } from 'express';
import * as attendeeService from '../services/attendee.services';

export async function listByEvent(req: Request, res: Response) {
  const attendees = await attendeeService.listAttendees(String(req.params.id), req.query);
  res.json(attendees);
}

export async function print(req: Request, res: Response) {
  const attendee = await attendeeService.markPrinted(String(req.params.id));
  res.json(attendee);
}
