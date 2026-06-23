import { EventModel } from '../models/event.model';
import { AttendeeModel } from '../models/attendee.model';
import { CreateEventInput } from '../validators/event.validators';

function buildSearchText(fullName: string, extra: Record<string, string>): string {
  return [fullName, ...Object.values(extra)].join(' ').toLowerCase();
}

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
    searchText: buildSearchText(a.fullName, a.extra),
  }));
  await AttendeeModel.insertMany(docs);

  return { ...event.toObject(), attendeeCount: docs.length };
}

export async function listEvents() {
  const events = await EventModel.find().sort({ date: -1 }).lean();
  const counts = await AttendeeModel.aggregate<{ _id: unknown; count: number }>([
    { $group: { _id: '$eventId', count: { $sum: 1 } } },
  ]);
  const countMap = new Map(counts.map((c) => [String(c._id), c.count]));
  return events.map((e) => ({ ...e, attendeeCount: countMap.get(String(e._id)) ?? 0 }));
}

export async function getEvent(id: string) {
  return EventModel.findById(id).lean();
}
