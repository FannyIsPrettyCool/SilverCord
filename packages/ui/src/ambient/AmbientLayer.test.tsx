import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aurora } from '../themes/aurora.ts';
import { AmbientLayer } from './AmbientLayer.tsx';

const mock = vi.hoisted(() => ({
  canvas: undefined as unknown,
  effect: undefined as (() => (() => void) | undefined) | undefined,
  failed: vi.fn(),
  render: vi.fn(),
  removeGeometry: vi.fn(),
  removeProgram: vi.fn(),
  deleteShader: vi.fn(),
  loseContext: vi.fn(),
}));

vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useRef: () => ({ current: mock.canvas }),
  useState: () => [false, mock.failed],
  useEffect: (effect: () => (() => void) | undefined) => {
    mock.effect = effect;
  },
}));

vi.mock('ogl', () => ({
  Renderer: class {
    gl = {
      canvas: { width: 1200, height: 800 },
      deleteShader: mock.deleteShader,
      getExtension: () => ({ loseContext: mock.loseContext }),
    };
    render = mock.render;
    setSize() {}
  },
  Triangle: class {
    remove = mock.removeGeometry;
  },
  Program: class {
    vertexShader = {};
    fragmentShader = {};
    remove = mock.removeProgram;
  },
  Mesh: class {},
}));

describe('ambient GPU lifecycle', () => {
  let frames: Map<number, FrameRequestCallback>;
  let canvas: EventTarget;

  beforeEach(() => {
    vi.clearAllMocks();
    frames = new Map();
    canvas = new EventTarget();
    mock.canvas = canvas;
    let nextFrame = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    vi.stubGlobal('window', Object.assign(new EventTarget(), { devicePixelRatio: 1 }));
    vi.stubGlobal(
      'document',
      Object.assign(new EventTarget(), { hidden: false, hasFocus: () => true }),
    );
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
  });

  afterEach(() => vi.unstubAllGlobals());

  function mount() {
    AmbientLayer({ theme: aurora });
    if (!mock.effect) throw new Error('Ambient effect missing');
    return mock.effect;
  }

  it('survives StrictMode setup/cleanup/setup without losing the reused canvas context', () => {
    const setup = mount();
    const cleanup = setup();
    cleanup?.();
    const cleanupAgain = setup();
    expect(mock.loseContext).not.toHaveBeenCalled();
    expect(mock.render).toHaveBeenCalledTimes(2);
    expect(mock.removeGeometry).toHaveBeenCalledTimes(1);
    expect(mock.removeProgram).toHaveBeenCalledTimes(1);
    expect(mock.deleteShader).toHaveBeenCalledTimes(2);
    cleanupAgain?.();
    expect(frames.size).toBe(0);
    expect(mock.removeGeometry).toHaveBeenCalledTimes(2);
    expect(mock.removeProgram).toHaveBeenCalledTimes(2);
  });

  it('switches to CSS and stops drawing when the context is lost', () => {
    const cleanup = mount()();
    canvas.dispatchEvent(new Event('webglcontextlost'));
    expect(mock.failed).toHaveBeenCalledWith(true);
    expect(frames.size).toBe(0);
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('resize'));
    expect(frames.size).toBe(0);
    expect(mock.render).toHaveBeenCalledTimes(1);
    cleanup?.();
  });

  it('removes context listeners on cleanup', () => {
    const cleanup = mount()();
    cleanup?.();
    canvas.dispatchEvent(new Event('webglcontextlost'));
    expect(mock.failed).not.toHaveBeenCalled();
  });
});
