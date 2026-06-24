import { Request, Response, NextFunction } from 'express';
import { ZodError, flattenError } from 'zod';
import mongoose from 'mongoose';
import { isProd } from '../config/env';
import { AppError } from '../utils/AppError';

interface HttpError {
  status?: number;
  statusCode?: number;
  message?: string;
}

// Maps an HTTP status to the stable `error` code returned to clients.
function errorName(status: number): string {
  switch (status) {
    case 400:
      return 'BadRequest';
    case 401:
      return 'Unauthorized';
    case 403:
      return 'Forbidden';
    case 404:
      return 'NotFound';
    case 409:
      return 'Conflict';
    case 413:
      return 'PayloadTooLarge';
    default:
      return status >= 500 ? 'InternalServerError' : 'Error';
  }
}

// Centralized error formatting. Express 5 forwards rejected promises from async
// handlers/middleware here automatically, so errors become a consistent JSON shape.
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  // Operational errors thrown by services/controllers → their declared status.
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: errorName(err.status), message: err.message });
  }

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
    return res.status(status).json({ error: errorName(status), message: httpErr.message });
  }

  // Anything else is unexpected: always log it, but never leak internals to clients in prod.
  console.error('[error]', err);
  const message = isProd
    ? 'Internal Server Error'
    : err instanceof Error
      ? err.message
      : 'Internal Server Error';
  return res.status(500).json({ error: 'InternalServerError', message });
}
