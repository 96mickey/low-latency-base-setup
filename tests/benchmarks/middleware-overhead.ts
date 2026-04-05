/**
 * Autocannon: baseline Fastify vs middleware stack (no DB I/O on GET /).
 * Rate limiting disabled. Exits 1 if p99 delta exceeds budget.
 *
 * Run: `npx tsx tests/benchmarks/middleware-overhead.ts`
 */

import autocannon from 'autocannon';
import pino from 'pino';

import { loadConfig } from '../../src/config/index.js';
import { correlationIdPlugin } from '../../src/middleware/correlationId/index.js';
import { rateLimitPlugin } from '../../src/middleware/rateLimit/index.js';
import { createLatencyCircuitBreaker } from '../../src/middleware/rateLimit/latencyCircuitBreaker.js';
import { createNewIpLimiter } from '../../src/middleware/rateLimit/newIpLimiter.js';
import { createTokenBucket } from '../../src/middleware/rateLimit/tokenBucket.js';
import { securityPlugin } from '../../src/middleware/security/index.js';
import { tracingSlotPlugin } from '../../src/middleware/tracingSlot/index.js';
import { createFastifyInstance } from '../../src/server/factory.js';

if (process.env.SCAFFOLD_DEPTH === '1') {
  console.warn('Skipping benchmark in nested SCAFFOLD_DEPTH context.');
  process.exit(0);
}

const benchEnv: Record<string, string | undefined> = {
  NODE_ENV: 'test',
  DB_HOST: 'localhost',
  DB_NAME: 'n',
  DB_USER: 'u',
  DB_PASSWORD: 'p',
  CORS_ALLOWED_ORIGINS: 'http://localhost',
  RATE_LIMIT_DISABLED: 'true',
  LATENCY_CB_WARMUP_MS: '1',
};

const P99_DELTA_MAX_MS = Number(process.env.MIDDLEWARE_P99_DELTA_MS ?? '5');

function benchConfig() {
  return loadConfig(benchEnv as NodeJS.ProcessEnv);
}

async function runBench(url: string): Promise<number> {
  const result = await autocannon({
    url,
    connections: 20,
    duration: 3,
    method: 'GET',
  });
  return result.latency.p99;
}

async function main() {
  const config = benchConfig();
  const log = pino({ level: 'silent' });

  const baselineApp = createFastifyInstance(config, log);
  baselineApp.get('/bench', async () => 'ok');
  await baselineApp.listen({ port: 0, host: '127.0.0.1' });
  const bAddr = baselineApp.server.address();
  const bPort = typeof bAddr === 'object' && bAddr ? bAddr.port : 0;
  const baseUrl = `http://127.0.0.1:${bPort}/bench`;
  const baseP99 = await runBench(baseUrl);
  await baselineApp.close();

  const fullApp = createFastifyInstance(config, log);
  await fullApp.register(securityPlugin, { config });
  await fullApp.register(correlationIdPlugin);
  await fullApp.register(tracingSlotPlugin);
  const tokenBucket = createTokenBucket(config);
  const newIpLimiter = createNewIpLimiter(config);
  const latencyCircuitBreaker = createLatencyCircuitBreaker(config);
  tokenBucket.startSweep();
  latencyCircuitBreaker.start();
  await fullApp.register(rateLimitPlugin, {
    config,
    tokenBucket,
    newIpLimiter,
    latencyCircuitBreaker,
  });
  fullApp.get('/bench', async () => 'ok');
  await fullApp.listen({ port: 0, host: '127.0.0.1' });
  const fAddr = fullApp.server.address();
  const fPort = typeof fAddr === 'object' && fAddr ? fAddr.port : 0;
  const fullUrl = `http://127.0.0.1:${fPort}/bench`;
  const fullP99 = await runBench(fullUrl);
  tokenBucket.stopSweep();
  latencyCircuitBreaker.stop();
  await fullApp.close();

  const delta = fullP99 - baseP99;
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    baseP99, fullP99, deltaMs: delta, budgetMs: P99_DELTA_MAX_MS,
  }));

  if (delta > P99_DELTA_MAX_MS) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
