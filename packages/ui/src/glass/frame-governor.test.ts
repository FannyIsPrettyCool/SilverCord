import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createFrameGovernor } from './frame-governor.ts';

const options = { slowFrameMs: 22, fastFrameMs: 13, windowFrames: 10, upgradeAfterWindows: 3 };
const feed = (governor: ReturnType<typeof createFrameGovernor>, ms: number, frames: number) => {
  for (let i = 0; i < frames; i++) governor.record(ms);
  return governor.tier;
};

describe('frame governor', () => {
  it('steps down one tier per slow window', () => {
    const governor = createFrameGovernor('high', options);
    expect(feed(governor, 30, 10)).toBe('low');
    expect(feed(governor, 30, 10)).toBe('solid');
    expect(feed(governor, 30, 10)).toBe('solid');
  });

  it('upgrades only after sustained fast windows, up to the ceiling', () => {
    const governor = createFrameGovernor('low', options);
    feed(governor, 30, 10);
    expect(governor.tier).toBe('solid');
    expect(feed(governor, 8, 20)).toBe('solid');
    expect(feed(governor, 8, 10)).toBe('low');
    expect(feed(governor, 8, 100)).toBe('low');
  });

  it('ignores huge gaps from hidden windows', () => {
    const governor = createFrameGovernor('high', options);
    expect(feed(governor, 5000, 50)).toBe('high');
  });

  it('never leaves the solid..ceiling range', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('solid', 'low', 'high' as const),
        fc.array(fc.float({ min: 1, max: 80, noNaN: true })),
        (ceiling, frames) => {
          const governor = createFrameGovernor(ceiling, options);
          const order = ['solid', 'low', 'high'];
          for (const frame of frames) {
            expect(order.indexOf(governor.record(frame))).toBeLessThanOrEqual(
              order.indexOf(ceiling),
            );
          }
        },
      ),
    );
  });
});
