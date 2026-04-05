import {
  describe, it, expect, vi,
} from 'vitest';

import { nowMs, sleep } from '../../../src/utils/time.js';

describe('time utils', () => {
  it('nowMs returns number', () => {
    expect(typeof nowMs()).toBe('number');
  });

  it('sleep resolves after delay', async () => {
    vi.useFakeTimers();
    const p = sleep(50);
    await vi.advanceTimersByTimeAsync(50);
    await expect(p).resolves.toBeUndefined();
    vi.useRealTimers();
  });
});
