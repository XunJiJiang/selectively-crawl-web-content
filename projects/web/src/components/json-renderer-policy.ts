import { uiAssert, UI_LIMITS, type CompiledUI } from '../../../shared/declarative-ui.ts';

const tags = new Set([
  'div',
  'span',
  'label',
  'input',
  'textarea',
  'select',
  'option',
  'button',
  'form',
  'progress',
  'hr',
  'img',
]);
const attributes = new Set([
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
  'max',
  'alt',
  'src',
  'class',
  'role',
  'tabindex',
  'aria-label',
  'aria-selected',
  'aria-controls',
  'aria-labelledby',
  'data-ui-key',
  'data-layout',
  'data-gap',
  'data-ui-visible',
  'data-ui-tabs',
  'data-ui-tab-group',
  'data-ui-tab-trigger',
  'data-ui-tab-panel',
]);

export function validateJSONAttribute(attribute: string, value: unknown) {
  uiAssert(attributes.has(attribute), 'UI_INVALID_CONTENT', 'JSON 属性不允许');
  if (attribute === 'src' && value) {
    const url = new URL(String(value), location.origin);
    uiAssert(
      url.origin === location.origin &&
        url.pathname.startsWith('/web/ui/assets/') &&
        !url.username &&
        !url.password &&
        !url.hash,
      'UI_RESOURCE_DENIED',
      'JSON 图片只允许核心资源服务',
    );
  }
}

/** Shadow DOM isolates styles; the component/attribute allowlists prevent active content. */
export function validateJSONModel(model: CompiledUI) {
  uiAssert(
    model.format === 'json' && model.styles.length === 0,
    'UI_INVALID_CONTENT',
    'JSON 不允许自定义样式',
  );
  const ids = new Set<string>();
  const visit = (nodes: CompiledUI['nodes'], depth: number) => {
    uiAssert(depth <= UI_LIMITS.depth, 'UI_QUOTA_EXCEEDED', 'JSON 结构过深');
    for (const node of nodes) {
      uiAssert(
        !ids.has(node.id) && ids.size < UI_LIMITS.nodes,
        'UI_INVALID_CONTENT',
        'JSON 节点无效',
      );
      ids.add(node.id);
      if (node.tag) {
        uiAssert(tags.has(node.tag), 'UI_INVALID_CONTENT', 'JSON 标签不允许');
        for (const [key, value] of Object.entries(node.attrs ?? {})) {
          validateJSONAttribute(key, value);
        }
      }
      visit(node.children ?? [], depth + 1);
    }
  };
  visit(model.nodes, 0);
  for (const binding of model.expressions) {
    uiAssert(ids.has(binding.nodeId), 'UI_INVALID_CONTENT', 'JSON 绑定目标无效');
    if (binding.attribute) {
      validateJSONAttribute(binding.attribute, '');
    }
  }
}
