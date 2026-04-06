/**
 * Postgres access: connection pool + Drizzle handle for future queries/migrations.
 * `connect()` warms `max(1, DB_POOL_MIN)` clients in parallel (retries on failure) so deploy
 * bursts do not open the rest lazily at once; `healthCheck` is used by GET /health.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';

import type { Config } from '../../types/index.js';
import { withRetry } from '../../helpers/retry.js';

import { createPool } from './pool.js';

export type PostgresConnector = {
  connect: () => Promise<void>;
  healthCheck: () => Promise<'connected' | 'disconnected'>;
  teardown: () => Promise<void>;
  pool: Pool;
  db: NodePgDatabase<Record<string, never>>;
};

export function createPostgresConnector(config: Config): PostgresConnector {
  const pool = createPool(config);
  const db = drizzle(pool);

  return {
    async connect() {
      const warmCount = Math.max(1, config.DB_POOL_MIN);
      await withRetry(
        async () => {
          await Promise.all(
            Array.from({ length: warmCount }, async () => {
              const client = await pool.connect();
              client.release();
            }),
          );
        },
        {
          maxRetries: config.DB_CONNECT_MAX_RETRIES,
          baseMs: config.DB_CONNECT_RETRY_BASE_MS,
        },
      );
    },

    async healthCheck() {
      const healthTimeoutMs = 2000;
      let tid: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<never>((_, rej) => {
          tid = setTimeout(() => rej(new Error('timeout')), healthTimeoutMs);
        });
        await Promise.race([
          pool.query('SELECT 1').finally(() => {
            if (tid !== undefined) {
              clearTimeout(tid);
            }
          }),
          timeout,
        ]);
        return 'connected';
      } catch {
        if (tid !== undefined) {
          clearTimeout(tid);
        }
        return 'disconnected';
      }
    },

    async teardown() {
      await pool.end();
    },

    pool,
    db,
  };
}
