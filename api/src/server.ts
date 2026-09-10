import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { describeTarget } from './db/pool.js';

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`
  API listening on http://localhost:${config.port}
  database        ${describeTarget()}
  environment     ${config.nodeEnv}
  cors origin     ${config.corsOrigin}
`);
});

/**
 * Finish in-flight requests before exiting, then close the pool. Without this,
 * a container restart can abort a transaction mid-write -- which the
 * transaction itself makes safe, but a clean shutdown makes unnecessary.
 */
async function shutdown(signal: string): Promise<void> {
  console.log(`\n  ${signal} received, shutting down`);
  server.close(() => {
    void pool.end().then(() => process.exit(0));
  });
  // Do not hang forever on a stuck connection.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
