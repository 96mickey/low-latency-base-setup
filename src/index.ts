/**
 * Process entry — not imported by tests.
 * Loads `.env` from the current working directory when present (see `dotenv`).
 */

import 'dotenv/config';

import { buildApp } from './app.js';
import { loadConfigFromProcessEnv } from './config/index.js';
import { createMetricsServer } from './server/metricsServer.js';

async function main() {
  const config = loadConfigFromProcessEnv();

  const bundle = await buildApp(config);

  await bundle.postgres.connect();
  await bundle.redis.connect();

  const metricsApp = await createMetricsServer(config, () => {
    const { pool } = bundle.postgres;
    return {
      active: pool.totalCount - pool.idleCount,
      idle: pool.idleCount,
    };
  });

  await metricsApp.listen({ port: config.METRICS_PORT, host: config.HOST });
  await bundle.fastify.listen({ port: config.PORT, host: config.HOST });

  bundle.fastify.log.info(
    { port: config.PORT, metricsPort: config.METRICS_PORT, nodeEnv: config.NODE_ENV },
    'Server listening',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
