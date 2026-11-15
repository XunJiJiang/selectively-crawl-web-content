import { afterEach, expect, it, vi } from 'vitest';

vi.mock('./migrate.ts', () => ({}));
vi.mock('./layouts/root.ts', () => ({}));
vi.mock('../../shared/components/index.ts', () => ({}));
vi.mock('vite-plugin-monkey/dist/client', () => ({ GM_info: undefined }));
let stop: (() => void) | undefined;

afterEach(() => {
  stop?.();
  document.body.replaceChildren();
  document.title = '';
  document
    .querySelectorAll('[name="scwc-app"], #scwc-userscript-font')
    .forEach((el) => el.remove());
  vi.restoreAllMocks();
});

async function start(ready = 'complete') {
  vi.resetModules();
  vi.spyOn(document, 'readyState', 'get').mockReturnValue(ready as DocumentReadyState);
  stop = (await import('./main.ts')).stopUserScript;
}

it.each(['marker', 'root'])(
  'skips the userscript window on a workbench page identified by %s',
  async (kind) => {
    document.title = 'SCWC · 插件工作台';
    document.body.innerHTML =
      kind === 'marker' ? '<meta name="scwc-app" content="workbench">' : '<app-root></app-root>';
    await start();
    expect(document.querySelector('#selective-crawl-floating-root')).toBeNull();
    expect(document.querySelector('#scwc-userscript-font')).toBeNull();
  },
);

it('checks the completed DOM before mounting when the script starts during page loading', async () => {
  await start('loading');
  document.title = 'SCWC · 插件工作台';
  document.body.innerHTML = '<app-root></app-root>';
  window.dispatchEvent(new Event('load'));
  expect(document.querySelector('scwc-layout-root')).toBeNull();
});

it('still mounts on ordinary pages and accepts a hide message from its parent', async () => {
  document.body.innerHTML = '<app-root>普通网站</app-root>';
  await start();
  const root = document.querySelector<HTMLElement>('scwc-layout-root');
  expect(root).not.toBeNull();
  expect(document.querySelector('#scwc-userscript-font')).toBeNull();
  window.dispatchEvent(new MessageEvent('message', { data: null }));
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'scwc-plugin-hinder', isSameOrigin: true },
      source: window,
    }),
  );
  expect(root?.isConnected).toBe(false);
});

function parentPage(markup: string) {
  const doc = document.implementation.createHTMLDocument('Parent');
  doc.body.innerHTML = markup;
  const page = { document: doc } as Window;
  Object.defineProperty(page, 'parent', { value: page, configurable: true });
  return page;
}

it.each([false, true])('skips a same-origin workbench iframe, nested=%s', async (nested) => {
  const workbench = parentPage('<meta name="scwc-app" content="workbench">');
  const parent = nested ? parentPage('<p>普通中间层</p>') : workbench;
  if (nested) {
    Object.defineProperty(parent, 'parent', { value: workbench });
  }
  vi.spyOn(window, 'parent', 'get').mockReturnValue(parent);
  await start();
  expect(document.querySelector('#selective-crawl-floating-root')).toBeNull();
});

it('hides the floating window inside ordinary same-origin frames by default', async () => {
  vi.spyOn(window, 'parent', 'get').mockReturnValue(parentPage('<app-root>普通网站</app-root>'));
  await start();
  expect(document.querySelector('scwc-layout-root')).toBeNull();
});

it('does not hide or fail when an ancestor document is cross-origin', async () => {
  const parent = parentPage('<meta name="scwc-app" content="workbench">');
  Object.defineProperty(parent, 'document', {
    get: () => {
      throw new DOMException('Cross-origin', 'SecurityError');
    },
  });
  vi.spyOn(window, 'parent', 'get').mockReturnValue(parent);
  await start();
  expect(document.querySelector('scwc-layout-root')).toBeNull();
});

it('only lets the direct parent enable the iframe and removes all script notices when hidden', async () => {
  const parent = parentPage('<p>普通网站</p>');
  vi.spyOn(window, 'parent', 'get').mockReturnValue(parent);
  await start();
  const { notify } = await import('./utils/notify.ts');
  notify({ title: '隐藏时的通知' });
  expect(document.querySelector('#scwc-notify-root')).toBeNull();
  const visibility = (source: Window, visible: boolean) =>
    window.dispatchEvent(
      new MessageEvent('message', {
        source,
        data: { protocol: 'scwc-userscript-settings/v1', type: 'visibility', visible },
      }),
    );
  visibility(window, true);
  expect(document.querySelector('scwc-layout-root')).toBeNull();
  visibility(parent, true);
  expect(document.querySelector('scwc-layout-root')).not.toBeNull();
  notify({ title: '可见时的通知' });
  expect(document.querySelector('#scwc-notify-root')).not.toBeNull();
  visibility(parent, false);
  expect(document.querySelector('scwc-layout-root')).toBeNull();
  expect(document.querySelector('#scwc-notify-root')).toBeNull();
  notify({ title: '迟到的通知' });
  expect(document.querySelector('#scwc-notify-root')).toBeNull();
});
