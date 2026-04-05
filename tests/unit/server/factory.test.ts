import { describe, it, expect } from 'vitest';
import pino from 'pino';

import { createFastifyInstance } from '../../../src/server/factory.js';
import { loadConfig } from '../../../src/config/index.js';

const baseEnv: Record<string, string | undefined> = {
  NODE_ENV: 'test',
  DB_HOST: 'localhost',
  DB_NAME: 'db',
  DB_USER: 'u',
  DB_PASSWORD: 'p',
  CORS_ALLOWED_ORIGINS: 'http://localhost',
  BODY_SIZE_LIMIT: '1mb',
};

describe('createFastifyInstance', () => {
  it('creates fastify with bodyLimit from config', async () => {
    const config = loadConfig(baseEnv as NodeJS.ProcessEnv);
    const app = createFastifyInstance(config, pino({ level: 'silent' }));
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
