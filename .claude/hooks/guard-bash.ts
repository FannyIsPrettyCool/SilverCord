// PreToolUse(Bash): blocks commands the commit policy forbids. Exit 2 = block, stderr goes to the agent.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type HookInput = { tool_input?: { command?: unknown }; cwd?: unknown };

const input = JSON.parse(readFileSync(0, 'utf8')) as HookInput;
const rawCommand = typeof input.tool_input?.command === 'string' ? input.tool_input.command : '';
// Quoted text (commit messages, heredoc-free echo strings) is data, not flags.
const command = rawCommand.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, "''");
const projectDir = process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd();

function block(reason: string): never {
  process.stderr.write(`Blocked by .claude/hooks/guard-bash.ts: ${reason}\n`);
  process.exit(2);
}

if (/\bgit\s+push\b[^;&|]*(\s--force\b|\s-f\b|\s--force-with-lease\b)/.test(command)) {
  block('force-push is forbidden (BRIEF §12.3)');
}
if (/\bgit\s+(commit|push|merge|rebase)\b[^;&|]*\s--no-verify\b/.test(command)) {
  block('--no-verify is forbidden (BRIEF §12.3)');
}

// rm with both recursive and force flags: every target must resolve inside the repo.
for (const match of command.matchAll(/\brm\s+((?:-[a-zA-Z]+\s+|--[a-z-]+\s+)+)([^;&|]+)/g)) {
  const flags = match[1] ?? '';
  const recursive = /-[a-zA-Z]*r|--recursive/i.test(flags);
  const force = /-[a-zA-Z]*f|--force/.test(flags);
  if (!recursive || !force) continue;
  const cwd = typeof input.cwd === 'string' ? input.cwd : projectDir;
  for (const target of (match[2] ?? '').trim().split(/\s+/)) {
    const absolute = resolve(cwd, target.replace(/^~(?=\/|$)/, process.env['HOME'] ?? '~'));
    if (absolute === projectDir || !absolute.startsWith(`${projectDir}/`)) {
      block(`rm -rf outside the repository (${target})`);
    }
  }
}
