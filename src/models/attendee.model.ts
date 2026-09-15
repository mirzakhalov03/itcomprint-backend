import { Schema, model, Document, Types } from 'mongoose';

export type PrintStatus = 'not_printed' | 'printed';

export interface AttendeeDoc extends Document {
  eventId: Types.ObjectId;
  fullName: string;
  extra: Record<string, string>;
  searchText: string;
  printStatus: PrintStatus;
  printCount: number;
  lastPrintedAt: Date | null;
  registrantId: string | null;
}

const attendeeSchema = new Schema<AttendeeDoc>({
  eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
  fullName: { type: String, required: true, trim: true },
  extra: { type: Schema.Types.Mixed, default: {} },
  searchText: { type: String, default: '' },
  printStatus: { type: String, enum: ['not_printed', 'printed'], default: 'not_printed' },
  printCount: { type: Number, default: 0 },
  lastPrintedAt: { type: Date, default: null },
  registrantId: String,
});

attendeeSchema.index({ eventId: 1, searchText: 1 });

// sparse: XLSX-imported attendees have no registrantId and must not collide
// against each other under a non-sparse unique index.
attendeeSchema.index(
  { eventId: 1, registrantId: 1 },
  { unique: true, sparse: true, partialFilterExpression: { registrantId: { $ne: null } } },
);

export const AttendeeModel = model<AttendeeDoc>('Attendee', attendeeSchema);
