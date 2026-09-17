import { BadgeTemplateModel, Zone } from '../models/badgeTemplate.model';
import { AttendeeModel } from '../models/attendee.model';
import { EventModel } from '../models/event.model';
import { AppError } from '../utils/AppError';
import { CreateTemplateInput } from '../validators/template.validators';

const DEFAULT_ZONES: Zone[] = [
  {
    id: 'name',
    type: 'field',
    field: 'fullName',
    fontFamily: 'Inter',
    fontSize: 16,
    bold: true,
    align: 'center',
    hidden: false,
  },
];

// Idempotent upsert. Called once at boot (server.ts), not on every request.
export async function ensureDefaultTemplate(): Promise<void> {
  await BadgeTemplateModel.updateOne(
    { isDefault: true },
    {
      $setOnInsert: {
        name: 'Default badge',
        isDefault: true,
        labelWidthMm: 80,
        labelHeightMm: 60,
        zones: DEFAULT_ZONES,
      },
    },
    { upsert: true },
  );
}

export async function listTemplates() {
  return BadgeTemplateModel.find().sort({ isDefault: -1, createdAt: 1 }).lean();
}

export async function getTemplate(id: string) {
  const template = await BadgeTemplateModel.findById(id).lean();
  if (!template) throw new AppError(404, 'Template not found');
  return template;
}

const FIELD_KEY_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;

// Distinct extra keys from recently created, non-trashed events: bounded cost as history grows.
export async function listFieldKeys(): Promise<string[]> {
  const since = new Date(Date.now() - FIELD_KEY_LOOKBACK_MS);
  const eventIds = await EventModel.find({ deletedAt: null, createdAt: { $gte: since } }).distinct(
    '_id',
  );
  const rows = await AttendeeModel.aggregate<{ _id: string }>([
    { $match: { eventId: { $in: eventIds } } },
    { $project: { kv: { $objectToArray: '$extra' } } },
    { $unwind: '$kv' },
    { $group: { _id: '$kv.k' } },
    { $sort: { _id: 1 } },
  ]);
  return rows.map((r) => r._id);
}

export async function createTemplate(input: CreateTemplateInput, authorName: string) {
  return BadgeTemplateModel.create({ ...input, isDefault: false, createdByName: authorName });
}

export async function updateTemplate(id: string, input: CreateTemplateInput) {
  const template = await BadgeTemplateModel.findByIdAndUpdate(
    id,
    { $set: input },
    { returnDocument: 'after' },
  ).lean();
  if (!template) throw new AppError(404, 'Template not found');
  return template;
}

export async function deleteTemplate(id: string) {
  const template = await BadgeTemplateModel.findById(id);
  if (!template) throw new AppError(404, 'Template not found');
  if (template.isDefault) throw new AppError(400, 'Cannot delete the default template');
  // Events pointing at this template fall back to the default (templateId null).
  await EventModel.updateMany({ templateId: id }, { $set: { templateId: null } });
  await template.deleteOne();
}
