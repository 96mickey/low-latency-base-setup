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
    type PoolOpts = {
      host: string;
      ssl: unknown;
      idleTimeoutMillis: number;
      statement_timeout: number;
    };
    const opts = (pool as unknown as { options: PoolOpts }).options;
    expect(opts.host).toBe('db.example');
    expect(opts.ssl).toEqual({ rejectUnauthorized: true });
    expect(opts.idleTimeoutMillis).toBe(30_000);
    expect(opts.statement_timeout).toBe(60_000);
    await pool.end();
  });
});
