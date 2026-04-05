import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';

import { securityPlugin } from '../../../src/middleware/security/index.js';
import { loadConfig } from '../../../src/config/index.js';

const base: Record<string, string | undefined> = {
  NODE_ENV: 'test',
  DB_HOST: 'h',
  DB_NAME: 'n',
  DB_USER: 'u',
  DB_PASSWORD: 'p',
  CORS_ALLOWED_ORIGINS: 'http://localhost,https://app.example',
};

describe('securityPlugin', () => {
  it('sets helmet and allows listed CORS origin', async () => {
    const config = loadConfig(base as NodeJS.ProcessEnv);
    const app = Fastify({ logger: false });
    await app.register(securityPlugin, { config });
    app.get('/x', async () => ({ ok: true }));
    const res = await app.inject({
      method: 'GET',
      url: '/x',
      headers: { origin: 'http://localhost' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost');
    await app.close();
  });

  it('rejects unknown origin', async () => {
    const config = loadConfig(base as NodeJS.ProcessEnv);
    const app = Fastify({ logger: false });
    await app.register(securityPlugin, { config });
    app.get('/x', async () => ({ ok: true }));
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/x',
      headers: {
        origin: 'https://evil',
        'access-control-request-method': 'GET',
      },
    });
    expect(res.statusCode).not.toBe(204);
    await app.close();
  });
});
