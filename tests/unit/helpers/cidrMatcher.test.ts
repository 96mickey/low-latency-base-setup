import { describe, it, expect } from 'vitest';

import { compileCidrs } from '../../../src/helpers/cidrMatcher.js';

describe('compileCidrs', () => {
  it('matches 10.0.0.0/8', () => {
    const m = compileCidrs(['10.0.0.0/8']);
    expect(m('10.5.1.1')).toBe(true);
    expect(m('9.255.255.255')).toBe(false);
  });

  it('treats bare IPv4 as /32', () => {
    const m = compileCidrs(['192.168.1.10']);
    expect(m('192.168.1.10')).toBe(true);
    expect(m('192.168.1.11')).toBe(false);
  });

  it('handles /32 and /0', () => {
    expect(compileCidrs(['192.168.1.1/32'])('192.168.1.1')).toBe(true);
    expect(compileCidrs(['0.0.0.0/0'])('255.255.255.255')).toBe(true);
  });
});
