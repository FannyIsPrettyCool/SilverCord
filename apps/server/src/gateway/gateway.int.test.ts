import { GatewayClose, GatewayOp, readyEventSchema } from '@silvercord/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, openRegistration, register, tokenFromLink } from '../../test/auth-helpers.ts';
import { TestGatewayClient } from '../../test/gateway-client.ts';
import { createTestApp, type TestApp } from '../../test/test-app.ts';
import { channels } from './event-bus.ts';

describe('gateway conformance', () => {
  let t: TestApp;
  let baseUrl: string;

  beforeAll(async () => {
    t = await createTestApp({
      gateway: { heartbeatIntervalMs: 300, identifyTimeoutMs: 400, opsPerMinute: 30 },
    });
    await openRegistration(t);
    baseUrl = await t.app.listen({ host: '127.0.0.1', port: 0 });
  });
  afterAll(() => t.close());

  async function readyClient() {
    const { tokens, account } = await register(t);
    const client = await TestGatewayClient.connect(baseUrl);
    await client.next((f) => f.op === GatewayOp.HELLO);
    client.identify(tokens.accessToken);
    const ready = await client.dispatch('READY');
    return { client, tokens, account, ready, data: readyEventSchema.parse(ready.d) };
  }

  it('sends HELLO first and READY as sequence 1', async () => {
    const { client, ready, data, tokens } = await readyClient();
    expect(client.frames).toHaveLength(0);
    expect(ready.s).toBe(1);
    expect(data.user.id).toBe(tokens.user.id);
    expect(data.heartbeatIntervalMs).toBe(300);
    await client.close();
  });

  it('acknowledges heartbeats and times out silent sessions', async () => {
    const { client } = await readyClient();
    client.send({ op: GatewayOp.HEARTBEAT, d: { seq: 1 } });
    await client.next((f) => f.op === GatewayOp.HEARTBEAT_ACK);
    expect(await client.closed).toBe(GatewayClose.SESSION_TIMED_OUT);
  });

  it('rejects bad tokens and ops before IDENTIFY', async () => {
    const bad = await TestGatewayClient.connect(baseUrl);
    bad.identify('nope');
    expect(await bad.closed).toBe(GatewayClose.AUTHENTICATION_FAILED);

    const early = await TestGatewayClient.connect(baseUrl);
    early.send({ op: GatewayOp.HEARTBEAT, d: { seq: null } });
    expect(await early.closed).toBe(GatewayClose.NOT_AUTHENTICATED);

    const idle = await TestGatewayClient.connect(baseUrl);
    expect(await idle.closed).toBe(GatewayClose.NOT_AUTHENTICATED);
  });

  it('closes on decode errors, unknown opcodes, double identify and oversize frames', async () => {
    const cases: [unknown, number][] = [
      ['{not json', GatewayClose.DECODE_ERROR],
      [{ op: 99, d: {} }, GatewayClose.UNKNOWN_OPCODE],
      [{ op: GatewayOp.IDENTIFY, d: { token: 1 } }, GatewayClose.DECODE_ERROR],
      ['x'.repeat(17 * 1024), 1009],
    ];
    for (const [frame, code] of cases) {
      const client = await TestGatewayClient.connect(baseUrl);
      client.send(frame);
      expect(await client.closed).toBe(code);
    }
    const { client, tokens } = await readyClient();
    client.identify(tokens.accessToken);
    expect(await client.closed).toBe(GatewayClose.ALREADY_AUTHENTICATED);
  });

  it('closes floods with RATE_LIMITED', async () => {
    const { client } = await readyClient();
    for (let i = 0; i < 40; i++) client.send({ op: GatewayOp.HEARTBEAT, d: { seq: 1 } });
    expect(await client.closed).toBe(GatewayClose.RATE_LIMITED);
  });

  it('delivers live events and replays missed ones on RESUME', async () => {
    const { client, tokens, data } = await readyClient();
    const userChannel = channels.user(BigInt(tokens.user.id));
    await t.context.events.dispatch(userChannel, 'USER_UPDATE', {
      ...tokens.user,
      displayName: 'live',
    });
    const live = await client.dispatch('USER_UPDATE');
    expect(live.s).toBe(2);
    await client.close();

    for (const name of ['missed-1', 'missed-2']) {
      await t.context.events.dispatch(userChannel, 'USER_UPDATE', {
        ...tokens.user,
        displayName: name,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 50));

    const resumed = await TestGatewayClient.connect(baseUrl);
    await resumed.next((f) => f.op === GatewayOp.HELLO);
    resumed.resume(tokens.accessToken, data.sessionId, 2);
    const done = await resumed.dispatch('RESUMED');
    expect(done.d).toEqual({ replayed: 2 });
    const replayed = resumed.frames.filter((f) => f.t === 'USER_UPDATE');
    expect(replayed.map((f) => [f.s, (f.d as { displayName: string }).displayName])).toEqual([
      [3, 'missed-1'],
      [4, 'missed-2'],
    ]);
    expect(done.s).toBe(5);

    // Live delivery continues on the resumed socket with the next sequence.
    await t.context.events.dispatch(userChannel, 'USER_UPDATE', {
      ...tokens.user,
      displayName: 'after',
    });
    expect((await resumed.next((f) => f.t === 'USER_UPDATE' && f.s === 6)).s).toBe(6);
    await resumed.close();
  });

  it('refuses a resume whose sequence is ahead of the session', async () => {
    const { client, tokens, data } = await readyClient();
    await client.close();
    const resumed = await TestGatewayClient.connect(baseUrl);
    resumed.resume(tokens.accessToken, data.sessionId, 99);
    expect((await resumed.next((f) => f.op === GatewayOp.INVALID_SESSION)).d).toEqual({
      resumable: false,
    });
    await resumed.close();
  });

  it('refuses to resume unknown or foreign sessions but allows IDENTIFY after', async () => {
    const alice = await readyClient();
    const bob = await register(t);
    const thief = await TestGatewayClient.connect(baseUrl);
    thief.resume(bob.tokens.accessToken, alice.data.sessionId, 1);
    const invalid = await thief.next((f) => f.op === GatewayOp.INVALID_SESSION);
    expect(invalid.d).toEqual({ resumable: false });
    thief.identify(bob.tokens.accessToken);
    expect(readyEventSchema.parse((await thief.dispatch('READY')).d).user.id).toBe(
      bob.tokens.user.id,
    );
    await Promise.all([thief.close(), alice.client.close()]);
  });

  it('kicks the socket when its REST session is revoked', async () => {
    const { client, tokens } = await readyClient();
    await t.request({ method: 'POST', url: '/api/v1/auth/logout', headers: bearer(tokens) });
    expect(await client.closed).toBe(GatewayClose.AUTHENTICATION_FAILED);
  });

  it('pushes USER_UPDATE when the email gets verified', async () => {
    const { client, account } = await readyClient();
    const mail =
      t.mailer.sent.find((m) => m.to === account.email) ?? (await t.mailer.next(account.email));
    await t.request({
      method: 'POST',
      url: '/api/v1/auth/email/verify',
      payload: { token: tokenFromLink(mail.text) },
    });
    const update = await client.dispatch('USER_UPDATE');
    expect((update.d as { emailVerified: boolean }).emailVerified).toBe(true);
    await client.close();
  });
});
