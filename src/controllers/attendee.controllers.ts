import { Request, Response } from 'express';
import * as attendeeService from '../services/attendee.services';
import { logActivity } from '../services/activity.services';
import { toAuthor } from '../utils/author';

export async function listByEvent(req: Request, res: Response) {
  const attendees = await attendeeService.listAttendees(String(req.params.id));
  res.json(attendees);
}

export async function print(req: Request, res: Response) {
  const attendee = await attendeeService.markPrinted(String(req.params.id));
  await logActivity(toAuthor(req.user!), {
    action: attendee.printCount > 1 ? 'attendee.reprint' : 'attendee.print',
    eventId: attendee.eventId,
    targetName: attendee.fullName,
  });
  res.json(attendee);
}

export async function unprint(req: Request, res: Response) {
  const attendee = await attendeeService.markUnprinted(String(req.params.id));
  await logActivity(toAuthor(req.user!), {
    action: 'attendee.unprint',
    eventId: attendee.eventId,
    targetName: attendee.fullName,
  });
  res.json(attendee);
}
