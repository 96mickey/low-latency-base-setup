import {
  describe, it, expect, beforeAll, afterAll,
} from 'vitest';
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from 'testcontainers';

import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/index.js';

const run = process.env.RUN_DOCKER_E2E === '1';

describe.skipIf(!run)('E2E with Testcontainers', () => {
  let pgHost: string;
  let pgPort: number;
  let redisHost: string;
  let redisPort: number;
  let pgContainer: StartedTestContainer | undefined;
  let redisContainer: StartedTestContainer | undefined;

  beforeAll(async () => {
    pgContainer = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({
        POSTGRES_USER: 't',
        POSTGRES_PASSWORD: 't',
        POSTGRES_DB: 't',
      })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forListeningPorts())
      .start();

    redisContainer = await new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forListeningPorts())
      .start();

    pgHost = pgContainer.getHost();
    pgPort = pgContainer.getMappedPort(5432);
    redisHost = redisContainer.getHost();
    redisPort = redisContainer.getMappedPort(6379);
  }, 120_000);

  afterAll(async () => {
    await redisContainer?.stop();
    await pgContainer?.stop();
  }, 30_000);

  it('GET /health returns 200 when Postgres and Redis are up', async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      DB_HOST: pgHost,
      DB_PORT: String(pgPort),
      DB_NAME: 't',
      DB_USER: 't',
      DB_PASSWORD: 't',
      CORS_ALLOWED_ORIGINS: 'http://localhost',
      REDIS_MODE: 'redis-primary',
      REDIS_TOPOLOGY: 'standalone',
      REDIS_HOST: redisHost,
      REDIS_PORT: String(redisPort),
      DB_CONNECT_MAX_RETRIES: '5',
      DB_CONNECT_RETRY_BASE_MS: '500',
      RATE_LIMIT_DISABLED: 'true',
    } as NodeJS.ProcessEnv);

    const bundle = await buildApp(config);
    await bundle.postgres.connect();
    await bundle.redis.connect();

    const res = await bundle.fastify.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { db: string; redis: string };
    expect(body.db).toBe('connected');
    expect(body.redis).toBe('connected');

    await bundle.postgres.teardown();
    await bundle.redis.teardown();
    await bundle.syncTask.stop();
    bundle.tokenBucket.stopSweep();
    bundle.latencyCircuitBreaker.stop();
    await bundle.fastify.close();
  }, 60_000);
});
