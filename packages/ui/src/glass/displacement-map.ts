/**
 * Displacement map for the High tier's refraction (BRIEF §7.2): a rounded-rectangle lens whose
 * bezel bends the backdrop toward the centre. Red/green encode x/y offsets around 128.
 */
export interface LensShape {
  readonly width: number;
  readonly height: number;
  readonly radius: number;
  /** Width of the refracting rim in px. */
  readonly bezel: number;
}

/** Signed distance from a point to the edge of a rounded rectangle centred at the origin. */
function roundedRectDistance(
  x: number,
  y: number,
  halfW: number,
  halfH: number,
  radius: number,
): number {
  const qx = Math.abs(x) - (halfW - radius);
  const qy = Math.abs(y) - (halfH - radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - radius;
}

/** RGBA pixels (row-major) for `shape`; pure so it can be tested without a canvas. */
export function buildDisplacementPixels(shape: LensShape): Uint8ClampedArray<ArrayBuffer> {
  const { width, height, bezel } = shape;
  const radius = Math.min(shape.radius, width / 2, height / 2);
  const halfW = width / 2;
  const halfH = height / 2;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const x = px + 0.5 - halfW;
      const y = py + 0.5 - halfH;
      const inset = -roundedRectDistance(x, y, halfW, halfH, radius);
      // Strength rises toward the edge with a convex (squared) profile, like a thick lens rim.
      const t = inset >= bezel || inset <= 0 ? 0 : (1 - inset / bezel) ** 2;
      // Gradient of the distance field ≈ outward normal; push samples inward along it.
      const e = 0.5;
      const nx =
        roundedRectDistance(x + e, y, halfW, halfH, radius) -
        roundedRectDistance(x - e, y, halfW, halfH, radius);
      const ny =
        roundedRectDistance(x, y + e, halfW, halfH, radius) -
        roundedRectDistance(x, y - e, halfW, halfH, radius);
      const length = Math.hypot(nx, ny) || 1;
      const offset = (px + py * width) * 4;
      pixels[offset] = 128 - (nx / length) * t * 127;
      pixels[offset + 1] = 128 - (ny / length) * t * 127;
      pixels[offset + 2] = 128;
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
}

const cache = new Map<string, string>();

/** PNG data URL for a lens, cached per shape. Browser only (uses a canvas). */
export function displacementMapUrl(shape: LensShape): string {
  const key = `${shape.width}x${shape.height}r${shape.radius}b${shape.bezel}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = shape.width;
  canvas.height = shape.height;
  const context = canvas.getContext('2d');
  if (!context) return '';
  const image = new ImageData(buildDisplacementPixels(shape), shape.width, shape.height);
  context.putImageData(image, 0, 0);
  const url = canvas.toDataURL('image/png');
  cache.set(key, url);
  return url;
}
