/**
 * Shared types only — no runtime logic.
 * `Config` mirrors env after validation; extend here when adding new settings.
 */

export type RedisMode = 'local' | 'hybrid' | 'redis-primary';

export type RedisTopology = 'standalone' | 'cluster';

export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/** Fully validated application configuration (see `config/index.ts`). */
export interface Config {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  HOST: string;
  METRICS_PORT: number;
  SHUTDOWN_GRACE_MS: number;
  LOG_LEVEL: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  DB_HOST: string;
  DB_PORT: number;
  DB_NAME: string;
  DB_USER: string;
  DB_PASSWORD: string;
  DB_SSL: boolean;
  DB_POOL_MIN: number;
  DB_POOL_MAX: number;
  DB_CONNECT_MAX_RETRIES: number;
  DB_CONNECT_RETRY_BASE_MS: number;
  REDIS_MODE: RedisMode;
  REDIS_TOPOLOGY: RedisTopology;
  REDIS_HOST?: string;
  REDIS_PORT: number;
  REDIS_PASSWORD?: string;
  REDIS_DB: number;
  REDIS_CLUSTER_NODES?: Array<{ host: string; port: number }>;
  REDIS_SYNC_INTERVAL_MS: number;
  RATE_LIMIT_DISABLED: boolean;
  RATE_LIMIT_BYPASS_CIDRS?: string;
  RL_IP_MAX_TOKENS: number;
  RL_IP_REFILL_RATE: number;
  RL_MAX_IPS: number;
  RL_NEW_IP_RATE_MAX: number;
  LATENCY_CB_DELTA_MS: number;
  LATENCY_CB_WINDOW_SIZE: number;
  LATENCY_CB_CHECK_INTERVAL_MS: number;
  LATENCY_CB_RECOVERY_MS: number;
  LATENCY_CB_WARMUP_MS: number;
  CORS_ALLOWED_ORIGINS: string;
  BODY_SIZE_LIMIT: string;
  TRUSTED_PROXY_DEPTH: number;
}

export interface ConnectorInterface {
  connect(): Promise<void>;
  healthCheck(): Promise<string>;
  teardown(): Promise<void>;
}

export interface RedisClientInterface extends ConnectorInterface {
  healthCheck(): Promise<'connected' | 'degraded'>;
  pipeline(): unknown;
  get(key: string): Promise<string | null>;
}

export interface RateLimitBucketEntry {
  tokens: number;
  lastRefillMs: number;
  localDelta: number;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  uptime: number;
  db: 'connected' | 'disconnected';
  redis: 'connected' | 'degraded';
  timestamp: string;
}

export interface StandardErrorResponse {
  error: {
    code: string;
    message: string;
    statusCode: number;
    correlationId: string;
  };
}

export interface RetryOptions {
  maxRetries: number;
  baseMs: number;
  maxMs?: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    correlationId: string;
  }
}
