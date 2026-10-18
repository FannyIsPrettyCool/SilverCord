import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Crop, ProfileMediaPurpose } from '@silvercord/protocol';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { sniff } from '../sniff.ts';
import { decode, frameCrop } from './decode.ts';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function run(buffer: Buffer, purpose: ProfileMediaPurpose, crop: Crop | null = null) {
  const directory = await mkdtemp(join(tmpdir(), 'decode-profile-'));
  directories.push(directory);
  const input = join(directory, 'input');
  await writeFile(input, buffer);
  const result = await decode(input, sniff(buffer.subarray(0, 512)), directory, {
    purpose,
    crop,
  });
  return { result, directory };
}

const frame = (r: number, width = 300, height = 200) =>
  sharp({ create: { width, height, channels: 4, background: { r, g: 30, b: 60, alpha: 1 } } })
    .png()
    .toBuffer();

async function animatedWebp() {
  const frames = await Promise.all([240, 120, 10].map((r) => frame(r)));
  return sharp(frames, { join: { animated: true } })
    .webp({ delay: [80, 80, 80], loop: 0 })
    .toBuffer();
}

describe('profile media decoding (ADR-0011)', () => {
  it('crops an animated avatar per frame and adds a still first frame', async () => {
    const { result, directory } = await run(await animatedWebp(), 'avatar', {
      x: 50,
      y: 0,
      width: 200,
      height: 200,
    });
    if (!result.ok || result.kind !== 'image') throw new Error(JSON.stringify(result));
    expect(result.animated).toBe(true);
    expect(result.variants.map((variant) => variant.variant)).toEqual([
      'display',
      'thumbnail',
      'still',
    ]);
    const display = await sharp(await readFile(join(directory, 'display.webp')), {
      animated: true,
    }).metadata();
    expect(display).toMatchObject({ width: 512, pageHeight: 512, pages: 3 });
    const still = await sharp(await readFile(join(directory, 'still.webp')), {
      animated: true,
    }).metadata();
    expect(still.pages ?? 1).toBe(1);
    // The first frame is red-dominant.
    expect((result.dominantColor ?? 0) >> 16).toBeGreaterThan(200);
  });

  it('centres a 5:2 banner when no crop is given and never keeps a download original', async () => {
    const { result } = await run(await frame(90, 1000, 1000), 'banner');
    if (!result.ok || result.kind !== 'image') throw new Error(JSON.stringify(result));
    expect(result.animated).toBe(false);
    expect(result).toMatchObject({ width: 1500, height: 600 });
    expect(result.variants.some((variant) => variant.variant === 'download')).toBe(false);
  });

  it('fits emotes inside their box without enlarging', async () => {
    const { result } = await run(await frame(10, 64, 32), 'emote');
    if (!result.ok || result.kind !== 'image') throw new Error(JSON.stringify(result));
    expect(result).toMatchObject({ width: 64, height: 32 });
  });

  it('rejects a crop outside the frame', async () => {
    const { result } = await run(await frame(10), 'avatar', {
      x: 200,
      y: 0,
      width: 200,
      height: 200,
    });
    expect(result).toEqual({ ok: false, failure: 'MALFORMED' });
  });

  it('refuses non-image input for profile purposes', async () => {
    const { result } = await run(Buffer.from('%PDF-1.7\n'.repeat(80)), 'avatar');
    expect(result.ok).toBe(false);
  });

  it('centres fixed-aspect frames', () => {
    expect(frameCrop(1000, 200, 1, null)).toEqual({ x: 400, y: 0, width: 200, height: 200 });
    expect(frameCrop(100, 1000, 2.5, null)).toEqual({ x: 0, y: 480, width: 100, height: 40 });
    expect(frameCrop(30, 40, null, null)).toEqual({ x: 0, y: 0, width: 30, height: 40 });
  });
});
