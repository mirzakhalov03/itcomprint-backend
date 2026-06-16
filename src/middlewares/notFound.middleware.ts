import { Request, Response } from 'express';

// JSON 404 for unmatched routes, so the API never falls back to Express's HTML page.
export function notFound(req: Request, res: Response) {
  res.status(404).json({ error: 'NotFound', message: `Cannot ${req.method} ${req.path}` });
}
