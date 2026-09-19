import type { Types } from 'mongoose';
import { ActivityModel, type ActivityAction } from '../models/activity.model';
import { EventModel } from '../models/event.model';
import type { Author } from '../utils/author';
import type { ListActivityQuery } from '../validators/activity.validators';

interface ActivityInput {
  action: ActivityAction;
  eventId?: Types.ObjectId | string | null;
  /** Pass when the event may already be gone (e.g. permanent delete); otherwise looked up. */
  eventName?: string;
  targetName?: string;
}

// Best-effort: the action already happened (a badge may be physically printed),
// so a failed log write is reported but never fails the request.
export async function logActivity(author: Author, input: ActivityInput): Promise<void> {
  try {
    const eventId = input.eventId ?? null;
    const eventName =
      input.eventName ??
      (eventId ? (await EventModel.findById(eventId).select('name').lean())?.name : undefined) ??
      '';
    await ActivityModel.create({
      action: input.action,
      actorId: author.id,
      actorName: author.name,
      actorPicture: author.picture,
      eventId,
      eventName,
      targetName: input.targetName ?? '',
    });
  } catch (err) {
    console.error('[activity] log write failed', err);
  }
}

// Cursor pagination on _id (ObjectIds sort by creation time): new entries arriving
// mid-browse can't shift rows between pages the way skip/offset would.
export async function listActivity({ eventId, before, limit }: ListActivityQuery) {
  const filter: Record<string, unknown> = {};
  if (eventId) filter.eventId = eventId;
  if (before) filter._id = { $lt: before };

  const items = await ActivityModel.find(filter)
    .sort({ _id: -1 })
    .limit(limit + 1) // one extra tells us whether an older page exists
    .select('-__v')
    .lean();

  const hasMore = items.length > limit;
  if (hasMore) items.pop();
  return { items, nextCursor: hasMore ? String(items[items.length - 1]._id) : null };
}
