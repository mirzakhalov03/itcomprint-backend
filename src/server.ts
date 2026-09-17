import type { Server } from 'http';
import { createApp } from './app';
import { connectDb, disconnectDb } from './config/db';
import { env } from './config/env';
import { purgeExpiredTrash } from './services/event.services';

async function main() {
  await connectDb();
  const app = createApp();
  const server = app.listen(env.PORT, () => console.log(`[server] listening on :${env.PORT}`));

  registerShutdown(server);
  schedulePurge();
}

const PURGE_INTERVAL_MS = 60 * 60 * 1000;

function schedulePurge() {
  const run = () =>
    purgeExpiredTrash()
      .then((n) => n > 0 && console.log(`[trash] purged ${n} expired event(s)`))
      .catch((err) => console.error('[trash] purge failed', err));
  void run();
  setInterval(run, PURGE_INTERVAL_MS).unref(); // unref: never keeps a shutting-down process alive
}

function registerShutdown(server: Server) {
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] ${signal} received, shutting down gracefully`);

    // Force-exit if a hung connection prevents a clean close (e.g. on container kill).
    const timer = setTimeout(() => {
      console.error('[server] graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, 10_000);
    timer.unref();

    server.close(async () => {
      try {
        await disconnectDb();
        clearTimeout(timer);
        process.exit(0);
      } catch (err) {
        console.error('[server] error during shutdown', err);
        process.exit(1);
      }
    });
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // Last-resort safety nets: log and let the orchestrator restart a clean process.
  process.on('unhandledRejection', (reason) => {
    console.error('[server] unhandled promise rejection', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('[server] uncaught exception', err);
    process.exit(1);
  });
}

main().catch((err) => {
  console.error('[server] failed to start', err);
  process.exit(1);
});
