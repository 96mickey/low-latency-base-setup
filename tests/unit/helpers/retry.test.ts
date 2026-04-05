import {
  describe, it, expect, vi,
} from 'vitest';

import { withRetry } from '../../../src/helpers/retry.js';

describe('withRetry', () => {
  it('returns on first success', async () => {
    const fn = vi.fn().mockResolvedValue(42);
    await expect(withRetry(fn, { maxRetries: 3, baseMs: 1 })).resolves.toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries then throws', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    await expect(withRetry(fn, { maxRetries: 2, baseMs: 1 })).rejects.toThrow('fail');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
