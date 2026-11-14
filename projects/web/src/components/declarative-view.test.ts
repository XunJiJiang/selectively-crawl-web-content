import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeclarativeView } from './declarative-view.ts';
import type { WorkbenchStore } from '../workbench/store.ts';
import type { CompiledUI, UIContent, UISurface } from '../../../shared/declarative-ui.ts';
import type { WbContextMenu } from './context-menu/wb-context-menu.ts';
import { DeclarativeMenu } from './declarative-menu.ts';
import { requireValue } from '../../../shared/workbench-protocol.ts';
import type { WbMenuSelect } from './context-menu/wb-menu-select.ts';
import { WorkbenchScrollContainer } from './scroll-container.ts';
import { ApiError } from '../api/workbench.ts';
import type { FramePool } from '../workbench/frames.ts';
import type { SCWCTooltip } from '../../../shared/components/tooltip.ts';

beforeEach(() => {
  vi.spyOn(WorkbenchScrollContainer.prototype, 'scrollTo').mockImplementation(function (
    this: WorkbenchScrollContainer,
    options: ScrollToOptions | number = {},
    y?: number,
  ) {
    const viewport = requireValue(this.scrollElement);
    viewport.scrollLeft =
      typeof options === 'number' ? options : (options.left ?? viewport.scrollLeft);
    viewport.scrollTop =
      typeof options === 'number' ? (y ?? 0) : (options.top ?? viewport.scrollTop);
  });
});

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
  it('places independent accessible validation messages directly below each control', async () => {
    const { view } = await renderedFixture({
      format: 'json',
      version: 1,
      root: {
        type: 'group',
        children: [
          {
            type: 'setting',
            label: 'First',
            description: 'Existing help',
            children: [{ type: 'input', name: 'first', minLength: 2 }],
          },
          {
            type: 'setting',
            label: 'Second',
            children: [{ type: 'textarea', name: 'second', minLength: 3 }],
          },
        ],
      },
    });
    const root = requireValue(view.shadowRoot);
    const first = requireValue(root.querySelector<HTMLInputElement>('[name=first]'));
    const second = requireValue(root.querySelector<HTMLTextAreaElement>('[name=second]'));
    for (const field of [first, second]) {
      field.value = 'x';
      field.dispatchEvent(new Event('input'));
      const message = requireValue(field.nextElementSibling);
      expect(message.getAttribute('role')).toBe('alert');
      expect(message.textContent).toContain('至少输入');
      expect(field.getAttribute('aria-describedby')).toContain(message.id);
      expect(field.getAttribute('aria-invalid')).toBe('true');
    }
    first.value = 'valid';
    first.dispatchEvent(new Event('input'));
    expect(first.nextElementSibling?.textContent).toBe('');
    expect(second.nextElementSibling?.textContent).toContain('至少输入');
    expect(root.querySelector('#error')?.textContent).toBe('');
    expect(first.getAttribute('aria-describedby')?.split(' ')).toHaveLength(2);
    const warning = requireValue(second.nextElementSibling);
    expect(warning.querySelector('svg[aria-hidden=true]')).not.toBeNull();
    warning.dispatchEvent(new MouseEvent('mouseenter'));
    await new Promise((resolve) => setTimeout(resolve, 1050));
    const tooltip = requireValue(warning.nextElementSibling) as SCWCTooltip;
    await tooltip.updateComplete;
    expect(tooltip.localName).toBe('scwc-tooltip');
    expect(tooltip.text).toBe(warning.textContent);
    expect(tooltip.hidden).toBe(false);
    await view.refresh();
    expect(tooltip.isConnected).toBe(false);
    expect(root.querySelector('[data-ui-error-for=second]')?.textContent).toContain('至少输入');
  });
  it('checks frontend template results before assigning them to constrained controls', async () => {
    const { view, instance, request, compiled } = await renderedFixture({
      format: 'json',
      version: 1,
      root: { type: 'input', name: 'q', minLength: 3, value: '${ui:read()}' },
    });
    Object.assign(instance, { sourceTabId: 'page', sourceFrameEpoch: 'epoch' });
    const invokeUI = vi.fn(async () => ({ hasValue: true, value: 'x' }));
    view.pool = Object.assign(new EventTarget(), { invokeUI }) as unknown as FramePool;
    request.mockImplementation(async (path) => {
      if (path.endsWith('/content')) {
        return instance;
      }
      if (path.endsWith('/data')) {
        return { updates: [{ id: compiled.expressions[0].id, frontend: true, fields: {} }] };
      }
      if (path.endsWith('/validate')) {
        throw new ApiError('UI_INVALID_VALUE_TYPE', '至少输入 3 个字符', 400, { field: 'q' });
      }
      return {};
    });
    await view.refresh();
    await vi.waitFor(() =>
      expect(view.shadowRoot?.querySelector('[data-ui-error-for=q]')?.textContent).toContain(
        '至少输入',
      ),
    );
    expect(view.shadowRoot?.querySelector<HTMLInputElement>('[name=q]')?.value).not.toBe('x');
    expect(request).toHaveBeenCalledWith('/ui/instances/direct-instance/validate', {
      renderRevision: 1,
      fields: { q: 'x' },
    });
  });
  it('does not expose invalid fields to a readonly frontend template consumer', async () => {
    const { view, instance, request, compiled } = await renderedFixture({
      format: 'json',
      version: 1,
      root: {
        type: 'stack',
        children: [
          { type: 'input', name: 'q', value: 'draft', validator: 'ui:check($this)' },
          { type: 'text', text: '${ui:consume()}' },
        ],
      },
    });
    Object.assign(instance, { sourceTabId: 'page', sourceFrameEpoch: 'epoch' });
    const invokeUI = vi.fn(async () => ({
      hasValue: true,
      value: { success: false, message: '拒绝草稿' },
    }));
    view.pool = Object.assign(new EventTarget(), { invokeUI }) as unknown as FramePool;
    request.mockImplementation(async (path) => {
      if (path.endsWith('/content')) {
        return instance;
      }
      if (path.endsWith('/data')) {
        return {
          updates: [{ id: compiled.expressions[0].id, frontend: true, fields: { q: 'draft' } }],
        };
      }
      return {};
    });
    await view.refresh();
    await vi.waitFor(() =>
      expect(view.shadowRoot?.querySelector('[data-ui-error-for=q]')?.textContent).toContain(
        '拒绝草稿',
      ),
    );
    expect(invokeUI).toHaveBeenCalled();
    expect(
      invokeUI.mock.calls.every(
        (call) => ((call as unknown[])[2] as { name: string }).name === 'check',
      ),
    ).toBe(true);
  });
  it('evaluates frontend validators as read-only calls and preserves their error messages', async () => {
    const { view, instance, request } = await renderedFixture({
      format: 'json',
      version: 1,
      root: {
        type: 'input',
        name: 'q',
        value: 'draft',
        validator: 'ui:check($this)',
      },
    });
    Object.assign(instance, { sourceTabId: 'page', sourceFrameEpoch: 'epoch' });
    const invokeUI = vi.fn(async () => ({
      hasValue: true,
      value: { success: false, message: '页面验证失败' },
    }));
    view.pool = Object.assign(new EventTarget(), { invokeUI }) as unknown as FramePool;
    request.mockImplementation(async (path) => {
      if (path.endsWith('/events/continue')) {
        return { status: 'failed', effects: [], error: 'generic failure' };
      }
      if (path.endsWith('/events')) {
        return {
          status: 'frontend',
          continuation: 'phase',
          effects: [],
          branches: instance.compiled.events[0].program.branches,
          event: { type: 'blur' },
          fields: { q: 'draft' },
        };
      }
      return { updates: [] };
    });
    const input = requireValue(view.shadowRoot?.querySelector('input'));
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('change'));
    expect(invokeUI).not.toHaveBeenCalled();
    input.dispatchEvent(new Event('blur'));
    await vi.waitFor(() =>
      expect(view.shadowRoot?.querySelector('[data-ui-error-for=q]')?.textContent).toContain(
        '页面验证失败',
      ),
    );
    expect(invokeUI).toHaveBeenCalledWith(
      'page',
      'epoch',
      expect.objectContaining({
        name: 'check',
        args: ['draft'],
        context: expect.objectContaining({ invocation: 'render' }),
      }),
    );
    expect(request).toHaveBeenCalledWith(
      '/ui/instances/direct-instance/events/continue',
      expect.objectContaining({ succeeded: false }),
    );
  });
  it('keeps tree row and toolbar tooltips working after JSON sidebar tabs are wrapped', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 400, 220),
    );
    const { view } = await renderedFixture({
      format: 'json',
      version: 1,
      root: {
        type: 'tabs',
        tabs: [
          {
            id: 'tree',
            label: '树',
            children: [
              {
                type: 'tree',
                name: 'files',
                label: '文件',
                nodes: [{ id: 'main', label: 'main.ts', tooltip: 'src/main.ts' }],
              },
            ],
          },
        ],
      },
    });
    const root = requireValue(view.shadowRoot);
    await vi.waitFor(() => expect(root.querySelector('[data-tree-id=main]')).not.toBeNull());
    expect(root.querySelector('.ui-tab-panel')?.parentElement?.localName).toBe(
      'wb-scroll-container',
    );
    vi.useFakeTimers();
    try {
      await vi.advanceTimersByTimeAsync(100);
      const row = requireValue(root.querySelector('[data-tree-id=main]'));
      const tooltip = requireValue(root.querySelector<SCWCTooltip>('.tree-list + scwc-tooltip'));
      row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(999);
      expect(tooltip.hidden).toBe(true);
      await vi.advanceTimersByTimeAsync(1);
      expect(tooltip.hidden).toBe(false);
      expect(tooltip.text).toBe('src/main.ts');
      tooltip.close();

      const button = requireValue(root.querySelector('.tree-toolbar button'));
      const toolbarTooltip = button.nextElementSibling as SCWCTooltip;
      button.dispatchEvent(new MouseEvent('mouseenter'));
      await vi.advanceTimersByTimeAsync(1000);
      expect(toolbarTooltip.hidden).toBe(false);
      expect(toolbarTooltip.text).toContain('查找');
    } finally {
      view.remove();
      vi.useRealTimers();
    }
  });

  it.each(['mainSidebar', 'auxiliarySidebar', 'tooltip'] as const)(
    'enforces JSON input/textarea constraints and preserves placeholder, disabled and readonly on %s',
    async (surface) => {
      const { view, request } = await renderedFixture(
        {
          format: 'json',
          version: 1,
          root: {
            type: 'stack',
            children: [
              ...['text', 'number', 'password', 'textarea'].map((kind) => ({
                type: kind === 'textarea' ? 'textarea' : 'input',
                ...(kind === 'textarea' ? {} : { inputType: kind }),
                name: kind,
                value: '12',
                minLength: 2,
                maxLength: 3,
                min: 10,
                max: 20,
                pattern: '[0-9]+',
                patternMessage: '请输入数字',
                placeholder: '10–20',
              })),
              { type: 'input', name: 'fixed', readonly: true, value: 'fixed', placeholder: '只读' },
              { type: 'textarea', name: 'fixedMemo', readonly: true, value: 'fixed' },
              { type: 'input', name: 'blocked', disabled: true },
              { type: 'textarea', name: 'blockedMemo', disabled: true },
              {
                type: 'button',
                name: 'save',
                for: ['text', 'number', 'password', 'textarea'],
                text: 'Save',
                events: { click: 'save' },
              },
            ],
          },
        },
        surface,
      );
      const root = requireValue(view.shadowRoot);
      await vi.waitFor(() => expect(root.querySelectorAll('input,textarea')).toHaveLength(8));
      for (const name of ['text', 'number', 'password', 'textarea']) {
        const field = requireValue(
          root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name=${name}]`),
        );
        expect(field.placeholder).toBe('10–20');
        expect(field.minLength).toBe(2);
        expect(field.maxLength).toBe(3);
        field.value = '21';
        field.dispatchEvent(new Event('input'));
        expect(field.parentElement?.querySelector('.ui-field-error')?.textContent).toContain(
          '数值',
        );
        field.dispatchEvent(new Event('change'));
        expect(request.mock.calls.filter(([path]) => path.endsWith('/events'))).toHaveLength(0);
        field.value = '12';
        field.dispatchEvent(new Event('input'));
      }
      expect(root.querySelector<HTMLInputElement>('[name=fixed]')?.readOnly).toBe(true);
      expect(root.querySelector<HTMLTextAreaElement>('[name=fixedMemo]')?.readOnly).toBe(true);
      expect(root.querySelector<HTMLInputElement>('[name=blocked]')?.disabled).toBe(true);
      expect(root.querySelector<HTMLTextAreaElement>('[name=blockedMemo]')?.disabled).toBe(true);
      const text = requireValue(root.querySelector<HTMLInputElement>('[name=text]'));
      text.value = 'ab';
      text.dispatchEvent(new Event('input'));
      expect(root.querySelector('[data-ui-error-for=text]')?.textContent).toBe('请输入数字');
      text.value = '12';
      text.dispatchEvent(new Event('input'));
      requireValue(root.querySelector<HTMLButtonElement>('[name=save]')).click();
      await vi.waitFor(() =>
        expect(request.mock.calls.some(([path]) => path.endsWith('/events'))).toBe(true),
      );
      expect(root.querySelector('#error')?.textContent).toBe('');
    },
  );
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
              icon: { kind: 'builtin', name: 'settings' },
              events: { click: 'core:settings.open()' },
            },
          ],
        },
      },
      'contextMenu',
    );
    const menu = requireValue(view.shadowRoot?.querySelector<WbContextMenu>('wb-context-menu'));
    await vi.waitFor(() => expect(menu.items).toHaveLength(1));
    expect(menu.items[0]).toMatchObject({ label: '打开配置' });
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

  it('serializes overlapping auxiliary template refreshes and reads only the final revision', async () => {
    const { view, store, request, instance } = await renderedFixture(content, 'auxiliarySidebar');
    const root = requireValue(view.shadowRoot);
    await vi.waitFor(() =>
      expect(root.querySelector('[data-ui-key=result]')?.textContent).toContain('<img'),
    );
    (root.querySelectorAll('[role=tab]')[1] as HTMLElement).click();
    const input = requireValue(root.querySelector('input'));
    input.value = 'local draft';
    input.dispatchEvent(new Event('input'));
    input.focus();
    const responses: { revision: number; resolve(value: unknown): void }[] = [];
    let revision = 1;
    const dataRevisions: number[] = [];
    request.mockImplementation((path, body) => {
      if (path.endsWith('/content')) {
        const next = ++revision;
        return new Promise((resolve) => responses.push({ revision: next, resolve }));
      }
      if (path.endsWith('/data')) {
        const current = (body as { renderRevision: number }).renderRevision;
        dataRevisions.push(current);
        return current === revision
          ? Promise.resolve({ updates: [] })
          : Promise.reject(new ApiError('UI_STALE_RENDER', '模板版本已变化', 400));
      }
      return Promise.resolve({});
    });
    const first = view.refresh();
    await vi.waitFor(() => expect(responses).toHaveLength(1));
    const second = view.refresh();
    expect(responses).toHaveLength(1);
    store.dispatchEvent(
      new CustomEvent('server-event', {
        detail: { type: 'ui.data.changed', entityId: instance.id },
      }),
    );
    expect(dataRevisions).toEqual([]);
    requireValue(responses[0]).resolve({ ...instance, renderRevision: 2 });
    await vi.waitFor(() => expect(responses).toHaveLength(2));
    expect(dataRevisions).toEqual([]);
    requireValue(responses[1]).resolve({ ...instance, renderRevision: 3 });
    await Promise.all([first, second]);
    await vi.waitFor(() => expect(dataRevisions).toContain(3));
    expect(dataRevisions.every((value) => value === 3)).toBe(true);
    expect(root.querySelector('.error')).toBeNull();
    const restored = requireValue(root.querySelector('input'));
    expect(restored.value).toBe('local draft');
    expect(root.activeElement).toBe(restored);
  });

  it('reloads a stale read once and preserves the auxiliary draft without replaying events', async () => {
    const { view, store, request, instance } = await renderedFixture(content, 'auxiliarySidebar');
    const root = requireValue(view.shadowRoot);
    await vi.waitFor(() =>
      expect(root.querySelector('[data-ui-key=result]')?.textContent).toContain('<img'),
    );
    (root.querySelectorAll('[role=tab]')[1] as HTMLElement).click();
    const input = requireValue(root.querySelector('input'));
    input.value = 'unsaved draft';
    input.dispatchEvent(new Event('input'));
    request.mockImplementation(async (path, body) => {
      if (path.endsWith('/content')) {
        return { ...instance, renderRevision: 2 };
      }
      if (path.endsWith('/data')) {
        if ((body as { renderRevision: number }).renderRevision === 1) {
          throw new ApiError('UI_STALE_RENDER', '模板版本已变化', 400);
        }
        return { updates: [] };
      }
      return {};
    });
    request.mockClear();
    store.dispatchEvent(
      new CustomEvent('server-event', {
        detail: { type: 'ui.data.changed', entityId: instance.id },
      }),
    );
    await vi.waitFor(() =>
      expect(
        request.mock.calls.some(
          ([path, body]) =>
            path.endsWith('/data') && (body as { renderRevision: number }).renderRevision === 2,
        ),
      ).toBe(true),
    );
    expect(request.mock.calls.filter(([path]) => path.endsWith('/content'))).toHaveLength(1);
    expect(request.mock.calls.some(([path]) => path.endsWith('/events'))).toBe(false);
    expect(root.querySelector('.error')).toBeNull();
    expect(root.querySelector('input')?.value).toBe('unsaved draft');
  });

  it('stops recovery when a refreshed template still reports a stale revision', async () => {
    const { view, store, request, instance } = await renderedFixture(content, 'auxiliarySidebar');
    await vi.waitFor(() =>
      expect(view.shadowRoot?.querySelector('[data-ui-key=result]')?.textContent).toContain('<img'),
    );
    request.mockImplementation(async (path) => {
      if (path.endsWith('/content')) {
        return { ...instance, renderRevision: 2 };
      }
      if (path.endsWith('/data')) {
        throw new ApiError('UI_STALE_RENDER', '模板版本已变化', 400);
      }
      return {};
    });
    request.mockClear();
    store.dispatchEvent(
      new CustomEvent('server-event', {
        detail: { type: 'ui.data.changed', entityId: instance.id },
      }),
    );
    await vi.waitFor(() =>
      expect(view.shadowRoot?.querySelector('.error')?.textContent).toContain('模板版本已变化'),
    );
    expect(request.mock.calls.filter(([path]) => path.endsWith('/content'))).toHaveLength(1);
    request.mockImplementation(async (path) =>
      path.endsWith('/content') ? { ...instance, renderRevision: 3 } : { updates: [] },
    );
    await view.refresh();
    expect(view.shadowRoot?.querySelector('.error')).toBeNull();
  });

  it('keeps HTML templates in a sandbox iframe', async () => {
    const { view } = await renderedFixture({ format: 'html', version: 1, html: '<p>HTML</p>' });
    await vi.waitFor(() => expect(view.shadowRoot?.querySelector('iframe')).not.toBeNull());
    expect(view.shadowRoot?.querySelector('iframe')?.getAttribute('sandbox')).toBe('allow-scripts');
    expect(view.shadowRoot?.querySelector('iframe')?.srcdoc).toContain('type="module"');
  });

  it.each(['mainSidebar', 'auxiliarySidebar', 'tooltip'] as const)(
    'uses workbench scrolling and menu selections on %s without losing field bindings or drafts',
    async (surface) => {
      const { view, request } = await renderedFixture(
        {
          format: 'json',
          version: 1,
          root: {
            type: 'tabs',
            tabs: [
              {
                id: 'controls',
                label: '控件',
                children: [
                  {
                    type: 'stack',
                    direction: 'row',
                    gap: 18,
                    children: [
                      { type: 'badge', tone: 'success', text: '就绪' },
                      { type: 'icon', icon: { kind: 'builtin', name: 'settings' } },
                    ],
                  },
                  {
                    type: 'form',
                    name: 'form',
                    events: { submit: 'save($event)' },
                    children: [
                      {
                        type: 'select',
                        name: 'mode',
                        value: 'b',
                        options: ['a', 'b'],
                        events: { change: 'save($event)' },
                      },
                      { type: 'input', name: 'disabledInput', value: '', disabled: true },
                      { type: 'textarea', name: 'disabledText', value: '', disabled: true },
                      { type: 'select', name: 'disabledSelect', options: ['a'], disabled: true },
                      { type: 'checkbox', name: 'check', label: '勾选', checked: true },
                      { type: 'toggle', name: 'toggle', label: '开关', checked: true },
                      {
                        type: 'button',
                        text: '保存',
                        icon: { kind: 'builtin', name: 'save' },
                        submit: true,
                      },
                      { type: 'progress', value: null },
                      { type: 'divider' },
                    ],
                  },
                ],
              },
            ],
          },
        },
        surface,
      );
      const root = requireValue(view.shadowRoot);
      await vi.waitFor(() => expect(root.querySelectorAll('wb-menu-select')).toHaveLength(2));
      for (const container of root.querySelectorAll('.ui-tab-list,.ui-tab-panel')) {
        expect(container.parentElement?.localName).toBe('wb-scroll-container');
      }
      for (const container of root.querySelectorAll('[data-layout],form,.ui-tabs')) {
        expect(container.parentElement?.localName).not.toBe('wb-scroll-container');
      }
      const tabs = requireValue(
        root.querySelector<WorkbenchScrollContainer>('.ui-scroll-tab-list'),
      );
      expect(tabs.wheelDirection).toBe('horizontal');
      expect(
        root.querySelector<HTMLElement>('[data-layout=row]')?.style.getPropertyValue('--ui-gap'),
      ).toBe('18px');
      expect(root.querySelector('input')?.disabled).toBe(true);
      expect(root.querySelector('textarea')?.disabled).toBe(true);
      expect(root.querySelector('[role=switch]')).not.toBeNull();
      expect(root.querySelectorAll('wb-icon[name=save]')).toHaveLength(1);
      const select = requireValue(root.querySelector<WbMenuSelect>('wb-menu-select'));
      await select.updateComplete;
      expect(select.value).toBe('b');
      requireValue(select.shadowRoot?.querySelector('button')).click();
      await select.updateComplete;
      const menu = requireValue(select.shadowRoot?.querySelector<WbContextMenu>('wb-context-menu'));
      await menu.updateComplete;
      requireValue(
        menu.shadowRoot?.querySelector<HTMLElement>('[data-menu-id="menu-select:a"]'),
      ).click();
      await vi.waitFor(() =>
        expect(request).toHaveBeenCalledWith(
          '/ui/instances/direct-instance/events',
          expect.objectContaining({ fields: { mode: { value: 'a', editSequence: 2 } } }),
        ),
      );
      select.focus();
      await select.updateComplete;
      await view.refresh();
      await vi.waitFor(() => {
        const restored = requireValue(root.querySelector<WbMenuSelect>('wb-menu-select'));
        expect(restored.value).toBe('a');
        expect(root.activeElement).toBe(restored);
      });
      const disabled = requireValue(
        root.querySelector<WbMenuSelect>('wb-menu-select[name=disabledSelect]'),
      );
      expect(disabled.disabled).toBe(true);
      root.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
      await vi.waitFor(() =>
        expect(request).toHaveBeenCalledWith(
          '/ui/instances/direct-instance/events',
          expect.objectContaining({
            fields: expect.objectContaining({ mode: { value: 'a', editSequence: 2 } }),
          }),
        ),
      );
    },
  );

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
