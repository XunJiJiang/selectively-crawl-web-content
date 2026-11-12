import { afterEach, expect, it, vi } from 'vitest';
import { ScriptUIView } from './script-ui.ts';
import { requireValue } from '../workbench-protocol.ts';
import type { HandlerDefinition, UINode } from '../declarative-ui.ts';
import type {
  ScriptUIModel,
  ScriptContext,
  ScriptUIEvent,
  ScriptConfigV2,
  ScriptUIResult,
} from '../script-ui.ts';

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});
it('checks local password rules while editing and runs the controller only on blur', async () => {
  const { ScriptUIRuntime } = await vi.importActual<{
    ScriptUIRuntime: new () => {
      render(config: ScriptConfigV2, context: ScriptContext): Promise<ScriptUIModel>;
      event(request: ScriptUIEvent, context: ScriptContext): Promise<ScriptUIResult>;
    };
  }>('../../server/user-script/ui.ts');
  const { inputValidationContent, inputValidationHandlers } = await vi.importActual<{
    inputValidationContent(target: 'scripts'): UINode[];
    inputValidationHandlers: Record<string, HandlerDefinition>;
  }>('../../server/plugins/template/input-validation-ui.ts');
  const context: ScriptContext = {
    version: 'v2',
    site: {
      url: 'https://example.com/a',
      rootUrl: 'https://example.com',
      origin: 'https://example.com',
      pathname: '/a',
      host: 'example.com',
      hostname: 'example.com',
    },
    values: {},
    data: [],
    logger: {} as SCWC.TLogger,
  };
  const runtime = new ScriptUIRuntime();
  const same = vi.fn(inputValidationHandlers['validation.same'].run);
  const submit = vi.fn(inputValidationHandlers['validation.submit'].run);
  const view = new ScriptUIView();
  view.model = await runtime.render(
    {
      version: 'v2',
      title: 'Template validation',
      handlers: {
        ...inputValidationHandlers,
        'validation.same': { readOnly: true, run: same },
        'validation.submit': { run: submit },
      },
      content: {
        format: 'json',
        version: 1,
        root: {
          type: 'stack',
          children: [
            requireValue(
              inputValidationContent('scripts').find(
                (node) => node.key === 'input-validation-limits',
              ),
            ),
            {
              type: 'button',
              name: 'submit',
              for: 'validation_confirm',
              events: { click: 'validation.submit()' },
            },
          ],
        },
      },
    },
    context,
  );
  const invoke = vi.fn((request: ScriptUIEvent) => runtime.event(request, context));
  view.invoke = invoke;
  document.body.append(view);
  await view.updateComplete;
  const root = requireValue(view.shadowRoot);
  const password = requireValue(root.querySelector<HTMLInputElement>('[name=validation_password]'));
  const confirm = requireValue(root.querySelector<HTMLInputElement>('[name=validation_confirm]'));
  const feedback = requireValue(
    root.querySelector<HTMLElement>('[data-ui-error-for=validation_confirm]'),
  );
  const edit = (value: string) => {
    confirm.focus();
    confirm.value = value;
    confirm.dispatchEvent(new Event('input'));
    confirm.dispatchEvent(new Event('change'));
  };
  for (const [value, message] of [
    ['x', '至少输入 8 个字符'],
    ['a'.repeat(25), '最多输入 24 个字符'],
    ['abcdefgh', '示例密码必须包含字母和数字，且只能使用字母、数字、下划线和中划线'],
    ['Abcd123!', '示例密码必须包含字母和数字，且只能使用字母、数字、下划线和中划线'],
  ]) {
    edit(value);
    expect(feedback.textContent).toBe(message);
    expect(feedback.hidden).toBe(false);
    expect(confirm.getAttribute('aria-invalid')).toBe('true');
    expect(invoke).not.toHaveBeenCalled();
    expect(same).not.toHaveBeenCalled();
    confirm.blur();
    expect(invoke).not.toHaveBeenCalled();
  }
  edit(password.value.slice(0, -1) + (password.value.endsWith('x') ? 'y' : 'x'));
  expect(invoke).not.toHaveBeenCalled();
  expect(same).not.toHaveBeenCalled();
  confirm.blur();
  await vi.waitFor(() => expect(feedback.textContent).toBe('两次示例密码不一致'));
  expect(feedback.hidden).toBe(false);
  expect(confirm.getAttribute('aria-invalid')).toBe('true');
  expect(root.querySelector('#error')?.textContent).toBe('');
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(same).toHaveBeenCalledTimes(1);
  edit(password.value);
  expect(same).toHaveBeenCalledTimes(1);
  confirm.blur();
  await vi.waitFor(() => expect(same).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(feedback.hidden).toBe(true));
  expect(confirm.getAttribute('aria-invalid')).toBe('false');
  expect(submit).not.toHaveBeenCalled();
  edit(password.value.slice(0, -1) + (password.value.endsWith('x') ? 'y' : 'x'));
  requireValue(root.querySelector<HTMLButtonElement>('[name=submit]')).click();
  await vi.waitFor(() => expect(feedback.textContent).toBe('两次示例密码不一致'));
  expect(submit).not.toHaveBeenCalled();
  edit(password.value);
  requireValue(root.querySelector<HTMLButtonElement>('[name=submit]')).click();
  await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
});
it('runs v2 script/extension validation through the real compiler, renderer and runtime', async () => {
  const { ScriptUIRuntime } = await vi.importActual<{
    ScriptUIRuntime: new () => {
      render(config: ScriptConfigV2, context: ScriptContext): Promise<ScriptUIModel>;
      event(request: ScriptUIEvent, context: ScriptContext): Promise<ScriptUIResult>;
    };
  }>('../../server/user-script/ui.ts');
  const context: ScriptContext = {
    version: 'v2',
    site: {
      url: 'https://example.com/a',
      rootUrl: 'https://example.com',
      origin: 'https://example.com',
      pathname: '/a',
      host: 'example.com',
      hostname: 'example.com',
    },
    values: {},
    data: [],
    logger: {} as SCWC.TLogger,
  };
  const runtime = new ScriptUIRuntime();
  const check = vi.fn(async () => ({ success: false, message: '验证控制器提示' }));
  const view = new ScriptUIView();
  view.model = await runtime.render(
    {
      version: 'v2',
      title: 'Validated',
      handlers: { check: { readOnly: true, run: check } },
      content: {
        format: 'json',
        version: 1,
        root: {
          type: 'stack',
          children: [
            {
              type: 'textarea',
              name: 'q',
              value: 'abc',
              minLength: 2,
              maxLength: 5,
              pattern: '[a-z]+',
              patternMessage: '只允许小写字母',
              validator: 'check($this)',
              placeholder: '输入说明',
            },
            {
              type: 'input',
              inputType: 'password',
              name: 'password',
              readonly: true,
              placeholder: '密码',
            },
            { type: 'textarea', name: 'disabled', disabled: true },
          ],
        },
      },
    },
    context,
  );
  const invoke = vi.fn((request: ScriptUIEvent) => runtime.event(request, context));
  view.invoke = invoke;
  document.body.append(view);
  await view.updateComplete;
  const root = requireValue(view.shadowRoot),
    field = requireValue(root.querySelector<HTMLTextAreaElement>('[name=q]'));
  expect(field.placeholder).toBe('输入说明');
  expect(field.maxLength).toBe(5);
  expect(root.querySelector<HTMLInputElement>('[name=password]')?.readOnly).toBe(true);
  expect(root.querySelector<HTMLTextAreaElement>('[name=disabled]')?.disabled).toBe(true);
  field.value = 'ABC';
  field.dispatchEvent(new Event('input'));
  field.dispatchEvent(new Event('change'));
  expect(root.querySelector('[data-ui-error-for=q]')?.textContent).toBe('只允许小写字母');
  expect(invoke).not.toHaveBeenCalled();
  field.value = 'abc';
  field.dispatchEvent(new Event('input'));
  field.dispatchEvent(new Event('change'));
  expect(check).not.toHaveBeenCalled();
  field.dispatchEvent(new Event('blur'));
  await vi.waitFor(() =>
    expect(root.querySelector('[data-ui-error-for=q]')?.textContent).toBe('验证控制器提示'),
  );
  expect(check).toHaveBeenCalledWith('abc');
  check.mockResolvedValue({ success: true, message: '' });
  field.dispatchEvent(new Event('blur'));
  await vi.waitFor(() => expect(root.querySelector('[data-ui-error-for=q]')?.textContent).toBe(''));
  let finish!: (value: { success: boolean; message: string }) => void;
  check.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  field.dispatchEvent(new Event('blur'));
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  field.value = 'x';
  field.dispatchEvent(new Event('input'));
  finish({ success: true, message: '' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(root.querySelector('[data-ui-error-for=q]')?.textContent).toContain('至少输入');
});
it('restores saved fields, persists edits and sends v2 events using the current field snapshot', async () => {
  const view = new ScriptUIView();
  view.model = {
    instanceId: 'instance',
    compiled: {
      format: 'json',
      nodes: [
        { id: 'field', tag: 'input', attrs: { name: 'q', value: 'default' } },
        { id: 'button', tag: 'button', children: [{ id: 'text', text: 'Save' }] },
      ],
      fields: [{ name: 'q', nodeId: 'field', kind: 'string' }],
      events: [
        {
          id: 'save',
          nodeId: 'button',
          event: 'click',
          capture: ['q'],
          for: ['q'],
          program: { branches: [] },
        },
      ],
      expressions: [],
      styles: [],
    },
    updates: [],
  } satisfies ScriptUIModel;
  view.values = { q: 'saved' };
  const save = vi.fn(),
    invoke = vi.fn(async () => ({ updates: [] }));
  view.saveValues = save;
  view.invoke = invoke;
  document.body.append(view);
  await view.updateComplete;
  expect(view.shadowRoot?.querySelector('#error')?.textContent).toBe('');
  const input = view.shadowRoot?.querySelector('input');
  if (!input) {
    throw new Error('JSON 输入未渲染');
  }
  expect(input.value).toBe('saved');
  input.value = 'edited';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  expect(save).toHaveBeenLastCalledWith({ q: 'edited' });
  view.values = { q: 'stale remote value' };
  await view.updateComplete;
  expect(view.shadowRoot?.querySelector('input')?.value).toBe('edited');
  view.shadowRoot?.querySelector('button')?.click();
  expect(invoke).toHaveBeenCalledWith(
    expect.objectContaining({
      version: 'v2',
      instanceId: 'instance',
      bindingId: 'save',
      fields: { q: { value: 'edited', editSequence: 1 } },
    }),
  );
  view.model = { ...view.model, instanceId: 'refreshed' };
  view.values = { q: 'edited' };
  await view.updateComplete;
  expect(view.shadowRoot?.querySelector('input')?.value).toBe('edited');
});

function model(instanceId = 'initial'): ScriptUIModel {
  return {
    instanceId,
    compiled: {
      format: 'json',
      styles: [],
      expressions: [{ id: 'value', nodeId: 'q', attribute: 'value', parts: [] }],
      fields: [{ name: 'q', nodeId: 'q', kind: 'string' }],
      events: [
        {
          id: 'submit',
          nodeId: 'save',
          event: 'click',
          capture: ['q'],
          for: ['q'],
          program: { branches: [] },
        },
      ],
      nodes: [
        {
          id: 'root',
          tag: 'div',
          attrs: { 'data-layout': 'column' },
          children: [
            { id: 'q', tag: 'input', attrs: { name: 'q', value: 'initial' } },
            { id: 'save', tag: 'button', children: [{ id: 'caption', text: 'Save' }] },
          ],
        },
      ],
    },
    updates: [],
  };
}
it('keeps a focused draft and selection during template replacement and ignores late results', async () => {
  const view = new ScriptUIView();
  view.identity = 'p';
  view.model = model();
  view.values = {};
  let finish!: (result: { updates: { id: string; value: string }[] }) => void;
  view.invoke = vi.fn(
    () =>
      new Promise<{ updates: { id: string; value: string }[] }>((resolve) => {
        finish = resolve;
      }),
  );
  document.body.append(view);
  await view.updateComplete;
  const input = requireValue(view.shadowRoot?.querySelector('input'));
  input.focus();
  input.value = 'unsaved draft';
  input.setSelectionRange(2, 7);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  requireValue(view.shadowRoot?.querySelector('button')).click();
  view.model = { ...model('next'), updates: [{ id: 'value', value: 'remote' }] };
  await view.updateComplete;
  const next = requireValue(view.shadowRoot?.querySelector('input'));
  expect(next.value).toBe('unsaved draft');
  expect(view.shadowRoot?.activeElement).toBe(next);
  expect([next.selectionStart, next.selectionEnd]).toEqual([2, 7]);
  finish({ updates: [{ id: 'value', value: 'late' }] });
  await Promise.resolve();
  expect(next.value).toBe('unsaved draft');
});
it('recovers stale reads once, clears recovered errors and never replays a failed submission', async () => {
  vi.useFakeTimers();
  const view = new ScriptUIView();
  view.identity = 'p';
  view.model = { ...model(), boundFields: ['q'] };
  const stale = Object.assign(new Error('stale'), { code: 'UI_STALE_INSTANCE' });
  const invoke = vi.fn().mockRejectedValueOnce(stale).mockResolvedValue({ updates: [] });
  const refresh = vi.fn(async () => ({ ...model('recovered'), boundFields: ['q'] }));
  view.invoke = invoke;
  view.refreshModel = refresh;
  document.body.append(view);
  await view.updateComplete;
  await view.readValues();
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(view.shadowRoot?.querySelector('#error')?.textContent).toBe('');
  invoke.mockRejectedValue(stale);
  requireValue(view.shadowRoot?.querySelector('button')).click();
  await Promise.resolve();
  await Promise.resolve();
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(invoke).toHaveBeenCalledTimes(3);
  await view.readValues();
  expect(refresh).toHaveBeenCalledTimes(2);
  const count = invoke.mock.calls.length;
  await vi.advanceTimersByTimeAsync(20000);
  expect(invoke).toHaveBeenCalledTimes(count);
});
