import type { RetryOptions } from '../types/index.js';
import { sleep } from '../utils/time.js';

function jitterMs(base: number): number {
  return Math.floor(Math.random() * base);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const { maxRetries, baseMs, maxMs = 60_000 } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === maxRetries) break;
      const exp = Math.min(baseMs * (2 ** attempt), maxMs);
      const wait = exp + jitterMs(Math.min(baseMs, exp));
      // eslint-disable-next-line no-await-in-loop
      await sleep(wait);
    }
  }
  throw lastErr;
}
