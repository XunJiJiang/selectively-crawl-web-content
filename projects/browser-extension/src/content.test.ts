import { beforeAll, describe, expect, it, vi } from 'vitest';

type Listener = (
  message: unknown,
  sender: { id: string },
  respond: (reply: { ok: boolean; data?: unknown }) => void,
) => void;
let listener: Listener;
const sendMessage = vi.fn(async () => ({ ok: true }));
beforeAll(async () => {
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'test-extension',
      sendMessage,
      onMessage: {
        addListener: (value: Listener) => {
          listener = value;
        },
      },
    },
  });
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  await import('./content.ts');
});
function page(command: string, extra: Record<string, unknown> = {}) {
  let response: { ok: boolean; data?: unknown } | undefined;
  listener({ type: 'scwc.page', command, ...extra }, { id: 'test-extension' }, (reply) => {
    response = reply;
  });
  return response;
}
describe('in-page picker without a floating application window', () => {
  it('selects a real element, walks parents, undoes and removes its overlay on confirmation', async () => {
    document.body.innerHTML = '<article id="article"><p id="text">正文</p></article>';
    expect(page('start')?.ok).toBe(true);
    document
      .querySelector('#text')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ draft: expect.objectContaining({ selector: '#text', depth: 1 }) }),
    );
    expect(page('parent')?.data).toMatchObject({ selector: '#article', depth: 2 });
    expect(page('undo')?.data).toMatchObject({ selector: '#text', depth: 1 });
    page('confirm');
    expect(document.querySelector('#scwc-extension-highlight')).toBeNull();
    expect(document.querySelector('scwc-layout-root')).toBeNull();
  });
  it('extracts the existing text/prefix format and reports missing selectors; Escape cancels', () => {
    document.body.innerHTML = '<section id="text">Hello <b>world</b></section>';
    const reply = page('extract', {
      items: [
        { selector: '#text', label: '正文', prefix: '> ' },
        { selector: '#missing', label: '', prefix: '' },
      ],
    });
    expect(reply?.data).toEqual({
      result: [{ label: '正文', value: '> Hello > world', images: [] }],
      failed: ['#missing'],
    });
    page('start');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('#scwc-extension-highlight')).toBeNull();
  });
});
