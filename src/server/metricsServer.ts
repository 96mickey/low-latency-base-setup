/**
 * Minimal Fastify app exposing GET /metrics (Prometheus text) on METRICS_PORT.
 * Side-effect import registers metrics; optional pool reader updates DB gauges per scrape.
 */

import Fastify, { type FastifyInstance } from 'fastify';

import '../observability/metrics/definitions.js';
import { registry } from '../observability/metrics/registry.js';
import type { Config } from '../types/index.js';

export type PoolGaugeReader = () => { active: number; idle: number };

export async function createMetricsServer(
  config: Config,
  readPoolGauges?: PoolGaugeReader,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.get('/metrics', async (_req, reply) => {
    if (readPoolGauges) {
      const { active, idle } = readPoolGauges();
      // Dynamic import keeps test/metrics bundles able to refresh gauge refs after mocks.
      const { dbPoolConnectionsActive, dbPoolConnectionsIdle } = await import(
        '../observability/metrics/definitions.js'
      );
      dbPoolConnectionsActive.set(active);
      dbPoolConnectionsIdle.set(idle);
    }
    const text = await registry.metrics();
    return reply
      .header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
      .send(text);
  });

  return app;
}
