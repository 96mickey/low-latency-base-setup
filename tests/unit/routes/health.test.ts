import {
  describe, it, expect, vi,
} from 'vitest';
import Fastify from 'fastify';

import { registerHealthRoutes } from '../../../src/routes/health/index.js';

describe('registerHealthRoutes', () => {
  it('registers GET /health', async () => {
    const app = Fastify({ logger: false });
    await registerHealthRoutes(app, {
      postgres: { healthCheck: vi.fn().mockResolvedValue('connected') },
      redis: { healthCheck: vi.fn().mockResolvedValue('connected') },
    });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { db: string };
    expect(body.db).toBe('connected');
    await app.close();
  });
});
