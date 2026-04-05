import { describe, it, expect } from 'vitest';

import { createPool } from '../../../src/connectors/postgres/pool.js';
import { loadConfig } from '../../../src/config/index.js';

const base: Record<string, string | undefined> = {
  NODE_ENV: 'test',
  DB_HOST: 'db.example',
  DB_PORT: '5432',
  DB_NAME: 'n',
  DB_USER: 'u',
  DB_PASSWORD: 'p',
  DB_SSL: 'true',
  DB_POOL_MIN: '1',
  DB_POOL_MAX: '5',
  CORS_ALLOWED_ORIGINS: 'http://localhost',
};

describe('createPool', () => {
  it('builds pg Pool from config', async () => {
    const config = loadConfig(base as NodeJS.ProcessEnv);
    const pool = createPool(config);
    expect((pool as unknown as { options: { host: string; ssl: unknown } }).options.host).toBe(
      'db.example',
    );
    expect((pool as unknown as { options: { ssl: unknown } }).options.ssl).toEqual({
      rejectUnauthorized: true,
    });
    await pool.end();
  });
});
