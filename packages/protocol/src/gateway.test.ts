import { describe, expect, it } from 'vitest';
import { clientFrameSchema, GatewayOp, serverFrameSchema } from './gateway.ts';

describe('gateway frames', () => {
  it('parses client heartbeats, identify and resume', () => {
    expect(clientFrameSchema.parse({ op: 1, d: { seq: null } }).op).toBe(GatewayOp.HEARTBEAT);
    expect(
      clientFrameSchema.safeParse({
        op: 2,
        d: { token: 't', client: { name: 'desktop', version: '0', os: 'linux' } },
      }).success,
    ).toBe(true);
    expect(
      clientFrameSchema.safeParse({ op: 3, d: { token: 't', sessionId: 's', seq: 3 } }).success,
    ).toBe(true);
  });

  it('rejects server-only and malformed frames from clients', () => {
    expect(clientFrameSchema.safeParse({ op: 0, d: {} }).success).toBe(false);
    expect(clientFrameSchema.safeParse({ op: 10, d: {} }).success).toBe(false);
    expect(clientFrameSchema.safeParse({ op: 1, d: { seq: -1 } }).success).toBe(false);
    expect(clientFrameSchema.safeParse({ op: 2, d: { token: '' } }).success).toBe(false);
  });

  it('parses server frames on the client', () => {
    expect(serverFrameSchema.parse({ op: 10, d: { heartbeatIntervalMs: 41250 } }).op).toBe(
      GatewayOp.HELLO,
    );
    expect(serverFrameSchema.safeParse({ op: 0, t: 'READY', s: 0, d: {} }).success).toBe(false);
  });
});
