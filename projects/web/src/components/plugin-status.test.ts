import { afterEach, expect, it, vi } from 'vitest';
import type { SCWCTooltip } from '../../../shared/components/tooltip.ts';
import { PluginStatus } from './plugin-status.ts';
import type { WorkbenchStore } from '../workbench/store.ts';
import { requireValue } from '../../../shared/workbench-protocol.ts';

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

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
  const tooltip = requireValue(status.shadowRoot?.querySelector<SCWCTooltip>('scwc-tooltip'));
  await tooltip.updateComplete;
  expect(tooltip.pinned).toBe(true);
  expect(tooltip.hidden).toBe(false);
  expect(tooltip.shadowRoot?.querySelector('[surface=tooltip]')).not.toBeNull();
  trigger.dispatchEvent(
    new CustomEvent('ui-surface-action', { detail: { kind: 'contextmenu', x: 123, y: 456 } }),
  );
  await status.updateComplete;
  await tooltip.updateComplete;
  expect(tooltip.hidden).toBe(true);
  expect(tooltip.shadowRoot?.querySelector('[surface=tooltip]')).toBeNull();
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

it('uses shared hover timing and closes the custom view when the owner changes', async () => {
  vi.useFakeTimers();
  const status = new PluginStatus();
  status.store = new EventTarget() as WorkbenchStore;
  status.contribution = {
    pluginId: 'p',
    ownerEpoch: 'one',
    surface: 'statusBar',
    id: 'state',
    title: 'Status',
    hasTooltip: true,
  };
  document.body.append(status);
  await status.updateComplete;
  const trigger = requireValue(status.shadowRoot?.querySelector('[surface=statusBar]'));
  const tooltip = requireValue(status.shadowRoot?.querySelector<SCWCTooltip>('scwc-tooltip'));
  const action = (kind: string) =>
    trigger.dispatchEvent(new CustomEvent('ui-surface-action', { detail: { kind } }));
  action('hover');
  await vi.advanceTimersByTimeAsync(999);
  expect(tooltip.hidden).toBe(true);
  action('leave');
  await vi.advanceTimersByTimeAsync(1000);
  expect(tooltip.hidden).toBe(true);
  action('hover');
  await vi.advanceTimersByTimeAsync(1000);
  expect(tooltip.hidden).toBe(false);
  action('click');
  await tooltip.updateComplete;
  expect(tooltip.pinned).toBe(true);
  status.contribution = { ...status.contribution, ownerEpoch: 'two' };
  await status.updateComplete;
  expect(tooltip.hidden).toBe(true);
});
