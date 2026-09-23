import { Schema, model, Document, Types } from 'mongoose';

/** A bus city: its chip label plus every bot answer (in any language) that means it. */
export interface BusRoute {
  label: string;
  autoLabel: boolean; // true until a human renames it; sync may improve it
  phrases: string[];
  hidden: boolean;
}

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
  tabGid: number | null;
  lastSyncedAt: Date | null;
  deletedAt: Date | null;
  busRoutes: BusRoute[];
}

const busRouteSchema = new Schema<BusRoute>(
  {
    label: { type: String, required: true, trim: true },
    autoLabel: { type: Boolean, default: true },
    phrases: { type: [String], default: [] },
    hidden: { type: Boolean, default: false },
  },
  { _id: false }, // the label is the key; routes are always replaced wholesale
);

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
  // Main Sheet tab this event reads from, by stable gid (tabs can be renamed). null → legacy/XLSX event.
  tabGid: { type: Number, default: null },
  lastSyncedAt: { type: Date, default: null },
  // Bus cities detected from sheet answers on sync; staff can rename/regroup/hide them.
  busRoutes: { type: [busRouteSchema], default: [] },
  // Soft-delete: set when an event is moved to trash, cleared on restore.
  // Trashed events are hidden from listEvents and hard-deleted 45 days later.
  deletedAt: { type: Date, default: null, index: true },
});

// One event per Main Sheet tab. Trashed events keep their reservation so a restore can't collide;
// only a hard delete frees the tab. Null tabGids (legacy/XLSX events) are outside the index.
eventSchema.index(
  { sheetId: 1, tabGid: 1 },
  {
    unique: true,
    partialFilterExpression: { tabGid: { $type: 'number' } },
    name: 'one_event_per_tab',
  },
);

export const EventModel = model<EventDoc>('Event', eventSchema);
