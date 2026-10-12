import { z } from 'zod';
import { objectId } from '../utils/objectId';

export const attendeeIdParamSchema = z.object({ id: objectId });

export const addAttendeeSchema = z.object({ fullName: z.string().trim().min(1).max(120) });
export type AddAttendeeInput = z.infer<typeof addAttendeeSchema>;
