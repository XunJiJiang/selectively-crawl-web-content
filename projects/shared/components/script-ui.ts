import { LitElement, html, css, unsafeCSS } from 'lit';
import { property } from 'lit/decorators.js';
import { customElement } from '../utils/customElement.ts';
import { createUIRenderer, type UIRendererMessage } from '../../web/src/components/ui-renderer.js';
import { createJSONComponents } from '../../web/src/components/json-components.ts';
import {
  validateJSONModel,
  validateJSONAttribute,
} from '../../web/src/components/json-renderer-policy.ts';
import { hasOwn, type FieldValue } from '../declarative-ui.ts';
import type { ScriptUIEvent, ScriptUIModel, ScriptUIResult } from '../script-ui.ts';
import baseStyle from '../../server/public/resources/styles/json-ui.css?raw';

@customElement('scwc-script-ui')
export class ScriptUIView extends LitElement {
  @property({ attribute: false }) accessor model!: ScriptUIModel;
  @property({ attribute: false }) accessor values: Record<string, FieldValue> = {};
  @property({ attribute: false }) accessor invoke!: (
    request: ScriptUIEvent,
  ) => Promise<ScriptUIResult>;
  @property({ attribute: false }) accessor saveValues: (
    values: Record<string, FieldValue>,
  ) => void = () => undefined;
  static styles = [
    css`
      :host {
        display: block;
        min-width: 0;
      }
      #error {
        color: var(--text-error, #f88);
      }
    `,
    css`
      ${unsafeCSS(baseStyle)}
    `,
  ];
  private get uiRoot(): ShadowRoot {
    const root = this.shadowRoot;
    if (!root) {
      throw new Error('JSON 渲染器尚未挂载');
    }
    return root;
  }
  private renderer?: ReturnType<typeof createUIRenderer>;
  private instance = '';
  private fields: ScriptUIEvent['fields'] = {};
  private serialized = '';
  private revision = 0;
  private previousValues = '';
  private dirtyValues = new Map<string, FieldValue>();
  render() {
    return html`<div class="ui-host">
      <div id="content" class="ui-root"></div>
      <div id="error" role="alert"></div>
    </div>`;
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.renderer?.dispose();
    this.renderer = undefined;
    this.instance = '';
  }
  protected updated() {
    if (!this.model) {
      return;
    }
    const nextValues = JSON.stringify(this.values);
    if (this.instance === this.model.instanceId && this.renderer) {
      if (nextValues !== this.previousValues) {
        this.previousValues = nextValues;
        for (const field of this.model.compiled.fields) {
          if (!hasOwn(this.values, field.name)) {
            continue;
          }
          if (this.dirtyValues.has(field.name)) {
            if (
              JSON.stringify(this.dirtyValues.get(field.name)) !==
              JSON.stringify(this.values[field.name])
            ) {
              continue;
            }
            this.dirtyValues.delete(field.name);
          }
          const node = this.uiRoot.querySelector<HTMLInputElement>(
            `[data-scwc-node="${field.nodeId}"]`,
          );
          if (node && this.uiRoot.activeElement !== node) {
            if (field.kind === 'boolean') {
              node.checked = this.values[field.name] === true;
            } else if (field.kind === 'multiple' && node instanceof HTMLSelectElement) {
              for (const option of node.options) {
                option.selected = (this.values[field.name] as string[]).includes(option.value);
              }
            } else {
              node.value = String(this.values[field.name]);
            }
          }
        }
        this.renderer.receive({
          data: { method: 'result', renderRevision: this.revision, payload: {} },
        });
      }
      return;
    }
    this.renderer?.dispose();
    this.instance = this.model.instanceId;
    this.previousValues = nextValues;
    this.revision++;
    try {
      validateJSONModel(this.model.compiled);
      const compiled = structuredClone(this.model.compiled);
      const apply = (nodes: typeof compiled.nodes) => {
        for (const node of nodes) {
          const field = compiled.fields.find((f) => f.nodeId === node.id);
          if (field && hasOwn(this.values, field.name)) {
            node.attrs ??= {};
            if (field.kind === 'boolean') {
              if (this.values[field.name]) {
                node.attrs.checked = '';
              } else {
                delete node.attrs.checked;
              }
            } else if (field.kind !== 'multiple') {
              node.attrs.value = String(this.values[field.name]);
            } else {
              for (const option of node.children ?? []) {
                if ((this.values[field.name] as string[]).includes(option.attrs?.value ?? '')) {
                  (option.attrs ??= {}).selected = '';
                } else if (option.attrs) {
                  delete option.attrs.selected;
                }
              }
            }
          }
          apply(node.children ?? []);
        }
      };
      apply(compiled.nodes);
      this.fields = {};
      this.dirtyValues.clear();
      this.serialized = JSON.stringify(this.values);
      this.renderer = createUIRenderer(
        this.uiRoot,
        (message) => this.receive(message),
        createJSONComponents(),
      );
      this.renderer.receive({
        data: {
          method: 'init',
          renderRevision: this.revision,
          payload: { compiled, renderRevision: this.revision, surface: 'scripts' },
        },
      });
      this.updates(
        this.model.updates.filter((update) => {
          const binding = compiled.expressions.find((b) => b.id === update.id);
          const field = compiled.fields.find((f) => f.nodeId === binding?.nodeId);
          return !field || !hasOwn(this.values, field.name);
        }),
      );
    } catch (error) {
      this.error(error);
    }
  }
  private error(error: unknown) {
    const errorElement = this.uiRoot.querySelector('#error');
    if (errorElement) {
      errorElement.textContent = error instanceof Error ? error.message : String(error);
    }
  }
  private updates(updates: ScriptUIResult['updates']) {
    for (const update of updates) {
      const binding = this.model.compiled.expressions.find((b) => b.id === update.id);
      if (binding?.attribute) {
        validateJSONAttribute(binding.attribute, update.value);
      }
    }
    this.renderer?.receive({
      data: { method: 'updates', renderRevision: this.revision, payload: updates },
    });
  }
  private receive(message: UIRendererMessage) {
    if (message.method === 'fields') {
      const next = message.payload as ScriptUIEvent['fields'];
      for (const [name, field] of Object.entries(next)) {
        if (field.editSequence > (this.fields[name]?.editSequence ?? 0)) {
          this.dirtyValues.set(name, field.value);
        }
      }
      this.fields = next;
      const values = Object.fromEntries(
        Object.entries(this.fields).map(([name, item]) => [name, item.value]),
      );
      const serialized = JSON.stringify(values);
      if (serialized !== this.serialized) {
        this.serialized = serialized;
        this.saveValues(values);
      }
    } else if (message.method === 'event') {
      const payload = message.payload as Pick<ScriptUIEvent, 'bindingId' | 'event' | 'fields'>;
      const instance = this.instance;
      void this.invoke({
        ...payload,
        fields: structuredClone({ ...this.fields, ...payload.fields }),
        version: 'v2',
        instanceId: instance,
        eventId: crypto.randomUUID(),
      })
        .then((result) => {
          if (this.instance === instance && this.isConnected) {
            this.updates(result.updates);
          }
        })
        .catch((error: unknown) => {
          if (this.instance === instance && this.isConnected) {
            this.error(error);
          }
        });
    }
  }
}
