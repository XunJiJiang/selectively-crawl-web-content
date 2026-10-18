import { afterEach, describe, expect, it, vi } from 'vitest';
import { WbContextMenu } from '../components/context-menu/wb-context-menu.ts';

afterEach(() => document.body.replaceChildren());
describe('workbench menu dismissal contract', () => {
  async function menu() {
    const el = new WbContextMenu();
    el.presentation = 'custom';
    el.x = 20;
    el.y = 20;
    el.items = [
      {
        kind: 'action',
        id: 'disabled',
        label: '禁用',
        disabled: true,
        action() {
          /* empty */
        },
      },
    ];
    document.body.append(el);
    await el.updateComplete;
    return el;
  }
  it('dismisses the real backdrop once and can reopen at the same coordinates', async () => {
    const el = await menu(),
      close = vi.fn();
    el.addEventListener('wb-menu-close', close);
    el.click();
    el.click();
    await el.updateComplete;
    expect(close).toHaveBeenCalledTimes(1);
    expect(el.shadowRoot?.querySelector('[role=menu]')).toBeNull();
    el.open = false;
    await el.updateComplete;
    el.open = true;
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('[role=menu]')).not.toBeNull();
  });
  it('allows an explicit override and rejects disabled actions without closing on panel clicks', async () => {
    const el = await menu(),
      close = vi.fn(),
      selected = vi.fn();
    el.addEventListener('wb-menu-close', close);
    el.addEventListener('wb-menu-select', selected);
    el.rootClickHandler = vi.fn();
    el.click();
    expect(close).not.toHaveBeenCalled();
    el.shadowRoot?.querySelector<HTMLElement>('[data-menu-id]')?.click();
    el.shadowRoot?.querySelector<HTMLElement>('[role=menu]')?.click();
    expect(selected).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    el.rootClickHandler = (_event, dismiss) => {
      dismiss();
      dismiss();
    };
    el.click();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
