import {
  hasOwn,
  type CompiledUI,
  type SafeNode,
  type UIValue,
} from '../../../shared/declarative-ui.ts';
import type { ContextMenuItem } from './context-menu/menu-types.ts';

type Fields = Record<string, { value: UIValue; editSequence: number }>;
/** Projects the core-compiled menu onto the workbench menu without evaluating plugin code. */
export class DeclarativeMenu {
  readonly fields: Fields = {};
  private values = new Map<string, UIValue>();
  private model: CompiledUI;
  private invoke: (bindingId: string, fields: Fields, event: string) => Promise<void>;
  constructor(model: CompiledUI, invoke: DeclarativeMenu['invoke']) {
    this.model = model;
    this.invoke = invoke;
    const nodes = model.nodes.flatMap(function all(node): SafeNode[] {
      return [node, ...(node.children ?? []).flatMap(all)];
    });
    for (const field of model.fields) {
      this.fields[field.name] = {
        value: hasOwn(nodes.find((node) => node.id === field.nodeId)?.attrs ?? {}, 'checked'),
        editSequence: 0,
      };
    }
  }
  update(updates: { id: string; value?: UIValue; error?: string }[]) {
    for (const update of updates) {
      if (update.error || update.value === undefined) {
        continue;
      }
      this.values.set(update.id, update.value);
      const binding = this.model.expressions.find((item) => item.id === update.id);
      const field = this.model.fields.find((item) => item.nodeId === binding?.nodeId);
      if (field && binding?.attribute === 'checked') {
        this.fields[field.name].value = update.value;
      }
    }
  }
  private value(node: SafeNode, attribute?: string): UIValue | undefined {
    const binding = this.model.expressions.find(
      (item) => item.nodeId === node.id && item.attribute === attribute,
    );
    if (binding && this.values.has(binding.id)) {
      return this.values.get(binding.id);
    }
    if (['checked', 'disabled'].includes(attribute ?? '')) {
      return hasOwn(node.attrs ?? {}, attribute ?? '');
    }
    return attribute ? node.attrs?.[attribute] : node.text;
  }
  private text(node: SafeNode): string {
    if (node.attrs?.class?.split(/\s+/).includes('ui-button-icon')) {
      return '';
    }
    return node.tag
      ? (node.children ?? []).map((child) => this.text(child)).join('')
      : String(this.value(node) ?? '');
  }
  private async execute(node: SafeNode, event: string) {
    const binding = this.model.events.find(
      (item) => item.nodeId === node.id && item.event === event,
    );
    if (!binding) {
      return;
    }
    const fields = Object.fromEntries(
      binding.capture.map((name) => [name, { ...this.fields[name] }]),
    );
    await this.invoke(binding.id, fields, event);
  }
  items(): ContextMenuItem[] {
    const convert = (node: SafeNode): ContextMenuItem[] => {
      if (!node.tag) {
        return [];
      }
      if (node.tag === 'hr') {
        return [{ kind: 'separator', id: node.id }];
      }
      if (node.tag === 'button') {
        return [
          {
            kind: 'action',
            id: node.id,
            label: this.text(node),
            disabled: this.value(node, 'disabled') === true,
            action: () => this.execute(node, 'click'),
          },
        ];
      }
      if (node.tag === 'label') {
        const input = node.children?.find((child) => child.tag === 'input');
        const field = this.model.fields.find((item) => item.nodeId === input?.id);
        if (!input || !field) {
          return [];
        }
        const state = this.fields[field.name];
        if (!state.editSequence) {
          state.value = this.value(input, 'checked') === true;
        }
        return [
          {
            kind: 'checkbox',
            id: input.id,
            label: this.text(node),
            checked: state.value === true,
            disabled: this.value(input, 'disabled') === true,
            action: async (checked) => {
              state.value = checked;
              state.editSequence++;
              await this.execute(input, 'change');
            },
          },
        ];
      }
      const children = node.children ?? [];
      if (node.tag === 'div' && children[0]?.tag === 'span') {
        return [
          {
            kind: 'submenu',
            id: node.id,
            label: this.text(children[0]),
            children: children.slice(1).flatMap(convert),
          },
        ];
      }
      return children.flatMap(convert);
    };
    return this.model.nodes.flatMap(convert);
  }
}
