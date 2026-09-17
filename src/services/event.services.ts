import { EventModel } from '../models/event.model';
import { AttendeeModel } from '../models/attendee.model';
import { BadgeTemplateModel } from '../models/badgeTemplate.model';
import {
  CreateEventInput,
  CreateEventFromSheetInput,
  UpdateEventInput,
} from '../validators/event.validators';
import { AppError } from '../utils/AppError';
import { extractSheetId, syncEventAttendees } from './sheetSync.services';

const TRASH_RETENTION_DAYS = 45;

export async function createEventWithAttendees(
  input: CreateEventInput,
  author: { id: string; name: string; picture: string },
) {
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
  await AttendeeModel.insertMany(docs);

  return { ...event.toObject(), attendeeCount: docs.length };
}

async function withAttendeeCounts<T extends { _id: unknown }>(events: T[]) {
  const counts = await AttendeeModel.aggregate<{ _id: unknown; count: number; printed: number }>([
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

export async function createEventFromSheet(
  input: CreateEventFromSheetInput,
  author: { id: string; name: string; picture: string },
) {
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
    await AttendeeModel.deleteMany({ eventId: event._id });
    await EventModel.findByIdAndDelete(event._id);
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
}

export async function listTrash() {
  const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const expired = await EventModel.find({ deletedAt: { $lte: cutoff } }, { _id: 1 }).lean();
  if (expired.length > 0) {
    const expiredIds = expired.map((e) => e._id);
    await AttendeeModel.deleteMany({ eventId: { $in: expiredIds } });
    await EventModel.deleteMany({ _id: { $in: expiredIds } });
  }

  const events = await EventModel.find({ deletedAt: { $ne: null } })
    .sort({ deletedAt: -1 })
    .lean();
  return withAttendeeCounts(events);
}
