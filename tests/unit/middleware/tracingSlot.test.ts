import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';

import { tracingSlotPlugin } from '../../../src/middleware/tracingSlot/index.js';

describe('tracingSlotPlugin', () => {
  it('registers without error', async () => {
    const app = Fastify({ logger: false });
    await app.register(tracingSlotPlugin);
    app.get('/x', async () => 'ok');
    const res = await app.inject({ method: 'GET', url: '/x' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
