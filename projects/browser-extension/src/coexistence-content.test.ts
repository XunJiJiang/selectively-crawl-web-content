import { afterEach, expect, it, vi } from 'vitest';
import type { INotifyOptions } from '../../shared/types/notify.d.ts';
import { COEXISTENCE_PROTOCOL } from '../../shared/client-coexistence.ts';
const fixture = vi.hoisted(() => ({
  send: vi.fn(),
  notify: vi.fn(),
  close: vi.fn(),
  update: vi.fn(),
}));
vi.mock('./browser.ts', () => ({ browser: { runtime: { sendMessage: fixture.send } } }));
vi.mock('../../shared/components/notify.ts', () => ({ notify: fixture.notify }));
const presence = { version: '3.4.7', handler: 'Tampermonkey', handlerVersion: '5.5.1' };
const reply = {
  ok: true,
  data: {
    suppressed: false,
    extensionVersion: '3.4.8',
    scriptManager: true,
    extensionManager: true,
    instructions: '',
  },
};
function announce(extra: { source?: Window; origin?: string; script?: unknown } = {}) {
  window.dispatchEvent(
    new MessageEvent('message', {
      source: extra.source ?? window,
      origin: extra.origin ?? location.origin,
      data: { protocol: COEXISTENCE_PROTOCOL, type: 'script', script: extra.script ?? presence },
    }),
  );
}
async function start() {
  vi.resetModules();
  fixture.send.mockReset().mockResolvedValue(reply);
  fixture.close.mockReset();
  fixture.update.mockReset();
  fixture.notify.mockReset().mockReturnValue({ close: fixture.close, update: fixture.update });
  await import('./coexistence-content.ts');
}
afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  delete (globalThis as Record<string, unknown>).__scwcCoexistenceV1;
  vi.restoreAllMocks();
});
it('shows both versions once per document, navigates on action, and reminds on a new document', async () => {
  await start();
  announce();
  announce();
  await vi.waitFor(() => expect(fixture.notify).toHaveBeenCalledTimes(1));
  const options = fixture.notify.mock.calls[0][0] as INotifyOptions;
  expect(options.title).toContain('v3.4.8');
  expect(options.title).toContain('v3.4.7');
  expect(options.duration).toBe(0);
  expect(options.actions?.map((action) => action.label)).toEqual([
    '去关闭油猴脚本',
    '去关闭浏览器扩展',
    '不再提示',
  ]);
  fixture.send.mockResolvedValue({ ok: true });
  await options.actions?.[0].onClick();
  expect(fixture.send).toHaveBeenLastCalledWith({
    type: 'coexistence.open',
    script: presence,
    target: 'script',
  });
  window.dispatchEvent(new Event('pagehide'));
  delete (globalThis as Record<string, unknown>).__scwcCoexistenceV1;
  await start();
  announce();
  await vi.waitFor(() => expect(fixture.notify).toHaveBeenCalledTimes(1));
});
it('rejects foreign frames, origins and malformed presence and omits unsupported actions', async () => {
  await start();
  announce({ source: {} as Window });
  announce({ origin: 'https://other.example' });
  announce({ script: { ...presence, version: '<script>' } });
  expect(fixture.send).not.toHaveBeenCalled();
  fixture.send.mockResolvedValue({
    ...reply,
    data: {
      ...reply.data,
      scriptManager: false,
      extensionManager: false,
      instructions: '手动打开',
    },
  });
  announce();
  await vi.waitFor(() => expect(fixture.notify).toHaveBeenCalledTimes(1));
  expect(fixture.notify.mock.calls[0][0]).toMatchObject({
    description: expect.stringContaining('手动打开'),
  });
  expect(
    fixture.notify.mock.calls[0][0].actions.map((action: { label: string }) => action.label),
  ).toEqual(['不再提示']);
});
it('does not display a late reply after the document has left', async () => {
  await start();
  let resolve!: (value: unknown) => void;
  fixture.send.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  announce();
  window.dispatchEvent(new Event('pagehide'));
  resolve(reply);
  await Promise.resolve();
  expect(fixture.notify).not.toHaveBeenCalled();
});
it('closes only after dismissal is saved, and keeps the reminder available when saving fails', async () => {
  await start();
  announce();
  await vi.waitFor(() => expect(fixture.notify).toHaveBeenCalledTimes(1));
  const options = fixture.notify.mock.calls[0][0] as INotifyOptions;
  const dismiss = options.actions?.find((action) => action.label === '不再提示');
  expect(dismiss).toBeDefined();
  fixture.send.mockResolvedValue({ ok: false, error: 'storage failed' });
  await dismiss?.onClick();
  expect(fixture.close).not.toHaveBeenCalled();
  expect(fixture.update).toHaveBeenCalledWith({
    description: expect.stringContaining('保存“不再提示”失败'),
  });
  fixture.send.mockResolvedValue({ ok: true });
  await dismiss?.onClick();
  expect(fixture.send).toHaveBeenLastCalledWith({ type: 'coexistence.dismiss', script: presence });
  expect(fixture.close).toHaveBeenCalledTimes(1);
});
it('does not show a reminder when the browser preference suppresses it', async () => {
  await start();
  fixture.send.mockResolvedValue({ ok: true, data: { suppressed: true } });
  announce();
  await Promise.resolve();
  expect(fixture.notify).not.toHaveBeenCalled();
});
