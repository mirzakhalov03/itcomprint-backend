import { z } from 'zod';
import { objectId } from '../utils/objectId';

const zoneSchema = z.object({
  id: z.string().min(1).max(80),
  field: z.string().trim().min(1).max(100),
  fontSize: z.number().int().min(1).max(8),
  bold: z.boolean(),
  align: z.enum(['left', 'center', 'right']),
  hidden: z.boolean().default(false),
});

export const createTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  labelWidthMm: z.number().min(10).max(200).default(80),
  labelHeightMm: z.number().min(10).max(200).default(60),
  zones: z.array(zoneSchema).max(12).default([]),
});

// Update is a full replacement of the editable fields.
export const updateTemplateSchema = createTemplateSchema;

export const templateIdParamSchema = z.object({ id: objectId });

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
