import { describe, expect, it } from 'vitest';
import { clientSubject } from './client-subject.ts';

describe('clientSubject', () => {
  it('keeps IPv4 and unwraps v4-mapped addresses', () => {
    expect(clientSubject('203.0.113.7')).toBe('203.0.113.7');
    expect(clientSubject('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  it('groups IPv6 by /64', () => {
    expect(clientSubject('2001:db8:abcd:12:1::1')).toBe('2001:db8:abcd:12::/64');
    expect(clientSubject('2001:db8:abcd:12:ffff:ffff:ffff:ffff')).toBe('2001:db8:abcd:12::/64');
    expect(clientSubject('2001:0DB8:0:0:1:2:3:4')).toBe('2001:db8:0:0::/64');
    expect(clientSubject('::1')).toBe('0:0:0:0::/64');
  });
});
