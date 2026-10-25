import type { SmoothWheelOptions } from './types.ts';

const finite = (value: number | undefined, fallback: number, min: number, max: number) =>
  Math.min(
    max,
    Math.max(min, typeof value === 'number' && Number.isFinite(value) ? value : fallback),
  );

export function wheelTiming(interval: number, options: SmoothWheelOptions = {}) {
  const accelerationMin = finite(options.minAcceleration, 8, 1, 1000);
  const decelerationMin = finite(options.minDeceleration, 8, 1, 1000);
  const minimum = Math.max(
    finite(options.minDuration, 80, 16, 2000),
    accelerationMin + decelerationMin + 1,
  );
  const maximum = Math.max(minimum, finite(options.maxDuration, 240, 16, 5000));
  const duration = finite(interval * 1.25, 150, minimum, maximum);
  const accelerationExtra = Math.max(
    0,
    duration * finite(options.accelerationRatio, 0.12, 0, 1) - accelerationMin,
  );
  const decelerationExtra = Math.max(
    0,
    duration * finite(options.decelerationRatio, 0.12, 0, 1) - decelerationMin,
  );
  const scale = Math.min(
    1,
    (duration - accelerationMin - decelerationMin - 1) /
      (accelerationExtra + decelerationExtra || 1),
  );
  const acceleration = accelerationMin + accelerationExtra * scale;
  const deceleration = decelerationMin + decelerationExtra * scale;
  return { duration, acceleration, deceleration, cruise: duration - acceleration - deceleration };
}

type Timing = ReturnType<typeof wheelTiming>;
type Axis = { start: number; target: number; velocity: number; peak: number };
// smoothstep 速度的解析积分：每帧按时间采样，不累加帧误差。
const integral = (t: number) => t ** 3 - t ** 4 / 2;
const ease = (t: number) => t * t * (3 - 2 * t);

function axis(start: number, target: number, velocity: number, timing: Timing): Axis {
  const distance = target - start;
  const sign = Math.sign(distance);
  // 反向立即响应；同向保留速度，短距离时限制初速度以防过冲。
  const initial =
    sign * Math.min(Math.max(0, velocity * sign), (2 * Math.abs(distance)) / timing.acceleration);
  const peak =
    (distance - (initial * timing.acceleration) / 2) /
    (timing.duration - (timing.acceleration + timing.deceleration) / 2);
  return { start, target, velocity: initial, peak };
}

function sampleAxis(axis: Axis, elapsed: number, timing: Timing) {
  const { acceleration: a, deceleration: d, cruise: c, duration } = timing;
  const { start, target, velocity: v, peak } = axis;
  const t = Math.max(0, elapsed);
  if (t >= duration) {
    return { position: target, velocity: 0 };
  }
  if (t < a) {
    return {
      position: start + v * t + (peak - v) * a * integral(t / a),
      velocity: v + (peak - v) * ease(t / a),
    };
  }
  const accelerated = ((v + peak) * a) / 2;
  if (t < a + c) {
    return { position: start + accelerated + peak * (t - a), velocity: peak };
  }
  const u = (t - a - c) / d;
  return {
    position: start + accelerated + peak * c + peak * d * (u - integral(u)),
    velocity: peak * (1 - ease(u)),
  };
}

/** 一个手势仅保留一个双轴轨迹，高频输入不创建动画队列，也不把速度重置为零。 */
export class SmoothWheelMotion {
  private started = 0;
  private lastEvent?: number;
  private interval = 120;
  private timing = wheelTiming(120);
  private x?: Axis;
  private y?: Axis;

  get target() {
    return { x: this.x?.target, y: this.y?.target };
  }

  add(
    x: number,
    y: number,
    now: number,
    position: { x: number; y: number },
    max: { x: number; y: number },
    options: SmoothWheelOptions,
  ) {
    const previous = this.sample(now);
    const elapsed = this.lastEvent === undefined ? Infinity : now - this.lastEvent;
    if (elapsed > 500) {
      this.interval = finite(options.initialInterval, 120, 1, 2000);
    } else if (elapsed > 0) {
      this.interval += (elapsed - this.interval) * 0.35;
    }
    this.lastEvent = now;
    this.timing = wheelTiming(this.interval, options);
    const clamp = (value: number, limit: number) => Math.max(0, Math.min(limit, value));
    const startX = clamp(previous?.x ?? position.x, max.x);
    const startY = clamp(previous?.y ?? position.y, max.y);
    this.x = axis(
      startX,
      clamp((this.x?.target ?? position.x) + x, max.x),
      previous?.vx ?? 0,
      this.timing,
    );
    this.y = axis(
      startY,
      clamp((this.y?.target ?? position.y) + y, max.y),
      previous?.vy ?? 0,
      this.timing,
    );
    this.started = now;
  }

  sample(now: number) {
    if (!this.x || !this.y) {
      return undefined;
    }
    const x = sampleAxis(this.x, now - this.started, this.timing);
    const y = sampleAxis(this.y, now - this.started, this.timing);
    return {
      x: x.position,
      y: y.position,
      vx: x.velocity,
      vy: y.velocity,
      done: now - this.started >= this.timing.duration,
    };
  }
}
