import { Schema, model, Document } from 'mongoose';

export type ZoneAlign = 'left' | 'center' | 'right';

export interface Zone {
  id: string;
  field: string; // 'fullName' or an attendee extra-column key
  fontSize: number; // 1–8 scale
  bold: boolean;
  align: ZoneAlign;
  hidden: boolean;
}

export interface BadgeTemplateDoc extends Document {
  name: string;
  labelWidthMm: number;
  labelHeightMm: number;
  zones: Zone[];
  isDefault: boolean;
  createdByName: string;
  createdAt: Date;
  updatedAt: Date;
}

const zoneSchema = new Schema<Zone>(
  {
    id: { type: String, required: true },
    field: { type: String, required: true },
    fontSize: { type: Number, default: 4 },
    bold: { type: Boolean, default: false },
    align: { type: String, enum: ['left', 'center', 'right'], default: 'center' },
    hidden: { type: Boolean, default: false },
  },
  { _id: false },
);

const badgeTemplateSchema = new Schema<BadgeTemplateDoc>(
  {
    name: { type: String, required: true, trim: true },
    labelWidthMm: { type: Number, default: 80 },
    labelHeightMm: { type: Number, default: 60 },
    zones: { type: [zoneSchema], default: [] },
    // Exactly one template carries isDefault: true — the fallback for events
    // with no templateId. Seeded by ensureDefaultTemplate(); not deletable.
    isDefault: { type: Boolean, default: false, index: true },
    createdByName: { type: String, default: '' },
  },
  { timestamps: true },
);

export const BadgeTemplateModel = model<BadgeTemplateDoc>('BadgeTemplate', badgeTemplateSchema);
