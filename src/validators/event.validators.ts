import { z } from 'zod';
import { objectId } from '../utils/objectId';

export const createEventSchema = z.object({
  name: z.string().trim().min(1).max(200),
  date: z.iso.datetime({ offset: true }).or(z.iso.date()), // ISO date or datetime string
  attendees: z
    .array(
      z.object({
        fullName: z.string().trim().min(1).max(300),
        extra: z.record(z.string(), z.string()).default({}),
      }),
    )
    .min(1, 'At least one attendee is required')
    .max(20_000, 'Too many attendees — split the spreadsheet into smaller imports'),
});

export type CreateEventInput = z.infer<typeof createEventSchema>;

export const eventIdParamSchema = z.object({ id: objectId });

export const updateEventSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    date: z.iso.datetime({ offset: true }).or(z.iso.date()),
    templateId: objectId.nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'No fields to update');

export type UpdateEventInput = z.infer<typeof updateEventSchema>;

export const createEventFromSheetSchema = z.object({
  name: z.string().trim().min(1).max(200),
  date: z.iso.datetime({ offset: true }).or(z.iso.date()),
  sheetUrl: z.string().url(),
});

export type CreateEventFromSheetInput = z.infer<typeof createEventFromSheetSchema>;
