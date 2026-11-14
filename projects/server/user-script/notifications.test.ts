import { expect, it, vi } from 'vitest';
import { SiteNotificationService } from './notifications.ts';
it('delivers unsolicited notifications per origin with independent cursors and scope', () => {
  const service = new SiteNotificationService();
  const initial = service.read('https://one.example/a');
  const receive = vi.fn(),
    other = vi.fn();
  const release = service.subscribe('https://one.example/child', receive);
  service.subscribe('https://two.example', other);
  const id = service.publish('plugin', 'https://one.example/direct', {
    title: '后台完成',
    scope: 'external',
    placement: 'tc',
  });
  expect(receive).toHaveBeenCalledWith(
    expect.objectContaining({
      id,
      pluginId: 'plugin',
      title: '后台完成',
      scope: 'external',
      placement: 'tc',
    }),
  );
  expect(other).not.toHaveBeenCalled();
  const batch = service.read('https://one.example', initial.cursor);
  expect(batch.notifications).toHaveLength(1);
  expect(service.read('https://two.example', initial.cursor).notifications).toEqual([]);
  expect(service.read('https://one.example', initial.cursor)).toEqual(batch);
  expect(service.read('https://one.example', batch.cursor).notifications).toEqual([]);
  expect(service.read('https://one.example').notifications).toEqual([]);
  release();
  service.publish('plugin', 'https://one.example', { title: '内部默认' });
  expect(receive).toHaveBeenCalledOnce();
  expect(service.read('https://one.example', batch.cursor).notifications[0].scope).toBe('internal');
});
it('rejects invalid options and keeps the transient log bounded', () => {
  const service = new SiteNotificationService(),
    initial = service.read('https://one.example');
  expect(() => service.publish('p', 'file:///tmp', { title: 'bad' })).toThrow();
  expect(() =>
    service.publish('p', 'https://one.example', { title: 'bad', scope: 'all' }),
  ).toThrow();
  for (let i = 0; i < 1005; i++) {
    service.publish('p', 'https://one.example', { title: String(i) });
  }
  const batch = service.read('https://one.example', initial.cursor);
  expect(batch.notifications).toHaveLength(1000);
  expect(batch.notifications[0].title).toBe('5');
});
