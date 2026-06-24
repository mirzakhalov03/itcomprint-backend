import { z } from 'zod';

// 24-char hex string — a valid Mongo ObjectId. Validating here turns a malformed
// `:id` into a clean 400 at the edge instead of a CastError → 500 deeper in.
export const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');
