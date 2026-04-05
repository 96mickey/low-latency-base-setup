/**
 * Rate limiting Fastify plugin — runs early on each request (after correlation id).
 * Order: global latency circuit breaker → new-IP flood cap → per-IP token bucket.
 * CIDR bypass and `RATE_LIMIT_DISABLED` short-circuit before any work.
 */

import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import type { Config } from '../../types/index.js';
import { compileCidrs } from '../../helpers/cidrMatcher.js';
import { extractClientIp } from '../../helpers/ipExtractor.js';
import { sendStandardError } from '../../lib/httpError.js';
import { rateLimitRejectedTotal } from '../../observability/metrics/definitions.js';

import type { LatencyCircuitBreaker } from './latencyCircuitBreaker.js';
import type { NewIpLimiter } from './newIpLimiter.js';
import type { TokenBucket } from './tokenBucket.js';

export type RateLimitPluginOpts = {
  config: Config;
  tokenBucket: TokenBucket;
  newIpLimiter: NewIpLimiter;
  latencyCircuitBreaker: LatencyCircuitBreaker;
};

const plugin: FastifyPluginAsync<RateLimitPluginOpts> = async (fastify, opts) => {
  const {
    config, tokenBucket, newIpLimiter, latencyCircuitBreaker,
  } = opts;

  const bypassList = (config.RATE_LIMIT_BYPASS_CIDRS ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
  const bypassMatch = bypassList.length > 0 ? compileCidrs(bypassList) : () => false;

  fastify.addHook('onRequest', async (request, reply) => {
    const req = request as FastifyRequest & { correlationId?: string };
    const correlationId = req.correlationId ?? 'unknown';

    if (config.RATE_LIMIT_DISABLED) {
      return;
    }

    const xff = typeof request.headers['x-forwarded-for'] === 'string'
      ? request.headers['x-forwarded-for']
      : undefined;
    const ip = extractClientIp(xff, request.ip, config.TRUSTED_PROXY_DEPTH);

    if (bypassMatch(ip)) {
      return;
    }

    if (!latencyCircuitBreaker.allowRequest()) {
      rateLimitRejectedTotal.labels('global').inc();
      reply.header('Retry-After', String(Math.ceil(config.LATENCY_CB_RECOVERY_MS / 1000)));
      sendStandardError(
        reply,
        429,
        'RATE_LIMIT_EXCEEDED',
        'Service is temporarily rejecting requests due to high latency.',
        correlationId,
      );
      return;
    }

    const returning = tokenBucket.hasIp(ip);
    if (!newIpLimiter.checkAndRecord(ip, returning)) {
      rateLimitRejectedTotal.labels('new_ip').inc();
      reply.header('Retry-After', '5');
      sendStandardError(
        reply,
        429,
        'RATE_LIMIT_EXCEEDED',
        'Too many new clients. Please retry later.',
        correlationId,
      );
      return;
    }

    const { allowed, retryAfterSecs } = tokenBucket.consumeToken(ip);
    if (!allowed) {
      rateLimitRejectedTotal.labels('ip').inc();
      reply.header('Retry-After', String(retryAfterSecs));
      sendStandardError(
        reply,
        429,
        'RATE_LIMIT_EXCEEDED',
        `Too many requests from this IP. Please retry after ${retryAfterSecs} seconds.`,
        correlationId,
      );
    }
  });
};

export const rateLimitPlugin = fp(plugin, {
  fastify: '5.x',
  name: 'rate-limit-plugin',
});
