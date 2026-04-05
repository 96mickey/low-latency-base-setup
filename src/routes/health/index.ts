/**
 * GET /health: response JSON schema only; logic in `controllers/health.controller`.
 */

import type { FastifyInstance } from 'fastify';

import { healthHandler, type HealthDeps } from '../../controllers/health.controller.js';

const healthResponseSchema = {
  type: 'object',
  required: ['status', 'uptime', 'db', 'redis', 'timestamp'],
  properties: {
    status: { type: 'string', enum: ['ok', 'degraded'] },
    uptime: { type: 'number' },
    db: { type: 'string', enum: ['connected', 'disconnected'] },
    redis: { type: 'string', enum: ['connected', 'degraded'] },
    timestamp: { type: 'string' },
  },
} as const;

export async function registerHealthRoutes(
  fastify: FastifyInstance,
  deps: HealthDeps,
): Promise<void> {
  fastify.get(
    '/health',
    {
      schema: {
        response: {
          200: healthResponseSchema,
          503: healthResponseSchema,
        },
      },
    },
    async (request, reply) => healthHandler(request, reply, deps),
  );
}
