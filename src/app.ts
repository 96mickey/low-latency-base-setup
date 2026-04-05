/**
 * Composes the HTTP application: Fastify instance, cross-cutting middleware, routes, and shutdown.
 * Plugin order matters (security → identity → rate limits → metrics hooks → errors → routes).
 * Hybrid Redis mode starts background sync of per-IP rate-limit deltas to Redis.
 */

import closeWithGrace from 'close-with-grace';
import type { FastifyInstance } from 'fastify';
import pino from 'pino';

import { createPostgresConnector, type PostgresConnector } from './connectors/postgres/index.js';
import { buildRedisConnector, type RedisConnector } from './connectors/redis/index.js';
import { createSyncTask, type SyncTask } from './connectors/redis/syncTask.js';
import { correlationIdPlugin } from './middleware/correlationId/index.js';
import { createLatencyCircuitBreaker } from './middleware/rateLimit/latencyCircuitBreaker.js';
import { createNewIpLimiter } from './middleware/rateLimit/newIpLimiter.js';
import { rateLimitPlugin } from './middleware/rateLimit/index.js';
import { createTokenBucket } from './middleware/rateLimit/tokenBucket.js';
import { securityPlugin } from './middleware/security/index.js';
import { tracingSlotPlugin } from './middleware/tracingSlot/index.js';
import {
  makeMetricsOnRequest,
  makeMetricsOnResponse,
} from './observability/metrics/definitions.js';
import { buildLogger } from './observability/logger/index.js';
import { registerRoutes } from './routes/index.js';
import { createFastifyInstance } from './server/factory.js';
import type { Config } from './types/index.js';
import { sendStandardError } from './lib/httpError.js';

export type AppBundle = {
  fastify: FastifyInstance;
  postgres: PostgresConnector;
  redis: RedisConnector;
  syncTask: SyncTask;
  tokenBucket: ReturnType<typeof createTokenBucket>;
  latencyCircuitBreaker: ReturnType<typeof createLatencyCircuitBreaker>;
};

export async function buildApp(config: Config): Promise<AppBundle> {
  const logger = pino(buildLogger(config));
  const fastify = createFastifyInstance(config, logger);

  const postgres = createPostgresConnector(config);
  const redis = buildRedisConnector(config);
  const syncTask = createSyncTask();
  const tokenBucket = createTokenBucket(config);
  const newIpLimiter = createNewIpLimiter(config);
  const latencyCircuitBreaker = createLatencyCircuitBreaker(config);

  tokenBucket.startSweep();
  latencyCircuitBreaker.start();

  if (config.REDIS_MODE === 'hybrid') {
    syncTask.start(redis, () => tokenBucket.drainDeltas(), config);
  }

  // Registers SIGTERM/SIGINT handling: stop timers and close Redis, Postgres, then Fastify.
  closeWithGrace(
    { delay: config.SHUTDOWN_GRACE_MS },
    async ({ err, signal: _signal }) => {
      if (err) {
        logger.error(err);
      }
      latencyCircuitBreaker.stop();
      tokenBucket.stopSweep();
      await syncTask.stop();
      await redis.teardown();
      await postgres.teardown();
      await fastify.close();
    },
  );

  fastify.addHook('onRequest', makeMetricsOnRequest);

  // --- Request pipeline (order preserved) ---
  await fastify.register(securityPlugin, { config });

  await fastify.register(correlationIdPlugin);

  await fastify.register(tracingSlotPlugin);

  await fastify.register(rateLimitPlugin, {
    config,
    tokenBucket,
    newIpLimiter,
    latencyCircuitBreaker,
  });

  fastify.addHook('onResponse', makeMetricsOnResponse);

  // Latency CB: use Fastify reply.elapsedTime each request (see rateLimit/latencyCircuitBreaker).
  fastify.addHook('onResponse', async (request, reply) => {
    const ms = reply.elapsedTime ?? 0;
    latencyCircuitBreaker.recordLatency(ms);
    latencyCircuitBreaker.onRequestCompleted(ms);
  });

  // Normalises oversized bodies to our standard error shape; everything else → 500 + log.
  fastify.setErrorHandler((err, request, reply) => {
    const e = err as NodeJS.ErrnoException & Error;
    const { code } = e;
    const status = reply.statusCode;
    if (
      code === 'FST_ERR_CTP_BODY_TOO_LARGE'
      || (typeof e.message === 'string' && e.message.includes('Body is too large'))
      || status === 413
    ) {
      sendStandardError(
        reply,
        413,
        'PAYLOAD_TOO_LARGE',
        `Request body exceeds the configured limit of ${config.BODY_SIZE_LIMIT}.`,
        request.correlationId,
      );
      return reply;
    }
    request.log.error(err);
    sendStandardError(
      reply,
      500,
      'INTERNAL_ERROR',
      'An unexpected error occurred.',
      request.correlationId,
    );
    return reply;
  });

  await registerRoutes(fastify, {
    health: { postgres, redis },
  });

  return {
    fastify,
    postgres,
    redis,
    syncTask,
    tokenBucket,
    latencyCircuitBreaker,
  };
}
