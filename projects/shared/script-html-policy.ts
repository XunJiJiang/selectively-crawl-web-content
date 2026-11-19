import * as css from 'css-tree';
import { UI_LIMITS, uiAssert, uiControlName, type CompiledUI } from './declarative-ui.ts';
import { validateUIRules } from './ui-validation.ts';

const tags = new Set([
  'section', 'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'small', 'strong',
  'em', 'b', 'i', 'pre', 'code', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'br', 'hr', 'label',
  'input', 'textarea', 'select', 'option', 'button', 'form', 'output', 'progress', 'details',
  'summary', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
]);
const attributes = new Set([
  'id', 'name', 'for', 'type', 'value', 'checked', 'disabled', 'readonly', 'multiple', 'selected',
  'placeholder', 'min', 'max', 'step', 'maxlength', 'minlength', 'pattern', 'title', 'class',
  'role', 'tabindex', 'data-ui-key', 'data-ui-for', 'data-layout', 'data-gap', 'data-ui-visible',
]);
const cssProperties = new Set([
  'color', 'background-color', 'border', 'border-color', 'border-width',
  'border-style', 'border-radius', 'padding', 'padding-top', 'padding-bottom', 'padding-left',
  'padding-right', 'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right',
  'display', 'flex', 'flex-direction', 'flex-wrap', 'align-items', 'justify-content', 'gap',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'font', 'font-family',
  'font-size', 'font-weight', 'line-height', 'text-align', 'text-decoration', 'white-space',
  'overflow', 'overflow-x', 'overflow-y', 'opacity', 'box-shadow', 'object-fit', 'font-style',
]);
const cssFunctions = new Set([
  'calc', 'min', 'max', 'clamp', 'rgb', 'rgba', 'hsl', 'hsla', 'var',
]);

export function validateScriptHTMLAttribute(attribute: string, value: unknown) {
  uiAssert(
    attributes.has(attribute) || /^aria-[a-z-]+$/.test(attribute),
    'UI_INVALID_CONTENT',
    '脚本 HTML 属性不允许',
  );
  if (attribute === 'type' && typeof value === 'string') {
    uiAssert(!/^(?:file|image)$/i.test(value), 'UI_INVALID_CONTENT', '脚本 HTML 控件类型不允许');
  }
}

function scriptHTMLStyles(styles: string[]): string[] {
  uiAssert(
    styles.join('').length <= UI_LIMITS.bytes,
    'UI_QUOTA_EXCEEDED',
    '脚本 HTML 样式过大',
  );
  return styles.map((source) => {
    const ast = css.parse(source);
    css.walk(ast, (node) => {
      uiAssert(
        node.type !== 'Raw' && node.type !== 'Url',
        'UI_INVALID_CONTENT',
        '脚本 HTML 样式含不支持的内容',
      );
      if (node.type === 'Atrule') {
        uiAssert(
          ['media', 'supports'].includes(node.name.toLowerCase()),
          'UI_INVALID_CONTENT',
          '脚本 HTML 样式规则不允许',
        );
      }
      if (node.type === 'Declaration') {
        uiAssert(
          cssProperties.has(node.property.toLowerCase()),
          'UI_INVALID_CONTENT',
          '脚本 HTML 样式属性不允许',
        );
      }
      if (node.type === 'Function') {
        const name = node.name.toLowerCase();
        const first = node.children.first;
        uiAssert(
          cssFunctions.has(name) &&
            (name !== 'var' ||
              (first?.type === 'Identifier' &&
                /^--(?:wb-|scwc-|color-|font-|space-|border-|text-|surface-)/.test(first.name))),
          'UI_INVALID_CONTENT',
          '脚本 HTML 样式函数不允许',
        );
      }
      if (node.type === 'Rule') {
        uiAssert(node.prelude.type === 'SelectorList', 'UI_INVALID_CONTENT', '脚本 HTML 选择器无效');
        node.prelude.children.forEach((selector) => {
          uiAssert(selector.type === 'Selector', 'UI_INVALID_CONTENT', '脚本 HTML 选择器无效');
          selector.children.prependData({ type: 'Combinator', name: ' ' });
          selector.children.prependData({ type: 'IdSelector', name: 'content' });
        });
      }
    });
    return css.generate(ast);
  });
}

export function validateScriptHTMLModel(model: CompiledUI): string[] {
  uiAssert(!model.trees?.length, 'UI_INVALID_CONTENT', '脚本 HTML 不支持树节点');
  const ids = new Set<string>();
  const visit = (nodes: CompiledUI['nodes'], depth: number) => {
    uiAssert(depth <= UI_LIMITS.depth, 'UI_QUOTA_EXCEEDED', '脚本 HTML 结构过深');
    for (const node of nodes) {
      uiAssert(
        !ids.has(node.id) && ids.size < UI_LIMITS.nodes,
        'UI_INVALID_CONTENT',
        '脚本 HTML 节点无效',
      );
      ids.add(node.id);
      if (node.tag) {
        uiAssert(tags.has(node.tag), 'UI_INVALID_CONTENT', '脚本 HTML 标签不允许');
        for (const [key, value] of Object.entries(node.attrs ?? {})) {
          validateScriptHTMLAttribute(key, value);
        }
      }
      visit(node.children ?? [], depth + 1);
    }
  };
  visit(model.nodes, 0);
  for (const field of model.fields) {
    uiControlName(field.name);
    uiAssert(ids.has(field.nodeId), 'UI_INVALID_CONTENT', '脚本 HTML 字段目标无效');
    if (field.validation) validateUIRules(field.validation.rules);
  }
  for (const binding of model.expressions) {
    uiAssert(ids.has(binding.nodeId), 'UI_INVALID_CONTENT', '脚本 HTML 绑定目标无效');
    if (binding.attribute) validateScriptHTMLAttribute(binding.attribute, '');
  }
  return scriptHTMLStyles(model.styles);
}
