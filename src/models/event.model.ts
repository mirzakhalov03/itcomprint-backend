import { Schema, model, Document } from 'mongoose';

export interface EventDoc extends Document {
  name: string;
  date: Date;
  createdAt: Date;
}

const eventSchema = new Schema<EventDoc>({
  name: { type: String, required: true, trim: true },
  date: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now },
});

export const EventModel = model<EventDoc>('Event', eventSchema);
