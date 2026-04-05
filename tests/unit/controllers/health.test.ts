import {
  describe, it, expect, vi,
} from 'vitest';
import type { FastifyReply } from 'fastify';

import { healthHandler } from '../../../src/controllers/health.controller.js';

function mockReply() {
  const status = vi.fn().mockReturnThis();
  const send = vi.fn().mockReturnThis();
  return {
    reply: { status, send } as unknown as FastifyReply,
    status,
    send,
  };
}

describe('healthHandler', () => {
  it('200 when db and redis connected', async () => {
    const { reply, status, send } = mockReply();
    await healthHandler(
      {} as never,
      reply,
      {
        postgres: { healthCheck: async () => 'connected' },
        redis: { healthCheck: async () => 'connected' },
      },
    );
    expect(status).toHaveBeenCalledWith(200);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      status: 'ok',
      db: 'connected',
      redis: 'connected',
    }));
  });

  it('200 when redis degraded', async () => {
    const { reply, status, send } = mockReply();
    await healthHandler(
      {} as never,
      reply,
      {
        postgres: { healthCheck: async () => 'connected' },
        redis: { healthCheck: async () => 'degraded' },
      },
    );
    expect(status).toHaveBeenCalledWith(200);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      redis: 'degraded',
    }));
  });

  it('503 when db disconnected', async () => {
    const { reply, status, send } = mockReply();
    await healthHandler(
      {} as never,
      reply,
      {
        postgres: { healthCheck: async () => 'disconnected' },
        redis: { healthCheck: async () => 'connected' },
      },
    );
    expect(status).toHaveBeenCalledWith(503);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      db: 'disconnected',
      status: 'degraded',
    }));
  });

  it('handles rejected health checks', async () => {
    const { reply, status } = mockReply();
    await healthHandler(
      {} as never,
      reply,
      {
        postgres: { healthCheck: async () => Promise.reject(new Error('x')) },
        redis: { healthCheck: async () => Promise.reject(new Error('y')) },
      },
    );
    expect(status).toHaveBeenCalledWith(503);
  });
});
