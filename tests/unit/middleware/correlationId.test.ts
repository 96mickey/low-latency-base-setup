import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';

import { correlationIdPlugin } from '../../../src/middleware/correlationId/index.js';

describe('correlationIdPlugin', () => {
  it('uses header when valid', async () => {
    const app = Fastify({ logger: false });
    await app.register(correlationIdPlugin);
    app.get('/x', async (req) => ({ id: req.correlationId }));
    const res = await app.inject({
      method: 'GET',
      url: '/x',
      headers: { 'x-correlation-id': 'abc-123' },
    });
    expect(res.json()).toEqual({ id: 'abc-123' });
    expect(res.headers['x-correlation-id']).toBe('abc-123');
    await app.close();
  });

  it('generates uuid when header too long', async () => {
    const app = Fastify({ logger: false });
    await app.register(correlationIdPlugin);
    app.get('/x', async (req) => ({ id: req.correlationId }));
    const res = await app.inject({
      method: 'GET',
      url: '/x',
      headers: { 'x-correlation-id': `${'a'.repeat(250)}` },
    });
    const body = res.json() as { id: string };
    expect(body.id.length).toBeGreaterThan(10);
    await app.close();
  });

  it('generates uuid when header invalid', async () => {
    const app = Fastify({ logger: false });
    await app.register(correlationIdPlugin);
    app.get('/x', async (req) => ({ id: req.correlationId }));
    const res = await app.inject({
      method: 'GET',
      url: '/x',
      headers: { 'x-correlation-id': 'bad\nline' },
    });
    const body = res.json() as { id: string };
    expect(body.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    await app.close();
  });
});
