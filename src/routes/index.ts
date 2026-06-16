import { Router } from 'express';
import mongoose from 'mongoose';
import { eventRouter } from './event.routes';
import { attendeeRouter } from './attendee.routes';

export const apiRouter = Router();

// Readiness probe: 200 only when the DB is actually connected (readyState 1),
// so an orchestrator/load balancer won't route traffic to a DB-less instance.
apiRouter.get('/health', (_req, res) => {
  const dbConnected = mongoose.connection.readyState === 1;
  res.status(dbConnected ? 200 : 503).json({ ok: dbConnected, db: dbConnected ? 'up' : 'down' });
});

apiRouter.use('/events', eventRouter);
apiRouter.use('/attendees', attendeeRouter);
