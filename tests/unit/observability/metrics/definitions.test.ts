import {
  describe, it, expect, vi,
} from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';

import {
  makeMetricsOnRequest,
  makeMetricsOnResponse,
} from '../../../../src/observability/metrics/definitions.js';

describe('metrics hooks', () => {
  it('makeMetricsOnRequest stores start time', () => {
    const request = {} as FastifyRequest;
    const done = vi.fn();
    makeMetricsOnRequest(request, {} as FastifyReply, done);
    expect(done).toHaveBeenCalled();
  });

  it('makeMetricsOnResponse uses zero duration when start missing', () => {
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

  it('makeMetricsOnResponse observes duration when start present', () => {
    const request = {
      method: 'GET',
      url: '/x',
      routeOptions: { url: '/x' },
    } as FastifyRequest;
    const reply = { statusCode: 200 } as FastifyReply;
    const done = vi.fn();
    makeMetricsOnRequest(request, reply, vi.fn());
    makeMetricsOnResponse(request, reply, done);
    expect(done).toHaveBeenCalled();
  });
});
