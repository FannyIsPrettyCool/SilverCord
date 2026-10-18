import { execFile } from 'node:child_process';
import { readdir, readFile, readlink } from 'node:fs/promises';
import { basename } from 'node:path';
import { promisify } from 'node:util';
import type { ActivityInput } from '@silvercord/protocol';

const run = promisify(execFile);
export const GAME_POLL_MS = 15_000;
export const USER_GAMES_MAX = 100;

export interface UserGame {
  /** Executable image name as the OS lists it, e.g. `mygame.exe`. */
  readonly process: string;
  readonly name: string;
}

/** `tasklist /fo csv /nh` → lowercased image names. */
export function parseTasklist(output: string): Set<string> {
  const names = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const match = /^"([^"]+)"/.exec(line);
    if (match?.[1]) names.add(match[1].toLowerCase());
  }
  return names;
}

/** Image names of running processes; nothing else about them is read or kept. */
export async function listProcessNames(platform = process.platform): Promise<Set<string>> {
  if (platform === 'win32') {
    const { stdout } = await run('tasklist', ['/fo', 'csv', '/nh'], {
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
      timeout: 10_000,
    });
    return parseTasklist(stdout);
  }
  if (platform !== 'linux') return new Set();
  const names = new Set<string>();
  const entries = await readdir('/proc').catch(() => [] as string[]);
  await Promise.all(
    entries
      .filter((entry) => /^\d+$/.test(entry))
      .map(async (pid) => {
        const comm = await readFile(`/proc/${pid}/comm`, 'utf8').catch(() => '');
        if (comm.trim()) names.add(comm.trim().toLowerCase());
        // comm is cut at 15 characters; the executable's own name is the full one.
        const exe = await readlink(`/proc/${pid}/exe`).catch(() => '');
        if (exe) names.add(basename(exe).toLowerCase());
      }),
  );
  return names;
}

/** The first known game running: the user's own list wins over the bundled one. */
export function matchGame(
  running: ReadonlySet<string>,
  userGames: readonly UserGame[],
  bundled: Readonly<Record<string, string>>,
): string | null {
  for (const game of userGames) if (running.has(game.process.toLowerCase())) return game.name;
  for (const [process, name] of Object.entries(bundled)) if (running.has(process)) return name;
  return null;
}

/**
 * Polls the process list while enabled and reports the current game (with the time it was
 * first seen) or null.
 */
export function createGameDetector(options: {
  readonly bundled: () => Promise<Readonly<Record<string, string>>>;
  readonly userGames: () => readonly UserGame[];
  readonly list?: () => Promise<Set<string>>;
  readonly onChange: (activity: ActivityInput | null) => void;
}) {
  const list = options.list ?? (() => listProcessNames());
  let timer: NodeJS.Timeout | undefined;
  let current: { name: string; startedAt: string } | null = null;

  async function tick() {
    const [running, bundled] = await Promise.all([list(), options.bundled()]);
    const name = matchGame(running, options.userGames(), bundled);
    if (name === (current?.name ?? null)) return;
    current = name ? { name, startedAt: new Date().toISOString() } : null;
    options.onChange(
      current ? { type: 'playing', name: current.name, startedAt: current.startedAt } : null,
    );
  }

  return {
    start() {
      if (timer) return;
      void tick().catch(() => undefined);
      timer = setInterval(() => void tick().catch(() => undefined), GAME_POLL_MS);
      timer.unref();
    },
    stop() {
      clearInterval(timer);
      timer = undefined;
      if (current) {
        current = null;
        options.onChange(null);
      }
    },
    refresh: () => tick(),
  };
}
