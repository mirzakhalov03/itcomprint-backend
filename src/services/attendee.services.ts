import { AttendeeModel } from '../models/attendee.model';
import { AppError } from '../utils/AppError';

// Full roster: the kiosk searches and filters in memory. searchText is excluded because pre-cleanup docs still carry it.
export async function listAttendees(eventId: string) {
  return AttendeeModel.find({ eventId, removedAt: null })
    .select('-searchText -__v')
    .sort({ _id: 1 })
    .lean();
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

// Undo a mistaken print: stats treat printed as "came", so the attendee must read as never printed.
export async function markUnprinted(attendeeId: string) {
  const attendee = await AttendeeModel.findByIdAndUpdate(
    attendeeId,
    { $set: { printStatus: 'not_printed', printCount: 0, lastPrintedAt: null } },
    { returnDocument: 'after' },
  ).lean();
  if (!attendee) throw new AppError(404, 'Attendee not found');
  return attendee;
}
