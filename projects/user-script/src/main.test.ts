import { afterEach, expect, it, vi } from 'vitest';

vi.mock('./migrate.ts', () => ({}));
vi.mock('./layouts/root.ts', () => ({}));
vi.mock('../../shared/components/index.ts', () => ({}));

afterEach(() => {
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
  await import('./main.ts');
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

it('still mounts on ordinary pages and accepts the existing plugin hide message', async () => {
  document.body.innerHTML = '<app-root>普通网站</app-root>';
  await start();
  const root = document.querySelector<HTMLElement>('scwc-layout-root');
  expect(root).not.toBeNull();
  window.dispatchEvent(new MessageEvent('message', { data: null }));
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'scwc-plugin-hinder', isSameOrigin: true },
    }),
  );
  expect(root?.style.display).toBe('none');
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

it('preserves the floating window inside ordinary same-origin frames', async () => {
  vi.spyOn(window, 'parent', 'get').mockReturnValue(parentPage('<app-root>普通网站</app-root>'));
  await start();
  expect(document.querySelector('scwc-layout-root')).not.toBeNull();
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
  expect(document.querySelector('scwc-layout-root')).not.toBeNull();
});
