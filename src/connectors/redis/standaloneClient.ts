import { Redis } from 'ioredis';

import type { Config } from '../../types/index.js';

export type StandaloneRedis = {
  client: Redis;
  connect: () => Promise<void>;
  healthCheck: () => Promise<'connected' | 'degraded'>;
  teardown: () => Promise<void>;
  pipeline: () => ReturnType<Redis['pipeline']>;
  get: (key: string) => Promise<string | null>;
};

export function createStandaloneClient(config: Config): StandaloneRedis {
  const client = new Redis({
    host: config.REDIS_HOST ?? '127.0.0.1',
    port: config.REDIS_PORT,
    password: config.REDIS_PASSWORD,
    db: config.REDIS_DB,
    lazyConnect: true,
    enableReadyCheck: true,
    maxRetriesPerRequest: 3,
    retryStrategy(times: number) {
      return Math.min(times * 200, 5000);
    },
  });

  return {
    client,
    async connect() {
      await client.connect();
    },
    async healthCheck() {
      try {
        const res = await client.ping();
        return res === 'PONG' ? 'connected' : 'degraded';
      } catch {
        return 'degraded';
      }
    },
    async teardown() {
      await client.quit();
    },
    pipeline() {
      return client.pipeline();
    },
    async get(key: string) {
      return client.get(key);
    },
  };
}
