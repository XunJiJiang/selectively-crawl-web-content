import { afterEach, expect, it } from 'vitest';
import { PluginStatus } from './plugin-status.ts';
import type { WorkbenchStore } from '../workbench/store.ts';
import { requireValue } from '../../../shared/workbench-protocol.ts';

afterEach(() => document.body.replaceChildren());

it('closes a pinned tooltip before opening the workbench context menu at the pointer', async () => {
  const status = new PluginStatus();
  status.store = new EventTarget() as WorkbenchStore;
  status.contribution = {
    pluginId: 'p',
    ownerEpoch: 'epoch',
    surface: 'statusBar',
    id: 'state',
    title: '状态',
    hasTooltip: true,
    hasContextMenu: true,
  };
  document.body.append(status);
  await status.updateComplete;
  const trigger = requireValue(status.shadowRoot?.querySelector('[surface=statusBar]'));
  trigger.dispatchEvent(new CustomEvent('ui-surface-action', { detail: { kind: 'click' } }));
  await status.updateComplete;
  expect(status.shadowRoot?.querySelector('.popup.pinned')).not.toBeNull();
  trigger.dispatchEvent(
    new CustomEvent('ui-surface-action', { detail: { kind: 'contextmenu', x: 123, y: 456 } }),
  );
  await status.updateComplete;
  expect(status.shadowRoot?.querySelector('.popup')).toBeNull();
  const menu = requireValue(
    status.shadowRoot?.querySelector<HTMLElement & { menuX: number; menuY: number }>(
      '[surface=contextMenu]',
    ),
  );
  expect([menu.menuX, menu.menuY]).toEqual([123, 456]);
  menu.dispatchEvent(new CustomEvent('ui-menu-close'));
  await status.updateComplete;
  expect(status.shadowRoot?.querySelector('[surface=contextMenu]')).toBeNull();
});
