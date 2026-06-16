import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

type Part = 'body' | 'query' | 'params';

export const validate =
  (schema: ZodSchema, part: Part = 'body') =>
  (req: Request, _res: Response, next: NextFunction) => {
    const parsed = schema.parse(req[part]);
    // In Express 5, `req.query` is a getter-only property, so a plain
    // assignment (`req.query = parsed`) throws. Redefining the property
    // works uniformly for body, query, and params.
    Object.defineProperty(req, part, { value: parsed, writable: true, configurable: true });
    next();
  };
