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

export function createSyncTask(): SyncTask {
  let timer: ReturnType<typeof setInterval> | null = null;
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
      const pipe = activeClient.pipeline() as {
        incrby: (k: string, v: number) => unknown;
        expire: (k: string, s: number) => unknown;
        exec: () => Promise<unknown>;
      };
      for (const [ip, delta] of deltas) {
        if (delta === 0) continue;
        const key = `rl:ip:${ip}`;
        pipe.incrby(key, delta);
        pipe.expire(key, RL_BUCKET_TTL_S);
      }
      await pipe.exec();
    } catch {
      redisSyncErrorsTotal.inc();
    } finally {
      redisSyncDurationMs.observe(performance.now() - start);
    }
  }

  return {
    start(client, getDeltas, config) {
      if (config.REDIS_MODE !== 'hybrid') return;
      activeClient = client;
      activeGetDeltas = getDeltas;
      activeConfig = config;
      timer = setInterval(() => {
        runSyncTick().catch(() => {
          redisSyncErrorsTotal.inc();
        });
      }, config.REDIS_SYNC_INTERVAL_MS);
    },

    async stop() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
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
            const pipe = client.pipeline() as {
              incrby: (k: string, v: number) => unknown;
              expire: (k: string, s: number) => unknown;
              exec: () => Promise<unknown>;
            };
            for (const [ip, delta] of deltas) {
              if (delta === 0) continue;
              const key = `rl:ip:${ip}`;
              pipe.incrby(key, delta);
              pipe.expire(key, RL_BUCKET_TTL_S);
            }
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
