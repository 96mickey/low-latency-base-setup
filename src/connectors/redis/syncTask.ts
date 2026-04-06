/**
 * Background job for `hybrid` mode: periodically pushes local per-IP rate-limit deltas to Redis
 * (`rl:ip:*` keys) for cross-instance approximate counts. Not on the request hot path.
 */

import type { Config } from '../../types/index.js';
import type { RedisConnector } from './index.js';

import { redisSyncDurationMs, redisSyncErrorsTotal } from '../../observability/metrics/definitions.js';
import { sleep } from '../../utils/time.js';

export type SyncTask = {
  start(
    client: RedisConnector,
    getDeltas: () => Map<string, number>,
    config: Config,
  ): void;
  stop(): Promise<void>;
};

const RL_BUCKET_TTL_S = 3600;

/**
 * Atomically INCRBY; EXPIRE only when the key was missing or 0 (new value equals delta).
 * Avoids an EXPIRE per IP on every hybrid sync when keys already exist.
 */
const RL_SYNC_INCRBY_LUA = `
local d = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local v = redis.call('INCRBY', KEYS[1], d)
if v == d then
  redis.call('EXPIRE', KEYS[1], ttl)
end
return v
`.trim();

type RlHybridPipeline = {
  eval: (script: string, numKeys: number, ...args: (string | number)[]) => unknown;
  exec: () => Promise<unknown>;
};

function appendHybridSyncEvals(pipe: RlHybridPipeline, deltas: Map<string, number>): void {
  for (const [ip, delta] of deltas) {
    if (delta === 0) continue;
    const key = `rl:ip:${ip}`;
    pipe.eval(RL_SYNC_INCRBY_LUA, 1, key, String(delta), String(RL_BUCKET_TTL_S));
  }
}

export function createSyncTask(): SyncTask {
  /** Pending next run; cleared while callback runs so `stop()` can cancel a scheduled tick. */
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let activeClient: RedisConnector | null = null;
  let activeGetDeltas: (() => Map<string, number>) | null = null;
  let activeConfig: Config | null = null;

  async function runSyncTick() {
    if (!activeClient || !activeGetDeltas || !activeConfig) return;
    const start = performance.now();
    try {
      const deltas = activeGetDeltas();
      if (deltas.size === 0) {
        redisSyncDurationMs.observe(performance.now() - start);
        return;
      }
      const pipe = activeClient.pipeline() as RlHybridPipeline;
      appendHybridSyncEvals(pipe, deltas);
      await pipe.exec();
    } catch {
      redisSyncErrorsTotal.inc();
    } finally {
      redisSyncDurationMs.observe(performance.now() - start);
    }
  }

  function scheduleNextTick() {
    const cfg = activeConfig;
    if (!activeClient || !activeGetDeltas || !cfg) return;
    timeoutId = setTimeout(() => {
      timeoutId = null;
      (async () => {
        try {
          await runSyncTick();
        } finally {
          scheduleNextTick();
        }
      })().catch(() => {
        redisSyncErrorsTotal.inc();
      });
    }, cfg.REDIS_SYNC_INTERVAL_MS);
  }

  return {
    start(client, getDeltas, config) {
      if (config.REDIS_MODE !== 'hybrid') return;
      activeClient = client;
      activeGetDeltas = getDeltas;
      activeConfig = config;
      scheduleNextTick();
    },

    async stop() {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      const client = activeClient;
      const getDeltas = activeGetDeltas;
      const config = activeConfig;
      activeClient = null;
      activeGetDeltas = null;
      activeConfig = null;
      if (!client || !getDeltas || !config || config.REDIS_MODE !== 'hybrid') {
        return;
      }
      try {
        await Promise.race([
          (async () => {
            const deltas = getDeltas();
            if (deltas.size === 0) return;
            const pipe = client.pipeline() as RlHybridPipeline;
            appendHybridSyncEvals(pipe, deltas);
            await pipe.exec();
          })(),
          sleep(2000),
        ]);
      } catch {
        /* best-effort */
      }
    },
  };
}
