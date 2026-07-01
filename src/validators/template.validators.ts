import { z } from 'zod';
import { objectId } from '../utils/objectId';

const zoneSchema = z.object({
  id: z.string().min(1).max(80),
  type: z.enum(['field', 'static']).default('field'),
  field: z.string().trim().max(100).optional(),
  staticText: z.string().max(500).optional(),
  fontFamily: z.string().max(80).default('Inter'),
  fontSize: z.number().min(6).max(96),
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

export const updateTemplateSchema = createTemplateSchema;

export const templateIdParamSchema = z.object({ id: objectId });

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
