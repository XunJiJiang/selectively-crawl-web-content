import { describe, expect, it } from 'vitest';
import { HostUI } from './ui-host.ts';
import type { UIWireRegistry, AuxiliaryDefinition } from '../../../shared/declarative-ui.ts';

describe('process-local UI callbacks and atomic publication', () => {
  it('requires a JSON or HTML template before hiding page information and preserves the previous definition on rejection', async () => {
    const host = new HostUI(async () => null, () => undefined, async () => null);
    const definition = { id: 'details', title: 'Details', icon: { kind: 'builtin' as const, name: 'info' } };
    await expect(host.api.registerAuxiliarySidebar({ ...definition, hideCurrentPage: true } as AuxiliaryDefinition)).rejects.toThrow('必须提供 JSON 或 HTML 模板');
    expect(host.snapshot().views).toHaveLength(0);
    const handle = await host.api.registerAuxiliarySidebar(definition as AuxiliaryDefinition);
    await expect(handle.setCurrentPageVisible(false)).rejects.toThrow('必须提供 JSON 或 HTML 模板');
    await handle.setContent({ format: 'json', version: 1, root: { type: 'text', text: '详情' } });
    await handle.setCurrentPageVisible(false);
    expect(host.snapshot().views[0].definition.hideCurrentPage).toBe(true);
    await expect(handle.set({ ...definition, hideCurrentPage: true } as AuxiliaryDefinition)).rejects.toThrow();
    expect(host.snapshot().views[0].definition.content).toHaveProperty('format', 'json');
    await handle.setContent({ format: 'html', version: 1, html: '<p>Details</p>' });
    expect(host.snapshot().views[0].definition.hideCurrentPage).toBe(true);
    await handle.set({ ...definition, hideCurrentPage: true, content: () => ({ format: 'json', version: 1, root: { type: 'text', text: '动态详情' } }) });
    expect(host.snapshot().views[0].definition.content).toHaveProperty('$provider');
    host.dispose();
  });
  it('stages onLoad, publishes a transaction once and rolls back a rejected batch', async () => {
    const snapshots: UIWireRegistry[] = [];
    const host = new HostUI(
      async (snapshot) => {
        snapshots.push(snapshot);
        if (snapshot.handlers.some((h) => h.name === 'rejected')) {
          throw Error('invalid');
        }
      },
      () => {
        /* Callback not used by this fixture. */
      },
      async () => null,
    );
    await host.api.handlers.register('before', {
      run() {
        return 'before';
      },
    });
    expect(snapshots).toHaveLength(0);
    host.activate();
    await host.api.transaction(async (draft) => {
      await draft.handlers.register('one', {
        run() {
          return 1;
        },
      });
      await draft.handlers.register('two', {
        readOnly: true,
        run() {
          return 2;
        },
      });
    });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].handlers.map((h) => h.name)).toEqual(['before', 'one', 'two']);
    await expect(
      host.api.transaction(async (draft) => {
        await draft.handlers.register('rejected', {
          run() {
            return 0;
          },
        });
      }),
    ).rejects.toThrow();
    expect(host.snapshot().handlers.map((h) => h.name)).toEqual(['before', 'one', 'two']);
    expect(JSON.stringify(host.snapshot())).not.toContain('function');
    host.dispose();
  });
  it('keeps positional arguments, provider functions and targeted content in their owning process', async () => {
    const targeted: Record<string, unknown>[] = [];
    const host = new HostUI(
      async () => null,
      () => {
        /* Callback not used by this fixture. */
      },
      async (data) => {
        targeted.push(data);
        return null;
      },
    );
    await host.api.handlers.register('echo', {
      readOnly: true,
      run(...args) {
        return args;
      },
    });
    const result = await host.invoke({
      kind: 'handler',
      name: 'echo',
      args: [123, 'abc'],
      context: {
        invocation: 'event',
        instanceId: 'i',
        windowId: 'w',
        workspaceId: 's',
        source: { kind: 'mainSidebar', viewId: 'v' },
        sourceTabId: null,
      },
    });
    expect(result).toEqual({ hasValue: true, value: [123, 'abc'] });
    const view = await host.api.registerMainSidebar({
      id: 'v',
      title: 'View',
      icon: { kind: 'builtin', name: 'info' },
      content: () => ({ format: 'html', version: 1, html: '<p>safe</p>' }),
    });
    expect(host.snapshot().views[0].definition.content).toHaveProperty('$provider');
    await view.setContent(
      { format: 'html', version: 1, html: '<p>targeted</p>' },
      { instanceId: 'i' },
    );
    expect(targeted[0]).toMatchObject({ instanceId: 'i', surface: 'mainSidebar', viewId: 'v' });
    host.dispose();
  });
});
