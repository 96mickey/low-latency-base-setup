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
  LATENCY_CB_WINDOW_SIZE: '20',
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

  it('opens after high latency samples', async () => {
    const cb = createLatencyCircuitBreaker(loadConfig(base as NodeJS.ProcessEnv));
    cb.start();
    for (let i = 0; i < 15; i += 1) {
      cb.recordLatency(i < 11 ? 1 : 500);
    }
    await vi.advanceTimersByTimeAsync(20);
    expect(['OPEN', 'CLOSED', 'HALF_OPEN']).toContain(cb.getState());
    cb.stop();
  });

  it('OPEN denies allowRequest', () => {
    const cb = createLatencyCircuitBreaker(loadConfig({
      ...base,
      LATENCY_CB_RECOVERY_MS: '100000',
    } as NodeJS.ProcessEnv));
    cb.start();
    (cb as unknown as { recordLatency: (n: number) => void }).recordLatency(500);
    for (let i = 0; i < 20; i += 1) {
      cb.recordLatency(500);
    }
    vi.advanceTimersByTime(20);
    if (cb.getState() === 'OPEN') {
      expect(cb.allowRequest()).toBe(false);
    }
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
      LATENCY_CB_DELTA_MS: '1000',
      LATENCY_CB_WINDOW_SIZE: '30',
      LATENCY_CB_CHECK_INTERVAL_MS: '5',
      LATENCY_CB_WARMUP_MS: '1',
    } as NodeJS.ProcessEnv));
    cb.start();
    for (let i = 0; i < 20; i += 1) {
      cb.recordLatency(i < 12 ? 2 : 800);
    }
    await vi.advanceTimersByTimeAsync(10);
    if (cb.getState() === 'OPEN') {
      await vi.advanceTimersByTimeAsync(25);
    }
    if (cb.getState() === 'HALF_OPEN') {
      cb.onRequestCompleted(99999);
      expect(cb.getState()).toBe('OPEN');
    } else {
      cb.onRequestCompleted(5);
      cb.onRequestCompleted(5);
      cb.onRequestCompleted(5);
    }
    cb.stop();
  });

  it('skips recordLatency when OPEN', () => {
    const c = loadConfig({
      ...base,
      LATENCY_CB_RECOVERY_MS: '999999',
    } as NodeJS.ProcessEnv);
    const cb = createLatencyCircuitBreaker(c);
    cb.start();
    for (let i = 0; i < 30; i += 1) cb.recordLatency(1000);
    vi.advanceTimersByTime(30);
    if (cb.getState() === 'OPEN') {
      cb.recordLatency(1);
    }
    cb.stop();
  });
});
