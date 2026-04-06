import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';

import { createLatencyCircuitBreaker } from '../../../../src/middleware/rateLimit/latencyCircuitBreaker.js';
import { loadConfig } from '../../../../src/config/index.js';

const base: Record<string, string | undefined> = {
  NODE_ENV: 'test',
  DB_HOST: 'h',
  DB_NAME: 'n',
  DB_USER: 'u',
  DB_PASSWORD: 'p',
  CORS_ALLOWED_ORIGINS: 'http://localhost',
  LATENCY_CB_CHECK_INTERVAL_MS: '10',
  LATENCY_CB_WARMUP_MS: '1',
  LATENCY_CB_DELTA_MS: '1',
  LATENCY_CB_RECOVERY_MS: '50',
};

describe('createLatencyCircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts CLOSED and allows requests', () => {
    const cb = createLatencyCircuitBreaker(loadConfig(base as NodeJS.ProcessEnv));
    expect(cb.getState()).toBe('CLOSED');
    expect(cb.allowRequest()).toBe(true);
  });

  it('opens after high latency in a later check interval (per-interval p99 vs EMA)', async () => {
    const cb = createLatencyCircuitBreaker(loadConfig(base as NodeJS.ProcessEnv));
    cb.start();

    for (let i = 0; i < 15; i += 1) {
      cb.recordLatency(1);
    }
    await vi.advanceTimersByTimeAsync(15);
    expect(cb.getState()).toBe('CLOSED');

    for (let i = 0; i < 15; i += 1) {
      cb.recordLatency(500);
    }
    await vi.advanceTimersByTimeAsync(15);
    expect(cb.getState()).toBe('OPEN');
    cb.stop();
  });

  it('OPEN denies allowRequest', async () => {
    const cb = createLatencyCircuitBreaker(loadConfig({
      ...base,
      LATENCY_CB_RECOVERY_MS: '100000',
    } as NodeJS.ProcessEnv));
    cb.start();
    for (let i = 0; i < 15; i += 1) {
      cb.recordLatency(1);
    }
    await vi.advanceTimersByTimeAsync(15);
    for (let i = 0; i < 15; i += 1) {
      cb.recordLatency(500);
    }
    await vi.advanceTimersByTimeAsync(15);
    expect(cb.getState()).toBe('OPEN');
    expect(cb.allowRequest()).toBe(false);
    cb.stop();
  });

  it('start stop is idempotent', () => {
    const cb = createLatencyCircuitBreaker(loadConfig(base as NodeJS.ProcessEnv));
    cb.start();
    cb.start();
    cb.stop();
    cb.stop();
  });

  it('recovers from HALF_OPEN to CLOSED after successful probes', async () => {
    const cb = createLatencyCircuitBreaker(loadConfig({
      ...base,
      LATENCY_CB_RECOVERY_MS: '20',
      LATENCY_CB_CHECK_INTERVAL_MS: '10',
      LATENCY_CB_WARMUP_MS: '1',
    } as NodeJS.ProcessEnv));
    cb.start();

    for (let i = 0; i < 15; i += 1) {
      cb.recordLatency(2);
    }
    await vi.advanceTimersByTimeAsync(15);

    for (let i = 0; i < 15; i += 1) {
      cb.recordLatency(800);
    }
    await vi.advanceTimersByTimeAsync(15);
    expect(cb.getState()).toBe('OPEN');

    await vi.advanceTimersByTimeAsync(25);
    expect(cb.getState()).toBe('HALF_OPEN');

    cb.onRequestCompleted(5);
    cb.onRequestCompleted(5);
    cb.onRequestCompleted(5);
    expect(cb.getState()).toBe('CLOSED');
    cb.stop();
  });

  it('HALF_OPEN reopens OPEN on failed probe', async () => {
    const cb = createLatencyCircuitBreaker(loadConfig({
      ...base,
      LATENCY_CB_RECOVERY_MS: '20',
      LATENCY_CB_CHECK_INTERVAL_MS: '10',
      LATENCY_CB_WARMUP_MS: '1',
    } as NodeJS.ProcessEnv));
    cb.start();

    for (let i = 0; i < 15; i += 1) {
      cb.recordLatency(2);
    }
    await vi.advanceTimersByTimeAsync(15);
    for (let i = 0; i < 15; i += 1) {
      cb.recordLatency(800);
    }
    await vi.advanceTimersByTimeAsync(15);
    await vi.advanceTimersByTimeAsync(25);
    expect(cb.getState()).toBe('HALF_OPEN');

    cb.onRequestCompleted(99_999);
    expect(cb.getState()).toBe('OPEN');
    cb.stop();
  });

  it('does not evaluate p99 during warmup', async () => {
    const cb = createLatencyCircuitBreaker(loadConfig({
      ...base,
      LATENCY_CB_WARMUP_MS: '10000',
      LATENCY_CB_CHECK_INTERVAL_MS: '5',
    } as NodeJS.ProcessEnv));
    cb.start();
    for (let i = 0; i < 15; i += 1) {
      cb.recordLatency(1);
    }
    for (let i = 0; i < 15; i += 1) {
      cb.recordLatency(900);
    }
    await vi.advanceTimersByTimeAsync(20);
    expect(cb.getState()).toBe('CLOSED');
    cb.stop();
  });

  it('recordLatency clamps non-finite values', () => {
    const cb = createLatencyCircuitBreaker(loadConfig(base as NodeJS.ProcessEnv));
    expect(() => {
      cb.recordLatency(Number.NaN);
      cb.recordLatency(Number.POSITIVE_INFINITY);
    }).not.toThrow();
  });

  it('tick does nothing when no samples in interval', async () => {
    const cb = createLatencyCircuitBreaker(loadConfig(base as NodeJS.ProcessEnv));
    cb.start();
    await vi.advanceTimersByTimeAsync(40);
    expect(cb.getState()).toBe('CLOSED');
    cb.stop();
  });

  it('allows requests in HALF_OPEN', async () => {
    const cb = createLatencyCircuitBreaker(loadConfig({
      ...base,
      LATENCY_CB_RECOVERY_MS: '20',
      LATENCY_CB_CHECK_INTERVAL_MS: '10',
      LATENCY_CB_WARMUP_MS: '1',
    } as NodeJS.ProcessEnv));
    cb.start();
    for (let i = 0; i < 15; i += 1) {
      cb.recordLatency(2);
    }
    await vi.advanceTimersByTimeAsync(15);
    for (let i = 0; i < 15; i += 1) {
      cb.recordLatency(800);
    }
    await vi.advanceTimersByTimeAsync(15);
    expect(cb.getState()).toBe('OPEN');
    await vi.advanceTimersByTimeAsync(25);
    expect(cb.getState()).toBe('HALF_OPEN');
    expect(cb.allowRequest()).toBe(true);
    cb.stop();
  });

  it('skips recordLatency when OPEN', async () => {
    const cb = createLatencyCircuitBreaker(loadConfig({
      ...base,
      LATENCY_CB_RECOVERY_MS: '999999',
    } as NodeJS.ProcessEnv));
    cb.start();
    for (let i = 0; i < 15; i += 1) {
      cb.recordLatency(1);
    }
    await vi.advanceTimersByTimeAsync(15);
    for (let i = 0; i < 15; i += 1) {
      cb.recordLatency(500);
    }
    await vi.advanceTimersByTimeAsync(15);
    expect(cb.getState()).toBe('OPEN');
    cb.recordLatency(1);
    cb.stop();
  });
});
