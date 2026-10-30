import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { LitElement } from 'lit';
import '../../../shared/components/index.ts';
import './root.ts';
import { siteStore } from '../site-store.ts';
import { sendCrawlRequest } from '../api/crawl.ts';
import { requireValue } from '../../../shared/workbench-protocol.ts';

vi.hoisted(() => {
  const entries = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
    removeItem: (key: string) => entries.delete(key),
    clear: () => entries.clear(),
  });
});
afterAll(() => vi.unstubAllGlobals());

vi.mock('../api/plugins.ts', () => ({
  fetchPlugins: async () => ({ plugins: [], activeIds: [], updatedIds: [] }),
  triggerPlugin: vi.fn(),
}));

vi.mock('../site-sync.ts', () => ({
  SiteConfigConnection: class {
    start() {
      /* 同步连接在独立测试中覆盖。 */
    }
    stop() {
      /* 此夹具不创建连接。 */
    }
  },
}));
vi.mock('../api/crawl.ts', () => ({
  sendCrawlRequest: vi.fn(async () => ({ success: true, message: '抓取成功', data: [] })),
}));

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

async function settle(el: LitElement) {
  await el.updateComplete;
  for (const child of el.shadowRoot?.querySelectorAll('*') ?? []) {
    if (child instanceof LitElement) {
      await settle(child);
    }
  }
}

describe('userscript workbench presentation', () => {
  it('keeps a remote window visible without rewriting its shared position or edit date', async () => {
    siteStore.update((data) => {
      data.window.pos = { x: 100000, y: 100000 };
      data.window.minimized = false;
      data.plugin.expanded = false;
    });
    const original = siteStore.snapshot;
    const root = document.createElement('scwc-layout-root');
    document.body.append(root);
    await settle(root);
    const panel = requireValue(
      requireValue(root.shadowRoot).querySelector<HTMLElement>('.scwc-layout-root'),
    );
    expect(Number.parseFloat(panel.style.left)).toBeLessThan(window.innerWidth);
    expect(Number.parseFloat(panel.style.top)).toBeLessThan(window.innerHeight);
    expect(siteStore.snapshot).toEqual(original);
  });
  it('uses the existing context menu to toggle panels and dismisses after selection', async () => {
    const root = document.createElement('scwc-layout-root');
    document.body.append(root);
    await settle(root);
    const header = requireValue(requireValue(root.shadowRoot).querySelector('scwc-layout-header'));
    header.dispatchEvent(new MouseEvent('contextmenu', { clientX: 40, clientY: 50 }));
    await settle(root);
    const menu = requireValue(requireValue(root.shadowRoot).querySelector('wb-context-menu'));
    expect(menu.x).toBe(40);
    menu.dispatchEvent(new CustomEvent('wb-menu-select', { detail: { id: 'selection' } }));
    await settle(root);
    expect(
      requireValue(requireValue(root.shadowRoot).querySelector('.scwc-layout-root')).hasAttribute(
        'data-expanded',
      ),
    ).toBe(true);
    expect(requireValue(root.shadowRoot).querySelector('wb-context-menu')).toBeNull();
    expect(requireValue(root.shadowRoot).querySelector('wb-scroll-container')).not.toBeNull();
  });
  it('submits an empty crawl result when no elements are configured', async () => {
    siteStore.update((data) => {
      data.items = [];
    });
    const claw = document.createElement('scwc-layout-content-claw');
    document.body.append(claw);
    await settle(claw);
    const trigger = requireValue(
      requireValue(claw.shadowRoot).querySelector(
        'scwc-button[aria-label="Trigger data crawling"]',
      ),
    );
    trigger.dispatchEvent(new CustomEvent('click'));
    await vi.waitFor(() => expect(sendCrawlRequest).toHaveBeenCalledWith([], expect.anything()));
  });
  it('keeps saved selection items inside the shared scroll container', async () => {
    siteStore.update((data) => {
      data.items = [{ selector: '#article', label: '正文', prefix: '' }];
    });
    const claw = document.createElement('scwc-layout-content-claw');
    claw.expanded = true;
    document.body.append(claw);
    await settle(claw);
    expect(
      requireValue(claw.shadowRoot).querySelector('wb-scroll-container .claw-item'),
    ).not.toBeNull();
    const input = requireValue(requireValue(claw.shadowRoot).querySelector('scwc-input'));
    input.dispatchEvent(new CustomEvent('input', { detail: '标题' }));
    expect(
      JSON.parse(requireValue(localStorage.getItem('__selective_crawl_items__')))[0].label,
    ).toBe('标题');
  });
});
