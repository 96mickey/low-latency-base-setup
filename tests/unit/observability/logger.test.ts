import { describe, it, expect } from 'vitest';

import { buildLogger } from '../../../src/observability/logger/index.js';
import { loadConfig } from '../../../src/config/index.js';

const base: Record<string, string | undefined> = {
  NODE_ENV: 'test',
  DB_HOST: 'h',
  DB_NAME: 'n',
  DB_USER: 'u',
  DB_PASSWORD: 'p',
  CORS_ALLOWED_ORIGINS: 'http://localhost',
};

describe('buildLogger', () => {
  it('adds pino-pretty transport in development', () => {
    const c = loadConfig({ ...base, NODE_ENV: 'development' } as NodeJS.ProcessEnv);
    const opts = buildLogger(c);
    expect(opts.transport).toBeDefined();
    expect(opts.transport).toMatchObject({ target: 'pino-pretty' });
  });

  it('returns JSON config in production', () => {
    const c = loadConfig({ ...base, NODE_ENV: 'production' } as NodeJS.ProcessEnv);
    const opts = buildLogger(c);
    expect(opts.transport).toBeUndefined();
    expect(opts.redact).toBeDefined();
  });
});
