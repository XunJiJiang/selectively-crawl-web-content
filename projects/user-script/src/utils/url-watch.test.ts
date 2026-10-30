import { afterEach, expect, it, vi } from 'vitest';
import { watchUrl } from './url-watch.ts';

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
});
it('observes push/replace/hash/history navigation once and releases its hooks', () => {
  vi.useFakeTimers();
  const original = history.pushState,
    listener = vi.fn();
  stop = watchUrl(listener);
  history.pushState({}, '', '/a');
  history.replaceState({}, '', '/b#one');
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  vi.advanceTimersByTime(1000);
  expect(listener).toHaveBeenCalledTimes(2);
  stop();
  stop = undefined;
  expect(history.pushState).toBe(original);
  history.pushState({}, '', '/after-stop');
  vi.advanceTimersByTime(1000);
  expect(listener).toHaveBeenCalledTimes(2);
});
it('detects History hooks bypassed by an isolated userscript world', () => {
  vi.useFakeTimers();
  const rawReplace = history.replaceState;
  const listener = vi.fn();
  stop = watchUrl(listener);
  rawReplace.call(history, {}, '', '/isolated-world');
  vi.advanceTimersByTime(500);
  expect(listener).toHaveBeenCalledOnce();
});
