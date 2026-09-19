import { z } from 'zod';
import { objectId } from '../utils/objectId';

export const listActivityQuerySchema = z.object({
  eventId: objectId.optional(),
  before: objectId.optional(), // cursor: the last _id of the previous page
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type ListActivityQuery = z.infer<typeof listActivityQuerySchema>;

// Printer state lives in the browser (WebUSB), so the client reports it.
export const logPrinterActivitySchema = z.object({
  action: z.enum(['connect', 'disconnect']),
  eventId: objectId.nullable().default(null),
});

export type LogPrinterActivityInput = z.infer<typeof logPrinterActivitySchema>;
