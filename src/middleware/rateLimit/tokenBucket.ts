import type { Config, RateLimitBucketEntry } from '../../types/index.js';
import { LruMap } from '../../helpers/lruMap.js';

export type TokenBucket = {
  consumeToken: (ip: string) => { allowed: boolean; retryAfterSecs: number };
  drainDeltas: () => Map<string, number>;
  hasIp: (ip: string) => boolean;
  startSweep: () => void;
  stopSweep: () => void;
};

const SWEEP_MS = 60_000;
const STALE_MS = 3_600_000;

export function createTokenBucket(config: Config): TokenBucket {
  const lru = new LruMap<string, RateLimitBucketEntry>(config.RL_MAX_IPS);
  let sweepTimer: ReturnType<typeof setInterval> | null = null;

  function sweep() {
    const now = Date.now();
    lru.forEachEntry((ip, entry) => {
      if (now - entry.lastRefillMs > STALE_MS) {
        lru.delete(ip);
      }
    });
  }

  return {
    hasIp(ip: string) {
      return lru.has(ip);
    },

    consumeToken(ip: string) {
      const now = Date.now();
      let entry = lru.get(ip);
      if (entry === undefined) {
        entry = {
          tokens: config.RL_IP_MAX_TOKENS,
          lastRefillMs: now,
          localDelta: 0,
        };
      }
      const elapsedSec = (now - entry.lastRefillMs) / 1000;
      const refill = elapsedSec * config.RL_IP_REFILL_RATE;
      entry.tokens = Math.min(config.RL_IP_MAX_TOKENS, entry.tokens + refill);
      entry.lastRefillMs = now;

      if (entry.tokens < 1) {
        const retryAfterSecs = Math.max(1, Math.ceil(1 / config.RL_IP_REFILL_RATE));
        lru.set(ip, entry);
        return { allowed: false, retryAfterSecs };
      }

      entry.tokens -= 1;
      entry.localDelta += 1;
      lru.set(ip, entry);
      return { allowed: true, retryAfterSecs: 0 };
    },

    drainDeltas() {
      const out = new Map<string, number>();
      lru.forEachEntry((ip, entry) => {
        if (entry.localDelta !== 0) {
          out.set(ip, entry.localDelta);
          entry.localDelta = 0;
        }
      });
      return out;
    },

    startSweep() {
      if (sweepTimer !== null) return;
      sweepTimer = setInterval(sweep, SWEEP_MS);
    },

    stopSweep() {
      if (sweepTimer !== null) {
        clearInterval(sweepTimer);
        sweepTimer = null;
      }
    },
  };
}
