import { describe, expect, it } from 'vitest';
import { SmoothWheelMotion, wheelTiming } from './wheel-motion.ts';

const position = { x: 0, y: 0 };
const bounds = { x: 100000, y: 100000 };
const sample = (motion: SmoothWheelMotion, time: number) => {
  const value = motion.sample(time);
  if (!value) {
    throw new Error('Missing wheel trajectory');
  }
  return value;
};

describe('adaptive wheel trajectory', () => {
  it('accelerates, cruises at constant speed, then decelerates to the exact distance', () => {
    const motion = new SmoothWheelMotion();
    motion.add(60, 120, 0, position, bounds, {});
    const timing = wheelTiming(120);
    expect(sample(motion, 0)).toMatchObject({ x: 0, y: 0, vy: 0 });
    expect(sample(motion, 4).vy).toBeGreaterThan(0);
    expect(sample(motion, 4).vy).toBeLessThan(sample(motion, 8).vy);
    expect(sample(motion, 40).vy).toBeCloseTo(sample(motion, 100).vy);
    expect(sample(motion, timing.duration - 4).vy).toBeLessThan(
      sample(motion, timing.duration - 8).vy,
    );
    expect(sample(motion, timing.duration)).toMatchObject({
      x: 60,
      y: 120,
      vx: 0,
      vy: 0,
      done: true,
    });
    const slowFrame = sample(motion, 5000);
    expect(slowFrame.y).toBe(120);
  });

  it('adapts all phases with configurable ratios, bounded minima and a nonnegative cruise', () => {
    const fast = wheelTiming(8);
    const slow = wheelTiming(180);
    expect(fast.duration).toBe(80);
    expect(fast.acceleration).toBeGreaterThanOrEqual(8);
    expect(slow.acceleration).toBeGreaterThan(fast.acceleration);
    expect(slow.deceleration).toBeGreaterThan(fast.deceleration);
    const timing = wheelTiming(100, { accelerationRatio: 0.2, decelerationRatio: 0.1 });
    expect(timing.acceleration).toBe(25);
    expect(timing.deceleration).toBe(12.5);
    for (const interval of [0, 1, 100, 10000, NaN]) {
      const timing = wheelTiming(interval, {
        accelerationRatio: 1,
        decelerationRatio: 1,
        minAcceleration: 30,
        minDeceleration: 40,
      });
      expect(timing.acceleration).toBeGreaterThanOrEqual(30);
      expect(timing.deceleration).toBeGreaterThanOrEqual(40);
      expect(timing.cruise).toBeGreaterThanOrEqual(0);
      expect(timing.acceleration + timing.cruise + timing.deceleration).toBeCloseTo(
        timing.duration,
      );
    }
  });

  it.each([60, 120, 240])(
    'preserves velocity and distance under %i Hz trackpad input',
    (frequency) => {
      const motion = new SmoothWheelMotion();
      const interval = 1000 / frequency;
      let previous = 0;
      for (let i = 0; i < frequency * 3; i++) {
        const time = i * interval;
        const before = motion.sample(time);
        motion.add(0.5, 2, time, position, bounds, {});
        const after = sample(motion, time);
        if (before) {
          expect(after.y).toBeCloseTo(before.y);
          expect(after.vy).toBeCloseTo(before.vy);
        }
        const next = sample(motion, time + interval);
        expect(next.y).toBeGreaterThan(previous);
        previous = next.y;
      }
      expect(sample(motion, 3300)).toMatchObject({
        x: frequency * 1.5,
        y: frequency * 6,
        done: true,
      });
    },
  );

  it('clamps boundaries and reverses without carrying excess distance or overshooting', () => {
    const motion = new SmoothWheelMotion();
    motion.add(0, 1000, 0, position, { x: 0, y: 200 }, {});
    expect(sample(motion, 200).y).toBe(200);
    motion.add(0, -50, 220, { x: 0, y: 200 }, { x: 0, y: 200 }, {});
    for (let t = 220; t < 500; t += 4) {
      expect(sample(motion, t).y).toBeGreaterThanOrEqual(150);
      expect(sample(motion, t).y).toBeLessThanOrEqual(200);
    }
    expect(sample(motion, 500).y).toBe(150);
  });
});
