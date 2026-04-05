import { describe, it, expect } from 'vitest';

import { parseBodyLimitBytes } from '../../../src/lib/parseBodyLimit.js';

describe('parseBodyLimitBytes', () => {
  it('parses plain bytes', () => {
    expect(parseBodyLimitBytes('1024')).toBe(1024);
  });

  it('parses kb mb gb suffixes', () => {
    expect(parseBodyLimitBytes('2kb')).toBe(2048);
    expect(parseBodyLimitBytes('1mb')).toBe(1024 ** 2);
    expect(parseBodyLimitBytes('1gb')).toBe(1024 ** 3);
  });

  it('defaults unit to b', () => {
    expect(parseBodyLimitBytes('100')).toBe(100);
  });

  it('falls back to default on invalid pattern', () => {
    expect(parseBodyLimitBytes('')).toBe(100 * 1024);
    expect(parseBodyLimitBytes('xyz')).toBe(100 * 1024);
  });
});
