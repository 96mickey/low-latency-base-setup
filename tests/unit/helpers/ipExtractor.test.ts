import { describe, it, expect } from 'vitest';

import { extractClientIp } from '../../../src/helpers/ipExtractor.js';

describe('extractClientIp', () => {
  it('returns first client with depth 1', () => {
    expect(extractClientIp('1.2.3.4, 10.0.0.1', '10.0.0.1', 1)).toBe('1.2.3.4');
  });

  it('falls back to requestIp when XFF empty', () => {
    expect(extractClientIp(undefined, '10.0.0.2', 1)).toBe('10.0.0.2');
    expect(extractClientIp('  ', '10.0.0.2', 1)).toBe('10.0.0.2');
  });

  it('falls back when XFF has only empty parts', () => {
    expect(extractClientIp(', ,', '10.0.0.3', 1)).toBe('10.0.0.3');
  });

  it('falls back when depth out of range', () => {
    expect(extractClientIp('1.1.1.1', '9.9.9.9', 99)).toBe('9.9.9.9');
  });
});
