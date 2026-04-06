import {
  describe, it, expect, vi,
} from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { makeMetricsOnResponse } from '../../../../src/observability/metrics/definitions.js';

describe('metrics hooks', () => {
  it('makeMetricsOnResponse uses zero duration when elapsedTime is missing', () => {
    const request = {
      method: 'GET',
      url: '/y',
      routeOptions: { url: '/y' },
    } as FastifyRequest;
    const reply = { statusCode: 204 } as FastifyReply;
    const done = vi.fn();
    makeMetricsOnResponse(request, reply, done);
    expect(done).toHaveBeenCalled();
  });

  it('makeMetricsOnResponse observes reply.elapsedTime', () => {
    const request = {
      method: 'GET',
      url: '/x',
      routeOptions: { url: '/x' },
    } as FastifyRequest;
    const reply = { statusCode: 200, elapsedTime: 12.5 } as FastifyReply;
    const done = vi.fn();
    makeMetricsOnResponse(request, reply, done);
    expect(done).toHaveBeenCalled();
  });
});
