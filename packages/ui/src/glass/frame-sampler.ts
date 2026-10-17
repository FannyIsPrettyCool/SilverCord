import { DEFAULT_GOVERNOR } from './frame-governor.ts';

interface SamplingOptions {
  readonly frames: number;
  readonly intervalMs: number;
}

/** Samples one governor window per burst, leaving no RAF running during the idle interval. */
export function startFrameSampling(
  record: (frameMs: number) => void,
  options: SamplingOptions = { frames: DEFAULT_GOVERNOR.windowFrames, intervalMs: 5000 },
): () => void {
  let frame = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last: number | undefined;
  let remaining = options.frames;

  const tick = (now: number) => {
    frame = 0;
    if (last !== undefined) {
      record(now - last);
      remaining -= 1;
    }
    last = now;
    if (remaining > 0) frame = requestAnimationFrame(tick);
    else
      timer = setTimeout(() => {
        timer = undefined;
        start();
      }, options.intervalMs);
  };
  const start = () => {
    if (frame || timer !== undefined || document.hidden || !document.hasFocus()) return;
    last = undefined;
    remaining = options.frames;
    frame = requestAnimationFrame(tick);
  };
  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    clearTimeout(timer);
    timer = undefined;
  };
  const onVisibility = () => (document.hidden ? stop() : start());
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus', start);
  window.addEventListener('blur', stop);
  start();
  return () => {
    stop();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('focus', start);
    window.removeEventListener('blur', stop);
  };
}
