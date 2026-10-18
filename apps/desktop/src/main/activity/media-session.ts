import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { ActivityInput } from '@silvercord/protocol';
import { z } from 'zod';

const run = promisify(execFile);
const INTERVAL_SECONDS = 5;
const LINUX_POLL_MS = 10_000;

/**
 * Windows SMTC reader (docs/spec/activity.md): one long-lived PowerShell process that prints the
 * current media session as a JSON line every few seconds. Reads only; never controls playback.
 */
export const SMTC_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'
} | Select-Object -First 1
function Await($operation, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation))
  $null = $task.Wait(5000)
  $task.Result
}
$managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
$manager = Await ($managerType::RequestAsync()) $managerType
while ($true) {
  $out = @{ status = 'None' }
  try {
    $session = $manager.GetCurrentSession()
    if ($session) {
      $props = Await ($session.TryGetMediaPropertiesAsync()) $propsType
      $info = $session.GetPlaybackInfo()
      $out = @{ title = $props.Title; artist = $props.Artist; album = $props.AlbumTitle; app = $session.SourceAppUserModelId; status = $info.PlaybackStatus.ToString(); kind = "$($info.PlaybackType)" }
    }
  } catch { $out = @{ status = 'None' } }
  [Console]::Out.WriteLine(($out | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
  Start-Sleep -Seconds ${INTERVAL_SECONDS}
}
`;

const smtcLineSchema = z.object({
  status: z.string().max(32),
  title: z.string().max(2000).nullable().optional(),
  artist: z.string().max(2000).nullable().optional(),
  album: z.string().max(2000).nullable().optional(),
  app: z.string().max(512).nullable().optional(),
  kind: z.string().max(32).nullable().optional(),
});

const PLAYERS: readonly [RegExp, string][] = [
  [/spotify/i, 'Spotify'],
  [/operagx/i, 'Opera GX'],
  [/opera/i, 'Opera'],
  [/msedge|microsoftedge/i, 'Microsoft Edge'],
  [/chrome/i, 'Chrome'],
  [/firefox/i, 'Firefox'],
  [/vlc/i, 'VLC'],
  [/foobar/i, 'foobar2000'],
  [/applemusic|itunes/i, 'Apple Music'],
  [/musicbee/i, 'MusicBee'],
  [/tidal/i, 'TIDAL'],
  [/deezer/i, 'Deezer'],
  [/zunemusic|groove|media\.player/i, 'Media Player'],
];

/** A readable player name for an app id; unknown ids stay private (null). */
export function playerName(app: string | null | undefined): string | null {
  if (!app) return null;
  return PLAYERS.find(([pattern]) => pattern.test(app))?.[1] ?? null;
}

const clip = (value: string | null | undefined, max = 128) => {
  const text = value?.replace(/[\p{Cc}\p{Cf}]/gu, '').trim();
  return text ? [...text].slice(0, max).join('') : null;
};

/** Only playing media becomes an activity: paused or stopped clears it. */
export function mediaActivity(input: {
  readonly status: string;
  readonly title?: string | null | undefined;
  readonly artist?: string | null | undefined;
  readonly player?: string | null | undefined;
  readonly video?: boolean;
}): ActivityInput | null {
  const name = clip(input.title);
  if (!/^playing$/i.test(input.status) || !name) return null;
  return {
    type: input.video ? 'watching' : 'listening',
    name,
    details: clip(input.artist),
    state: clip(input.player, 64),
  };
}

export function parseSmtcLine(line: string): ActivityInput | null | undefined {
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    return undefined;
  }
  const parsed = smtcLineSchema.safeParse(json);
  if (!parsed.success) return undefined;
  const value = parsed.data;
  return mediaActivity({
    status: value.status,
    title: value.title,
    artist: value.artist,
    player: playerName(value.app),
    video: value.kind === 'Video',
  });
}

/** `playerctl metadata --format` with tab-separated status, artist, title and player. */
export function parsePlayerctl(output: string): ActivityInput | null {
  const [status = '', artist, title, player] = output.trim().split('\t');
  return mediaActivity({
    status,
    title,
    artist,
    player: player ? (playerName(player) ?? player) : null,
  });
}

export function createMediaSession(options: {
  readonly onChange: (activity: ActivityInput | null) => void;
  readonly platform?: NodeJS.Platform;
}) {
  const platform = options.platform ?? process.platform;
  let child: ChildProcess | null = null;
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let last = 'null';
  let restarts = 0;

  const report = (activity: ActivityInput | null) => {
    const key = JSON.stringify(activity);
    if (key === last) return;
    last = key;
    options.onChange(activity);
  };

  function spawnWindows() {
    const encoded = Buffer.from(SMTC_SCRIPT, 'utf16le').toString('base64');
    const process_ = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    child = process_;
    let buffer = '';
    process_.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      if (buffer.length > 64 * 1024) buffer = '';
      for (;;) {
        const index = buffer.indexOf('\n');
        if (index < 0) break;
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        const activity = parseSmtcLine(line);
        if (activity !== undefined) {
          restarts = 0;
          report(activity);
        }
      }
    });
    process_.once('exit', () => {
      if (child === process_) child = null;
      if (!running) return;
      // Backs off when PowerShell or WinRT is unavailable; gives up after a few tries.
      restarts += 1;
      if (restarts > 5) return report(null);
      timer = setTimeout(spawnWindows, 2_000 * 2 ** restarts);
      timer.unref();
    });
  }

  async function pollLinux() {
    try {
      const { stdout } = await run(
        'playerctl',
        ['metadata', '--format', '{{status}}\t{{xesam:artist}}\t{{xesam:title}}\t{{playerName}}'],
        { timeout: 5_000, maxBuffer: 64 * 1024 },
      );
      report(parsePlayerctl(stdout));
    } catch {
      // No player, or playerctl missing (docs/PLATFORM-LIMITS.md).
      report(null);
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      restarts = 0;
      if (platform === 'win32') spawnWindows();
      else if (platform === 'linux') {
        void pollLinux();
        timer = setInterval(() => void pollLinux(), LINUX_POLL_MS);
        timer.unref();
      }
    },
    stop() {
      running = false;
      clearTimeout(timer);
      clearInterval(timer);
      timer = undefined;
      child?.kill();
      child = null;
      report(null);
    },
  };
}
