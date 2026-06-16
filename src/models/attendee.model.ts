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
}

const attendeeSchema = new Schema<AttendeeDoc>({
  eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
  fullName: { type: String, required: true, trim: true },
  extra: { type: Schema.Types.Mixed, default: {} },
  searchText: { type: String, default: '' },
  printStatus: { type: String, enum: ['not_printed', 'printed'], default: 'not_printed' },
  printCount: { type: Number, default: 0 },
  lastPrintedAt: { type: Date, default: null },
});

attendeeSchema.index({ eventId: 1, searchText: 1 });

export const AttendeeModel = model<AttendeeDoc>('Attendee', attendeeSchema);
