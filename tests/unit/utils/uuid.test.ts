import { describe, it, expect } from 'vitest';

import { generateUuid } from '../../../src/utils/uuid.js';

describe('generateUuid', () => {
  it('matches v4 shape and is unique', () => {
    const a = generateUuid();
    const b = generateUuid();
    expect(a).toMatch(/^[0-9a-f-]{36}$/i);
    expect(a).not.toBe(b);
  });
});
