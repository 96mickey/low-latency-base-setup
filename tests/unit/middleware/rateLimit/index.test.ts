import {
  describe, it, expect, vi,
} from 'vitest';
import Fastify from 'fastify';

import { rateLimitPlugin } from '../../../../src/middleware/rateLimit/index.js';
import { correlationIdPlugin } from '../../../../src/middleware/correlationId/index.js';
import { createTokenBucket } from '../../../../src/middleware/rateLimit/tokenBucket.js';
import { createNewIpLimiter } from '../../../../src/middleware/rateLimit/newIpLimiter.js';
import { createLatencyCircuitBreaker } from '../../../../src/middleware/rateLimit/latencyCircuitBreaker.js';
import { loadConfig } from '../../../../src/config/index.js';

const base: Record<string, string | undefined> = {
  NODE_ENV: 'test',
  DB_HOST: 'h',
  DB_NAME: 'n',
  DB_USER: 'u',
  DB_PASSWORD: 'p',
  CORS_ALLOWED_ORIGINS: 'http://localhost',
  RL_IP_MAX_TOKENS: '1',
  RL_IP_REFILL_RATE: '0.0001',
  LATENCY_CB_WARMUP_MS: '1',
  LATENCY_CB_WINDOW_SIZE: '50',
  LATENCY_CB_CHECK_INTERVAL_MS: '100',
  TRUSTED_PROXY_DEPTH: '0',
};

async function makeApp(over: Record<string, string | undefined> = {}) {
  const config = loadConfig({ ...base, ...over } as NodeJS.ProcessEnv);
  const app = Fastify({ logger: false });
  await app.register(correlationIdPlugin);
  const tokenBucket = createTokenBucket(config);
  const newIpLimiter = createNewIpLimiter(config);
  const latencyCircuitBreaker = createLatencyCircuitBreaker(config);
  await app.register(rateLimitPlugin, {
    config,
    tokenBucket,
    newIpLimiter,
    latencyCircuitBreaker,
  });
  app.get('/z', async () => 'ok');
  return {
    app, tokenBucket, newIpLimiter, latencyCircuitBreaker,
  };
}

describe('rateLimitPlugin', () => {
  it('treats non-string XFF header as undefined', async () => {
    const { app } = await makeApp({
      RL_IP_MAX_TOKENS: '999',
      RL_IP_REFILL_RATE: '100',
    });
    const res = await app.inject({
      method: 'GET',
      url: '/z',
      headers: { 'x-forwarded-for': ['1.2.3.4', '5.6.7.8'] as unknown as string },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('bypasses when RATE_LIMIT_DISABLED', async () => {
    const { app } = await makeApp({ RATE_LIMIT_DISABLED: 'true' });
    const res = await app.inject({ method: 'GET', url: '/z' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('bypasses CIDR in RATE_LIMIT_BYPASS_CIDRS', async () => {
    const { app } = await makeApp({
      RATE_LIMIT_BYPASS_CIDRS: '127.0.0.1/32',
    });
    const res = await app.inject({ method: 'GET', url: '/z' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('returns 429 when token bucket empty', async () => {
    const { app, tokenBucket } = await makeApp();
    tokenBucket.consumeToken('127.0.0.1');
    const res = await app.inject({ method: 'GET', url: '/z' });
    expect(res.statusCode).toBe(429);
    const j = res.json() as { error: { code: string } };
    expect(j.error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(res.headers['retry-after']).toBeDefined();
    await app.close();
  });

  it('returns 429 when circuit breaker denies', async () => {
    const { app, latencyCircuitBreaker } = await makeApp({
      RL_IP_MAX_TOKENS: '999',
      RL_IP_REFILL_RATE: '100',
    });
    vi.spyOn(latencyCircuitBreaker, 'allowRequest').mockReturnValue(false);
    const res = await app.inject({ method: 'GET', url: '/z' });
    expect(res.statusCode).toBe(429);
    await app.close();
  });

  it('returns 429 when new IP limit exceeded', async () => {
    const { app, newIpLimiter } = await makeApp({
      RL_IP_MAX_TOKENS: '999',
      RL_IP_REFILL_RATE: '100',
    });
    vi.spyOn(newIpLimiter, 'checkAndRecord').mockReturnValue(false);
    const res = await app.inject({ method: 'GET', url: '/z' });
    expect(res.statusCode).toBe(429);
    await app.close();
  });
});
