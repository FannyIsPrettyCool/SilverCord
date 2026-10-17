// Stop: runs the workspace typecheck. On failure, exit 2 sends the errors back to the agent once;
// `stop_hook_active` prevents an endless loop when the agent cannot fix them.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

type HookInput = { stop_hook_active?: unknown };

const input = JSON.parse(readFileSync(0, 'utf8')) as HookInput;
if (input.stop_hook_active === true) process.exit(0);

const result = spawnSync('pnpm', ['-s', 'turbo', 'run', 'typecheck', '--output-logs=errors-only'], {
  cwd: process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd(),
  encoding: 'utf8',
});
if (result.status !== 0) {
  process.stderr.write(`Typecheck failed:\n${(result.stdout + result.stderr).slice(-4000)}\n`);
  process.exit(2);
}
