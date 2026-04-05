import { describe, it, expect } from 'vitest';

import { loadConfig } from '../../../src/config/index.js';
import { createMetricsServer } from '../../../src/server/metricsServer.js';

const base: Record<string, string | undefined> = {
  NODE_ENV: 'test',
  DB_HOST: 'h',
  DB_NAME: 'n',
  DB_USER: 'u',
  DB_PASSWORD: 'p',
  CORS_ALLOWED_ORIGINS: 'http://localhost',
  METRICS_PORT: '9098',
};

describe('createMetricsServer', () => {
  it('sets pool gauges when reader provided', async () => {
    const config = loadConfig(base as NodeJS.ProcessEnv);
    const app = await createMetricsServer(config, () => ({ active: 3, idle: 2 }));
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('db_pool_connections_active');
    await app.close();
  });
});
