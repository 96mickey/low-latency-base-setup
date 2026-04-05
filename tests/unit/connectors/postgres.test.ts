import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';

import { createPostgresConnector } from '../../../src/connectors/postgres/index.js';
import { loadConfig } from '../../../src/config/index.js';

const mockConnect = vi.fn();
const mockQuery = vi.fn();
const mockEnd = vi.fn();

vi.mock('../../../src/connectors/postgres/pool.js', () => ({
  createPool: () => ({
    connect: mockConnect,
    query: mockQuery,
    end: mockEnd,
    totalCount: 4,
    idleCount: 2,
  }),
}));

const base: Record<string, string | undefined> = {
  NODE_ENV: 'test',
  DB_HOST: 'localhost',
  DB_NAME: 'db',
  DB_USER: 'u',
  DB_PASSWORD: 'p',
  CORS_ALLOWED_ORIGINS: 'http://localhost',
  DB_CONNECT_MAX_RETRIES: '0',
  DB_CONNECT_RETRY_BASE_MS: '1',
};

describe('createPostgresConnector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue({ release: vi.fn() });
    mockQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] });
    mockEnd.mockResolvedValue(undefined);
  });

  it('connect acquires and releases a client', async () => {
    const config = loadConfig(base as NodeJS.ProcessEnv);
    const pg = createPostgresConnector(config);
    await pg.connect();
    expect(mockConnect).toHaveBeenCalled();
  });

  it('healthCheck returns connected when query succeeds', async () => {
    const config = loadConfig(base as NodeJS.ProcessEnv);
    const pg = createPostgresConnector(config);
    const h = await pg.healthCheck();
    expect(h).toBe('connected');
  });

  it('healthCheck returns disconnected on query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('down'));
    const config = loadConfig(base as NodeJS.ProcessEnv);
    const pg = createPostgresConnector(config);
    const h = await pg.healthCheck();
    expect(h).toBe('disconnected');
  });

  it('teardown ends pool', async () => {
    const config = loadConfig(base as NodeJS.ProcessEnv);
    const pg = createPostgresConnector(config);
    await pg.teardown();
    expect(mockEnd).toHaveBeenCalled();
  });
});
