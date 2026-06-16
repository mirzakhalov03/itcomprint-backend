import { Request, Response, NextFunction } from 'express';
import { ZodError, flattenError } from 'zod';
import mongoose from 'mongoose';
import { isProd } from '../config/env';

interface HttpError {
  status?: number;
  statusCode?: number;
  message?: string;
}

// Centralized error formatting. Every async route is wrapped in `asyncHandler`,
// so thrown/rejected errors land here and become a consistent JSON shape.
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  // Zod validation failures (from the `validate` middleware) → 400 with field details.
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'ValidationError', details: flattenError(err) });
  }

  // Malformed ObjectId / failed type coercion deeper in Mongoose → 400, not a 500.
  if (err instanceof mongoose.Error.CastError) {
    return res.status(400).json({ error: 'ValidationError', message: `Invalid ${err.path}` });
  }

  // Mongoose document validation → 400.
  if (err instanceof mongoose.Error.ValidationError) {
    return res.status(400).json({ error: 'ValidationError', message: err.message });
  }

  // Errors that already carry an HTTP status (e.g. body-parser: malformed JSON → 400,
  // payload too large → 413). Respect it instead of masking as 500.
  const httpErr = err as HttpError;
  const status = httpErr.status ?? httpErr.statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return res.status(status).json({ error: 'BadRequest', message: httpErr.message });
  }

  // Anything else is unexpected: always log it, but never leak internals to clients in prod.
  console.error('[error]', err);
  const message = isProd ? 'Internal Server Error' : (err instanceof Error ? err.message : 'Internal Server Error');
  return res.status(500).json({ error: 'InternalServerError', message });
}
