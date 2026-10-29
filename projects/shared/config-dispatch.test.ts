import { expect, it } from 'vitest';
import { ConfigDispatchQueue } from './config-dispatch.ts';
import type { ConfigChange } from '../server/types/plugin-config.d.ts';
const change = (revision: number): ConfigChange => ({
  pluginId: 'p',
  changedKeys: ['x'],
  effectiveValues: { x: String(revision) },
  revision,
  schemaRevision: 1,
});
it('queues inactive documents and delivers ordered changes exactly once after resume', async () => {
  let active = true;
  const received: number[] = [];
  const queue = new ConfigDispatchQueue(
    () => active,
    async () => change(0),
    async (value) => {
      received.push(value.revision);
    },
  );
  await queue.flush();
  active = false;
  queue.enqueue(change(1));
  queue.enqueue(change(2));
  queue.enqueue(change(2));
  expect(received).toEqual([0]);
  active = true;
  await queue.flush();
  expect(received).toEqual([0, 1, 2]);
  queue.enqueue(change(1));
  await queue.flush();
  expect(received).toEqual([0, 1, 2]);
  queue.dispose();
});
it('resynchronizes an overflowing queue and retains changes arriving during delivery', async () => {
  let active = true;
  let latest = 0;
  const received: number[] = [];
  const queue = new ConfigDispatchQueue(
    () => active,
    async () => change(latest),
    async (value) => {
      received.push(value.revision);
      if (value.revision === 300) {
        queue.enqueue(change(301));
      }
    },
  );
  await queue.flush();
  active = false;
  for (let i = 1; i <= 300; i++) {
    latest = i;
    queue.enqueue(change(i));
  }
  active = true;
  await queue.flush();
  expect(received).toEqual([0, 300, 301]);
  queue.dispose();
});
it('keeps a failed delivery until the next ready checkpoint and stops destroyed documents', async () => {
  let fail = true;
  let count = 0;
  const queue = new ConfigDispatchQueue(
    () => true,
    async () => change(0),
    async () => {
      count++;
      if (fail) {
        throw Error('closed');
      }
    },
  );
  await queue.flush();
  fail = false;
  await queue.flush();
  expect(count).toBe(2);
  queue.dispose();
  queue.enqueue(change(1));
  await queue.flush();
  expect(count).toBe(2);
});
