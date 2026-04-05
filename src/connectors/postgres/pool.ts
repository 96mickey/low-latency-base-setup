import { Pool } from 'pg';

import type { Config } from '../../types/index.js';

export function createPool(config: Config): Pool {
  return new Pool({
    host: config.DB_HOST,
    port: config.DB_PORT,
    database: config.DB_NAME,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    ssl: config.DB_SSL ? { rejectUnauthorized: true } : false,
    min: config.DB_POOL_MIN,
    max: config.DB_POOL_MAX,
    connectionTimeoutMillis: 5000,
  });
}
