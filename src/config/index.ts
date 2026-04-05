/**
 * Central configuration from environment variables.
 * Validates with Zod, applies cross-field Redis rules, and maps to the typed `Config`.
 * Use `loadConfigFromProcessEnv()` at runtime; tests call `loadConfig(partialEnv)`.
 */

import { z } from 'zod';

import type { Config, RedisMode, RedisTopology } from '../types/index.js';

const logLevelEnum = z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);

const redisModeEnum = z.enum(['local', 'hybrid', 'redis-primary']);
const redisTopologyEnum = z.enum(['standalone', 'cluster']);

function boolFromEnv(val: unknown, defaultVal: boolean): boolean {
  if (val === undefined || val === '') return defaultVal;
  const s = String(val).toLowerCase();
  if (s === 'true' || s === '1') return true;
  if (s === 'false' || s === '0') return false;
  return defaultVal;
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  PORT: z.coerce.number().int().min(1).max(65535)
    .default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),
  METRICS_PORT: z.coerce.number().int().min(1).max(65535)
    .default(9090),
  SHUTDOWN_GRACE_MS: z.coerce.number().int().positive().default(30_000),
  LOG_LEVEL: logLevelEnum.optional(),
  DB_HOST: z.string().min(1, 'Required'),
  DB_PORT: z.coerce.number().int().min(1).max(65535)
    .default(5432),
  DB_NAME: z.string().min(1, 'Required'),
  DB_USER: z.string().min(1, 'Required'),
  DB_PASSWORD: z.string().min(1, 'Required'),
  DB_SSL: z.preprocess((v) => boolFromEnv(v, false), z.boolean()),
  DB_POOL_MIN: z.coerce.number().int().min(0).default(2),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  DB_CONNECT_MAX_RETRIES: z.coerce.number().int().min(0).default(5),
  DB_CONNECT_RETRY_BASE_MS: z.coerce.number().int().positive().default(500),
  REDIS_MODE: redisModeEnum.default('local'),
  REDIS_TOPOLOGY: redisTopologyEnum.default('standalone'),
  REDIS_HOST: z.string().optional(),
  REDIS_PORT: z.coerce.number().int().min(1).max(65535)
    .default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.coerce.number().int().min(0).default(0),
  REDIS_CLUSTER_NODES_RAW: z.string().optional(),
  REDIS_SYNC_INTERVAL_MS: z.coerce.number().int().positive().default(10_000),
  RATE_LIMIT_DISABLED: z.preprocess((v) => boolFromEnv(v, false), z.boolean()),
  RATE_LIMIT_BYPASS_CIDRS: z.string().optional(),
  RL_IP_MAX_TOKENS: z.coerce.number().int().positive().default(100),
  RL_IP_REFILL_RATE: z.coerce.number().positive().default(10),
  RL_MAX_IPS: z.coerce.number().int().positive().default(500_000),
  RL_NEW_IP_RATE_MAX: z.coerce.number().int().positive().default(1000),
  LATENCY_CB_DELTA_MS: z.coerce.number().int().positive().default(5),
  LATENCY_CB_WINDOW_SIZE: z.coerce.number().int().positive().default(10_000),
  LATENCY_CB_CHECK_INTERVAL_MS: z.coerce.number().int().positive().default(100),
  LATENCY_CB_RECOVERY_MS: z.coerce.number().int().positive().default(5000),
  LATENCY_CB_WARMUP_MS: z.coerce.number().int().positive().default(30_000),
  CORS_ALLOWED_ORIGINS: z.string().min(1, 'Required'),
  BODY_SIZE_LIMIT: z.string().min(1).default('100kb'),
  TRUSTED_PROXY_DEPTH: z.coerce.number().int().min(0).default(2),
}).superRefine((data, ctx) => {
  const mode = data.REDIS_MODE as RedisMode;
  const topo = data.REDIS_TOPOLOGY as RedisTopology;

  if (mode !== 'local' && topo === 'standalone') {
    if (data.REDIS_HOST === undefined || data.REDIS_HOST.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'REDIS_HOST: Required when REDIS_MODE is not local and REDIS_TOPOLOGY is standalone',
        path: ['REDIS_HOST'],
      });
    }
  }

  if (mode !== 'local' && topo === 'cluster') {
    const raw = data.REDIS_CLUSTER_NODES_RAW;
    if (raw === undefined || raw.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'REDIS_CLUSTER_NODES: Required when REDIS_TOPOLOGY is cluster and REDIS_MODE is not local',
        path: ['REDIS_CLUSTER_NODES'],
      });
    } else {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed) || parsed.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'REDIS_CLUSTER_NODES: Must be a non-empty JSON array',
            path: ['REDIS_CLUSTER_NODES'],
          });
        } else {
          for (let i = 0; i < parsed.length; i += 1) {
            const n = parsed[i] as { host?: string; port?: number };
            if (typeof n?.host !== 'string' || typeof n?.port !== 'number') {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'REDIS_CLUSTER_NODES: Each entry must have host (string) and port (number)',
                path: ['REDIS_CLUSTER_NODES'],
              });
              break;
            }
          }
        }
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'REDIS_CLUSTER_NODES: Invalid JSON',
          path: ['REDIS_CLUSTER_NODES'],
        });
      }
    }
  }
});

function formatZodError(err: z.ZodError): string {
  const lines = err.issues.map((issue, i) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'config';
    return `  ${i + 1}. ${path}: ${issue.message}`;
  });
  return `Configuration errors — fix these env vars before starting:\n${lines.join('\n')}`;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(formatZodError(parsed.error));
  }
  const d = parsed.data;
  const logLevel = d.LOG_LEVEL ?? (d.NODE_ENV === 'development' ? 'debug' : 'info');

  let redisClusterNodes: Array<{ host: string; port: number }> | undefined;
  if (d.REDIS_CLUSTER_NODES_RAW && d.REDIS_CLUSTER_NODES_RAW.trim().length > 0) {
    try {
      redisClusterNodes = JSON.parse(d.REDIS_CLUSTER_NODES_RAW) as Array<{
        host: string;
        port: number;
      }>;
    } catch {
      /* superRefine already validated */
    }
  }

  const config: Config = {
    NODE_ENV: d.NODE_ENV,
    PORT: d.PORT,
    HOST: d.HOST,
    METRICS_PORT: d.METRICS_PORT,
    SHUTDOWN_GRACE_MS: d.SHUTDOWN_GRACE_MS,
    LOG_LEVEL: logLevel,
    DB_HOST: d.DB_HOST,
    DB_PORT: d.DB_PORT,
    DB_NAME: d.DB_NAME,
    DB_USER: d.DB_USER,
    DB_PASSWORD: d.DB_PASSWORD,
    DB_SSL: d.DB_SSL,
    DB_POOL_MIN: d.DB_POOL_MIN,
    DB_POOL_MAX: d.DB_POOL_MAX,
    DB_CONNECT_MAX_RETRIES: d.DB_CONNECT_MAX_RETRIES,
    DB_CONNECT_RETRY_BASE_MS: d.DB_CONNECT_RETRY_BASE_MS,
    REDIS_MODE: d.REDIS_MODE as RedisMode,
    REDIS_TOPOLOGY: d.REDIS_TOPOLOGY as RedisTopology,
    REDIS_HOST: d.REDIS_HOST,
    REDIS_PORT: d.REDIS_PORT,
    REDIS_PASSWORD: d.REDIS_PASSWORD,
    REDIS_DB: d.REDIS_DB,
    REDIS_CLUSTER_NODES: redisClusterNodes,
    REDIS_SYNC_INTERVAL_MS: d.REDIS_SYNC_INTERVAL_MS,
    RATE_LIMIT_DISABLED: d.RATE_LIMIT_DISABLED,
    RATE_LIMIT_BYPASS_CIDRS: d.RATE_LIMIT_BYPASS_CIDRS,
    RL_IP_MAX_TOKENS: d.RL_IP_MAX_TOKENS,
    RL_IP_REFILL_RATE: d.RL_IP_REFILL_RATE,
    RL_MAX_IPS: d.RL_MAX_IPS,
    RL_NEW_IP_RATE_MAX: d.RL_NEW_IP_RATE_MAX,
    LATENCY_CB_DELTA_MS: d.LATENCY_CB_DELTA_MS,
    LATENCY_CB_WINDOW_SIZE: d.LATENCY_CB_WINDOW_SIZE,
    LATENCY_CB_CHECK_INTERVAL_MS: d.LATENCY_CB_CHECK_INTERVAL_MS,
    LATENCY_CB_RECOVERY_MS: d.LATENCY_CB_RECOVERY_MS,
    LATENCY_CB_WARMUP_MS: d.LATENCY_CB_WARMUP_MS,
    CORS_ALLOWED_ORIGINS: d.CORS_ALLOWED_ORIGINS,
    BODY_SIZE_LIMIT: d.BODY_SIZE_LIMIT,
    TRUSTED_PROXY_DEPTH: d.TRUSTED_PROXY_DEPTH,
  };

  return config;
}

/** Map process.env REDIS_CLUSTER_NODES to internal raw field for Zod */
export function envWithRedisClusterNodes(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { REDIS_CLUSTER_NODES, ...rest } = env;
  return {
    ...rest,
    REDIS_CLUSTER_NODES_RAW: REDIS_CLUSTER_NODES,
  };
}

export function loadConfigFromProcessEnv(): Config {
  return loadConfig(envWithRedisClusterNodes(process.env));
}
