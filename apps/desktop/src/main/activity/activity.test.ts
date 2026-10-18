import { connect } from 'node:net';
import type { ActivityInput } from '@silvercord/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { matchGame, parseTasklist } from './game-detector.ts';
import { parsePlayerctl, parseSmtcLine, playerName } from './media-session.ts';
import { createRpcServer, lineReader, parseRpcActivity, RPC_LINE_MAX } from './rpc-server.ts';

describe('game detection', () => {
  it('reads image names from tasklist csv', () => {
    const names = parseTasklist(
      '"System Idle Process","0","Services","0","8 K"\r\n"Hades.exe","4120","Console","1","812,004 K"\r\n',
    );
    expect(names).toEqual(new Set(['system idle process', 'hades.exe']));
  });

  it('prefers the user list over the bundled one', () => {
    const running = new Set(['hades.exe', 'mygame.exe']);
    const bundled = { 'hades.exe': 'Hades' };
    expect(matchGame(running, [], bundled)).toBe('Hades');
    expect(matchGame(running, [{ process: 'MyGame.exe', name: 'Mine' }], bundled)).toBe('Mine');
    expect(matchGame(new Set(['notepad.exe']), [], bundled)).toBeNull();
  });
});

describe('media sessions', () => {
  it('turns playing SMTC sessions into activities and clears paused ones', () => {
    expect(
      parseSmtcLine(
        JSON.stringify({
          status: 'Playing',
          title: 'Strobe',
          artist: 'deadmau5',
          app: 'Spotify.exe',
          kind: 'Music',
        }),
      ),
    ).toEqual({ type: 'listening', name: 'Strobe', details: 'deadmau5', state: 'Spotify' });
    expect(parseSmtcLine(JSON.stringify({ status: 'Paused', title: 'Strobe' }))).toBeNull();
    expect(parseSmtcLine('not json')).toBeUndefined();
    expect(
      parseSmtcLine(JSON.stringify({ status: 'Playing', title: 'Clip', kind: 'Video', app: 'x' })),
    ).toMatchObject({ type: 'watching', state: null });
  });

  it('keeps unknown player ids private and strips control characters', () => {
    expect(playerName('SomeVendor.PrivateApp_8wekyb3d8bbwe!App')).toBeNull();
    expect(playerName('OperaSoftware.OperaGXWebBrowser.1778430378')).toBe('Opera GX');
    expect(parsePlayerctl('Playing\tArtist\tTi‮tle\tspotify\n')).toEqual({
      type: 'listening',
      name: 'Title',
      details: 'Artist',
      state: 'Spotify',
    });
    expect(parsePlayerctl('Paused\tA\tB\tvlc')).toBeNull();
  });
});

describe('local rpc', () => {
  it('keeps documented keys only and names the application itself', () => {
    expect(
      parseRpcActivity(
        { type: 'playing', name: 'Run', extra: 'ignored', application: 'Spoof' },
        'Real',
      ),
    ).toEqual({ type: 'playing', name: 'Run', application: 'Real' });
    expect(parseRpcActivity({ type: 'playing', name: '' }, 'Real')).toBeNull();
  });

  it('frames lines and refuses oversized ones', () => {
    const lines: string[] = [];
    let overflow = false;
    const feed = lineReader(
      (line) => lines.push(line),
      () => {
        overflow = true;
      },
    );
    feed(Buffer.from('{"a":1}\n{"b"'));
    feed(Buffer.from(':2}\n'));
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
    feed(Buffer.from('x'.repeat(RPC_LINE_MAX + 2)));
    expect(overflow).toBe(true);
  });

  let stop: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await stop?.();
    stop = undefined;
  });

  it('waits for approval, applies activity, rate limits and clears on disconnect', async () => {
    const changes: (ActivityInput | null)[] = [];
    const requests: string[] = [];
    const server = createRpcServer({
      decision: () => 'unknown',
      onRequest: (client) => requests.push(client),
      onChange: (activity) => changes.push(activity),
    });
    const address = await server.start();
    stop = () => server.stop();
    if (!address) throw new Error('no rpc address');
    const socket = connect(address);
    const replies: Record<string, unknown>[] = [];
    socket.on(
      'data',
      lineReader(
        (line) => replies.push(JSON.parse(line) as Record<string, unknown>),
        () => undefined,
      ),
    );
    const send = (message: object) => socket.write(`${JSON.stringify(message)}\n`);
    const until = async (count: number) => {
      for (let attempt = 0; attempt < 100 && replies.length < count; attempt += 1)
        await new Promise((resolve) => setTimeout(resolve, 10));
    };
    await new Promise((resolve) => socket.once('connect', resolve));
    send({ v: 1, op: 'hello', client: { name: 'Blocks' } });
    await until(1);
    expect(replies[0]).toMatchObject({ op: 'pending' });
    expect(requests).toEqual(['Blocks']);
    send({ op: 'set_activity', nonce: '1', activity: { type: 'playing', name: 'Tetrominoes' } });
    await until(2);
    expect(replies[1]).toEqual({ op: 'ack', nonce: '1' });
    // Nothing is published until the user allows the program.
    expect(changes).toEqual([]);
    server.decide('Blocks', true);
    await until(3);
    expect(replies[2]).toMatchObject({ op: 'ready' });
    expect(changes.at(-1)).toMatchObject({ name: 'Tetrominoes', application: 'Blocks' });
    for (let index = 2; index <= 6; index += 1)
      send({ op: 'set_activity', nonce: String(index), activity: { type: 'playing', name: 'x' } });
    await until(8);
    expect(replies.at(-1)).toMatchObject({ op: 'error', code: 'RATE_LIMITED', nonce: '6' });
    socket.destroy();
    for (let attempt = 0; attempt < 100 && changes.at(-1) !== null; attempt += 1)
      await new Promise((resolve) => setTimeout(resolve, 10));
    expect(changes.at(-1)).toBeNull();
  });
});
