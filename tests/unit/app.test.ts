import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';

import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/index.js';

const closeWithGraceHandlers: Array<(args: { err?: Error; signal?: string }) => Promise<void>> = [];
vi.mock('close-with-grace', () => ({
  default: vi.fn((opts: unknown, fn: (args: { err?: Error; signal?: string }) => Promise<void>) => {
    closeWithGraceHandlers.push(fn);
    return fn;
  }),
}));

const mockConnect = vi.fn();
const mockQuery = vi.fn();
const mockEnd = vi.fn();

vi.mock('../../src/connectors/postgres/pool.js', () => ({
  createPool: () => ({
    connect: mockConnect,
    query: mockQuery,
    end: mockEnd,
    totalCount: 2,
    idleCount: 1,
  }),
}));

const base: Record<string, string | undefined> = {
  NODE_ENV: 'test',
  DB_HOST: 'h',
  DB_NAME: 'n',
  DB_USER: 'u',
  DB_PASSWORD: 'p',
  CORS_ALLOWED_ORIGINS: 'http://localhost',
  REDIS_MODE: 'local',
  BODY_SIZE_LIMIT: '100b',
  RL_IP_MAX_TOKENS: '50',
  RL_IP_REFILL_RATE: '10',
  TRUSTED_PROXY_DEPTH: '0',
  DB_CONNECT_MAX_RETRIES: '0',
  DB_CONNECT_RETRY_BASE_MS: '1',
};

describe('buildApp', () => {
  beforeEach(() => {
    closeWithGraceHandlers.length = 0;
    vi.clearAllMocks();
    mockConnect.mockResolvedValue({ release: vi.fn() });
    mockQuery.mockResolvedValue({ rows: [] });
    mockEnd.mockResolvedValue(undefined);
  });

  it('serves /health when deps up', async () => {
    const config = loadConfig(base as NodeJS.ProcessEnv);
    const bundle = await buildApp(config);
    await bundle.postgres.connect();
    const res = await bundle.fastify.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    await bundle.postgres.teardown();
    await bundle.redis.teardown();
    await bundle.syncTask.stop();
    bundle.tokenBucket.stopSweep();
    bundle.latencyCircuitBreaker.stop();
    await bundle.fastify.close();
  });

  it('returns 500 for unexpected errors', async () => {
    const config = loadConfig(base as NodeJS.ProcessEnv);
    const bundle = await buildApp(config);
    bundle.fastify.get('/boom', async () => {
      throw new Error('intentional');
    });
    const res = await bundle.fastify.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    const j = res.json() as { error: { code: string } };
    expect(j.error.code).toBe('INTERNAL_ERROR');
    await bundle.postgres.teardown();
    await bundle.redis.teardown();
    await bundle.syncTask.stop();
    bundle.tokenBucket.stopSweep();
    bundle.latencyCircuitBreaker.stop();
    await bundle.fastify.close();
  });

  it('starts hybrid sync task when REDIS_MODE is hybrid', async () => {
    const config = loadConfig({
      ...base,
      REDIS_MODE: 'hybrid',
      REDIS_HOST: '127.0.0.1',
      REDIS_TOPOLOGY: 'standalone',
      REDIS_SYNC_INTERVAL_MS: '3600000',
    } as NodeJS.ProcessEnv);
    const bundle = await buildApp(config);
    expect(closeWithGraceHandlers.length).toBeGreaterThan(0);
    await bundle.postgres.teardown();
    await bundle.redis.teardown();
    await bundle.syncTask.stop();
    bundle.tokenBucket.stopSweep();
    bundle.latencyCircuitBreaker.stop();
    await bundle.fastify.close();
  });

  it('closeWithGrace handler logs err and tears down', async () => {
    const config = loadConfig(base as NodeJS.ProcessEnv);
    await buildApp(config);
    const handler = closeWithGraceHandlers[0];
    expect(handler).toBeDefined();
    await handler!({ err: new Error('shutdown err') });
  });

  it('maps body too large to 413', async () => {
    const config = loadConfig(base as NodeJS.ProcessEnv);
    const bundle = await buildApp(config);
    const res = await bundle.fastify.inject({
      method: 'POST',
      url: '/not-a-route',
      headers: { 'content-type': 'text/plain' },
      payload: 'x'.repeat(500),
    });
    expect(res.statusCode).toBe(413);
    const j = res.json() as { error: { code: string } };
    expect(j.error.code).toBe('PAYLOAD_TOO_LARGE');
    await bundle.postgres.teardown();
    await bundle.redis.teardown();
    await bundle.syncTask.stop();
    bundle.tokenBucket.stopSweep();
    bundle.latencyCircuitBreaker.stop();
    await bundle.fastify.close();
  });
});
