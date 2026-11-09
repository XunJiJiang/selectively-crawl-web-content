import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { scheduleFrame } from './frame.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('uses the browser frame callback and suppresses cancelled callbacks even without a cancel API', () => {
  let frame!: FrameRequestCallback;
  const request = vi.fn((callback: FrameRequestCallback) => {
    frame = callback;
    return 1;
  });
  vi.stubGlobal('requestAnimationFrame', request);
  vi.stubGlobal('cancelAnimationFrame', undefined);
  const callback = vi.fn();
  const cancel = scheduleFrame(callback);
  expect(request).toHaveBeenCalledOnce();
  expect(callback).not.toHaveBeenCalled();
  cancel();
  frame(16);
  expect(callback).not.toHaveBeenCalled();
  scheduleFrame(callback);
  frame(32);
  frame(48);
  expect(callback).toHaveBeenCalledOnce();
});
it('falls back to a cancellable timer when requestAnimationFrame is unavailable', () => {
  vi.stubGlobal('requestAnimationFrame', undefined);
  vi.stubGlobal('cancelAnimationFrame', undefined);
  const callback = vi.fn();
  const cancel = scheduleFrame(callback);
  cancel();
  vi.advanceTimersByTime(32);
  expect(callback).not.toHaveBeenCalled();
  scheduleFrame(callback);
  vi.advanceTimersByTime(15);
  expect(callback).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(callback).toHaveBeenCalledOnce();
});
