import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeclarativeView } from './declarative-view.ts';
import type { WorkbenchStore } from '../workbench/store.ts';
import type { CompiledUI, UIContent, UISurface } from '../../../shared/declarative-ui.ts';
import type { WbContextMenu } from './context-menu/wb-context-menu.ts';
import { DeclarativeMenu } from './declarative-menu.ts';
import { requireValue } from '../../../shared/workbench-protocol.ts';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

async function renderedFixture(content: UIContent, surface: UISurface = 'mainSidebar') {
  const { compileUI } = await vi.importActual<{
    compileUI(
      content: UIContent,
      options: {
        resource(value: string): string;
        validateCall(): void;
      },
    ): CompiledUI;
  }>('../../../server/workbench/ui-compiler.ts');
  const compiled = compileUI(content, {
    resource: (value) => value,
    validateCall: () => undefined,
  });
  const instance = {
    id: 'direct-instance',
    workspaceId: 'workspace',
    renderRevision: 1,
    compiled,
    sourceTabId: null,
    sourceFrameEpoch: null,
  };
  const request = vi.fn(async (path: string, _body?: unknown): Promise<unknown> => {
    if (path === '/ui/instances' || path.endsWith('/content')) {
      return instance;
    }
    if (path.endsWith('/data')) {
      return {
        updates: compiled.expressions.map((binding) => ({
          id: binding.id,
          value: '<img src=x onerror=alert(1)>',
        })),
      };
    }
    if (path.endsWith('/events')) {
      return { status: 'completed', effects: [] };
    }
    return {};
  });
  const store = Object.assign(new EventTarget(), {
    workspace: { workspaceId: 'workspace' },
    lease: { workspaceId: 'workspace', token: 'lease' },
    api: { request },
    session: () => ({ workspaceId: 'workspace', lease: 'lease' }),
    message: (error: unknown) => String(error),
    toast: vi.fn(),
  });
  const view = document.createElement('wb-declarative-view') as DeclarativeView;
  view.store = store as unknown as WorkbenchStore;
  view.pluginId = 'plugin';
  view.setAttribute('surface', surface);
  document.body.append(view);
  await view.updateComplete;
  await vi.waitFor(() =>
    expect(view.shadowRoot?.querySelector('#content,iframe,wb-context-menu')).not.toBeNull(),
  );
  return { view, store, request, instance, compiled };
}

describe('DeclarativeView rendering', () => {
  it('uses the workbench context menu and invokes its backend binding when selected', async () => {
    const { view, request } = await renderedFixture(
      {
        format: 'json',
        version: 1,
        root: {
          type: 'stack',
          children: [
            {
              type: 'button',
              name: 'settings',
              text: '打开配置',
              events: { click: 'core:settings.open()' },
            },
          ],
        },
      },
      'contextMenu',
    );
    const menu = requireValue(view.shadowRoot?.querySelector<WbContextMenu>('wb-context-menu'));
    await vi.waitFor(() => expect(menu.items).toHaveLength(1));
    await menu.updateComplete;
    expect(view.shadowRoot?.querySelector('iframe,#content')).toBeNull();
    const closed = vi.fn();
    view.addEventListener('ui-menu-close', closed);
    requireValue(menu.shadowRoot?.querySelector<HTMLElement>('[role=menuitem]')).click();
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        '/ui/instances/direct-instance/events',
        expect.objectContaining({ bindingId: 'e0', fields: {} }),
      ),
    );
    await vi.waitFor(() => expect(closed).toHaveBeenCalledTimes(1));
  });

  it('preserves nested menus, separators, disabled entries and checkbox field snapshots', async () => {
    const { view, request } = await renderedFixture(
      {
        format: 'json',
        version: 1,
        root: {
          type: 'stack',
          children: [
            {
              type: 'button',
              name: 'blocked',
              text: '不可操作',
              disabled: true,
              events: { click: 'save()' },
            },
            { type: 'divider' },
            {
              type: 'stack',
              children: [
                { type: 'text', text: '更多' },
                {
                  type: 'checkbox',
                  name: 'enabled',
                  label: '启用',
                  checked: true,
                  events: { change: 'save($event)' },
                },
              ],
            },
          ],
        },
      },
      'contextMenu',
    );
    const menu = requireValue(view.shadowRoot?.querySelector<WbContextMenu>('wb-context-menu'));
    await vi.waitFor(() => expect(menu.items).toHaveLength(3));
    expect(menu.items[0]).toMatchObject({ kind: 'action', disabled: true });
    expect(menu.items[1].kind).toBe('separator');
    const submenu = menu.items[2];
    if (submenu.kind !== 'submenu' || submenu.children[0].kind !== 'checkbox') {
      throw Error('missing submenu checkbox');
    }
    expect(submenu.children[0].checked).toBe(true);
    await submenu.children[0].action(false);
    expect(request).toHaveBeenCalledWith(
      '/ui/instances/direct-instance/events',
      expect.objectContaining({ fields: { enabled: { value: false, editSequence: 1 } } }),
    );
  });

  it('updates menu labels and disabled state from evaluated template data', async () => {
    const { compiled } = await renderedFixture({
      format: 'json',
      version: 1,
      root: { type: 'button', text: "${core:get('title')}", disabled: "${core:get('disabled')}" },
    });
    const model = new DeclarativeMenu(compiled, async () => undefined);
    model.update(
      compiled.expressions.map((binding) => ({
        id: binding.id,
        value: binding.attribute === 'disabled' ? true : '<script>literal</script>',
      })),
    );
    expect(model.items()[0]).toMatchObject({ label: '<script>literal</script>', disabled: true });
  });
  const content: UIContent = {
    format: 'json',
    version: 1,
    root: {
      type: 'tabs',
      tabs: [
        {
          id: 'properties',
          label: '属性',
          children: [{ type: 'text', key: 'result', text: "${core:get('title')}" }],
        },
        {
          id: 'config',
          label: '配置',
          children: [
            {
              type: 'form',
              name: 'settings',
              events: { submit: 'save($event)' },
              children: [
                { type: 'input', name: 'query', value: 'initial' },
                { type: 'button', text: '保存', submit: true },
              ],
            },
          ],
        },
      ],
    },
  };

  it('renders JSON and initial template values directly with no iframe or HTML interpretation', async () => {
    const { view, request } = await renderedFixture(content);
    await vi.waitFor(() =>
      expect(view.shadowRoot?.querySelector('[data-ui-key=result]')?.textContent).toBe(
        '<img src=x onerror=alert(1)>',
      ),
    );
    expect(view.shadowRoot?.querySelector('iframe,img,script')).toBeNull();
    expect(request.mock.calls.some(([path]) => path.endsWith('/data'))).toBe(true);
  });

  it('switches tabs, captures form values and preserves edited fields and tab selection on refresh', async () => {
    const { view, request } = await renderedFixture(content);
    await vi.waitFor(() => expect(view.shadowRoot?.querySelectorAll('[role=tab]')).toHaveLength(2));
    const root = requireValue(view.shadowRoot);
    (root.querySelectorAll('[role=tab]')[1] as HTMLElement).click();
    const input = requireValue(root.querySelector('input'));
    input.value = 'draft';
    input.dispatchEvent(new Event('input'));
    requireValue(root.querySelector('form')).dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    await vi.waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        '/ui/instances/direct-instance/events',
        expect.objectContaining({ fields: { query: { value: 'draft', editSequence: 1 } } }),
      ),
    );
    await view.refresh();
    await vi.waitFor(() => expect(root.querySelector('input')?.value).toBe('draft'));
    expect(root.querySelectorAll('[role=tab]')[1].getAttribute('aria-selected')).toBe('true');
    expect(root.querySelectorAll<HTMLElement>('[role=tabpanel]')[0].hidden).toBe(true);
  });

  it('keeps HTML templates in a sandbox iframe', async () => {
    const { view } = await renderedFixture({ format: 'html', version: 1, html: '<p>HTML</p>' });
    await vi.waitFor(() => expect(view.shadowRoot?.querySelector('iframe')).not.toBeNull());
    expect(view.shadowRoot?.querySelector('iframe')?.getAttribute('sandbox')).toBe('allow-scripts');
    expect(view.shadowRoot?.querySelector('iframe')?.srcdoc).toContain('type="module"');
  });

  it.each([
    (model: CompiledUI) => {
      model.nodes = [{ id: 'unsafe', tag: 'script' }];
    },
    (model: CompiledUI) => {
      model.nodes = [{ id: 'unsafe', tag: 'img', attrs: { onerror: 'alert(1)' } }];
    },
    (model: CompiledUI) => {
      model.styles = ['body { display: none }'];
    },
    (model: CompiledUI) => {
      model.nodes = [{ id: 'unsafe', tag: 'img', attrs: { src: 'https://evil.test/x.svg' } }];
    },
  ])('rejects active content and custom styles in directly rendered models', async (mutate) => {
    const { view, instance } = await renderedFixture(content);
    await vi.waitFor(() => expect(view.shadowRoot?.querySelector('[role=tab]')).not.toBeNull());
    mutate(instance.compiled);
    await view.refresh();
    await vi.waitFor(() => expect(view.shadowRoot?.querySelector('.error')).not.toBeNull());
    expect(view.shadowRoot?.querySelector('script,img')).toBeNull();
  });
});

describe('DeclarativeView startup', () => {
  it('opens after workspace initialization while the event connection is still connecting', async () => {
    const store = new EventTarget() as EventTarget & {
      workspace?: { workspaceId: string };
      lease?: { workspaceId: string; token: string };
      connection: string;
      api: { request: ReturnType<typeof vi.fn> };
      session: () => { workspaceId: string; lease: string };
      message: (error: unknown) => string;
    };
    store.connection = 'connecting';
    store.api = {
      request: vi.fn(async (path: string) => {
        if (path !== '/ui/instances') {
          return {};
        }
        return {
          id: 'instance',
          workspaceId: 'workspace',
          renderRevision: 1,
          compiled: { events: [], expressions: [] },
          sourceTabId: null,
          sourceFrameEpoch: null,
        };
      }),
    };
    store.session = () => ({ workspaceId: 'workspace', lease: 'lease' });
    store.message = (error) => String(error);

    const view = document.createElement('wb-declarative-view') as DeclarativeView;
    view.store = store as unknown as WorkbenchStore;
    view.pluginId = 'plugin';
    document.body.append(view);
    await view.updateComplete;

    store.workspace = { workspaceId: 'workspace' };
    store.lease = { workspaceId: 'workspace', token: 'lease' };
    store.dispatchEvent(new Event('change'));

    await vi.waitFor(() => {
      expect(store.api.request).toHaveBeenCalledWith(
        '/ui/instances',
        expect.objectContaining({ pluginId: 'plugin' }),
      );
    });
  });

  it('retries with the current lease when it changes during the initial request', async () => {
    let rejectFirstRequest!: (error: Error) => void;
    const firstRequest = new Promise<never>((_, reject) => {
      rejectFirstRequest = reject;
    });
    const request = vi.fn((path: string) => {
      if (path !== '/ui/instances') {
        return Promise.resolve({});
      }
      if (request.mock.calls.length === 1) {
        return firstRequest;
      }
      return Promise.resolve({
        id: 'instance',
        workspaceId: 'workspace-2',
        renderRevision: 1,
        compiled: { events: [], expressions: [] },
        sourceTabId: null,
        sourceFrameEpoch: null,
      });
    });
    const store = new EventTarget() as EventTarget & {
      workspace: { workspaceId: string };
      lease: { workspaceId: string; token: string };
      connection: string;
      api: { request: typeof request };
      session: () => { workspaceId: string; lease: string };
      message: (error: unknown) => string;
    };
    store.workspace = { workspaceId: 'workspace-1' };
    store.lease = { workspaceId: 'workspace-1', token: 'lease-1' };
    store.connection = 'connecting';
    store.api = { request };
    store.session = () => ({
      workspaceId: store.lease.workspaceId,
      lease: store.lease.token,
    });
    store.message = (error) => String(error);

    const view = document.createElement('wb-declarative-view') as DeclarativeView;
    view.store = store as unknown as WorkbenchStore;
    view.pluginId = 'plugin';
    document.body.append(view);
    await view.updateComplete;
    expect(request).toHaveBeenCalledTimes(1);

    store.workspace = { workspaceId: 'workspace-2' };
    store.lease = { workspaceId: 'workspace-2', token: 'lease-2' };
    store.dispatchEvent(new Event('change'));
    rejectFirstRequest(new Error('stale lease'));

    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(request.mock.calls[1]).toEqual([
      '/ui/instances',
      expect.objectContaining({ workspaceId: 'workspace-2', lease: 'lease-2' }),
    ]);
  });
});
