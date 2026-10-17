import { isIPv6 } from 'node:net';

/**
 * Rate-limit subject for a client address. IPv6 clients usually control a whole /64, so
 * keying on the full address would let them rotate past every per-IP limit (threat model T1).
 */
export function clientSubject(ip: string): string {
  const address = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (!isIPv6(address)) return address;
  const [head = '', tail = ''] = address.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const missing = 8 - left.length - right.length;
  const groups = [...left, ...Array<string>(Math.max(0, missing)).fill('0'), ...right];
  return `${groups
    .slice(0, 4)
    .map((group) => Number.parseInt(group || '0', 16).toString(16))
    .join(':')}::/64`;
}
