import {
  describe, it, expect, vi, afterEach,
} from 'vitest';

import { createTokenBucket } from '../../../../src/middleware/rateLimit/tokenBucket.js';
import { loadConfig } from '../../../../src/config/index.js';

const base: Record<string, string | undefined> = {
  NODE_ENV: 'test',
  DB_HOST: 'h',
  DB_NAME: 'n',
  DB_USER: 'u',
  DB_PASSWORD: 'p',
  CORS_ALLOWED_ORIGINS: 'http://localhost',
  RL_IP_MAX_TOKENS: '5',
  RL_IP_REFILL_RATE: '1',
  RL_MAX_IPS: '1000',
};

function cfg(over: Record<string, string> = {}) {
  return loadConfig({ ...base, ...over } as NodeJS.ProcessEnv);
}

describe('createTokenBucket', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows burst then denies with retryAfter', () => {
    const tb = createTokenBucket(cfg());
    for (let i = 0; i < 5; i += 1) {
      expect(tb.consumeToken('10.0.0.1').allowed).toBe(true);
    }
    const r = tb.consumeToken('10.0.0.1');
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSecs).toBeGreaterThanOrEqual(1);
  });

  it('hasIp false then true after consume', () => {
    const tb = createTokenBucket(cfg());
    expect(tb.hasIp('10.0.0.2')).toBe(false);
    tb.consumeToken('10.0.0.2');
    expect(tb.hasIp('10.0.0.2')).toBe(true);
  });

  it('drainDeltas snapshots and resets', () => {
    const tb = createTokenBucket(cfg());
    tb.consumeToken('10.0.0.3');
    const m = tb.drainDeltas();
    expect(m.get('10.0.0.3')).toBe(1);
    expect(tb.drainDeltas().size).toBe(0);
  });

  it('startSweep stopSweep are idempotent', () => {
    vi.useFakeTimers();
    const tb = createTokenBucket(cfg());
    tb.startSweep();
    tb.startSweep();
    tb.stopSweep();
    tb.stopSweep();
  });

  it('sweep evicts stale IPs', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const tb = createTokenBucket(cfg());
    tb.startSweep();
    tb.consumeToken('10.0.0.99');
    vi.advanceTimersByTime(3_700_000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(tb.hasIp('10.0.0.99')).toBe(false);
    tb.stopSweep();
  });
});
