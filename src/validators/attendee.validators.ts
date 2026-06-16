import { z } from 'zod';
import { objectId } from '../utils/objectId';

export const listAttendeesQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: z.enum(['printed', 'not_printed']).optional(),
});

export type ListAttendeesQuery = z.infer<typeof listAttendeesQuerySchema>;

export const attendeeIdParamSchema = z.object({ id: objectId });
