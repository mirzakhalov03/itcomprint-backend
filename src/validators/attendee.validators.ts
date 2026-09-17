import { z } from 'zod';
import { objectId } from '../utils/objectId';

export const attendeeIdParamSchema = z.object({ id: objectId });
