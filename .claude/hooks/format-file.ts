// PostToolUse(Write|Edit): formats the touched file with Biome. Never blocks.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

type HookInput = { tool_input?: { file_path?: unknown } };

const input = JSON.parse(readFileSync(0, 'utf8')) as HookInput;
const filePath = input.tool_input?.file_path;
if (typeof filePath === 'string' && /\.(ts|tsx|js|mjs|cjs|json|jsonc|css)$/.test(filePath)) {
  spawnSync(
    'pnpm',
    ['exec', 'biome', 'format', '--write', '--files-ignore-unknown=true', filePath],
    {
      cwd: process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd(),
      stdio: 'ignore',
    },
  );
}
