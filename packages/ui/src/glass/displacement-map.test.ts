import { describe, expect, it } from 'vitest';
import { buildDisplacementPixels } from './displacement-map.ts';

const at = (pixels: Uint8ClampedArray, width: number, x: number, y: number) => {
  const i = (x + y * width) * 4;
  return [pixels[i], pixels[i + 1]] as const;
};

describe('buildDisplacementPixels', () => {
  const shape = { width: 120, height: 40, radius: 20, bezel: 10 };
  const pixels = buildDisplacementPixels(shape);

  it('leaves the centre undisplaced', () => {
    expect(at(pixels, 120, 60, 20)).toEqual([128, 128]);
  });

  it('pushes samples inward at the edges', () => {
    const [leftX] = at(pixels, 120, 1, 20);
    const [rightX] = at(pixels, 120, 118, 20);
    const [, topY] = at(pixels, 120, 60, 1);
    expect(leftX).toBeGreaterThan(200);
    expect(rightX).toBeLessThan(56);
    expect(topY).toBeGreaterThan(200);
  });

  it('is symmetric', () => {
    const [l] = at(pixels, 120, 3, 20);
    const [r] = at(pixels, 120, 116, 20);
    expect(Math.abs((l ?? 0) - 128 - (128 - (r ?? 0)))).toBeLessThanOrEqual(1);
  });
});
