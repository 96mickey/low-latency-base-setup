/**
 * pg `Pool` factory — tuning comes from `Config` (min/max, SSL, timeouts).
 * `idleTimeoutMillis` returns clients to the pool lifecycle so idle TCP slots drop (PgBouncer).
 * `statement_timeout` (node-pg, ms) sets PostgreSQL session timeout for each connection.
 */

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
    idleTimeoutMillis: config.DB_POOL_IDLE_TIMEOUT_MS,
    statement_timeout: config.DB_STATEMENT_TIMEOUT_MS,
  });
}
