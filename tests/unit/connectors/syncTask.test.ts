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
      eval: vi.fn().mockReturnThis(),
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

  it('pipelines one EVAL per IP (INCRBY + conditional EXPIRE in Lua)', async () => {
    const evalFn = vi.fn().mockReturnThis();
    const exec = vi.fn().mockResolvedValue([]);
    const client: RedisConnector = {
      connect: vi.fn(),
      healthCheck: vi.fn(),
      teardown: vi.fn(),
      get: vi.fn(),
      pipeline: () => ({ eval: evalFn, exec }),
    };
    const config = loadConfig({
      ...base,
      REDIS_MODE: 'hybrid',
      REDIS_TOPOLOGY: 'standalone',
      REDIS_SYNC_INTERVAL_MS: '100',
    } as NodeJS.ProcessEnv);
    const task = createSyncTask();
    task.start(
      client,
      () => new Map<string, number>([
        ['1.2.3.4', 2],
        ['5.5.5.5', 1],
      ]),
      config,
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(evalFn).toHaveBeenCalledTimes(2);
    expect(evalFn).toHaveBeenCalledWith(
      expect.stringContaining('INCRBY'),
      1,
      'rl:ip:1.2.3.4',
      '2',
      '3600',
    );
    expect(evalFn).toHaveBeenCalledWith(
      expect.stringContaining('EXPIRE'),
      1,
      'rl:ip:5.5.5.5',
      '1',
      '3600',
    );
    await task.stop();
  });

  it('does not start a second tick while the previous exec is still pending', async () => {
    const config = loadConfig({
      ...base,
      REDIS_MODE: 'hybrid',
      REDIS_TOPOLOGY: 'standalone',
      REDIS_SYNC_INTERVAL_MS: '10',
    } as NodeJS.ProcessEnv);
    let releaseFirst: (v: unknown) => void;
    const exec = vi.fn()
      .mockImplementationOnce(
        () => new Promise<unknown>((r) => { releaseFirst = r; }),
      )
      .mockResolvedValue([]);
    const client = makeClient(exec);
    const task = createSyncTask();
    task.start(client, () => new Map([['9.9.9.9', 1]]), config);
    await vi.advanceTimersByTimeAsync(10);
    expect(exec).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(exec).toHaveBeenCalledTimes(1);
    releaseFirst!([]);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(10);
    expect(exec).toHaveBeenCalledTimes(2);
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
