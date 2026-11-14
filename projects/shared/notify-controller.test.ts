import { afterEach, expect, it, vi } from 'vitest';
import { NotifyController } from './notify-controller.ts';
afterEach(() => vi.useRealTimers());
it('combines pointer/focus pauses and resumes only the remaining lifetime', () => {
  vi.useFakeTimers();
  const closed = vi.fn(),
    controller = new NotifyController(closed);
  controller.set('one', 5000);
  vi.advanceTimersByTime(1000);
  controller.pause('one');
  controller.pause('one', 'focus');
  controller.resume('one');
  vi.advanceTimersByTime(10000);
  expect(closed).not.toHaveBeenCalled();
  controller.resume('one', 'focus');
  vi.advanceTimersByTime(3999);
  expect(closed).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(closed).toHaveBeenCalledExactlyOnceWith('one', 'auto');
  expect(controller.close('one')).toBe(false);
});
it('supports persistent messages, disconnected hosts and explicit close without stale timers', () => {
  vi.useFakeTimers();
  const closed = vi.fn(),
    controller = new NotifyController(closed);
  controller.set('persistent', 0);
  controller.set('timed', 1000);
  controller.suspend();
  vi.advanceTimersByTime(6000);
  expect(closed).not.toHaveBeenCalled();
  controller.connect();
  vi.advanceTimersByTime(1000);
  expect(closed).toHaveBeenCalledExactlyOnceWith('timed', 'auto');
  expect(controller.close('persistent', 'user')).toBe(true);
  controller.set('cancelled', 100);
  controller.dispose();
  vi.advanceTimersByTime(1000);
  expect(closed).toHaveBeenCalledTimes(2);
});
