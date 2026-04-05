import type { FastifyReply, FastifyRequest } from 'fastify';

import type { HealthResponse } from '../types/index.js';

export type HealthDeps = {
  postgres: { healthCheck: () => Promise<'connected' | 'disconnected'> };
  redis: { healthCheck: () => Promise<'connected' | 'degraded'> };
};

export async function healthHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
  deps: HealthDeps,
): Promise<void> {
  const settled = await Promise.allSettled([
    deps.postgres.healthCheck(),
    deps.redis.healthCheck(),
  ]);

  let db: 'connected' | 'disconnected' = 'disconnected';
  if (settled[0].status === 'fulfilled') {
    db = settled[0].value;
  }

  let redis: 'connected' | 'degraded' = 'degraded';
  if (settled[1].status === 'fulfilled') {
    redis = settled[1].value;
  }

  const status: HealthResponse['status'] = db === 'connected' ? 'ok' : 'degraded';
  const body: HealthResponse = {
    status,
    uptime: Math.floor(process.uptime()),
    db,
    redis,
    timestamp: new Date().toISOString(),
  };

  if (db === 'disconnected') {
    reply.status(503).send(body);
    return;
  }
  reply.status(200).send(body);
}
