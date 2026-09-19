import { EventModel } from '../models/event.model';
import { AttendeeModel } from '../models/attendee.model';
import { BadgeTemplateModel } from '../models/badgeTemplate.model';
import {
  CreateEventInput,
  CreateEventFromSheetInput,
  UpdateEventInput,
} from '../validators/event.validators';
import { AppError } from '../utils/AppError';
import type { Author } from '../utils/author';
import { extractSheetId, syncEventAttendees } from './sheetSync.services';

// Creation isn't transactional: undo a half-created event so no empty event is left behind.
async function deleteEventCascade(eventId: string) {
  await AttendeeModel.deleteMany({ eventId });
  await EventModel.findByIdAndDelete(eventId);
}

export async function createEventWithAttendees(input: CreateEventInput, author: Author) {
  const event = await EventModel.create({
    name: input.name,
    date: new Date(input.date),
    authorId: author.id,
    authorName: author.name,
    authorPicture: author.picture,
  });

  const docs = input.attendees.map((a) => ({
    eventId: event._id,
    fullName: a.fullName,
    extra: a.extra,
  }));
  try {
    await AttendeeModel.insertMany(docs);
  } catch (err) {
    try {
      await deleteEventCascade(String(event._id));
    } catch (cascadeErr) {
      console.error('[events] rollback failed after creation error', cascadeErr);
    }
    throw err;
  }

  return { ...event.toObject(), attendeeCount: docs.length };
}

async function withAttendeeCounts<T extends { _id: unknown }>(events: T[]) {
  const counts = await AttendeeModel.aggregate<{ _id: unknown; count: number; printed: number }>([
    // Scope to the listed events so cost tracks the screen, not total history.
    { $match: { eventId: { $in: events.map((e) => e._id) }, removedAt: null } },
    {
      $group: {
        _id: '$eventId',
        count: { $sum: 1 },
        printed: { $sum: { $cond: [{ $eq: ['$printStatus', 'printed'] }, 1, 0] } },
      },
    },
  ]);
  const countMap = new Map(counts.map((c) => [String(c._id), c]));
  return events.map((e) => {
    const c = countMap.get(String(e._id));
    return { ...e, attendeeCount: c?.count ?? 0, printedCount: c?.printed ?? 0 };
  });
}

export async function listEvents() {
  const events = await EventModel.find({ deletedAt: null }).sort({ date: -1 }).lean();
  return withAttendeeCounts(events);
}

export async function getEvent(id: string) {
  const event = await EventModel.findOne({ _id: id, deletedAt: null }).lean();
  if (!event) throw new AppError(404, 'Event not found');
  return event;
}

export async function createEventFromSheet(input: CreateEventFromSheetInput, author: Author) {
  const sheetId = extractSheetId(input.sheetUrl);
  if (!sheetId) throw new AppError(400, 'Could not find a Google Sheet ID in that URL');

  const event = await EventModel.create({
    name: input.name,
    date: new Date(input.date),
    authorId: author.id,
    authorName: author.name,
    authorPicture: author.picture,
    sheetId,
    sheetUrl: input.sheetUrl,
  });

  try {
    const result = await syncEventAttendees(String(event._id));
    return { ...event.toObject(), attendeeCount: result.total - result.skipped, ...result };
  } catch (err) {
    try {
      await deleteEventCascade(String(event._id));
    } catch (cascadeErr) {
      console.error('[events] rollback failed after creation error', cascadeErr);
    }
    throw err;
  }
}

export async function syncEventSheet(eventId: string) {
  return syncEventAttendees(eventId);
}

export async function updateEvent(eventId: string, input: UpdateEventInput) {
  if (input.templateId) {
    const exists = await BadgeTemplateModel.exists({ _id: input.templateId });
    if (!exists) throw new AppError(404, 'Template not found');
  }
  const update: Record<string, unknown> = {};
  if (input.name !== undefined) update.name = input.name;
  if (input.date !== undefined) update.date = new Date(input.date);
  if (input.templateId !== undefined) update.templateId = input.templateId;

  const event = await EventModel.findOneAndUpdate(
    { _id: eventId, deletedAt: null },
    { $set: update },
    { returnDocument: 'after' },
  ).lean();
  if (!event) throw new AppError(404, 'Event not found');
  return event;
}

export async function trashEvent(eventId: string) {
  const event = await EventModel.findOneAndUpdate(
    { _id: eventId, deletedAt: null },
    { $set: { deletedAt: new Date() } },
    { returnDocument: 'after' },
  ).lean();
  if (!event) throw new AppError(404, 'Event not found');
  return event;
}

export async function restoreEvent(eventId: string) {
  const event = await EventModel.findOneAndUpdate(
    { _id: eventId, deletedAt: { $ne: null } },
    { $set: { deletedAt: null } },
    { returnDocument: 'after' },
  ).lean();
  if (!event) throw new AppError(404, 'Trashed event not found');
  return event;
}

export async function permanentlyDeleteEvent(eventId: string) {
  const event = await EventModel.findOneAndDelete({ _id: eventId, deletedAt: { $ne: null } });
  if (!event) throw new AppError(404, 'Trashed event not found');
  await AttendeeModel.deleteMany({ eventId });
  return event;
}

const TRASH_RETENTION_MS = 45 * 24 * 60 * 60 * 1000;

const trashCutoff = () => new Date(Date.now() - TRASH_RETENTION_MS);

// Hard-deletes events trashed longer than the retention window. Runs on a timer from server.ts.
export async function purgeExpiredTrash(): Promise<number> {
  const expiredIds = await EventModel.find({ deletedAt: { $lte: trashCutoff() } }).distinct('_id');
  if (expiredIds.length === 0) return 0;
  await AttendeeModel.deleteMany({ eventId: { $in: expiredIds } });
  await EventModel.deleteMany({ _id: { $in: expiredIds } });
  return expiredIds.length;
}

export async function listTrash() {
  // $gt a Date also excludes null, so this lists only trashed events still inside the window.
  const events = await EventModel.find({ deletedAt: { $gt: trashCutoff() } })
    .sort({ deletedAt: -1 })
    .lean();
  const withCounts = await withAttendeeCounts(events);
  return withCounts.map((e) => ({
    ...e,
    purgeAt: new Date(e.deletedAt!.getTime() + TRASH_RETENTION_MS),
  }));
}
