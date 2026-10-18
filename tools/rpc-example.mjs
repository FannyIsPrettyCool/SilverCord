// Local RPC example (docs/rpc.md): sets "Playing Example Game" until you press Ctrl+C.
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const path =
  process.platform === 'win32'
    ? '\\?\pipe\silvercord-rpc-0'
    : join(process.env.XDG_RUNTIME_DIR ?? tmpdir(), 'silvercord-rpc-0');
const socket = connect(path);
const send = (message) => socket.write(`${JSON.stringify(message)}\n`);
socket.on('data', (data) => process.stdout.write(data));
socket.on('error', (error) => {
  console.error(`Cannot reach SilverCord at ${path}: ${error.message}`);
  process.exit(1);
});
send({ v: 1, op: 'hello', client: { name: process.argv[2] ?? 'Example' } });
send({
  op: 'set_activity',
  nonce: '1',
  activity: {
    type: 'playing',
    name: process.argv[3] ?? 'Example Game',
    details: 'Local RPC demo',
    startedAt: new Date().toISOString(),
    buttons: [{ label: 'Protocol', url: 'https://github.com/FannyIsPrettyCool/SilverCord' }],
  },
});
process.on('SIGINT', () => {
  send({ op: 'clear_activity', nonce: '2' });
  socket.end();
});
