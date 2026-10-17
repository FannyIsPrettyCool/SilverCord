import { Mesh, Program, Renderer, Triangle } from 'ogl';
import { useEffect, useRef, useState } from 'react';
import { parseColor } from '../tokens/color.ts';
import type { ThemeTokens } from '../tokens/theme.ts';
import styles from './ambient.module.css';
import { AURORA_FRAGMENT, AURORA_VERTEX } from './aurora-shader.ts';

const FRAME_INTERVAL_MS = 1000 / 30;

function toVec3(color: string): [number, number, number] {
  const { r, g, b } = parseColor(color);
  return [r / 255, g / 255, b / 255];
}

function prefersReducedMotion(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface AmbientLayerProps {
  readonly theme: ThemeTokens;
  /** 0–1, how strongly the aurora shows through. */
  readonly intensity?: number;
  /** Freeze the animation (motion off, static wallpaper mode, screenshots). */
  readonly still?: boolean;
}

/**
 * Animated aurora behind the whole app so glass always has something to refract, identically on
 * every OS (BRIEF §7.1, §7.3). 30 fps cap; stops while the window is hidden or unfocused.
 */
export function AmbientLayer({ theme, intensity, still = false }: AmbientLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [webglFailed, setWebglFailed] = useState(false);
  const strength = intensity ?? (theme.scheme === 'dark' ? 0.46 : 0.6);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: Renderer;
    try {
      renderer = new Renderer({
        canvas,
        dpr: Math.min(window.devicePixelRatio, 1.5),
        alpha: false,
        antialias: false,
      });
    } catch {
      setWebglFailed(true);
      return;
    }
    const gl = renderer.gl;
    const colors = theme.ambient.slice(0, 4);
    while (colors.length < 4) colors.push(theme.ambient[0] ?? theme.color.accent);
    const uniforms = {
      uTime: { value: 0 },
      uResolution: { value: [1, 1] },
      uBase: { value: toVec3(theme.color.base) },
      uColors: { value: colors.flatMap(toVec3) },
      uIntensity: { value: strength },
    };
    const program = new Program(gl, { vertex: AURORA_VERTEX, fragment: AURORA_FRAGMENT, uniforms });
    const mesh = new Mesh(gl, { geometry: new Triangle(gl), program });

    const resize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      uniforms.uResolution.value = [gl.canvas.width, gl.canvas.height];
    };
    const startedAt = performance.now();
    const draw = (now: number) => {
      // Offset so the first frame is already mid-motion rather than a symmetric start pose.
      uniforms.uTime.value = (now - startedAt) / 1000 + 40;
      renderer.render({ scene: mesh });
    };
    const onResize = () => {
      resize();
      draw(performance.now());
    };
    resize();
    window.addEventListener('resize', onResize);

    const frozen = still || prefersReducedMotion();
    let frame = 0;
    let lastDraw = 0;
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (now - lastDraw < FRAME_INTERVAL_MS) return;
      lastDraw = now;
      draw(now);
    };
    const start = () => {
      if (frozen || frame || document.hidden || !document.hasFocus()) return;
      frame = requestAnimationFrame(loop);
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    draw(performance.now());
    start();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', start);
    window.addEventListener('blur', stop);
    return () => {
      stop();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', start);
      window.removeEventListener('blur', stop);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, [theme, strength, still]);

  return (
    <div className={styles['layer']} aria-hidden="true">
      {webglFailed ? (
        <div className={styles['fallback']} />
      ) : (
        <canvas ref={canvasRef} className={styles['canvas']} />
      )}
    </div>
  );
}
