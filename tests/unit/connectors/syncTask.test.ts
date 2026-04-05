import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';

import { createSyncTask } from '../../../src/connectors/redis/syncTask.js';
import { loadConfig } from '../../../src/config/index.js';
import type { RedisConnector } from '../../../src/connectors/redis/index.js';

const base: Record<string, string | undefined> = {
  NODE_ENV: 'test',
  DB_HOST: 'h',
  DB_NAME: 'n',
  DB_USER: 'u',
  DB_PASSWORD: 'p',
  CORS_ALLOWED_ORIGINS: 'http://localhost',
  REDIS_HOST: '127.0.0.1',
  REDIS_SYNC_INTERVAL_MS: '5000',
};

function makeClient(execImpl: () => Promise<unknown>): RedisConnector {
  return {
    connect: vi.fn(),
    healthCheck: vi.fn(),
    teardown: vi.fn(),
    get: vi.fn(),
    pipeline: () => ({
      incrby: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: execImpl,
    }),
  };
}

describe('createSyncTask', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not start timer when not hybrid', () => {
    const config = loadConfig({
      ...base,
      REDIS_MODE: 'local',
    } as NodeJS.ProcessEnv);
    const task = createSyncTask();
    const client = makeClient(vi.fn().mockResolvedValue([]));
    task.start(client, () => new Map(), config);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('runs sync tick and observes duration', async () => {
    const config = loadConfig({
      ...base,
      REDIS_MODE: 'hybrid',
      REDIS_TOPOLOGY: 'standalone',
      REDIS_SYNC_INTERVAL_MS: '100',
    } as NodeJS.ProcessEnv);
    const exec = vi.fn().mockResolvedValue([]);
    const client = makeClient(exec);
    const task = createSyncTask();
    const deltas = new Map<string, number>([['1.2.3.4', 2]]);
    task.start(client, () => deltas, config);
    await vi.advanceTimersByTimeAsync(100);
    expect(exec).toHaveBeenCalled();
    await task.stop();
  });

  it('increments error counter on exec failure', async () => {
    const config = loadConfig({
      ...base,
      REDIS_MODE: 'hybrid',
      REDIS_TOPOLOGY: 'standalone',
      REDIS_SYNC_INTERVAL_MS: '50',
    } as NodeJS.ProcessEnv);
    const exec = vi.fn().mockRejectedValue(new Error('pipe'));
    const client = makeClient(exec);
    const task = createSyncTask();
    task.start(client, () => new Map([['1.1.1.1', 1]]), config);
    await vi.advanceTimersByTimeAsync(50);
    await task.stop();
  });
});
