import { BadgeTemplateModel, Zone } from '../models/badgeTemplate.model';
import { AttendeeModel } from '../models/attendee.model';
import { EventModel } from '../models/event.model';
import { AppError } from '../utils/AppError';
import { CreateTemplateInput } from '../validators/template.validators';

const DEFAULT_ZONES: Zone[] = [
  { id: 'name', field: 'fullName', fontSize: 4, bold: true, align: 'center', hidden: false },
];

export async function ensureDefaultTemplate() {
  const existing = await BadgeTemplateModel.findOne({ isDefault: true });
  if (existing) return existing;
  return BadgeTemplateModel.create({
    name: 'Default badge',
    isDefault: true,
    labelWidthMm: 80,
    labelHeightMm: 60,
    zones: DEFAULT_ZONES,
  });
}

export async function listTemplates() {
  await ensureDefaultTemplate();
  return BadgeTemplateModel.find().sort({ isDefault: -1, createdAt: 1 }).lean();
}

export async function getTemplate(id: string) {
  const template = await BadgeTemplateModel.findById(id).lean();
  if (!template) throw new AppError(404, 'Template not found');
  return template;
}

// Distinct attendee `extra` keys across all events — suggestions for the
// template field picker. extra is a Mixed map, so unwind its key/value pairs.
export async function listFieldKeys(): Promise<string[]> {
  const rows = await AttendeeModel.aggregate<{ _id: string }>([
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
