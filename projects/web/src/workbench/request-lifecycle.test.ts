import { expect, it, vi } from 'vitest';
import { RequestLifecycle } from '../../../shared/request-lifecycle.ts';

it('protects unmarked work and replays only explicitly interruptible work after resume', async () => {
  const network = new RequestLifecycle();
  let finish!: () => void;
  const protectedRequest = network.run(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await Promise.resolve();
  expect(network.pause()).toBe(false);
  finish();
  await protectedRequest;
  let started!: () => void;
  const firstStart = new Promise<void>((resolve) => {
    started = resolve;
  });
  const operation = vi.fn((signal: AbortSignal) =>
    operation.mock.calls.length === 1
      ? new Promise<string>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason));
          started();
        })
      : Promise.resolve('current state'),
  );
  const result = network.run(operation, true);
  await firstStart;
  expect(network.pause()).toBe(true);
  await Promise.resolve();
  expect(operation).toHaveBeenCalledTimes(1);
  network.resume();
  expect(await result).toBe('current state');
  expect(operation).toHaveBeenCalledTimes(2);
});

it('retains caller cancellation while waiting for a reconnect', async () => {
  const network = new RequestLifecycle();
  network.pause();
  const controller = new AbortController(),
    operation = vi.fn();
  const result = network.run(operation, true, controller.signal);
  controller.abort(new Error('dismissed'));
  await expect(result).rejects.toThrow('dismissed');
  network.resume();
  expect(operation).not.toHaveBeenCalled();
});
