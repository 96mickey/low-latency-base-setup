import { describe, it, expect } from 'vitest';

import { LruMap } from '../../../src/helpers/lruMap.js';

describe('LruMap', () => {
  it('throws when maxSize < 1', () => {
    expect(() => new LruMap<string, number>(0)).toThrow(/maxSize/);
  });

  it('delete removes entry', () => {
    const lru = new LruMap<string, number>(5);
    lru.set('a', 1);
    expect(lru.delete('a')).toBe(true);
    expect(lru.delete('a')).toBe(false);
  });

  it('forEachEntry visits all keys', () => {
    const lru = new LruMap<string, number>(5);
    lru.set('x', 1);
    lru.set('y', 2);
    const keys = new Set<string>();
    lru.forEachEntry((k) => keys.add(k));
    expect(keys.has('x')).toBe(true);
    expect(keys.has('y')).toBe(true);
  });

  it('evicts LRU at capacity', () => {
    const m = new LruMap<string, number>(2);
    m.set('a', 1);
    m.set('b', 2);
    m.get('a');
    m.set('c', 3);
    expect(m.has('b')).toBe(false);
    expect(m.get('a')).toBe(1);
    expect(m.get('c')).toBe(3);
    expect(m.size).toBe(2);
  });
});
