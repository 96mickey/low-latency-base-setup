import { describe, it, expect } from 'vitest';

import { envWithRedisClusterNodes, loadConfig } from '../../src/config/index.js';

const base: Record<string, string | undefined> = {
  NODE_ENV: 'test',
  DB_HOST: 'localhost',
  DB_NAME: 'db',
  DB_USER: 'u',
  DB_PASSWORD: 'p',
  CORS_ALLOWED_ORIGINS: 'http://localhost',
};

describe('loadConfig', () => {
  it('returns typed config when valid', () => {
    const c = loadConfig(base as NodeJS.ProcessEnv);
    expect(c.PORT).toBe(3000);
    expect(c.REDIS_MODE).toBe('local');
  });

  it('lists multiple missing required vars', () => {
    expect(() => loadConfig({ CORS_ALLOWED_ORIGINS: 'http://x' })).toThrow(/DB_HOST/);
    try {
      loadConfig({ CORS_ALLOWED_ORIGINS: 'http://x' });
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toMatch(/DB_HOST/);
      expect(msg).toMatch(/DB_NAME/);
    }
  });

  it('requires REDIS_HOST for hybrid standalone', () => {
    expect(() => loadConfig({
      ...base,
      REDIS_MODE: 'hybrid',
      REDIS_TOPOLOGY: 'standalone',
      REDIS_HOST: '',
    } as NodeJS.ProcessEnv)).toThrow(/REDIS_HOST/);
  });

  it('does not require REDIS_HOST for local mode', () => {
    const c = loadConfig({
      ...base,
      REDIS_MODE: 'local',
    } as NodeJS.ProcessEnv);
    expect(c.REDIS_HOST).toBeUndefined();
  });

  it('parses cluster nodes from REDIS_CLUSTER_NODES_RAW', () => {
    const c = loadConfig({
      ...base,
      REDIS_MODE: 'hybrid',
      REDIS_TOPOLOGY: 'cluster',
      REDIS_CLUSTER_NODES_RAW: JSON.stringify([{ host: '10.0.0.1', port: 6379 }]),
    } as NodeJS.ProcessEnv);
    expect(c.REDIS_CLUSTER_NODES).toEqual([{ host: '10.0.0.1', port: 6379 }]);
  });

  it('rejects invalid REDIS_CLUSTER_NODES JSON in refine', () => {
    expect(() => loadConfig({
      ...base,
      REDIS_MODE: 'hybrid',
      REDIS_TOPOLOGY: 'cluster',
      REDIS_CLUSTER_NODES_RAW: 'not-json',
    } as NodeJS.ProcessEnv)).toThrow(/REDIS_CLUSTER_NODES/);
  });

  it('envWithRedisClusterNodes maps REDIS_CLUSTER_NODES', () => {
    const mapped = envWithRedisClusterNodes({
      REDIS_CLUSTER_NODES: '[{"host":"h","port":1}]',
      PATH: '/usr/bin',
    } as NodeJS.ProcessEnv);
    expect(mapped.REDIS_CLUSTER_NODES_RAW).toBe('[{"host":"h","port":1}]');
    expect(mapped.REDIS_CLUSTER_NODES).toBeUndefined();
  });
});
