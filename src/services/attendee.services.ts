import { AttendeeModel } from '../models/attendee.model';
import { ListAttendeesQuery } from '../validators/attendee.validators';
import { AppError } from '../utils/AppError';

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function listAttendees(eventId: string, query: ListAttendeesQuery) {
  const filter: Record<string, unknown> = { eventId };
  if (query.status) filter.printStatus = query.status;
  if (query.search) {
    filter.searchText = { $regex: escapeRegex(query.search.toLowerCase()) };
  }
  return AttendeeModel.find(filter).sort({ fullName: 1 }).lean();
}

export async function markPrinted(attendeeId: string) {
  const attendee = await AttendeeModel.findByIdAndUpdate(
    attendeeId,
    {
      $inc: { printCount: 1 },
      $set: { printStatus: 'printed', lastPrintedAt: new Date() },
    },
    { returnDocument: 'after' },
  ).lean();
  if (!attendee) throw new AppError(404, 'Attendee not found');
  return attendee;
}
