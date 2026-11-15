import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FrameSettingsController } from './frame-settings.ts';
import { ConfigController } from '../../shared/store/config.ts';
import { defaultSiteData, CONFIG_CHANGED_EVENT } from '../../shared/userscript-config.ts';
import type { INotifyOptions } from '../../shared/types/notify.d.ts';
import { notify } from './utils/notify.ts';
import { requireValue } from '../../shared/workbench-protocol.ts';

vi.mock('./utils/notify.ts', () => ({ notify: vi.fn(() => ({ close: vi.fn() })) }));
const protocol = 'scwc-userscript-settings/v1';
const websiteSettingsKey = (origin: string) =>
  ['scwc', 'userscript', 'frame-settings', 'v1'].join('.') + ':' + origin;
class Page extends EventTarget {
  parent: Page = this;
  frames: Page[] = [];
  location: URL;
  history = { pushState: vi.fn(), replaceState: vi.fn() };
  setInterval = window.setInterval.bind(window);
  clearInterval = window.clearInterval.bind(window);
  postMessage = vi.fn((data: { type: string }) => {
    const source = data.type === 'request' ? this.frames[0] : this.parent;
    this.dispatchEvent(new MessageEvent('message', { data, source: source as unknown as Window }));
  });
  constructor(url: string, parent?: Page) {
    super();
    this.location = new URL(url);
    if (parent) {
      this.parent = parent;
      parent.frames.push(this);
    }
  }
  get window() {
    return this as unknown as Window;
  }
}
const controllers: FrameSettingsController[] = [];
const views: ReturnType<typeof vi.fn>[] = [];
function start(page: Page) {
  const view = vi.fn();
  const controller = new FrameSettingsController(view, page.window, localStorage);
  controllers.push(controller);
  views.push(view);
  controller.start();
  return controller;
}
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  vi.mocked(notify).mockClear();
  ConfigController.applyConfig(defaultSiteData().config);
});
afterEach(() => {
  controllers.splice(0).forEach((controller) => controller.stop());
  views.length = 0;
  ConfigController.setAdditionalControls([]);
  vi.useRealTimers();
});
function lastPrompt() {
  const calls = vi.mocked(notify).mock.calls;
  return calls[calls.length - 1][0] as INotifyOptions;
}

it('controls only immediate children across websites until synchronization is confirmed', () => {
  const root = new Page('https://parent.test/root');
  const child = new Page('https://child.test/one', root);
  const grandchild = new Page('https://nested.test/two', child);
  const parentSettings = start(root);
  start(child);
  start(grandchild);
  expect(views[0]).toHaveBeenLastCalledWith(true);
  expect(views[1]).toHaveBeenLastCalledWith(false);
  expect(views[2]).toHaveBeenLastCalledWith(false);
  parentSettings.setShowInChildFrames(true);
  expect(views[1]).toHaveBeenLastCalledWith(true);
  expect(views[2]).toHaveBeenLastCalledWith(false);
  requireValue(lastPrompt().actions)[1].onClick();
  expect(views[2]).toHaveBeenLastCalledWith(false);
  controllers[1].setShowInChildFrames(true);
  expect(views[2]).toHaveBeenLastCalledWith(true);
});

it('recursively synchronizes only after confirmation and does not prompt descendants again', () => {
  const root = new Page('https://root.test/');
  const child = new Page('https://child.test/', root);
  const nested = new Page('https://nested.test/', child);
  const parentSettings = start(root);
  start(child);
  start(nested);
  parentSettings.setShowInChildFrames(true);
  expect(notify).toHaveBeenCalledOnce();
  requireValue(lastPrompt().actions)[0].onClick();
  expect(views[2]).toHaveBeenLastCalledWith(true);
  expect(localStorage.getItem('scwc.userscript.frame-settings.v1:https://child.test')).toBe('true');
  expect(localStorage.getItem('scwc.userscript.frame-settings.v1:https://nested.test')).toBe(
    'true',
  );
  expect(notify).toHaveBeenCalledOnce();
  parentSettings.setShowInChildFrames(false);
  expect(views[1]).toHaveBeenLastCalledWith(false);
  expect(views[2]).toHaveBeenLastCalledWith(true);
  requireValue(lastPrompt().actions)[0].onClick();
  expect(views[2]).toHaveBeenLastCalledWith(false);
});

it('supports patches for every shared script setting and rejects unrelated message sources', () => {
  const root = new Page('https://root.test/');
  const child = new Page('https://child.test/', root);
  const grandchild = new Page('https://nested.test/', child);
  const parentSettings = start(root);
  start(child);
  start(grandchild);
  const changed = vi.fn();
  child.addEventListener(CONFIG_CHANGED_EVENT, changed);
  const patch = {
    config: {
      api: { host: 'https://core.test', port: '4444', token: 'new-token' },
      plugin: { refreshRule: '//custom' },
      notify: { placement: 'bl' as const },
    },
  };
  parentSettings.synchronizeSettings(patch);
  expect(ConfigController.config).toEqual(patch.config);
  expect(changed).toHaveBeenCalledOnce();
  expect(notify).not.toHaveBeenCalled();
  grandchild.dispatchEvent(
    new MessageEvent('message', {
      source: root.window,
      data: {
        protocol,
        type: 'sync',
        id: 'forged',
        patch: { config: { api: { token: 'forged' } } },
      },
    }),
  );
  expect(ConfigController.config.api.token).toBe('new-token');
  child.dispatchEvent(
    new MessageEvent('message', {
      source: root.window,
      data: {
        protocol,
        type: 'sync',
        id: 'bad-patch',
        patch: { config: { notify: { placement: 'invalid' } } },
      },
    }),
  );
  expect(ConfigController.config.notify.placement).toBe('bl');
});

it('recovers the website policy and replies when a child starts before the parent', async () => {
  const root = new Page('https://root.test/page');
  const child = new Page('https://child.test/', root);
  localStorage.setItem('scwc.userscript.frame-settings.v1:https://root.test', 'true');
  start(child);
  expect(views[0]).toHaveBeenLastCalledWith(false);
  start(root);
  expect(views[0]).toHaveBeenLastCalledWith(true);
  await vi.advanceTimersByTimeAsync(1000);
  expect(views[0]).toHaveBeenLastCalledWith(true);
});

it('shares the website switch across paths and frames but only prompts the page directly edited', () => {
  const root = new Page('https://parent.test/first');
  const child = new Page('https://parent.test/second', root);
  const nested = new Page('https://nested.test/', child);
  const parentSettings = start(root);
  start(child);
  start(nested);
  parentSettings.setShowInChildFrames(true);
  expect(notify).toHaveBeenCalledOnce();
  const prompt = lastPrompt();
  child.dispatchEvent(
    new StorageEvent('storage', {
      key: websiteSettingsKey('https://parent.test'),
      newValue: 'true',
      url: root.location.href,
    }),
  );
  expect(views[2]).toHaveBeenLastCalledWith(true);
  expect(notify).toHaveBeenCalledOnce();
  expect(lastPrompt()).toBe(prompt);
  requireValue(prompt.actions)[1].onClick();

  const otherTab = new Page('https://parent.test/third');
  const otherChild = new Page('https://other.test/', otherTab);
  start(otherTab);
  start(otherChild);
  expect(views[4]).toHaveBeenLastCalledWith(true);
  expect(notify).toHaveBeenCalledOnce();
  expect(
    localStorage.getItem('scwc.userscript.frame-settings.v1:https://parent.test/first'),
  ).toBeNull();
});

it('silently propagates a same-origin edit even when it originates inside an iframe', () => {
  const root = new Page('https://parent.test/first');
  const child = new Page('https://parent.test/second', root);
  const nested = new Page('https://nested.test/', child);
  start(root);
  const childSettings = start(child);
  start(nested);
  childSettings.setShowInChildFrames(true);
  expect(notify).toHaveBeenCalledOnce();
  root.dispatchEvent(
    new StorageEvent('storage', {
      key: websiteSettingsKey('https://parent.test'),
      newValue: 'true',
      url: child.location.href,
    }),
  );
  expect(views[1]).toHaveBeenLastCalledWith(true);
  expect(notify).toHaveBeenCalledOnce();
});

it('uses the existing website setting in preference to legacy path copies', () => {
  const root = new Page('https://parent.test/page');
  const child = new Page('https://child.test/', root);
  localStorage.setItem('scwc.userscript.frame-settings.v1:https://parent.test', 'false');
  localStorage.setItem('scwc.userscript.frame-settings.v1:https://parent.test/page', 'true');
  start(root);
  start(child);
  expect(views[1]).toHaveBeenLastCalledWith(false);
  expect(notify).not.toHaveBeenCalled();
});

it('migrates the current legacy path switch once and shares it with other paths', () => {
  const root = new Page('https://parent.test/page');
  const child = new Page('https://child.test/', root);
  localStorage.setItem('scwc.userscript.frame-settings.v1:https://parent.test/page', 'true');
  start(root);
  start(child);
  expect(views[1]).toHaveBeenLastCalledWith(true);
  expect(localStorage.getItem('scwc.userscript.frame-settings.v1:https://parent.test')).toBe(
    'true',
  );
  expect(notify).not.toHaveBeenCalled();
});

it('applies confirmed settings to descendants that initialize later', () => {
  const root = new Page('https://root.test/');
  const child = new Page('https://child.test/', root);
  const nested = new Page('https://nested.test/', child);
  const parentSettings = start(root);
  parentSettings.setShowInChildFrames(true);
  requireValue(lastPrompt().actions)[0].onClick();
  start(child);
  start(nested);
  expect(views[2]).toHaveBeenLastCalledWith(true);
});
