/**
 * Public export for the Redis connector — thin re-export of `factory.createRedisConnector`.
 */

import type { Config } from '../../types/index.js';

import { createRedisConnector, type RedisWire } from './factory.js';

export type RedisConnector = RedisWire;

export function buildRedisConnector(config: Config): RedisConnector {
  return createRedisConnector(config);
}
