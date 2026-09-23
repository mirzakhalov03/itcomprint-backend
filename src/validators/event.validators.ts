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

const busRouteSchema = z.object({
  label: z.string().trim().min(1, 'Every bus needs a name').max(100),
  autoLabel: z.boolean(),
  phrases: z.array(z.string().trim().min(1).max(300)).min(1).max(50),
  hidden: z.boolean(),
});

const busRoutesSchema = z
  .array(busRouteSchema)
  .max(50)
  .refine((routes) => {
    const phrases = routes.flatMap((r) => r.phrases);
    return new Set(phrases).size === phrases.length;
  }, 'A phrase can belong to only one bus')
  .refine((routes) => {
    const labels = routes.map((r) => r.label.toLowerCase());
    return new Set(labels).size === labels.length;
  }, 'Two buses have the same name');

export const updateEventSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    date: z.iso.datetime({ offset: true }).or(z.iso.date()),
    templateId: objectId.nullable(),
    busRoutes: busRoutesSchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'No fields to update');

export type UpdateEventInput = z.infer<typeof updateEventSchema>;

export const createEventFromSheetSchema = z.object({
  name: z.string().trim().min(1).max(200),
  date: z.iso.datetime({ offset: true }).or(z.iso.date()),
  tabGid: z.number().int().nonnegative(),
});

export type CreateEventFromSheetInput = z.infer<typeof createEventFromSheetSchema>;

// `?refresh=1` skips the cached tab list (a tab was just added in Google Sheets).
export const sheetTabsQuerySchema = z.object({ refresh: z.literal('1').optional() });
