import { Schema, model, Document, Types } from 'mongoose';

export interface EventDoc extends Document {
  name: string;
  date: Date;
  authorId: Types.ObjectId;
  authorName: string;
  authorPicture: string;
  createdAt: Date;
  templateId: Types.ObjectId | null;
}

const eventSchema = new Schema<EventDoc>({
  name: { type: String, required: true, trim: true },
  date: { type: Date, required: true },
  // Author identity is denormalized onto the event so the dashboard lists
  // events without a join (same reasoning as Attendee.searchText). A user
  // renaming themselves does not rewrite past events.
  authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  authorName: { type: String, default: '' },
  authorPicture: { type: String, default: '' },
  // Which badge template this event prints with. null → the default template
  // (resolved client-side at print time). Set via PATCH /events/:id.
  templateId: { type: Schema.Types.ObjectId, ref: 'BadgeTemplate', default: null },
  createdAt: { type: Date, default: Date.now },
});

export const EventModel = model<EventDoc>('Event', eventSchema);
