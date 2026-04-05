/**
 * Builds the main Fastify server with trust proxy, JSON body size cap, and an injected Pino logger.
 * Fastify v5 expects a logger *instance* as `loggerInstance`, not raw pino options.
 */

import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';

import { parseBodyLimitBytes } from '../lib/parseBodyLimit.js';
import type { Config } from '../types/index.js';

export function createFastifyInstance(
  config: Config,
  logger: FastifyBaseLogger,
): FastifyInstance {
  return Fastify({
    loggerInstance: logger,
    trustProxy: true,
    bodyLimit: parseBodyLimitBytes(config.BODY_SIZE_LIMIT),
  });
}
