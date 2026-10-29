import { requireValue } from '../../shared/workbench-protocol.ts';
import fs from 'node:fs';
import { MessageChannel } from 'node:worker_threads';
import { JSDOM } from 'jsdom';
import { expect, it } from 'vitest';
import { compileUI } from './ui-compiler.ts';

it('renders values as text, preserves dirty input/focus and rejects stale renderer updates', async () => {
  const source = fs.readFileSync(
    new URL('../../web/src/components/ui-renderer.js', import.meta.url),
    'utf8',
  ).replace('export function createUIRenderer', 'function createUIRenderer') + fs.readFileSync(
    new URL('../../web/src/components/ui-frame.js', import.meta.url), 'utf8',
  );
  const dom = new JSDOM(
    `<!doctype html><style id="dynamic-style"></style><div id="content"></div><div id="error"></div><script data-nonce="test">${source}</script>`,
    { runScripts: 'dangerously', url: 'http://localhost' },
  );
  const channel = new MessageChannel();
  const pending: { resolve: (message: unknown) => void; method: string }[] = [];
  const messages: { method: string; payload: unknown }[] = [];
  channel.port1.on('message', (message) => {
    const waiter = pending.find((w) => w.method === message.method);
    if (waiter) {
      pending.splice(pending.indexOf(waiter), 1);
      waiter.resolve(message);
    } else {
      messages.push(message);
    }
  });
  const next = (method: string) => {
    const index = messages.findIndex((m) => m.method === method);
    if (index >= 0) {
      return Promise.resolve(messages.splice(index, 1)[0]);
    }
    return new Promise((resolve) => pending.push({ method, resolve }));
  };
  const send = (method: string, payload: unknown, renderRevision = 1) =>
    channel.port1.postMessage({ method, payload, renderRevision });
  try {
    dom.window.dispatchEvent(
      new dom.window.MessageEvent('message', {
        data: { protocol:'scwc-declarative-ui',version:1,nonce: 'test' },
        source: dom.window as unknown as Window,
        ports: [channel.port2 as unknown as MessagePort],
      }),
    );
    const compiled = compileUI(
      {
        format: 'html',
        version: 1,
        html: `<input name="q" value="initial"><p>${"${core:get('text')}"}</p>`,
      },
      {
        resource: (raw) => raw,
        validateCall: () => {
          /* Callback not used by this fixture. */
        },
      },
    );
    send('init', { compiled, renderRevision: 1, surface: 'mainSidebar' });
    await next('fields');
    const input = requireValue(dom.window.document.querySelector('input'));
    input.value = 'local';
    input.focus();
    input.setSelectionRange(1, 3);
    input.dispatchEvent(new dom.window.Event('input'));
    await next('fields');
    send('init', { compiled, renderRevision: 2, surface: 'mainSidebar' }, 2);
    await next('fields');
    const restored = requireValue(dom.window.document.querySelector('input'));
    expect(restored.value).toBe('local');
    expect(dom.window.document.activeElement).toBe(restored);
    expect(restored.selectionStart).toBe(1);
    const binding = compiled.expressions[0];
    send('updates', [{ id: binding.id, value: '<img src=x onerror=alert(1)>' }], 2);
    await next('fields');
    expect(requireValue(dom.window.document.querySelector('p')).textContent).toBe(
      '<img src=x onerror=alert(1)>',
    );
    expect(dom.window.document.querySelector('img')).toBeNull();
    send('updates', [{ id: binding.id, value: 'stale' }], 1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(requireValue(dom.window.document.querySelector('p')).textContent).not.toBe('stale');
  } finally {
    channel.port1.close();
    channel.port2.close();
    dom.window.close();
  }
});

it('switches nested tabs with click and keyboard while preserving selection across updates', async () => {
  const source = fs.readFileSync(
    new URL('../../web/src/components/ui-renderer.js', import.meta.url),
    'utf8',
  ).replace('export function createUIRenderer', 'function createUIRenderer') + fs.readFileSync(
    new URL('../../web/src/components/ui-frame.js', import.meta.url), 'utf8',
  );
  const dom = new JSDOM(
    `<!doctype html><style id="dynamic-style"></style><div id="content"></div><div id="error"></div><script data-nonce="tabs">${source}</script>`,
    { runScripts: 'dangerously', url: 'http://localhost' },
  );
  const channel = new MessageChannel();
  const pending: (() => void)[] = [];
  channel.port1.on('message', (message) => {
    if (message.method === 'fields') {
      pending.shift()?.();
    }
  });
  const nextFields = () => new Promise<void>((resolve) => pending.push(resolve));
  const send = (method: string, payload: unknown, renderRevision = 1) =>
    channel.port1.postMessage({ method, payload, renderRevision });
  try {
    dom.window.dispatchEvent(
      new dom.window.MessageEvent('message', {
        data: { protocol: 'scwc-declarative-ui', version: 1, nonce: 'tabs' },
        source: dom.window as unknown as Window,
        ports: [channel.port2 as unknown as MessagePort],
      }),
    );
    const compiled = compileUI(
      {
        format: 'json',
        version: 1,
        root: {
          type: 'tabs',
          tabs: [
            {
              id: 'page',
              label: '页面',
              children: [
                {
                  type: 'tabs',
                  tabs: [
                    { id: 'one', label: '一', children: [{ type: 'text', text: '第一项' }] },
                    { id: 'two', label: '二', children: [{ type: 'text', text: '第二项' }] },
                  ],
                },
              ],
            },
            { id: 'other', label: '其他', children: [{ type: 'text', text: '其他内容' }] },
          ],
        },
      },
      { resource: (value) => value, validateCall: () => undefined },
    );
    send('init', { compiled, renderRevision: 1, surface: 'mainSidebar' });
    await nextFields();
    const groups = [...dom.window.document.querySelectorAll('[data-ui-tabs]')];
    expect(groups).toHaveLength(2);
    const outerId = groups[0].getAttribute('data-ui-tabs');
    const innerId = groups[1].getAttribute('data-ui-tabs');
    if (!outerId || !innerId) {
      throw new Error('tab group id missing');
    }
    const triggers = (groupId: string) =>
      [...dom.window.document.querySelectorAll('[data-ui-tab-trigger]')].filter(
        (node) => node.getAttribute('data-ui-tab-group') === groupId,
      );
    const panels = (groupId: string) =>
      [...dom.window.document.querySelectorAll('[data-ui-tab-panel]')].filter(
        (node) => node.getAttribute('data-ui-tab-group') === groupId,
      );
    const outer = triggers(outerId);
    outer[1].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    expect(outer[1].getAttribute('aria-selected')).toBe('true');
    expect(panels(outerId)[0].hasAttribute('hidden')).toBe(true);
    outer[0].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    const inner = triggers(innerId);
    inner[0].dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    );
    expect(inner[1].getAttribute('aria-selected')).toBe('true');
    expect(dom.window.document.activeElement).toBe(inner[1]);

    const updated = nextFields();
    send('init', { compiled, renderRevision: 2, surface: 'mainSidebar' }, 2);
    await updated;
    const updatedGroups = [...dom.window.document.querySelectorAll('[data-ui-tabs]')];
    const updatedOuterId = updatedGroups[0].getAttribute('data-ui-tabs');
    const updatedInnerId = updatedGroups[1].getAttribute('data-ui-tabs');
    if (!updatedOuterId || !updatedInnerId) {
      throw new Error('updated tab group id missing');
    }
    const updatedOuter = triggers(updatedOuterId);
    const updatedInner = triggers(updatedInnerId);
    expect(updatedOuter[0].getAttribute('aria-selected')).toBe('true');
    expect(updatedInner[1].getAttribute('aria-selected')).toBe('true');
  } finally {
    channel.port1.close();
    channel.port2.close();
    dom.window.close();
  }
});
