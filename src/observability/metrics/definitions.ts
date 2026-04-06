/**
 * Prometheus metric definitions and Fastify hooks to record HTTP duration and counts per route.
 * Importing this module registers metrics on `registry` (see also `metricsServer.ts` side-effect).
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { Counter, Gauge, Histogram } from 'prom-client';

import { registry } from './registry.js';

const labelNames = ['method', 'route', 'status_code'] as const;

export const httpRequestDurationMs = new Histogram({
  name: 'http_request_duration_ms',
  help: 'Duration of HTTP requests in milliseconds',
  labelNames: [...labelNames],
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
  registers: [registry],
});

export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: [...labelNames],
  registers: [registry],
});

export const dbPoolConnectionsActive = new Gauge({
  name: 'db_pool_connections_active',
  help: 'Active connections in the pg pool',
  registers: [registry],
});

export const dbPoolConnectionsIdle = new Gauge({
  name: 'db_pool_connections_idle',
  help: 'Idle connections in the pg pool',
  registers: [registry],
});

export const rateLimitRejectedTotal = new Counter({
  name: 'rate_limit_rejected_total',
  help: 'Rate limit rejections by layer',
  labelNames: ['layer'],
  registers: [registry],
});

export const redisSyncDurationMs = new Histogram({
  name: 'redis_sync_duration_ms',
  help: 'Redis hybrid sync duration ms',
  buckets: [5, 10, 25, 50, 100, 250, 500],
  registers: [registry],
});

export const redisSyncErrorsTotal = new Counter({
  name: 'redis_sync_errors_total',
  help: 'Redis sync errors',
  registers: [registry],
});

/**
 * HTTP duration uses `reply.elapsedTime` (Fastify) instead of a request Symbol / WeakMap so
 * we do not add hidden properties to high-churn `FastifyRequest` objects. Matches the latency
 * circuit breaker hook in `app.ts` (same clock as access-log `responseTime`).
 */
export function makeMetricsOnResponse(
  request: FastifyRequest,
  reply: FastifyReply,
  done: () => void,
): void {
  const duration = reply.elapsedTime ?? 0;
  const route = request.routeOptions?.url ?? request.url;
  const { method } = request;
  const { statusCode } = reply;
  const status = String(statusCode);
  httpRequestDurationMs.labels(method, route, status).observe(duration);
  httpRequestsTotal.labels(method, route, status).inc();
  done();
}
