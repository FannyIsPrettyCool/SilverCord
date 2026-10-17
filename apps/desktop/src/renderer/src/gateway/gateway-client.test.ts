import { GatewayClose, GatewayOp } from '@silvercord/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DesktopError } from '../desktop.ts';
import { createGatewayClient, type GatewaySocket } from './gateway-client.ts';

class FakeSocket implements GatewaySocket {
  readyState = 1;
  sent: { op: number; d: Record<string, unknown> }[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close(code = 1000) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  receive(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

const user = {
  id: '1',
  username: 'u',
  displayName: null,
  email: 'u@example.test',
  emailVerified: false,
  isInstanceAdmin: false,
  mfaEnabled: false,
  locale: 'en',
  createdAt: '2026-10-17T00:00:00.000Z',
};

describe('gateway client', () => {
  let sockets: FakeSocket[];
  let states: string[];
  const flush = () => vi.advanceTimersByTimeAsync(0);

  beforeEach(() => {
    vi.useFakeTimers();
    sockets = [];
    states = [];
  });
  afterEach(() => vi.useRealTimers());

  function setup(getToken = vi.fn(async () => 'token'), onUnauthenticated = vi.fn()) {
    const client = createGatewayClient({
      url: 'ws://test',
      getToken,
      random: () => 0.5,
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      onState: (s) => states.push(s),
      onUnauthenticated,
    });
    client.start();
    return { client, getToken, onUnauthenticated, last: () => sockets.at(-1) as FakeSocket };
  }

  async function handshake(socket: FakeSocket, sessionId = 'sess') {
    socket.receive({ op: GatewayOp.HELLO, d: { heartbeatIntervalMs: 1000 } });
    await flush();
    socket.receive({
      op: GatewayOp.DISPATCH,
      t: 'READY',
      s: 1,
      d: { sessionId, user, heartbeatIntervalMs: 1000 },
    });
  }

  it('identifies after HELLO and becomes ready', async () => {
    const { last } = setup();
    await handshake(last());
    expect(last().sent[0]).toMatchObject({ op: GatewayOp.IDENTIFY, d: { token: 'token' } });
    expect(states).toEqual(['connecting', 'ready']);
  });

  it('heartbeats with the last sequence and drops zombie connections', async () => {
    const { last } = setup();
    await handshake(last());
    last().receive({ op: GatewayOp.DISPATCH, t: 'USER_UPDATE', s: 2, d: user });
    await vi.advanceTimersByTimeAsync(500);
    expect(last().sent.at(-1)).toEqual({ op: GatewayOp.HEARTBEAT, d: { seq: 2 } });
    // No ACK before the next beat: the client closes and reconnects.
    const zombie = last();
    await vi.advanceTimersByTimeAsync(1000);
    expect(zombie.readyState).toBe(3);
    expect(states.at(-1)).toBe('connecting');
  });

  it('resumes after a drop with the last session and sequence', async () => {
    const { last } = setup();
    await handshake(last(), 'abc');
    last().receive({ op: GatewayOp.DISPATCH, t: 'USER_UPDATE', s: 7, d: user });
    last().close(1006);
    await vi.advanceTimersByTimeAsync(1500);
    expect(sockets).toHaveLength(2);
    last().receive({ op: GatewayOp.HELLO, d: { heartbeatIntervalMs: 1000 } });
    await flush();
    expect(last().sent[0]).toEqual({
      op: GatewayOp.RESUME,
      d: { token: 'token', sessionId: 'abc', seq: 7 },
    });
  });

  it('identifies again after INVALID_SESSION on the same socket', async () => {
    const { last } = setup();
    await handshake(last());
    last().close(1006);
    await vi.advanceTimersByTimeAsync(1500);
    last().receive({ op: GatewayOp.HELLO, d: { heartbeatIntervalMs: 1000 } });
    await flush();
    last().receive({ op: GatewayOp.INVALID_SESSION, d: { resumable: false } });
    await flush();
    expect(last().sent.map((f) => f.op)).toEqual([GatewayOp.RESUME, GatewayOp.IDENTIFY]);
  });

  it('gives up and signs out after two authentication failures', async () => {
    const { last, onUnauthenticated, getToken } = setup();
    last().receive({ op: GatewayOp.HELLO, d: { heartbeatIntervalMs: 1000 } });
    await flush();
    last().close(GatewayClose.AUTHENTICATION_FAILED);
    await vi.advanceTimersByTimeAsync(1500);
    last().receive({ op: GatewayOp.HELLO, d: { heartbeatIntervalMs: 1000 } });
    await flush();
    last().close(GatewayClose.AUTHENTICATION_FAILED);
    expect(onUnauthenticated).toHaveBeenCalledOnce();
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(states.at(-1)).toBe('closed');
  });

  it('signs out when the login session is rejected', async () => {
    const { last, onUnauthenticated } = setup(
      vi.fn(async () => Promise.reject(new DesktopError('TOKEN_REUSED', 'revoked'))),
    );
    last().receive({ op: GatewayOp.HELLO, d: { heartbeatIntervalMs: 1000 } });
    await flush();
    expect(onUnauthenticated).toHaveBeenCalledOnce();
  });

  it('waits for READY before starting heartbeats even with a slow token request', async () => {
    let resolveToken: (token: string) => void = () => {};
    const { last } = setup(
      vi.fn(
        () =>
          new Promise<string>((resolve) => {
            resolveToken = resolve;
          }),
      ),
    );
    last().receive({ op: GatewayOp.HELLO, d: { heartbeatIntervalMs: 1000 } });
    await vi.advanceTimersByTimeAsync(1500);
    expect(last().sent).toEqual([]);
    resolveToken('token');
    await flush();
    await vi.advanceTimersByTimeAsync(1500);
    expect(last().sent.map((frame) => frame.op)).toEqual([GatewayOp.IDENTIFY]);
  });

  it.each(['NETWORK', 'RATE_LIMITED', 'INTERNAL'])(
    'retries %s token failures without signing out',
    async (code) => {
      const { last, onUnauthenticated } = setup(
        vi.fn(async () => {
          throw new DesktopError(code, 'temporary');
        }),
      );
      const failed = last();
      failed.receive({ op: GatewayOp.HELLO, d: { heartbeatIntervalMs: 1000 } });
      await flush();
      expect(failed.readyState).toBe(3);
      expect(onUnauthenticated).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1000);
      expect(sockets).toHaveLength(2);
    },
  );

  it('detaches a zombie without waiting for the WebSocket close handshake', async () => {
    const { last, client } = setup();
    await handshake(last());
    const zombie = last();
    zombie.close = vi.fn();
    await vi.advanceTimersByTimeAsync(1500);
    expect(zombie.close).toHaveBeenCalledWith(4000);
    expect(client.state).toBe('connecting');
    await vi.advanceTimersByTimeAsync(1000);
    expect(sockets).toHaveLength(2);
  });

  it('handles token failure when re-identifying after INVALID_SESSION', async () => {
    const getToken = vi.fn(async () => 'token');
    const { last, onUnauthenticated } = setup(getToken);
    await handshake(last());
    getToken.mockRejectedValueOnce(new DesktopError('NETWORK', 'temporary'));
    last().receive({ op: GatewayOp.INVALID_SESSION, d: { resumable: false } });
    await flush();
    expect(onUnauthenticated).not.toHaveBeenCalled();
    expect(last().readyState).toBe(3);
    await vi.advanceTimersByTimeAsync(1000);
    last().receive({ op: GatewayOp.HELLO, d: { heartbeatIntervalMs: 1000 } });
    await flush();
    expect(last().sent[0]?.op).toBe(GatewayOp.IDENTIFY);
  });

  it('discards a token result from a socket that closed while it was pending', async () => {
    let resolveToken: (token: string) => void = () => {};
    const { last, getToken } = setup(
      vi.fn(
        () =>
          new Promise<string>((resolve) => {
            resolveToken = resolve;
          }),
      ),
    );
    last().receive({ op: GatewayOp.HELLO, d: { heartbeatIntervalMs: 1000 } });
    last().close(1006);
    await vi.advanceTimersByTimeAsync(1000);
    getToken.mockResolvedValueOnce('new-token');
    last().receive({ op: GatewayOp.HELLO, d: { heartbeatIntervalMs: 1000 } });
    await flush();
    resolveToken('old-token');
    await flush();
    expect(last().sent).toHaveLength(1);
    expect(last().sent[0]?.d['token']).toBe('new-token');
  });

  it('ignores rejection from an obsolete socket', async () => {
    let rejectToken: (error: Error) => void = () => {};
    const { last, getToken, onUnauthenticated } = setup(
      vi.fn(
        () =>
          new Promise<string>((_resolve, reject) => {
            rejectToken = reject;
          }),
      ),
    );
    last().receive({ op: GatewayOp.HELLO, d: { heartbeatIntervalMs: 1000 } });
    last().close(1006);
    await vi.advanceTimersByTimeAsync(1000);
    getToken.mockResolvedValueOnce('new-token');
    await handshake(last());
    rejectToken(new DesktopError('UNAUTHENTICATED', 'obsolete'));
    await flush();
    expect(onUnauthenticated).not.toHaveBeenCalled();
    expect(last().readyState).toBe(1);
    expect(states.at(-1)).toBe('ready');
  });

  it('backs off between failed connects', async () => {
    setup();
    sockets[0]?.close(1006);
    await vi.advanceTimersByTimeAsync(900);
    expect(sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(sockets).toHaveLength(2);
    sockets[1]?.close(1006);
    await vi.advanceTimersByTimeAsync(1900);
    expect(sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(200);
    expect(sockets).toHaveLength(3);
  });

  it('stops cleanly', async () => {
    const { client, last } = setup();
    await handshake(last());
    client.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(1);
    expect(client.state).toBe('closed');
  });
});
