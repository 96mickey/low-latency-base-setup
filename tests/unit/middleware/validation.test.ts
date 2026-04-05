import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { z } from 'zod';

import { makeValidator } from '../../../src/middleware/validation/index.js';
import { correlationIdPlugin } from '../../../src/middleware/correlationId/index.js';

describe('makeValidator', () => {
  it('attaches validated body on success', async () => {
    const app = Fastify({ logger: false });
    await app.register(correlationIdPlugin);
    const schema = z.object({ name: z.string() });
    app.post('/x', { preHandler: makeValidator(schema) }, async (req) => {
      const b = (req as typeof req & { validatedBody: z.infer<typeof schema> }).validatedBody;
      return b;
    });
    const res = await app.inject({
      method: 'POST',
      url: '/x',
      payload: { name: 'a' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ name: 'a' });
    await app.close();
  });

  it('returns 400 with VALIDATION_ERROR on failure', async () => {
    const app = Fastify({ logger: false });
    await app.register(correlationIdPlugin);
    const schema = z.object({ name: z.string() });
    app.post('/x', { preHandler: makeValidator(schema) }, async () => 'no');
    const res = await app.inject({
      method: 'POST',
      url: '/x',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    const j = res.json() as { error: { code: string } };
    expect(j.error.code).toBe('VALIDATION_ERROR');
    await app.close();
  });
});
