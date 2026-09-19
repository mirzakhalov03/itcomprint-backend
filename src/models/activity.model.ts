import { Schema, model, Document, Types } from 'mongoose';

export const ACTIVITY_ACTIONS = [
  'attendee.print',
  'attendee.reprint',
  'attendee.unprint',
  'event.create',
  'event.update',
  'event.template',
  'event.trash',
  'event.restore',
  'event.delete',
  'template.create',
  'template.update',
  'template.delete',
  'printer.connect',
  'printer.disconnect',
] as const;

export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

export interface ActivityDoc extends Document {
  action: ActivityAction;
  actorId: Types.ObjectId;
  actorName: string;
  actorPicture: string;
  eventId: Types.ObjectId | null;
  eventName: string;
  targetName: string;
  createdAt: Date;
}

// Append-only audit trail. Names are snapshots taken at write time so history still
// reads correctly after an event is deleted or a user renames themselves.
const activitySchema = new Schema<ActivityDoc>({
  action: { type: String, enum: ACTIVITY_ACTIONS, required: true },
  actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  actorName: { type: String, default: '' },
  actorPicture: { type: String, default: '' },
  // null for actions outside any event (template edits, printer on the dashboard).
  eventId: { type: Schema.Types.ObjectId, ref: 'Event', default: null },
  eventName: { type: String, default: '' },
  targetName: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
});

// Serves the kiosk's per-event feed; the global feed pages on the built-in _id index.
activitySchema.index({ eventId: 1, _id: -1 });

export const ActivityModel = model<ActivityDoc>('Activity', activitySchema);
