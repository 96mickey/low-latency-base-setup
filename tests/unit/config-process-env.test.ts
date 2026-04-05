import {
  describe, it, expect, afterEach, vi,
} from 'vitest';

describe('loadConfigFromProcessEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reads REDIS_CLUSTER_NODES via envWithRedisClusterNodes mapping', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DB_HOST', 'h');
    vi.stubEnv('DB_NAME', 'n');
    vi.stubEnv('DB_USER', 'u');
    vi.stubEnv('DB_PASSWORD', 'p');
    vi.stubEnv('CORS_ALLOWED_ORIGINS', 'http://localhost');
    vi.stubEnv('REDIS_MODE', 'hybrid');
    vi.stubEnv('REDIS_TOPOLOGY', 'cluster');
    vi.stubEnv('REDIS_CLUSTER_NODES', JSON.stringify([{ host: '127.0.0.1', port: 6379 }]));
    const { loadConfigFromProcessEnv } = await import('../../src/config/index.js');
    const c = loadConfigFromProcessEnv();
    expect(c.REDIS_CLUSTER_NODES?.[0]?.host).toBe('127.0.0.1');
  });
});
