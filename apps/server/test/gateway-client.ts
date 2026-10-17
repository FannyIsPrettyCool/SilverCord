import { GATEWAY_PATH, GatewayOp } from '@silvercord/protocol';
import WebSocket from 'ws';

export interface Frame {
  op: number;
  d: unknown;
  s?: number;
  t?: string;
}

/** Minimal scripted client for conformance tests: records frames and the close code. */
export class TestGatewayClient {
  readonly frames: Frame[] = [];
  readonly closed: Promise<number>;
  private readonly socket: WebSocket;
  private waiters: { match: (frame: Frame) => boolean; resolve: (frame: Frame) => void }[] = [];

  private constructor(socket: WebSocket) {
    this.socket = socket;
    this.closed = new Promise((resolve) => socket.on('close', (code) => resolve(code)));
    socket.on('message', (raw) => {
      const frame = JSON.parse(raw.toString()) as Frame;
      this.frames.push(frame);
      const index = this.waiters.findIndex((waiter) => waiter.match(frame));
      if (index >= 0) this.waiters.splice(index, 1)[0]?.resolve(frame);
    });
  }

  static async connect(baseUrl: string): Promise<TestGatewayClient> {
    const socket = new WebSocket(`${baseUrl.replace(/^http/, 'ws')}${GATEWAY_PATH}`);
    const client = new TestGatewayClient(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    return client;
  }

  /** Resolves with the first already-received or future frame matching `match`. */
  next(match: (frame: Frame) => boolean, timeoutMs = 3000): Promise<Frame> {
    const seen = this.frames.find(match);
    if (seen) {
      this.frames.splice(this.frames.indexOf(seen), 1);
      return Promise.resolve(seen);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for frame')), timeoutMs);
      this.waiters.push({
        match,
        resolve: (frame) => {
          clearTimeout(timer);
          this.frames.splice(this.frames.indexOf(frame), 1);
          resolve(frame);
        },
      });
    });
  }

  dispatch(t: string) {
    return this.next((frame) => frame.op === GatewayOp.DISPATCH && frame.t === t);
  }

  send(frame: unknown) {
    this.socket.send(typeof frame === 'string' ? frame : JSON.stringify(frame));
  }

  identify(token: string) {
    this.send({
      op: GatewayOp.IDENTIFY,
      d: { token, client: { name: 'test', version: '0', os: 'linux' } },
    });
  }

  resume(token: string, sessionId: string, seq: number) {
    this.send({ op: GatewayOp.RESUME, d: { token, sessionId, seq } });
  }

  close() {
    this.socket.close();
    return this.closed;
  }
}
