import { Schema, model, Document } from 'mongoose';

export type ZoneAlign = 'left' | 'center' | 'right';

export interface Zone {
  id: string;
  type: 'field' | 'static';
  field?: string;
  staticText?: string;
  fontFamily: string;
  fontSize: number;
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
    type: { type: String, enum: ['field', 'static'], default: 'field' },
    field: { type: String, default: '' },
    staticText: { type: String, default: '' },
    fontFamily: { type: String, default: 'Inter' },
    fontSize: { type: Number, default: 16 },
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
    isDefault: { type: Boolean, default: false, index: true },
    createdByName: { type: String, default: '' },
  },
  { timestamps: true },
);

export const BadgeTemplateModel = model<BadgeTemplateDoc>('BadgeTemplate', badgeTemplateSchema);
