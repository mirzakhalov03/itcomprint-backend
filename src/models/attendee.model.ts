import { Schema, model, Document, Types } from 'mongoose';

export type PrintStatus = 'not_printed' | 'printed';

export interface AttendeeDoc extends Document {
  eventId: Types.ObjectId;
  fullName: string;
  extra: Record<string, string>;
  printStatus: PrintStatus;
  printCount: number;
  lastPrintedAt: Date | null;
  registrantId: string | null;
  removedAt: Date | null;
  manual: boolean;
}

// minimize:false keeps `extra: {}` — dropped, the client crashes on Object.values(undefined).
const attendeeSchema = new Schema<AttendeeDoc>(
  {
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
    fullName: { type: String, required: true, trim: true },
    extra: { type: Schema.Types.Mixed, default: {} },
    printStatus: { type: String, enum: ['not_printed', 'printed'], default: 'not_printed' },
    printCount: { type: Number, default: 0 },
    lastPrintedAt: { type: Date, default: null },
    registrantId: String,
    // Set when the row leaves the linked sheet; soft so print history survives an accidental delete.
    removedAt: { type: Date, default: null },
    // Added by hand at the kiosk. Legacy imports also lack a registrantId, so that alone can't tell them apart.
    manual: { type: Boolean, default: false },
  },
  { minimize: false },
);

// sparse: XLSX-imported attendees have no registrantId and must not collide
// against each other under a non-sparse unique index.
attendeeSchema.index(
  { eventId: 1, registrantId: 1 },
  { unique: true, partialFilterExpression: { registrantId: { $exists: true } } },
);

export const AttendeeModel = model<AttendeeDoc>('Attendee', attendeeSchema);
