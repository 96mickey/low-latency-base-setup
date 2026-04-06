import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';

import { createNewIpLimiter } from '../../../../src/middleware/rateLimit/newIpLimiter.js';
import { loadConfig } from '../../../../src/config/index.js';

const base: Record<string, string | undefined> = {
  NODE_ENV: 'test',
  DB_HOST: 'h',
  DB_NAME: 'n',
  DB_USER: 'u',
  DB_PASSWORD: 'p',
  CORS_ALLOWED_ORIGINS: 'http://localhost',
  RL_NEW_IP_RATE_MAX: '2',
};

describe('createNewIpLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows returning IPs without counting', () => {
    const lim = createNewIpLimiter(loadConfig(base as NodeJS.ProcessEnv));
    expect(lim.checkAndRecord('1.1.1.1', true)).toBe(true);
    expect(lim.checkAndRecord('1.1.1.1', true)).toBe(true);
  });

  it('caps new IPs per second window', () => {
    const lim = createNewIpLimiter(loadConfig(base as NodeJS.ProcessEnv));
    expect(lim.checkAndRecord('2.2.2.1', false)).toBe(true);
    expect(lim.checkAndRecord('2.2.2.2', false)).toBe(true);
    expect(lim.checkAndRecord('2.2.2.3', false)).toBe(false);
  });

  it('resets window on new second', () => {
    const lim = createNewIpLimiter(loadConfig(base as NodeJS.ProcessEnv));
    expect(lim.checkAndRecord('3.3.3.1', false)).toBe(true);
    expect(lim.checkAndRecord('3.3.3.2', false)).toBe(true);
    vi.setSystemTime(new Date('2026-01-01T00:00:01Z'));
    expect(lim.checkAndRecord('3.3.3.3', false)).toBe(true);
  });

  it('same IP only consumes cap when first seen as new (matches hasIp → consumeToken order)', () => {
    const lim = createNewIpLimiter(loadConfig(base as NodeJS.ProcessEnv));
    expect(lim.checkAndRecord('4.4.4.4', false)).toBe(true);
    expect(lim.checkAndRecord('4.4.4.4', true)).toBe(true);
    expect(lim.checkAndRecord('5.5.5.5', false)).toBe(true);
    expect(lim.checkAndRecord('6.6.6.6', false)).toBe(false);
  });
});
