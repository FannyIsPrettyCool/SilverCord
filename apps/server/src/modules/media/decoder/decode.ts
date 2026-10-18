import { execFile } from 'node:child_process';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { MediaVariant, UploadFailure } from '@silvercord/protocol';
import { encode } from 'blurhash';
import sharp, { type Sharp, type SharpOptions } from 'sharp';
import type { Sniffed } from '../sniff.ts';

const run = promisify(execFile);

// One job per process: libvips' cache would only keep hostile inputs and their handles open.
sharp.cache(false);

/** docs/spec/media.md processing bounds. */
export const LIMITS = {
  maxAxis: 8192,
  maxFramePixels: 40_000_000,
  maxFrames: 100,
  maxTotalPixels: 100_000_000,
  displayEdge: 2560,
  thumbnailEdge: 480,
  maxVideoMs: 6 * 60 * 60 * 1000,
} as const;

export interface DecodedVariant {
  readonly variant: MediaVariant;
  /** File name inside the output directory. */
  readonly file: string;
  readonly mime: string;
  readonly width: number | null;
  readonly height: number | null;
}

export type DecodeResult =
  | {
      readonly ok: true;
      readonly kind: 'image' | 'video';
      readonly animated: boolean;
      readonly width: number;
      readonly height: number;
      readonly durationMs: number | null;
      readonly blurhash: string | null;
      readonly variants: readonly DecodedVariant[];
    }
  /** Not renderable inline here (e.g. no ffmpeg for video/APNG): serve as a download. */
  | { readonly ok: true; readonly kind: 'file' }
  | { readonly ok: false; readonly failure: UploadFailure };

class DecodeFailure extends Error {
  readonly failure: UploadFailure;
  constructor(failure: UploadFailure) {
    super(failure);
    this.failure = failure;
  }
}

async function hasFfmpeg(): Promise<boolean> {
  try {
    await run('ffprobe', ['-version'], { timeout: 5000, env: {} });
    return true;
  } catch {
    return false;
  }
}

/** APNG carries an `acTL` chunk before the first `IDAT`. */
async function isAnimatedPng(path: string): Promise<boolean> {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(64 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const head = buffer.subarray(0, bytesRead);
    const actl = head.indexOf('acTL');
    const idat = head.indexOf('IDAT');
    return actl !== -1 && (idat === -1 || actl < idat);
  } finally {
    await handle.close();
  }
}

async function blurhashOf(input: Sharp): Promise<string> {
  const { data, info } = await input
    .clone()
    .resize(32, 32, { fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return encode(new Uint8ClampedArray(data), info.width, info.height, 4, 3);
}

function checkDimensions(width: number, frameHeight: number, frames: number) {
  if (width > LIMITS.maxAxis || frameHeight > LIMITS.maxAxis)
    throw new DecodeFailure('LIMIT_EXCEEDED');
  if (width * frameHeight > LIMITS.maxFramePixels) throw new DecodeFailure('LIMIT_EXCEEDED');
  if (frames > LIMITS.maxFrames) throw new DecodeFailure('LIMIT_EXCEEDED');
  if (width * frameHeight * frames > LIMITS.maxTotalPixels)
    throw new DecodeFailure('LIMIT_EXCEEDED');
}

async function resized(
  source: Sharp,
  edge: number,
  file: string,
  outDir: string,
  variant: MediaVariant,
  quality: number,
): Promise<DecodedVariant> {
  const info = await source
    .clone()
    .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
    .webp({ quality, effort: 4 })
    .toFile(join(outDir, file));
  return {
    variant,
    file,
    mime: 'image/webp',
    width: info.width,
    height: info.pageHeight ?? info.height,
  };
}

async function decodeImage(
  path: string,
  format: 'jpeg' | 'png' | 'gif' | 'webp',
  outDir: string,
): Promise<DecodeResult> {
  const options: SharpOptions = {
    limitInputPixels: LIMITS.maxFramePixels,
    failOn: 'error',
    sequentialRead: true,
  };
  const animatedInput = format === 'gif' || format === 'webp';
  const probe = await sharp(path, { ...options, animated: animatedInput }).metadata();
  const width = probe.width;
  const frames = probe.pages ?? 1;
  const frameHeight = probe.pageHeight ?? probe.height;
  if (!width || !frameHeight) throw new DecodeFailure('MALFORMED');
  checkDimensions(width, frameHeight, frames);
  const animated = animatedInput && frames > 1;
  // Animated sources keep every frame, delay and loop; still images are auto-oriented.
  const base = animated
    ? sharp(path, { ...options, animated: true })
    : sharp(path, { ...options, animated: false }).rotate();
  const display = await resized(base, LIMITS.displayEdge, 'display.webp', outDir, 'display', 85);
  const thumbnail = await resized(
    base,
    LIMITS.thumbnailEdge,
    'thumbnail.webp',
    outDir,
    'thumbnail',
    75,
  );
  // The download is a re-encode in the original format: metadata (EXIF/GPS/XMP) never survives.
  const downloadFile = `download.${format === 'jpeg' ? 'jpg' : format}`;
  const encoder = base.clone();
  const encoded =
    format === 'jpeg'
      ? encoder.jpeg({ quality: 92, mozjpeg: true })
      : format === 'png'
        ? encoder.png()
        : format === 'gif'
          ? encoder.gif()
          : encoder.webp({ quality: 90 });
  const downloadInfo = await encoded.toFile(join(outDir, downloadFile));
  const mime = { jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' }[
    format
  ];
  return {
    ok: true,
    kind: 'image',
    animated,
    // The download keeps original (auto-oriented) dimensions.
    width: downloadInfo.width,
    height: downloadInfo.pageHeight ?? downloadInfo.height,
    durationMs: null,
    blurhash: await blurhashOf(sharp(path, { ...options, animated: false }).rotate()),
    variants: [
      display,
      thumbnail,
      {
        variant: 'download',
        file: downloadFile,
        mime,
        width: downloadInfo.width,
        height: downloadInfo.pageHeight ?? downloadInfo.height,
      },
    ],
  };
}

async function decodeAnimatedPng(path: string, outDir: string): Promise<DecodeResult> {
  // libvips cannot read APNG frames; ffmpeg decodes them into a sanitized animated WebP.
  const converted = join(outDir, 'apng.webp');
  await run(
    'ffmpeg',
    [
      '-v',
      'error',
      '-f',
      'apng',
      '-i',
      path,
      '-frames:v',
      String(LIMITS.maxFrames),
      '-loop',
      '0',
      '-c:v',
      'libwebp',
      '-y',
      converted,
    ],
    { timeout: 20_000, env: {}, maxBuffer: 1024 * 1024 },
  );
  return decodeImage(converted, 'webp', outDir);
}

async function decodeVideo(
  path: string,
  outDir: string,
  format: 'mp4' | 'webm',
): Promise<DecodeResult> {
  const { stdout } = await run(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height:format=duration',
      '-of',
      'json',
      path,
    ],
    { timeout: 10_000, env: {}, maxBuffer: 1024 * 1024 },
  );
  const probe = JSON.parse(stdout) as {
    streams?: { width?: number; height?: number }[];
    format?: { duration?: string };
  };
  const stream = probe.streams?.[0];
  const durationMs = Math.round(Number(probe.format?.duration ?? 0) * 1000);
  if (!stream?.width || !stream.height || !Number.isFinite(durationMs))
    throw new DecodeFailure('MALFORMED');
  if (
    stream.width > LIMITS.maxAxis ||
    stream.height > LIMITS.maxAxis ||
    durationMs > LIMITS.maxVideoMs
  )
    throw new DecodeFailure('LIMIT_EXCEEDED');
  const posterFile = join(outDir, 'poster.png');
  await run(
    'ffmpeg',
    ['-v', 'error', '-i', path, '-frames:v', '1', '-f', 'image2', '-y', posterFile],
    {
      timeout: 20_000,
      env: {},
      maxBuffer: 1024 * 1024,
    },
  );
  const poster = sharp(posterFile, { limitInputPixels: LIMITS.maxFramePixels, failOn: 'error' });
  const display = await resized(poster, LIMITS.displayEdge, 'display.webp', outDir, 'display', 85);
  const thumbnail = await resized(
    poster,
    LIMITS.thumbnailEdge,
    'thumbnail.webp',
    outDir,
    'thumbnail',
    75,
  );
  return {
    ok: true,
    kind: 'video',
    animated: false,
    width: stream.width,
    height: stream.height,
    durationMs,
    blurhash: await blurhashOf(poster),
    variants: [
      display,
      thumbnail,
      // Validated container bytes; served with nosniff and a fixed MIME.
      {
        variant: 'download',
        file: 'source',
        mime: `video/${format}`,
        width: stream.width,
        height: stream.height,
      },
    ],
  };
}

/**
 * Decodes one hostile input into sanitized variants inside `outDir`. Never throws: every
 * problem becomes a safe failure code.
 */
export async function decode(
  path: string,
  sniffed: Sniffed,
  outDir: string,
): Promise<DecodeResult> {
  try {
    if (sniffed.kind === 'rejected') return { ok: false, failure: 'UNSUPPORTED_TYPE' };
    if (sniffed.kind === 'file') return { ok: true, kind: 'file' };
    if (sniffed.kind === 'video') {
      return (await hasFfmpeg())
        ? await decodeVideo(path, outDir, sniffed.format)
        : { ok: true, kind: 'file' };
    }
    if (sniffed.format === 'png' && (await isAnimatedPng(path))) {
      // Never silently flatten animation: without ffmpeg an APNG stays download-only.
      return (await hasFfmpeg())
        ? await decodeAnimatedPng(path, outDir)
        : { ok: true, kind: 'file' };
    }
    return await decodeImage(path, sniffed.format, outDir);
  } catch (error) {
    if (error instanceof DecodeFailure) return { ok: false, failure: error.failure };
    const message = error instanceof Error ? error.message : '';
    if (/pixel limit|exceeds/i.test(message)) return { ok: false, failure: 'LIMIT_EXCEEDED' };
    return { ok: false, failure: 'MALFORMED' };
  }
}
