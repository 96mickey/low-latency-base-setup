import { describe, it, expect } from 'vitest';

import { loadConfig } from '../../src/config/index.js';
import { createMetricsServer } from '../../src/server/metricsServer.js';

const env: Record<string, string | undefined> = {
  NODE_ENV: 'test',
  DB_HOST: 'localhost',
  DB_NAME: 'db',
  DB_USER: 'u',
  DB_PASSWORD: 'p',
  CORS_ALLOWED_ORIGINS: 'http://localhost',
  METRICS_PORT: '9099',
};

describe('GET /metrics', () => {
  it('returns prometheus text', async () => {
    const config = loadConfig(env as NodeJS.ProcessEnv);
    const app = await createMetricsServer(config);
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toContain('process_cpu_user_seconds_total');
    expect(res.body).toContain('http_request_duration_ms');
    await app.close();
  });
});
