import type { Config, CircuitBreakerState } from '../../types/index.js';

export type LatencyCircuitBreaker = {
  getState: () => CircuitBreakerState;
  recordLatency: (ms: number) => void;
  start: () => void;
  stop: () => void;
  allowRequest: () => boolean;
  onRequestCompleted: (ms: number) => void;
};

function percentile99(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.99) - 1);
  return sorted[idx] ?? 0;
}

export function createLatencyCircuitBreaker(config: Config): LatencyCircuitBreaker {
  const buf = new Float64Array(config.LATENCY_CB_WINDOW_SIZE);
  let idx = 0;
  let count = 0;
  let state: CircuitBreakerState = 'CLOSED';
  let openedAt = 0;
  let emaP99 = 0;
  const boot = Date.now();
  let timer: ReturnType<typeof setInterval> | null = null;
  let halfOpenProbesOk = 0;

  function sampleP99(): number {
    const n = Math.min(count, config.LATENCY_CB_WINDOW_SIZE);
    if (n === 0) return 0;
    const slice = Array.from(buf.slice(0, n));
    slice.sort((a, b) => a - b);
    return percentile99(slice);
  }

  function tick() {
    const now = Date.now();
    if (now - boot < config.LATENCY_CB_WARMUP_MS) {
      return;
    }

    if (state === 'OPEN') {
      if (now - openedAt >= config.LATENCY_CB_RECOVERY_MS) {
        state = 'HALF_OPEN';
        halfOpenProbesOk = 0;
      }
      return;
    }

    if (state === 'HALF_OPEN') {
      return;
    }

    const p99 = sampleP99();
    if (emaP99 === 0) {
      emaP99 = p99;
    } else {
      emaP99 = 0.2 * p99 + 0.8 * emaP99;
    }

    if (p99 > emaP99 + config.LATENCY_CB_DELTA_MS && count > 10) {
      state = 'OPEN';
      openedAt = now;
    }
  }

  return {
    getState: () => state,

    recordLatency(ms: number) {
      if (state === 'OPEN') return;
      buf[idx % config.LATENCY_CB_WINDOW_SIZE] = ms;
      idx += 1;
      count = Math.min(count + 1, config.LATENCY_CB_WINDOW_SIZE);
    },

    allowRequest() {
      if (state === 'CLOSED') return true;
      if (state === 'OPEN') return false;
      return true;
    },

    onRequestCompleted(ms: number) {
      if (state === 'HALF_OPEN') {
        if (ms <= emaP99 + config.LATENCY_CB_DELTA_MS) {
          halfOpenProbesOk += 1;
          if (halfOpenProbesOk >= 3) {
            state = 'CLOSED';
            halfOpenProbesOk = 0;
          }
        } else {
          state = 'OPEN';
          openedAt = Date.now();
        }
      }
    },

    start() {
      if (timer !== null) return;
      timer = setInterval(tick, config.LATENCY_CB_CHECK_INTERVAL_MS);
    },

    stop() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
