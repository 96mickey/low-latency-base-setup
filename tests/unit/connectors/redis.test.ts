import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';

import { buildRedisConnector } from '../../../src/connectors/redis/index.js';
import { createStandaloneClient } from '../../../src/connectors/redis/standaloneClient.js';
import { createClusterClient } from '../../../src/connectors/redis/clusterClient.js';
import { loadConfig } from '../../../src/config/index.js';

const mockConnect = vi.fn();
const mockPing = vi.fn();
const mockQuit = vi.fn();
const mockDisconnect = vi.fn();
const mockPipeline = vi.fn();
const mockGet = vi.fn();

vi.mock('ioredis', () => ({
  Redis: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    ping: mockPing,
    quit: mockQuit,
    pipeline: mockPipeline,
    get: mockGet,
  })),
  Cluster: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    ping: mockPing,
    disconnect: mockDisconnect,
    pipeline: mockPipeline,
    get: mockGet,
  })),
}));

const base: Record<string, string | undefined> = {
  NODE_ENV: 'test',
  DB_HOST: 'h',
  DB_NAME: 'n',
  DB_USER: 'u',
  DB_PASSWORD: 'p',
  CORS_ALLOWED_ORIGINS: 'http://localhost',
  REDIS_HOST: '127.0.0.1',
  REDIS_PORT: '6379',
};

describe('redis connectors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
    mockPing.mockResolvedValue('PONG');
    mockQuit.mockResolvedValue('OK');
    mockPipeline.mockReturnValue({
      incrby: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    });
    mockGet.mockResolvedValue(null);
  });

  it('local mode stub connects and healthChecks', async () => {
    const config = loadConfig({
      ...base,
      REDIS_MODE: 'local',
    } as NodeJS.ProcessEnv);
    const r = buildRedisConnector(config);
    await r.connect();
    expect(await r.healthCheck()).toBe('connected');
    await r.teardown();
    const p = r.pipeline() as { exec: () => Promise<unknown> };
    await p.exec();
    expect(await r.get('k')).toBeNull();
  });

  it('standalone connect ping teardown', async () => {
    const config = loadConfig({
      ...base,
      REDIS_MODE: 'hybrid',
      REDIS_TOPOLOGY: 'standalone',
    } as NodeJS.ProcessEnv);
    const s = createStandaloneClient(config);
    await s.connect();
    expect(mockConnect).toHaveBeenCalled();
    expect(await s.healthCheck()).toBe('connected');
    mockPing.mockResolvedValueOnce('x');
    expect(await s.healthCheck()).toBe('degraded');
    mockPing.mockRejectedValueOnce(new Error('e'));
    expect(await s.healthCheck()).toBe('degraded');
    mockGet.mockResolvedValueOnce('hello');
    expect(await s.get('key')).toBe('hello');
    const pl = s.pipeline() as { exec: () => Promise<unknown> };
    await pl.exec();
    await s.teardown();
    expect(mockQuit).toHaveBeenCalled();
  });

  it('cluster connect ping teardown', async () => {
    const config = loadConfig({
      ...base,
      REDIS_MODE: 'hybrid',
      REDIS_TOPOLOGY: 'cluster',
      REDIS_CLUSTER_NODES_RAW: JSON.stringify([{ host: '127.0.0.1', port: 7000 }]),
    } as NodeJS.ProcessEnv);
    const c = createClusterClient(config);
    await c.connect();
    expect(await c.healthCheck()).toBe('connected');
    mockGet.mockResolvedValueOnce('v');
    expect(await c.get('k')).toBe('v');
    const p = c.pipeline() as { exec: () => Promise<unknown> };
    await p.exec();
    mockPing.mockRejectedValueOnce(new Error('e'));
    expect(await c.healthCheck()).toBe('degraded');
    await c.teardown();
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it('buildRedisConnector delegates to standalone when not local', async () => {
    const config = loadConfig({
      ...base,
      REDIS_MODE: 'redis-primary',
      REDIS_TOPOLOGY: 'standalone',
    } as NodeJS.ProcessEnv);
    const r = buildRedisConnector(config);
    await r.connect();
    await r.healthCheck();
    await r.teardown();
  });
});
