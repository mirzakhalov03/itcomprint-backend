import { Schema, model, Document, Types } from 'mongoose';

export interface EventDoc extends Document {
  name: string;
  date: Date;
  authorId: Types.ObjectId;
  authorName: string;
  authorPicture: string;
  createdAt: Date;
  templateId: Types.ObjectId | null;
  sheetId: string | null;
  sheetUrl: string | null;
  lastSyncedAt: Date | null;
  deletedAt: Date | null;
}

const eventSchema = new Schema<EventDoc>({
  name: { type: String, required: true, trim: true },
  date: { type: Date, required: true },
  // Author identity is denormalized onto the event so the dashboard lists
  // events without a join. A user renaming themselves does not rewrite past events.
  authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  authorName: { type: String, default: '' },
  authorPicture: { type: String, default: '' },
  // Which badge template this event prints with. null → the default template
  // (resolved client-side at print time). Set via PATCH /events/:id.
  templateId: { type: Schema.Types.ObjectId, ref: 'BadgeTemplate', default: null },
  createdAt: { type: Date, default: Date.now },
  sheetId: { type: String, default: null },
  sheetUrl: { type: String, default: null },
  lastSyncedAt: { type: Date, default: null },
  // Soft-delete: set when an event is moved to trash, cleared on restore.
  // Trashed events are hidden from listEvents and hard-deleted 45 days later.
  deletedAt: { type: Date, default: null, index: true },
});

export const EventModel = model<EventDoc>('Event', eventSchema);
