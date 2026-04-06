/**
 * Instance-wide protection: rejects traffic when recent latency p99 spikes vs an EMA baseline.
 * Uses HDR Histogram for O(1) `recordValue` / `getValueAtPercentile` — no per-tick sort/alloc.
 *
 * Semantics: p99 is computed over latencies recorded **since the previous tick** (each tick
 * reads then `reset()`). `LATENCY_CB_CHECK_INTERVAL_MS` defines that window;
 * `LATENCY_CB_WINDOW_SIZE` is kept in config for compatibility but is **not** used here.
 */

import { build } from 'hdr-histogram-js';

import type { Config, CircuitBreakerState } from '../../types/index.js';

/** Need enough samples in the interval before OPEN is allowed (matches prior ring behaviour). */
const MIN_SAMPLES_BEFORE_OPEN = 11;

/** Upper bound for request duration in ms (HDR requires a finite trackable max). */
const HISTOGRAM_MAX_LATENCY_MS = 3_600_000;

export type LatencyCircuitBreaker = {
  getState: () => CircuitBreakerState;
  recordLatency: (ms: number) => void;
  start: () => void;
  stop: () => void;
  allowRequest: () => boolean;
  onRequestCompleted: (ms: number) => void;
};

export function createLatencyCircuitBreaker(config: Config): LatencyCircuitBreaker {
  const histogram = build({
    highestTrackableValue: HISTOGRAM_MAX_LATENCY_MS,
    lowestDiscernibleValue: 1,
    numberOfSignificantValueDigits: 2,
    useWebAssembly: false,
  });

  let state: CircuitBreakerState = 'CLOSED';
  let openedAt = 0;
  let emaP99 = 0;
  const boot = Date.now();
  let timer: ReturnType<typeof setInterval> | null = null;
  let halfOpenProbesOk = 0;

  function recordMs(ms: number): void {
    const clamped = Number.isFinite(ms)
      ? Math.min(Math.max(ms, 0), HISTOGRAM_MAX_LATENCY_MS)
      : 0;
    const v = Math.round(clamped);
    if (v < 1) {
      histogram.recordValue(1);
    } else {
      histogram.recordValue(v);
    }
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

    const n = histogram.totalCount;
    if (n === 0) {
      return;
    }

    const p99 = histogram.getValueAtPercentile(99);
    histogram.reset();

    if (emaP99 === 0) {
      emaP99 = p99;
    } else {
      emaP99 = 0.2 * p99 + 0.8 * emaP99;
    }

    if (p99 > emaP99 + config.LATENCY_CB_DELTA_MS && n >= MIN_SAMPLES_BEFORE_OPEN) {
      state = 'OPEN';
      openedAt = now;
    }
  }

  return {
    getState: () => state,

    recordLatency(ms: number) {
      if (state === 'OPEN') return;
      recordMs(ms);
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
