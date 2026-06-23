import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import { corsOrigins, isProd, isTest } from './config/env';
import { apiRouter } from './routes';
import { notFound } from './middlewares/notFound.middleware';
import { errorHandler } from './middlewares/error.middleware';

export function createApp() {
  const app = express();

  // Trust the first proxy hop (PaaS / reverse proxy) so client IPs and protocol are correct.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(compression());
  if (!isTest) app.use(morgan(isProd ? 'combined' : 'dev'));

  app.use(
    cors({
      credentials: true,
      origin(origin, callback) {
        // Allow non-browser clients (no Origin header) and any configured origin.
        if (!origin || corsOrigins.includes(origin)) return callback(null, true);
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      },
    }),
  );
  app.use(cookieParser());

  app.use(express.json({ limit: '5mb' })); // imports can be large

  app.use('/api', apiRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
