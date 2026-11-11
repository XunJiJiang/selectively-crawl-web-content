/* Fixed core renderer shared by JSON components and the HTML sandbox. */
export function createUIRenderer(root, emit, components) {
  const document = root.ownerDocument ?? root;
  const content = root.querySelector('#content');
  const error = root.querySelector('#error');
  const listeners = [];
  const listen = (type, handler) => {
    root.addEventListener(type, handler);
    listeners.push(() => root.removeEventListener(type, handler));
  };
  let model,
    renderRevision = 0;
  let surface,
    lastHeight = -1;
  const measure = () => {
    if (surface !== 'tooltip') return;
    const height = (components?.measureHeight() ?? content.scrollHeight) + error.getBoundingClientRect().height;
    if (height !== lastHeight) {
      lastHeight = height;
      send('surface', { kind: 'resize', height });
    }
  };
  const viewer = document.defaultView;
  const observer =
    typeof viewer.ResizeObserver === 'function' ? new viewer.ResizeObserver(measure) : undefined;
  observer?.observe(content);
  observer?.observe(error);
  const activeTabs = new Map();
  const nodes = new Map(),
    fields = new Map(),
    fieldErrors = new Map(),
    edits = new Map(),
    dirty = new Set(),
    appliedEffects = new Set();
  const send = (method, payload) => emit({ method, payload, renderRevision });
  const value = (field) => {
    const node = nodes.get(field.nodeId);
    return field.kind === 'boolean'
      ? node.checked
      : field.kind === 'multiple'
        ? [...node.selectedOptions].map((o) => o.value)
        : node.value;
  };
  const snapshot = (names) =>
    Object.fromEntries(
      model.fields
        .filter((f) => !names || names.includes(f.name))
        .map((f) => [f.name, { value: value(f), editSequence: edits.get(f.name) ?? 0 }]),
    );
  const notifyFields = () => {
    components?.update();
    send('fields', snapshot());
    measure();
  };
  const showFieldError = (name, message) => {
    const entry = fieldErrors.get(name);
    if (!entry) return false;
    entry.message.textContent = message ?? '';
    entry.message.hidden = !message;
    entry.node.setAttribute('aria-invalid', String(Boolean(message)));
    entry.node.setCustomValidity?.(message ?? '');
    return true;
  };
  // This renderer also runs as a standalone sandbox script. The backend repeats these checks
  // against the compiler-owned rules before any controller or configuration write executes.
  const validateField = (field) => {
    const rules = field.validation?.rules;
    if (!rules) return '';
    const current = value(field);
    let message = '';
    if (rules.minLength !== undefined && current.length < rules.minLength)
      message = `至少输入 ${rules.minLength} 个字符`;
    else if (rules.maxLength !== undefined && current.length > rules.maxLength)
      message = `最多输入 ${rules.maxLength} 个字符`;
    else if (rules.pattern !== undefined && !new RegExp(`^(?:${rules.pattern})$(?![\\s\\S])`, 'u').test(current))
      message = rules.patternMessage || '输入格式不匹配';
    else if (rules.min !== undefined || rules.max !== undefined) {
      const number = /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(current) ? Number(current) : NaN;
      if (!Number.isFinite(number) || (rules.min !== undefined && number < rules.min) ||
          (rules.max !== undefined && number > rules.max)) message = '数值不符合声明式规则';
    }
    showFieldError(field.name, message);
    return message;
  };
  const activateTab = (groupId, tabId, focus = false) => {
    const groupRoot = [...root.querySelectorAll('[data-ui-tabs]')].find(
      (node) => node.getAttribute('data-ui-tabs') === groupId,
    );
    if (!groupRoot) return false;
    const members = [...groupRoot.querySelectorAll('[data-ui-tab-group]')].filter(
      (node) => node.getAttribute('data-ui-tab-group') === groupId,
    );
    const trigger = members.find(
      (node) =>
        node.hasAttribute('data-ui-tab-trigger') &&
        node.getAttribute('data-ui-tab-trigger') === tabId,
    );
    if (!trigger) return false;
    activeTabs.set(groupId, tabId);
    for (const member of members) {
      if (member.hasAttribute('data-ui-tab-trigger')) {
        const selected = member === trigger;
        member.setAttribute('aria-selected', String(selected));
        member.tabIndex = selected ? 0 : -1;
      } else if (member.hasAttribute('data-ui-tab-panel')) {
        member.hidden = member.getAttribute('data-ui-tab-panel') !== tabId;
      }
    }
    if (focus) trigger.focus();
    components?.update();
    trigger.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    return true;
  };
  const assign = (node, attribute, value) => {
    if (!attribute) {
      node.textContent = value === null ? '' : String(value);
      return;
    }
    if (attribute === 'data-ui-visible') {
      node.hidden = value !== true;
      return;
    }
    if (attribute === 'readonly') {
      node.readOnly = value === true;
      return;
    }
    if (['checked', 'disabled', 'selected', 'multiple', 'hidden'].includes(attribute)) {
      node[attribute] = value === true;
      return;
    }
    if (attribute === 'value' && 'value' in node) {
      if (node.tagName === 'SELECT' && node.multiple && Array.isArray(value)) {
        for (const option of node.options) option.selected = value.includes(option.value);
      } else if (node.tagName === 'PROGRESS' && value === null) {
        node.removeAttribute('value');
      } else {
        node.value = value === null ? '' : String(value);
      }
      return;
    }
    if (value === null) node.removeAttribute(attribute);
    else node.setAttribute(attribute, String(value));
  };
  function render(data) {
    for (const group of root.querySelectorAll('[data-ui-tabs]')) {
      const id = group.getAttribute('data-ui-tabs');
      const selected = group.querySelector('[data-ui-tab-trigger][aria-selected="true"]');
      if (id && selected) activeTabs.set(id, selected.getAttribute('data-ui-tab-trigger'));
    }
    const previous = model ? snapshot() : {};
    const previousErrors = new Map([...fieldErrors].map(([name, entry]) =>
      [name, { message: entry.message.textContent, validation: fields.get(name)?.validation }]));
    const active = root.activeElement;
    const focus = active?.getAttribute('name') ?? active?.getAttribute('data-ui-key');
    const selection = { start: active?.selectionStart, end: active?.selectionEnd };
    const scroll = { x: content.scrollLeft, y: content.scrollTop };
    const componentScroll = components?.captureScroll();
    model = data.compiled;
    surface = data.surface;
    renderRevision = data.renderRevision;
    nodes.clear();
    fields.clear();
    fieldErrors.clear();
    const create = (spec) => {
      const node = spec.tag
        ? document.createElement(spec.tag)
        : document.createTextNode(spec.text ?? '');
      nodes.set(spec.id, node);
      if (spec.tag) {
        node.setAttribute('data-scwc-node', spec.id);
        // The renderer owns validation feedback; native form popups would prevent our submit event.
        if (spec.tag === 'form') node.noValidate = true;
        for (const [key, value] of Object.entries(spec.attrs ?? {})) {
          if (key === 'data-ui-visible') node.hidden = value === 'false';
          else if (key === 'readonly') node.readOnly = true;
          else if (['checked', 'disabled', 'multiple', 'selected'].includes(key)) node[key] = true;
          else if (key === 'value' && 'value' in node) node.value = value;
          else node.setAttribute(key, value);
        }
        for (const child of spec.children ?? []) node.append(create(child));
        // A select's children must exist before its initial value is applied.
        if (spec.tag === 'select' && Object.hasOwn(spec.attrs ?? {}, 'value')) {
          node.value = spec.attrs.value;
        }
      }
      return node;
    };
    const fragment = document.createDocumentFragment();
    for (const node of model.nodes) fragment.append(create(node));
    content.replaceChildren(fragment);
    for (const field of model.fields) {
      const node = nodes.get(field.nodeId);
      if (!node || field.kind !== 'string') continue;
      const wrapper = document.createElement('div');
      wrapper.className = 'ui-field';
      const message = document.createElement('div');
      message.className = 'ui-field-error';
      message.dataset.uiErrorFor = field.name;
      message.id = `ui-error-${field.nodeId}`;
      message.setAttribute('role', 'alert');
      message.hidden = true;
      const describedBy = node.getAttribute('aria-describedby');
      node.setAttribute('aria-describedby', [describedBy, message.id].filter(Boolean).join(' '));
      node.before(wrapper);
      wrapper.append(node, message);
      fieldErrors.set(field.name, { node, message });
    }
    components?.mount(content);
    content.parentElement.dataset.surface = data.surface;
    const dynamicStyle = root.querySelector('#dynamic-style');
    if (dynamicStyle) dynamicStyle.textContent = model.styles.join('\n');
    const tabGroups = [...root.querySelectorAll('[data-ui-tabs]')];
    const liveGroups = new Set(tabGroups.map((group) => group.getAttribute('data-ui-tabs')));
    for (const groupId of activeTabs.keys())
      if (!liveGroups.has(groupId)) activeTabs.delete(groupId);
    for (const group of tabGroups) {
      const groupId = group.getAttribute('data-ui-tabs');
      const first = group.querySelector('[data-ui-tab-trigger]');
      if (groupId && first)
        activateTab(groupId, activeTabs.get(groupId) ?? first.getAttribute('data-ui-tab-trigger'));
    }
    for (const field of model.fields) {
      const node = nodes.get(field.nodeId);
      fields.set(field.name, field);
      if (dirty.has(field.name) && previous[field.name])
        assign(node, field.kind === 'boolean' ? 'checked' : 'value', previous[field.name].value);
      const previousError = previousErrors.get(field.name);
      if (dirty.has(field.name) && previousError &&
          JSON.stringify(previousError.validation) === JSON.stringify(field.validation))
        showFieldError(field.name, previousError.message);
      const changed = () => {
        if (node.disabled || node.readOnly) return;
        dirty.add(field.name);
        edits.set(field.name, (edits.get(field.name) ?? 0) + 1);
        if (field.validation) validateField(field);
        else showFieldError(field.name, '');
        notifyFields();
      };
      node.addEventListener('input', changed);
      node.addEventListener('change', changed);
    }
    for (const name of [...dirty])
      if (!model.fields.some((field) => field.name === name)) {
        dirty.delete(name);
        edits.delete(name);
      }
    for (const binding of model.events) {
      const node = nodes.get(binding.nodeId);
      node.addEventListener(binding.event, (event) => {
        event.preventDefault();
        if (event.isComposing || node.disabled || node.readOnly) return;
        const invalid = model.fields.filter((field) => binding.capture.includes(field.name))
          .map(validateField).find(Boolean);
        if (invalid) {
          measure();
          return;
        }
        send('event', {
          bindingId: binding.id,
          fields: snapshot(binding.capture),
          event: {
            modifiers: {
              alt: Boolean(event.altKey),
              ctrl: Boolean(event.ctrlKey),
              meta: Boolean(event.metaKey),
              shift: Boolean(event.shiftKey),
            },
          },
        });
      });
    }
    if (focus) {
      const target = [...nodes.values()].find(
        (node) =>
          node.nodeType === 1 &&
          (node.getAttribute('name') === focus || node.getAttribute('data-ui-key') === focus),
      );
      if (target) {
        (components?.focusTarget(target) ?? target).focus({ preventScroll: true });
        if (typeof selection.start === 'number' && typeof target.setSelectionRange === 'function')
          try {
            target.setSelectionRange(selection.start, selection.end);
          } catch {}
      }
    }
    content.scrollLeft = scroll.x;
    content.scrollTop = scroll.y;
    components?.restoreScroll(componentScroll);
    notifyFields();
  }
  function receive({ data }) {
    if (data.method === 'init') {
      render(data.payload);
      return;
    }
    if (data.renderRevision !== renderRevision) return;
    const payload = data.payload;
    if (data.method === 'updates') {
      for (const update of payload) {
        const binding = model.expressions.find((b) => b.id === update.id);
        if (!binding) continue;
        const field = model.fields.find((f) => f.nodeId === binding.nodeId);
        if (field && dirty.has(field.name) && ['value', 'checked'].includes(binding.attribute))
          continue;
        const node = nodes.get(binding.nodeId);
        if (update.error) {
          if (!update.field || !showFieldError(update.field, update.error)) error.textContent = update.error;
          continue;
        }
        assign(node, binding.attribute, update.value);
        if (field && ['value', 'checked'].includes(binding.attribute)) showFieldError(field.name, '');
      }
      notifyFields();
    }
    if (data.method === 'result') {
      const errorSequences = payload.errorEditSequences ?? payload.editSequences;
      const current = !errorSequences || Object.entries(errorSequences)
        .every(([name, sequence]) => (edits.get(name) ?? 0) === sequence);
      if (current) {
        for (const name of payload.validatedFields ?? []) showFieldError(name, '');
        if (payload.error && payload.field && showFieldError(payload.field, payload.error)) error.textContent = '';
        else error.textContent = payload.error ?? (payload.status === 'unavailable' ? payload.result : '');
      }
      for (const effect of payload.effects ?? []) {
        if (appliedEffects.has(effect.id)) continue;
        appliedEffects.add(effect.id);
        if (appliedEffects.size > 2048) appliedEffects.delete(appliedEffects.values().next().value);
        const name = effect.args[0],
          field = fields.get(name),
          node = field
            ? nodes.get(field.nodeId)
            : [...nodes.values()].find((n) => n.nodeType === 1 && n.getAttribute('name') === name);
        if (
          effect.type === 'value.write' &&
          field &&
          (edits.get(name) ?? 0) === payload.editSequences?.[name]
        )
          assign(node, field.kind === 'boolean' ? 'checked' : 'value', effect.args[1]);
        if (effect.type === 'element.focus' && node) (components?.focusTarget(node) ?? node).focus();
        if (effect.type === 'section.toggle' && node) node.hidden = !node.hidden;
        if (effect.type === 'scroll.to') node?.scrollIntoView({ block: 'nearest' });
      }
      if (payload.saved)
        for (const [name, sequence] of Object.entries(payload.editSequences ?? {}))
          if ((edits.get(name) ?? 0) === sequence) dirty.delete(name);
      notifyFields();
    }
    if (data.method === 'focus') {
      const node = root.querySelector('input,button,select,textarea,[tabindex]') ?? content;
      (components?.focusTarget(node) ?? node).focus();
    }
  }
  listen('submit', (event) => event.preventDefault());
  listen('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const tab = target?.closest('[data-ui-tab-trigger]');
    if (tab)
      activateTab(tab.getAttribute('data-ui-tab-group'), tab.getAttribute('data-ui-tab-trigger'));
    if (target?.closest('a')) event.preventDefault();
    send('surface', { kind: 'click' });
  });
  listen('contextmenu', (event) => {
    event.preventDefault();
    send('surface', { kind: 'contextmenu', x: event.clientX, y: event.clientY });
  });
  listen('mouseenter', () => send('surface', { kind: 'hover' }));
  listen('mouseleave', () => send('surface', { kind: 'leave' }));
  listen('keydown', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const tab = target?.closest('[data-ui-tab-trigger]');
    if (tab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      const groupId = tab.getAttribute('data-ui-tab-group');
      const group = [...root.querySelectorAll('[data-ui-tabs]')].find(
        (node) => node.getAttribute('data-ui-tabs') === groupId,
      );
      const triggers = group
        ? [...group.querySelectorAll('[data-ui-tab-trigger]')].filter(
            (node) => node.getAttribute('data-ui-tab-group') === groupId,
          )
        : [];
      const index = triggers.indexOf(tab);
      if (triggers.length && index >= 0) {
        event.preventDefault();
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? triggers.length - 1
              : (index + (event.key === 'ArrowRight' ? 1 : -1) + triggers.length) % triggers.length;
        activateTab(groupId, triggers[next].getAttribute('data-ui-tab-trigger'), true);
      }
    }
    if (event.key === 'Escape') send('surface', { kind: 'escape' });
  });
  return {
    receive,
    dispose: () => {
      observer?.disconnect();
      components?.dispose();
      listeners.forEach((remove) => remove());
    },
  };
}
