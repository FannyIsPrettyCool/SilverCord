import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ActivityInput } from '@silvercord/protocol';
import { z } from 'zod';
import type { ActivitySnapshot, DetectorSwitches, RpcApps } from '../../shared/ipc-contract.ts';
import { createGameDetector, USER_GAMES_MAX, type UserGame } from './game-detector.ts';
import { createMediaSession } from './media-session.ts';
import { createRpcServer, type RpcDecision } from './rpc-server.ts';

const userGamesSchema = z
  .array(
    z.object({
      process: z.string().trim().toLowerCase().min(1).max(128),
      name: z.string().trim().min(1).max(128),
    }),
  )
  .max(USER_GAMES_MAX);
const rpcAppsSchema = z.object({
  allowed: z.array(z.string().max(64)).max(100),
  denied: z.array(z.string().max(64)).max(100),
});

async function readJson<T>(path: string, schema: z.ZodType<T>, fallback: T): Promise<T> {
  try {
    const parsed = schema.safeParse(JSON.parse(await readFile(path, 'utf8')));
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

/** Written to a temporary file first, so a crash never leaves half a file. */
async function writeJson(path: string, value: unknown) {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(temporary, path);
}

/**
 * The three detected activity sources (docs/spec/activity.md). Each runs only while its switch
 * is on; the renderer polls `snapshot()` and forwards changes to the API.
 */
export function createActivityHub(options: {
  readonly userData: string;
  readonly resources: string;
}) {
  const gamesPath = join(options.userData, 'activity-games.json');
  const appsPath = join(options.userData, 'rpc-apps.json');
  const current: {
    game: ActivityInput | null;
    rpc: ActivityInput | null;
    media: ActivityInput | null;
  } = {
    game: null,
    rpc: null,
    media: null,
  };
  let switches: DetectorSwitches = { game: false, rpc: false, media: false };
  let userGames: UserGame[] = [];
  let apps: RpcApps = { allowed: [], denied: [] };
  const requests = new Set<string>();
  let bundled: Promise<Record<string, string>> | null = null;
  const loaded = Promise.all([
    readJson(gamesPath, userGamesSchema, []).then((value) => {
      userGames = value;
    }),
    readJson(appsPath, rpcAppsSchema, { allowed: [], denied: [] }).then((value) => {
      apps = value;
    }),
  ]);

  const games = createGameDetector({
    bundled: () => {
      bundled ??= readJson(
        join(options.resources, 'games.json'),
        z.record(z.string(), z.string()),
        {},
      );
      return bundled;
    },
    userGames: () => userGames,
    onChange: (activity) => {
      current.game = activity;
    },
  });
  const media = createMediaSession({
    onChange: (activity) => {
      current.media = activity;
    },
  });
  const rpc = createRpcServer({
    decision: (client): RpcDecision =>
      apps.allowed.includes(client)
        ? 'allowed'
        : apps.denied.includes(client)
          ? 'denied'
          : 'unknown',
    onRequest: (client) => requests.add(client),
    onChange: (activity) => {
      current.rpc = activity;
    },
  });

  return {
    async configure(next: DetectorSwitches): Promise<null> {
      await loaded;
      switches = next;
      if (next.game) games.start();
      else games.stop();
      if (next.media) media.start();
      else media.stop();
      if (next.rpc) await rpc.start();
      else {
        requests.clear();
        await rpc.stop();
      }
      return null;
    },

    snapshot(): ActivitySnapshot {
      return {
        game: switches.game ? current.game : null,
        rpc: switches.rpc ? current.rpc : null,
        media: switches.media ? current.media : null,
        rpcRequests: [...requests],
        rpcAddress: switches.rpc ? rpc.address : null,
      };
    },

    async games(): Promise<UserGame[]> {
      await loaded;
      return userGames;
    },
    async setGames(next: readonly UserGame[]): Promise<UserGame[]> {
      await loaded;
      userGames = userGamesSchema.parse(next);
      await writeJson(gamesPath, userGames);
      if (switches.game) await games.refresh().catch(() => undefined);
      return userGames;
    },

    async rpcApps(): Promise<RpcApps> {
      await loaded;
      return apps;
    },
    async decide(client: string, allow: boolean): Promise<RpcApps> {
      await loaded;
      requests.delete(client);
      apps = {
        allowed: [
          ...apps.allowed.filter((name) => name !== client),
          ...(allow ? [client] : []),
        ].slice(-100),
        denied: [
          ...apps.denied.filter((name) => name !== client),
          ...(allow ? [] : [client]),
        ].slice(-100),
      };
      await writeJson(appsPath, apps);
      rpc.decide(client, allow);
      return apps;
    },
    /** Forget a decision: the program will ask again next time. */
    async forget(client: string): Promise<RpcApps> {
      await loaded;
      apps = {
        allowed: apps.allowed.filter((name) => name !== client),
        denied: apps.denied.filter((name) => name !== client),
      };
      await writeJson(appsPath, apps);
      return apps;
    },

    async close() {
      games.stop();
      media.stop();
      await rpc.stop();
    },
  };
}
export type ActivityHub = ReturnType<typeof createActivityHub>;
