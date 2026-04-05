/**
 * Aggregates route registration — add new route modules here and extend `RouteDeps` as needed.
 */

import type { FastifyInstance } from 'fastify';

import type { HealthDeps } from '../controllers/health.controller.js';

import { registerHealthRoutes } from './health/index.js';

export type RouteDeps = {
  health: HealthDeps;
};

export async function registerRoutes(fastify: FastifyInstance, deps: RouteDeps): Promise<void> {
  await registerHealthRoutes(fastify, deps.health);
}
