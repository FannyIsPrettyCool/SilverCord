import type { BadgeVisual } from '@silvercord/protocol';

interface Surface {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  readonly visual: BadgeVisual;
  readonly color: string;
  readonly seed: number;
}
const surfaces = new Set<Surface>();
const TOTAL_BUDGET = 180;
let frame = 0;
let last = 0;
let time = 0;

/** One bounded animation loop across every visible medallion; no React work per frame. */
function tick(now: number) {
  frame = 0;
  if (document.hidden || surfaces.size === 0) return;
  if (now - last >= 1000 / 30) {
    time += Math.min(64, now - (last || now));
    last = now;
    const budget = Math.min(24, Math.floor(TOTAL_BUDGET / surfaces.size));
    for (const surface of surfaces) draw(surface, time, budget);
  }
  frame = requestAnimationFrame(tick);
}
function resume() {
  if (!document.hidden && surfaces.size && !frame) {
    last = 0;
    frame = requestAnimationFrame(tick);
  }
  if (document.hidden && frame) {
    cancelAnimationFrame(frame);
    frame = 0;
  }
}
function random(seed: number, index: number) {
  const x = Math.sin(seed * 17.13 + index * 127.1) * 43758.5453;
  return x - Math.floor(x);
}
function draw(
  { canvas, context: ctx, visual, color, seed }: Surface,
  elapsed: number,
  budget: number,
) {
  const size = canvas.clientWidth;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(size * dpr)) {
    canvas.width = Math.round(size * dpr);
    canvas.height = canvas.width;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  const count = Math.min(budget, 6 + visual.intensity * 6);
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const r = random(seed, i);
    const phase = (elapsed / (2200 + r * 2400) + random(seed, i + 90)) % 1;
    const angle = r * Math.PI * 2 + elapsed / 9000;
    const orbit = size * (0.27 + phase * 0.2);
    const x = size / 2 + Math.cos(angle) * orbit;
    const y =
      visual.particles === 'sparks'
        ? size * (0.85 - phase * 0.7)
        : size / 2 + Math.sin(angle) * orbit;
    const radius = (0.5 + random(seed, i + 45)) * Math.max(0.65, size / 80);
    ctx.globalAlpha = Math.sin(phase * Math.PI) * 0.9;
    ctx.beginPath();
    if (visual.particles === 'stars') {
      ctx.moveTo(x, y - radius * 2);
      ctx.lineTo(x + radius * 0.55, y - radius * 0.55);
      ctx.lineTo(x + radius * 2, y);
      ctx.lineTo(x + radius * 0.55, y + radius * 0.55);
      ctx.lineTo(x, y + radius * 2);
      ctx.lineTo(x - radius * 0.55, y + radius * 0.55);
      ctx.lineTo(x - radius * 2, y);
      ctx.lineTo(x - radius * 0.55, y - radius * 0.55);
      ctx.closePath();
    } else
      ctx.ellipse(
        x,
        y,
        radius,
        visual.particles === 'sparks' ? radius * 2.4 : radius,
        0,
        0,
        Math.PI * 2,
      );
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export function attachBadgeParticles(
  canvas: HTMLCanvasElement,
  visual: BadgeVisual,
  color: string,
  seed: number,
) {
  const context = canvas.getContext('2d');
  if (!context || visual.particles === 'none') return () => {};
  const surface = { canvas, context, visual, color, seed };
  if (surfaces.size === 0) document.addEventListener('visibilitychange', resume);
  surfaces.add(surface);
  resume();
  return () => {
    surfaces.delete(surface);
    if (!surfaces.size) {
      cancelAnimationFrame(frame);
      frame = 0;
      document.removeEventListener('visibilitychange', resume);
    }
    context.clearRect(0, 0, canvas.width, canvas.height);
  };
}
