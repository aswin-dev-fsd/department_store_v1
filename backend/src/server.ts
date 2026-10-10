import { createApp } from './app.js';
import { env } from './config/env.js';
import { db, pool } from './db.js';
import { logger } from './lib/logger.js';

const SHUTDOWN_GRACE_MS = 10_000;

const server = createApp({ db }).listen(env.PORT, (error?: Error) => {
  if (error) {
    logger.fatal({ err: error }, 'Could not start the API');
    process.exit(1);
  }
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'API listening');
});

/** Stop taking requests, let in-flight ones finish, then close the database pool. */
function shutdown(signal: NodeJS.Signals): void {
  logger.info({ signal }, 'Shutting down');
  setTimeout(() => {
    logger.error('Shutdown took too long; exiting');
    process.exit(1);
  }, SHUTDOWN_GRACE_MS).unref();
  server.close(() => {
    pool.end().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
  server.closeIdleConnections();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
