import { type RefObject, useEffect, useId } from 'react';
import { displacementMapUrl } from './displacement-map.ts';
import { useGlassQuality } from './glass-quality.tsx';

const SVG_NS = 'http://www.w3.org/2000/svg';
const DEFS_ID = 'glass-refraction-defs';
const BEZEL_PX = 14;
const DISPLACEMENT_SCALE = 28;

function defsRoot(): SVGSVGElement {
  const existing = document.getElementById(DEFS_ID);
  if (existing instanceof SVGSVGElement) return existing;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.id = DEFS_ID;
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.position = 'absolute';
  document.body.append(svg);
  return svg;
}

interface FilterLook {
  readonly blur: number;
  readonly saturate: number;
  readonly brightness: number;
}

function readLook(element: HTMLElement): FilterLook {
  const style = getComputedStyle(element);
  const number = (name: string, fallback: number) =>
    Number.parseFloat(style.getPropertyValue(name)) || fallback;
  return {
    blur: number('--glass-blur', 16),
    saturate: number('--glass-saturate', 1.6),
    brightness: number('--glass-brightness', 1),
  };
}

function svgElement(name: string, attributes: Record<string, string>): SVGElement {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

/**
 * blur → saturate → brightness → displace. Chromium (Electron 44) ignores CSS filter functions
 * listed after an SVG reference in `backdrop-filter`, and disables a reference filter that
 * applies anything after feDisplacementMap, so displacement must be the final primitive
 * (docs/PLATFORM-LIMITS.md). Blur is halved so the lensing at the rim stays visible.
 */
function buildFilter(id: string, width: number, height: number, radius: number, look: FilterLook) {
  const filter = svgElement('filter', {
    id,
    x: '0',
    y: '0',
    width: `${width}`,
    height: `${height}`,
    filterUnits: 'userSpaceOnUse',
    'color-interpolation-filters': 'sRGB',
  });
  const lens = displacementMapUrl({ width, height, radius, bezel: BEZEL_PX });
  const transfer = svgElement('feComponentTransfer', { in: 'saturated', result: 'graded' });
  for (const channel of ['feFuncR', 'feFuncG', 'feFuncB']) {
    transfer.append(svgElement(channel, { type: 'linear', slope: look.brightness.toFixed(3) }));
  }
  filter.append(
    svgElement('feImage', { href: lens, width: `${width}`, height: `${height}`, result: 'lens' }),
    // CSS blur(r) uses r as the Gaussian standard deviation.
    svgElement('feGaussianBlur', {
      in: 'SourceGraphic',
      stdDeviation: `${look.blur / 2}`,
      result: 'blurred',
    }),
    svgElement('feColorMatrix', {
      in: 'blurred',
      type: 'saturate',
      values: `${look.saturate}`,
      result: 'saturated',
    }),
    transfer,
    svgElement('feDisplacementMap', {
      in: 'graded',
      in2: 'lens',
      scale: `${DISPLACEMENT_SCALE}`,
      xChannelSelector: 'R',
      yChannelSelector: 'G',
    }),
  );
  return filter;
}

/**
 * Chromium-only SVG displacement refraction for small floating glass (High tier, BRIEF §7.2).
 * Until the filter exists the element keeps the plain blur chain; once attached it switches via
 * `data-refracting`. Rebuilt when the element resizes or the theme changes.
 */
export function useRefraction(ref: RefObject<HTMLElement | null>, requested: boolean): void {
  const { tier, claimRefraction } = useGlassQuality();
  const reactId = useId();
  const active = requested && tier === 'high';

  useEffect(() => {
    const element = ref.current;
    if (!element || !active) return;
    const release = claimRefraction();
    if (!release) return;
    const id = `glass-refract-${reactId.replace(/[^a-zA-Z0-9-]/g, '')}`;
    let filter: SVGElement | null = null;
    const rebuild = () => {
      const { width, height } = element.getBoundingClientRect();
      const w = Math.max(1, Math.round(width));
      const h = Math.max(1, Math.round(height));
      const radius = Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
      const next = buildFilter(id, w, h, Math.min(radius, h / 2), readLook(element));
      if (filter) filter.replaceWith(next);
      else defsRoot().append(next);
      filter = next;
      element.style.setProperty('--glass-refraction', `url(#${id})`);
      element.dataset['refracting'] = '';
    };
    const resizeObserver = new ResizeObserver(rebuild);
    resizeObserver.observe(element);
    const themeObserver = new MutationObserver(rebuild);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    rebuild();
    return () => {
      resizeObserver.disconnect();
      themeObserver.disconnect();
      filter?.remove();
      element.style.removeProperty('--glass-refraction');
      delete element.dataset['refracting'];
      release();
    };
  }, [ref, active, claimRefraction, reactId]);
}
