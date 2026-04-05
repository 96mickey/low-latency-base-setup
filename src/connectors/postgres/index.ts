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
      await withRetry(
        async () => {
          const client = await pool.connect();
          client.release();
        },
        {
          maxRetries: config.DB_CONNECT_MAX_RETRIES,
          baseMs: config.DB_CONNECT_RETRY_BASE_MS,
        },
      );
    },

    async healthCheck() {
      try {
        const timeout = new Promise<never>((_, rej) => {
          setTimeout(() => rej(new Error('timeout')), 2000);
        });
        await Promise.race([pool.query('SELECT 1'), timeout]);
        return 'connected';
      } catch {
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
