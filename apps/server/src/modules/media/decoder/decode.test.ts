import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { sniff } from '../sniff.ts';
import { decode } from './decode.ts';

const directories: string[] = [];
async function workspace() {
  const directory = await mkdtemp(join(tmpdir(), 'decode-'));
  directories.push(directory);
  return directory;
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

const solid = (width: number, height: number, r = 200) =>
  sharp({ create: { width, height, channels: 3, background: { r, g: 80, b: 120 } } });

async function decodeBuffer(buffer: Buffer) {
  const directory = await workspace();
  const input = join(directory, 'input');
  await writeFile(input, buffer);
  return { result: await decode(input, sniff(buffer.subarray(0, 512)), directory), directory };
}

describe('media decoder', () => {
  it('strips EXIF and GPS from every variant and keeps original dimensions for download', async () => {
    const photo = await solid(1200, 800)
      .jpeg()
      .withExif({ IFD0: { Copyright: 'secret-owner' }, IFD3: { GPSLatitudeRef: 'N' } })
      .toBuffer();
    expect((await sharp(photo).metadata()).exif).toBeDefined();
    const { result, directory } = await decodeBuffer(photo);
    if (!result.ok || result.kind !== 'image')
      throw new Error(`unexpected ${JSON.stringify(result)}`);
    expect(result).toMatchObject({ animated: false, width: 1200, height: 800 });
    expect(result.blurhash).toMatch(/^[0-9A-Za-z#$%*+,-.:;=?@[\]^_{|}~]{6,}$/);
    for (const variant of result.variants) {
      const bytes = await readFile(join(directory, variant.file));
      const metadata = await sharp(bytes).metadata();
      expect(metadata.exif, variant.variant).toBeUndefined();
      expect(bytes.includes('secret-owner')).toBe(false);
    }
    const thumbnail = result.variants.find((variant) => variant.variant === 'thumbnail');
    expect(thumbnail).toMatchObject({ mime: 'image/webp', width: 480, height: 320 });
  });

  it('keeps animation frames and timing', async () => {
    const frames = await Promise.all([
      solid(64, 64, 10).png().toBuffer(),
      solid(64, 64, 250).png().toBuffer(),
    ]);
    const gif = await sharp(frames, { join: { animated: true } })
      .gif({ delay: [120, 480], loop: 0 })
      .toBuffer();
    const { result, directory } = await decodeBuffer(gif);
    if (!result.ok || result.kind !== 'image') throw new Error('expected image');
    expect(result.animated).toBe(true);
    const display = result.variants.find((variant) => variant.variant === 'display');
    const metadata = await sharp(await readFile(join(directory, display?.file ?? '')), {
      animated: true,
    }).metadata();
    expect(metadata.pages).toBe(2);
    expect(metadata.delay).toEqual([120, 480]);
  });

  it('refuses oversize axes and frame bombs', async () => {
    const wide = await solid(9000, 4).png().toBuffer();
    expect((await decodeBuffer(wide)).result).toEqual({ ok: false, failure: 'LIMIT_EXCEEDED' });
    // Noise frames: the GIF encoder merges identical or near-identical consecutive frames.
    const noise = () =>
      sharp({
        create: {
          width: 8,
          height: 8,
          channels: 3,
          background: '#000',
          noise: { type: 'gaussian', mean: 128, sigma: 60 },
        },
      })
        .png()
        .toBuffer();
    const frames = await Promise.all(Array.from({ length: 101 }, noise));
    const bomb = await sharp(frames, { join: { animated: true } })
      .gif()
      .toBuffer();
    expect((await decodeBuffer(bomb)).result).toEqual({ ok: false, failure: 'LIMIT_EXCEEDED' });
  });

  it('fails safely on truncated or rejected input and leaves other files download-only', async () => {
    const photo = await solid(300, 300).jpeg().toBuffer();
    expect((await decodeBuffer(photo.subarray(0, 200))).result).toEqual({
      ok: false,
      failure: 'MALFORMED',
    });
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>');
    expect((await decodeBuffer(svg)).result).toEqual({ ok: false, failure: 'UNSUPPORTED_TYPE' });
    expect((await decodeBuffer(Buffer.from('%PDF-1.7 fake'))).result).toEqual({
      ok: true,
      kind: 'file',
    });
  });
});
