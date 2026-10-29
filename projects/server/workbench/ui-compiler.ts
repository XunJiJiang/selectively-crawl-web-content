import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';
import * as css from 'css-tree';
import {
  UI_LIMITS,
  uiAssert,
  uiName,
  type UIContent,
  type UINode,
  type SafeNode,
  type CompiledUI,
  type UIValue,
} from '../../shared/declarative-ui.ts';
import { parseProgram, parseTemplate, walkArgument } from '../../shared/ui-expressions.ts';

const tags = [
  'section',
  'div',
  'span',
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'small',
  'strong',
  'em',
  'b',
  'i',
  'pre',
  'code',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'br',
  'hr',
  'label',
  'input',
  'textarea',
  'select',
  'option',
  'button',
  'form',
  'output',
  'progress',
  'img',
  'a',
  'details',
  'summary',
  'table',
  'thead',
  'tbody',
  'tr',
  'td',
  'th',
];
const attributes = [
  'id',
  'name',
  'for',
  'type',
  'value',
  'checked',
  'disabled',
  'multiple',
  'selected',
  'placeholder',
  'min',
  'max',
  'maxlength',
  'title',
  'alt',
  'src',
  'srcset',
  'href',
  'class',
  'role',
  'tabindex',
  'aria-label',
  'aria-live',
  'aria-hidden',
  'aria-expanded',
  'aria-selected',
  'aria-controls',
  'aria-labelledby',
  'data-ui-key',
  'data-ui-for',
  'data-ui-tabs',
  'data-ui-tab-group',
  'data-ui-tab-trigger',
  'data-ui-tab-panel',
  'data-layout',
  'data-gap',
  'data-ui-visible',
];
const events: Record<string, string> = {
  onclick: 'click',
  oninput: 'input',
  onchange: 'change',
  onsubmit: 'submit',
  oncontextmenu: 'contextmenu',
  onmouseenter: 'mouseenter',
  onmouseleave: 'mouseleave',
  onfocus: 'focus',
  onblur: 'blur',
};
const styleProperties = new Set([
  'color',
  'background',
  'background-color',
  'background-image',
  'border',
  'border-color',
  'border-width',
  'border-style',
  'border-radius',
  'padding',
  'padding-top',
  'padding-bottom',
  'padding-left',
  'padding-right',
  'margin',
  'margin-top',
  'margin-bottom',
  'margin-left',
  'margin-right',
  'display',
  'flex',
  'flex-direction',
  'flex-wrap',
  'align-items',
  'justify-content',
  'gap',
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'font',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'text-align',
  'text-decoration',
  'white-space',
  'overflow',
  'overflow-x',
  'overflow-y',
  'opacity',
  'box-shadow',
  'object-fit',
  'content',
  'src',
  'font-style',
  'font-display',
]);
export interface CompileOptions {
  resource(path: string): string;
  validateCall(name: string, readOnly: boolean, watch: boolean): void;
  reads?(name: string): string[];
}
export function compileCSS(source: string, resource: (path: string) => string, inline = false) {
  uiAssert(Buffer.byteLength(source) <= 262144, 'UI_QUOTA_EXCEEDED', 'CSS 过大');
  const ast = css.parse(source, { context: inline ? 'declarationList' : 'stylesheet' });
  css.walk(ast, (node) => {
    uiAssert(node.type !== 'Raw', 'UI_INVALID_CONTENT', 'CSS 含无法验证的片段');
    if (node.type === 'Atrule') {
      uiAssert(
        ['media', 'supports', 'font-face', 'import'].includes(node.name.toLowerCase()),
        'UI_INVALID_CONTENT',
        'CSS 规则不允许',
      );
    }
    if (node.type === 'Declaration') {
      uiAssert(
        styleProperties.has(node.property.toLowerCase()),
        'UI_INVALID_CONTENT',
        `CSS 属性不允许：${node.property}`,
      );
    }
    if (node.type === 'Url') {
      node.value = resource(node.value);
    }
    if (node.type === 'Function') {
      uiAssert(
        !['expression', 'attr', 'image-set', '-webkit-image-set'].includes(node.name.toLowerCase()),
        'UI_INVALID_CONTENT',
        'CSS 函数不允许',
      );
    }
    if (node.type === 'Function' && node.name.toLowerCase() === 'var') {
      const first = node.children.first;
      uiAssert(
        first?.type === 'Identifier' &&
          /^--(?:wb-|scwc-|color-|font-|space-|border-|text-|surface-)/.test(first.name),
        'UI_INVALID_CONTENT',
        '仅允许核心主题变量',
      );
    }
    if (node.type === 'Atrule' && node.name.toLowerCase() === 'import' && node.prelude) {
      css.walk(node.prelude, (child) => {
        if (child.type === 'String') {
          child.value = resource(child.value);
        }
      });
    }
  });
  return css.generate(ast);
}
const escape = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );
function jsonHTML(node: UINode, depth = 0, path = '0'): string {
  uiAssert(
    depth <= UI_LIMITS.depth && node && typeof node === 'object',
    'UI_INVALID_CONTENT',
    '组件结构无效',
  );
  const properties: Record<string, string[]> = {
    stack: ['direction', 'gap', 'children'],
    text: ['text', 'tone'],
    icon: ['icon', 'label'],
    image: ['src', 'alt'],
    button: ['text', 'icon', 'disabled', 'submit'],
    input: ['value', 'inputType', 'placeholder', 'disabled'],
    textarea: ['value', 'placeholder', 'disabled'],
    select: ['value', 'options', 'disabled'],
    checkbox: ['checked', 'label', 'disabled'],
    toggle: ['checked', 'label', 'disabled'],
    form: ['children'],
    progress: ['value'],
    badge: ['text', 'tone'],
    divider: [],
    tabs: ['label', 'tabs'],
  };
  uiAssert(Object.hasOwn(properties, node.type), 'UI_INVALID_CONTENT', '组件类型无效');
  const allowed = new Set([
    'type',
    'key',
    'name',
    'for',
    'events',
    'visible',
    ...properties[node.type],
  ]);
  const unknownProperty = Object.keys(node).find((key) => !allowed.has(key));
  uiAssert(
    !unknownProperty,
    'UI_INVALID_CONTENT',
    `组件含未知属性：${unknownProperty ?? ''}`,
  );
  for (const key of ['text', 'label', 'src', 'alt', 'placeholder']) {
    if (node[key] !== undefined) {
      uiAssert(typeof node[key] === 'string', 'UI_INVALID_VALUE_TYPE', `${key} 需要字符串`);
    }
  }
  for (const key of ['visible', 'disabled', 'checked', 'submit']) {
    if (node[key] !== undefined) {
      uiAssert(
        typeof node[key] === 'boolean' ||
          (typeof node[key] === 'string' && node[key].includes('${')),
        'UI_INVALID_VALUE_TYPE',
        `${key} 需要布尔值或模板`,
      );
    }
  }
  if (node.type === 'input' && node.value !== undefined) {
    uiAssert(typeof node.value === 'string', 'UI_INVALID_VALUE_TYPE', '输入值必须是字符串');
  }
  if (node.type === 'textarea' && node.value !== undefined) {
    uiAssert(typeof node.value === 'string', 'UI_INVALID_VALUE_TYPE', '输入值必须是字符串');
  }
  if (node.type === 'progress') {
    uiAssert(
      node.value === null ||
        (typeof node.value === 'number' &&
          Number.isFinite(node.value) &&
          node.value >= 0 &&
          node.value <= 1) ||
        (typeof node.value === 'string' && node.value.includes('${')),
      'UI_INVALID_VALUE_TYPE',
      '进度需要 0–1 数字、null 或模板',
    );
  }
  if (node.direction !== undefined) {
    uiAssert(
      ['row', 'column'].includes(String(node.direction)),
      'UI_INVALID_VALUE_TYPE',
      '布局方向无效',
    );
  }
  if (node.gap !== undefined) {
    uiAssert(
      ['small', 'medium', 'large'].includes(String(node.gap)) ||
        (typeof node.gap === 'number' && node.gap >= 0 && node.gap <= 100),
      'UI_INVALID_VALUE_TYPE',
      '布局间距无效',
    );
  }
  if (node.tone !== undefined) {
    uiAssert(
      ['title', 'muted', 'code', 'success', 'warning', 'error'].includes(String(node.tone)),
      'UI_INVALID_VALUE_TYPE',
      '文本强调样式无效',
    );
  }
  const attr = (key: string, value: unknown) =>
    value === undefined ? '' : ` ${key}="${escape(value)}"`;
  const base =
    attr('data-ui-visible', node.visible) +
    attr('name', node.name) +
    attr('for', Array.isArray(node.for) ? node.for.join(' ') : node.for) +
    attr('data-ui-key', node.key) +
    Object.entries(node.events ?? {})
      .map(([event, program]) => {
        uiAssert(
          Object.values(events).includes(event) || event === 'hover',
          'UI_INVALID_CONTENT',
          '组件事件无效',
        );
        return event === 'hover'
          ? attr('onmouseenter', program) + attr('onmouseleave', program)
          : attr('on' + event, program);
      })
      .join('');
  const text = escape(node.text ?? node.label);
  const children = () => {
    uiAssert(Array.isArray(node.children), 'UI_INVALID_CONTENT', 'children 必须是数组');
    return node.children.map((n, index) => jsonHTML(n, depth + 1, `${path}-${index}`)).join('');
  };
  switch (node.type) {
    case 'stack':
      return `<div${base}${attr('data-layout', node.direction ?? 'column')}${attr('data-gap', node.gap ?? 'medium')}>${children()}</div>`;
    case 'text':
      return `<span${base}${attr('class', `ui-text${node.tone ? ' ui-text-' + node.tone : ''}`)}>${text}</span>`;
    case 'badge':
      return `<span${base}${attr('class', `ui-badge${node.tone ? ' ui-badge-' + node.tone : ''}`)}>${text}</span>`;
    case 'form':
      return `<form${base}>${children()}</form>`;
    case 'button':
      return `<button${base} type="${node.submit === true ? 'submit' : 'button'}"${attr('disabled', node.disabled)}>${text}</button>`;
    case 'input':
      return `<input${base}${attr('type', node.inputType ?? 'text')}${attr('value', node.value ?? '')}${attr('placeholder', node.placeholder)}>`;
    case 'textarea':
      return `<textarea${base}${attr('value', node.value ?? '')}${attr('placeholder', node.placeholder)}></textarea>`;
    case 'checkbox':
    case 'toggle':
      return `<label><input${base} type="checkbox"${attr('checked', node.checked)}${attr('disabled', node.disabled)}>${text}</label>`;
    case 'select': {
      uiAssert(Array.isArray(node.options), 'UI_INVALID_CONTENT', 'options 必须是数组');
      return `<select${base}${attr('value', node.value ?? '')}>${node.options
        .map((item) => {
          const option =
            typeof item === 'string'
              ? { value: item, label: item }
              : (item as { value: string; label: string });
          uiAssert(
            option && typeof option.value === 'string' && typeof option.label === 'string',
            'UI_INVALID_CONTENT',
            '选项无效',
          );
          return `<option${attr('value', option.value)}>${escape(option.label)}</option>`;
        })
        .join('')}</select>`;
    }
    case 'progress':
      return `<progress${base}${node.value === null ? '' : attr('value', node.value)} max="1"></progress>`;
    case 'divider':
      return '<hr>';
    case 'image':
      return `<img${base}${attr('src', node.src)}${attr('alt', node.alt)}>`;
    case 'icon': {
      const icon = node.icon as { kind: string; path?: string; name?: string };
      return icon?.kind === 'asset'
        ? `<img${base}${attr('src', icon.path)}${attr('alt', node.label)}>`
        : `<span${base}${attr('class', 'core-icon ' + (icon?.name ?? 'info'))}${attr('aria-label', node.label)}>${['loading', 'syncing', 'pulsing'].includes(icon?.name ?? '') ? '⟳' : '●'}</span>`;
    }
    case 'tabs': {
      uiAssert(
        Array.isArray(node.tabs) && node.tabs.length > 0 && node.tabs.length <= 32,
        'UI_INVALID_CONTENT',
        'tabs 必须包含 1–32 个标签',
      );
      const tabIds = new Set<string>();
      for (const tab of node.tabs) {
        uiAssert(
          tab &&
            typeof tab.id === 'string' &&
            !tabIds.has(tab.id) &&
            typeof tab.label === 'string' &&
            Array.isArray(tab.children),
          'UI_INVALID_CONTENT',
          '标签定义无效或 id 重复',
        );
        uiName(tab.id);
        tabIds.add(tab.id);
      }
      const group = `g-${path}`;
      const tabId = (id: string) => `${group}-tab-${id}`;
      const panelId = (id: string) => `${group}-panel-${id}`;
      const tabs = node.tabs as { id: string; label: string; children: UINode[] }[];
      return `<div${base}${attr('class', 'ui-tabs')} data-ui-tabs="${group}">
        <div class="ui-tab-list" role="tablist"${attr('aria-label', node.label ?? '标签栏')}>
          ${tabs
            .map(
              (tab, index) =>
                `<button type="button" role="tab"${attr('id', tabId(tab.id))}${attr('data-ui-key', tabId(tab.id))}${attr('aria-controls', panelId(tab.id))}${attr('aria-selected', index === 0 ? 'true' : 'false')}${attr('tabindex', index === 0 ? '0' : '-1')} data-ui-tab-group="${group}" data-ui-tab-trigger="${escape(tab.id)}">${escape(tab.label)}</button>`,
            )
            .join('')}
        </div>
        ${tabs
          .map(
            (tab, index) =>
              `<div class="ui-tab-panel" role="tabpanel"${attr('id', panelId(tab.id))}${attr('aria-labelledby', tabId(tab.id))} data-ui-tab-group="${group}" data-ui-tab-panel="${escape(tab.id)}" data-ui-visible="${index === 0 ? 'true' : 'false'}">${tab.children
                .map((child, childIndex) =>
                  jsonHTML(child, depth + 1, `${path}-t${index}-${childIndex}`),
                )
                .join('')}</div>`,
          )
          .join('')}
      </div>`;
    }
    default:
      return `<span${base}>${text}</span>`;
  }
}
export function compileUI(content: UIContent, options: CompileOptions): CompiledUI {
  uiAssert(
    content.version === 1 && ['html', 'json'].includes(content.format),
    'UI_INVALID_CONTENT',
    '声明式内容版本无效',
  );
  const html = content.format === 'html' ? content.html : jsonHTML(content.root);
  uiAssert(
    typeof html === 'string' && Buffer.byteLength(html) <= UI_LIMITS.bytes,
    'UI_QUOTA_EXCEEDED',
    'UI 内容过大',
  );
  const dom = new JSDOM('<!doctype html><body></body>');
  try {
    const document = dom.window.document;
    const inert = document.createElement('div');
    inert.innerHTML = html;
    const result: CompiledUI = { format: content.format, nodes: [], fields: [], events: [], expressions: [], styles: [] };
    const eventTable = new Map<Element, Record<string, string>>();
    const associations = new Map<Element, string>();
    for (const element of inert.querySelectorAll('*')) {
      associations.set(
        element,
        element.getAttribute('data-ui-for') ?? element.getAttribute('for') ?? '',
      );
      const handlers: Record<string, string> = {};
      for (const attr of [...element.attributes]) {
        const canonical = attr.name.startsWith('data-ui-') ? 'on' + attr.name.slice(8) : attr.name;
        if (Object.hasOwn(events, canonical)) {
          uiAssert(
            !Object.hasOwn(handlers, events[canonical]),
            'UI_INVALID_CONTENT',
            '同一事件重复绑定',
          );
          handlers[events[canonical]] = attr.value;
          element.removeAttribute(attr.name);
        } else if (attr.name.startsWith('on')) {
          element.removeAttribute(attr.name);
        }
      }
      eventTable.set(element, handlers);
      if (element.tagName === 'STYLE') {
        result.styles.push(compileCSS(element.textContent ?? '', options.resource));
        element.remove();
      } else if (element.tagName === 'LINK') {
        uiAssert(
          element.getAttribute('rel') === 'stylesheet',
          'UI_INVALID_CONTENT',
          '只允许样式表 link',
        );
        result.styles.push(
          `@import url("${options.resource(element.getAttribute('href') ?? '').replace(/"/g, '%22')}");`,
        );
        element.remove();
      }
    }
    const purifier = createDOMPurify(dom.window);
    purifier.sanitize(inert, {
      IN_PLACE: true,
      ALLOWED_TAGS: tags,
      ALLOWED_ATTR: [...attributes, 'style'],
      ALLOW_DATA_ATTR: false,
      ADD_ATTR: [
        'data-ui-key',
        'data-ui-for',
        'data-ui-tabs',
        'data-ui-tab-group',
        'data-ui-tab-trigger',
        'data-ui-tab-panel',
        'data-layout',
        'data-gap',
        'data-ui-visible',
      ],
    });
    let count = 0;
    const expr = (nodeId: string, attribute: string | undefined, text: string) => {
      const parts = parseTemplate(text);
      if (parts.some((part) => typeof part !== 'string')) {
        for (const part of parts) {
          if (typeof part !== 'string') {
            walkArgument(part, (n) => {
              if (n.type === 'call') {
                options.validateCall(n.name, true, n.watch);
              }
            });
          }
        }
        result.expressions.push({ id: 'x' + result.expressions.length, nodeId, attribute, parts });
        return '';
      }
      return parts.join('');
    };
    const visit = (node: Node, depth: number, form?: string): SafeNode | null => {
      uiAssert(
        ++count <= UI_LIMITS.nodes && depth <= UI_LIMITS.depth,
        'UI_QUOTA_EXCEEDED',
        'UI 节点过多或嵌套过深',
      );
      const id = 'n' + count;
      if (node.nodeType === 3) {
        return { id, text: expr(id, undefined, node.textContent ?? '') };
      }
      if (node.nodeType !== 1) {
        return null;
      }
      const element = node as Element,
        tag = element.tagName.toLowerCase();
      const attrs: Record<string, string> = {};
      for (const attr of [...element.attributes]) {
        if (['name', 'for', 'data-ui-for', 'id', 'data-ui-key'].includes(attr.name)) {
          uiAssert(!attr.value.includes('${'), 'UI_INVALID_CONTENT', '绑定标识不支持插值');
        }
        if (attr.name === 'style') {
          result.styles.push(
            `[data-scwc-node="${id}"]{${compileCSS(attr.value, options.resource, true)}}`,
          );
          continue;
        }
        if (['srcset'].includes(attr.name)) {
          uiAssert(!attr.value.includes('${'), 'UI_INVALID_CONTENT', 'srcset 不支持插值');
          attrs.srcset = attr.value
            .split(',')
            .map((part) => {
              const [url, density] = part.trim().split(/\s+/);
              uiAssert(
                !density || /^\d+(?:\.\d+)?[wx]$/.test(density),
                'UI_INVALID_CONTENT',
                'srcset 无效',
              );
              return options.resource(url) + (density ? ' ' + density : '');
            })
            .join(',');
          continue;
        }
        if (attr.name === 'src' || attr.name === 'href') {
          if (attr.value.includes('${')) {
            attrs[attr.name] = expr(id, attr.name, attr.value);
          } else {
            attrs[attr.name] = attr.value.startsWith('#')
              ? attr.value
              : options.resource(attr.value);
          }
          continue;
        }
        const value = expr(id, attr.name, attr.value);
        if (['checked', 'disabled', 'multiple', 'selected'].includes(attr.name)) {
          if (attr.value === '' || attr.value === 'true') {
            attrs[attr.name] = '';
          } else {
            uiAssert(
              ['false'].includes(attr.value) || attr.value.includes('${'),
              'UI_INVALID_VALUE_TYPE',
              '布尔属性值无效',
            );
          }
        } else {
          attrs[attr.name] = value;
        }
      }
      if (attrs.name) {
        uiName(attrs.name);
        if (tag === 'form') {
          form = attrs.name;
        }
        if (['input', 'textarea', 'select'].includes(tag)) {
          const kind =
            attrs.type === 'checkbox'
              ? 'boolean'
              : Object.hasOwn(attrs, 'multiple')
                ? 'multiple'
                : 'string';
          result.fields.push({ name: attrs.name, nodeId: id, kind, form });
        }
      }
      if (tag === 'input') {
        uiAssert(
          ['text', 'number', 'color', 'checkbox', 'password', 'email', 'url', 'search'].includes(
            attrs.type ?? 'text',
          ),
          'UI_INVALID_CONTENT',
          '输入类型不允许',
        );
      }
      for (const [event, text] of Object.entries(eventTable.get(element) ?? {})) {
        const program = parseProgram(text),
          capture = new Set<string>();
        for (const chain of program.branches) {
          chain.forEach((call) =>
            walkArgument(call, (n) => {
              if (n.type === 'field') {
                capture.add(n.name);
              }
              if (n.type === 'call') {
                options.validateCall(n.name, n !== call, n.watch);
                for (const name of options.reads?.(n.name) ?? []) {
                  capture.add(name);
                }
              }
            }),
          );
        }
        const association =
          tag === 'label' ? [] : (associations.get(element) ?? '').split(/\s+/).filter(Boolean);
        association.forEach((name) => {
          uiName(name);
          capture.add(name);
        });
        if (result.fields.some((field) => field.nodeId === id)) {
          capture.add(attrs.name);
        }
        result.events.push({
          id: 'e' + result.events.length,
          nodeId: id,
          event,
          program,
          for: association,
          capture: [...capture],
        });
      }
      const children = [...node.childNodes]
        .map((child) => visit(child, depth + 1, form))
        .filter((n): n is SafeNode => n !== null);
      return { id, tag, attrs, children, key: attrs['data-ui-key'] };
    };
    result.nodes = [...inert.childNodes]
      .map((n) => visit(n, 0))
      .filter((n): n is SafeNode => n !== null);
    uiAssert(
      result.fields.length <= UI_LIMITS.fields &&
        new Set(result.fields.map((f) => f.name)).size === result.fields.length,
      'UI_INVALID_CONTENT',
      '命名值重复或超过上限',
    );
    for (const binding of result.events) {
      const form = result.nodes
        .flatMap(function all(n): SafeNode[] {
          return [n, ...(n.children ?? []).flatMap(all)];
        })
        .find((n) => n.id === binding.nodeId && n.tag === 'form');
      if (form) {
        binding.capture.push(
          ...result.fields.filter((f) => f.form === form.attrs?.name).map((f) => f.name),
        );
      }
      for (const name of binding.capture) {
        uiAssert(
          result.fields.some((f) => f.name === name),
          'UI_UNKNOWN_VALUE',
          `未声明的命名值 ${name}`,
        );
      }
    }
    for (const binding of result.expressions) {
      for (const part of binding.parts) {
        if (typeof part !== 'string') {
          walkArgument(part, (n) => {
            if (n.type === 'field') {
              uiAssert(
                result.fields.some((f) => f.name === n.name),
                'UI_UNKNOWN_VALUE',
                `未声明的命名值 ${n.name}`,
              );
            }
          });
        }
      }
    }
    const allNodes = result.nodes.flatMap(function all(node): SafeNode[] {
      return [node, ...(node.children ?? []).flatMap(all)];
    });
    const expand = (binding: CompiledUI['events'][number], path: string[]): number => {
      uiAssert(
        !path.includes(binding.id) && path.length < 8,
        'UI_TRIGGER_CYCLE',
        '嵌套触发存在循环或过深',
      );
      let steps = 0;
      for (const chain of binding.program.branches) {
        for (const call of chain) {
          walkArgument(call, (node) => {
            if (node.type !== 'call') {
              return;
            }
            steps++;
            if (['core:value.read', 'core:value.write'].includes(node.name)) {
              const name = node.args[0];
              uiAssert(
                name?.type === 'literal' &&
                  typeof name.value === 'string' &&
                  result.fields.some((field) => field.name === name.value),
                'UI_UNKNOWN_VALUE',
                '读写目标必须是静态命名值',
              );
              binding.capture.push(name.value);
            }
            if (node.name === 'core:validate') {
              const rules = node.args[1];
              uiAssert(rules, 'UI_INVALID_PROGRAM', '缺少校验规则');
              walkArgument(rules, (arg) =>
                uiAssert(
                  ['literal', 'array', 'object'].includes(arg.type),
                  'UI_INVALID_PROGRAM',
                  '校验规则必须为静态声明',
                ),
              );
            }
            if (node.name !== 'core:event.trigger') {
              return;
            }
            const name = node.args[0],
              event = node.args[1];
            uiAssert(
              name?.type === 'literal' &&
                typeof name.value === 'string' &&
                event?.type === 'literal' &&
                typeof event.value === 'string',
              'UI_INVALID_PROGRAM',
              '触发目标和事件必须是静态字符串',
            );
            const element = allNodes.find((item) => item.attrs?.name === name.value),
              target = result.events.find(
                (item) => item.nodeId === element?.id && item.event === event.value,
              );
            uiAssert(target, 'UI_UNKNOWN_VALUE', '嵌套触发目标不存在');
            uiAssert(
              target.program.branches.every((c) => c[0].domain === call.domain),
              'UI_CROSS_DOMAIN_PIPE',
              '嵌套触发不能跨域',
            );
            steps += expand(target, [...path, binding.id]);
            binding.capture.push(...target.capture);
          });
        }
      }
      binding.capture = [...new Set(binding.capture)];
      uiAssert(steps <= 64, 'UI_QUOTA_EXCEEDED', '静态展开步骤超过上限');
      return steps;
    };
    for (const binding of result.events) {
      expand(binding, []);
    }
    uiAssert(
      result.events.length + result.expressions.length <= UI_LIMITS.bindings,
      'UI_QUOTA_EXCEEDED',
      '绑定数量超限',
    );
    return result;
  } finally {
    dom.window.close();
  }
}
export function validateAttribute(
  name: string | undefined,
  value: UIValue,
): string | boolean | number | null {
  if (
    ['checked', 'disabled', 'selected', 'multiple', 'hidden', 'data-ui-visible'].includes(
      name ?? '',
    )
  ) {
    uiAssert(typeof value === 'boolean', 'UI_INVALID_VALUE_TYPE', '属性需要布尔值');
    return value;
  }
  uiAssert(
    value === null || typeof value !== 'object',
    'UI_INVALID_VALUE_TYPE',
    '显示值必须为标量',
  );
  return value;
}
