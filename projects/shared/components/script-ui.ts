import { LitElement, html, css, unsafeCSS, type PropertyValues } from 'lit';
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
import hostStyle from '../../web/src/components/ui-content.css?raw';

@customElement('scwc-script-ui')
export class ScriptUIView extends LitElement {
  @property() accessor identity = '';
  @property({ attribute: false }) accessor active = true;
  @property({ attribute: false }) accessor refreshModel:
    | ((previous: { instanceId: string; dirtyFields: string[] }) => Promise<ScriptUIModel>)
    | undefined;
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
      ${unsafeCSS(baseStyle)} ${unsafeCSS(hostStyle)}
    `,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      :host([hidden]) {
        display: none;
      }
      .ui-host,
      #content {
        width: 100%;
        min-width: 0;
      }
      .ui-host #content {
        padding: 0;
        overflow: visible;
      }
      .ui-host #content > :is([data-layout], .ui-tabs) {
        flex: 0 0 auto;
      }
      .ui-host .ui-tabs {
        overflow: visible;
        flex: 0 0 auto;
      }
      .ui-host .ui-scroll-panel {
        max-height: none;
      }
      #error {
        color: var(--text-error, #f88);
      }
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
  private renderedModel?: ScriptUIModel;
  private owner = '';
  private reading?: Promise<void>;
  private polling?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private recovering = false;
  private instance = '';
  private fields: ScriptUIEvent['fields'] = {};
  private treeEvents: Promise<unknown> = Promise.resolve();
  private serialized = '';
  private revision = 0;
  private dataGeneration = 0;
  private previousValues = '';
  private dirtyValues = new Map<string, FieldValue>();
  private components = createJSONComponents({ scrollPanels: false });
  private interaction?: {
    scroll: Map<string, { left: number; top: number }> | undefined;
    name?: string | null;
    start?: number | null;
    end?: number | null;
  };
  preserveInteraction() {
    const node = this.uiRoot.activeElement as HTMLInputElement | null;
    this.interaction = {
      scroll: this.components.captureScroll?.(),
      name: node?.getAttribute('name'),
      start: node?.selectionStart,
      end: node?.selectionEnd,
    };
  }
  restoreInteraction() {
    const saved = this.interaction;
    if (!saved) {
      return;
    }
    this.components.restoreScroll?.(saved.scroll);
    const node = [...this.uiRoot.querySelectorAll<HTMLInputElement>('[name]')].find(
      (node) => node.name === saved.name,
    );
    if (node) {
      (this.components.focusTarget?.(node) ?? node).focus({ preventScroll: true });
      if (typeof saved.start === 'number') {
        try {
          node.setSelectionRange(saved.start, saved.end ?? saved.start);
        } catch {
          /* non-text field */
        }
      }
    }
  }
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
    this.renderedModel = undefined;
    clearTimeout(this.polling);
  }
  protected updated(changed: PropertyValues) {
    if (!this.model) {
      return;
    }
    if (changed.has('active') && this.active) {
      this.restoreInteraction();
    }
    const nextValues = JSON.stringify(this.values);
    if (this.renderedModel === this.model && this.renderer) {
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
            const adapter = this.components.fieldAdapter?.(field.nodeId);
            if (adapter) {
              adapter.writeValue(this.values[field.name]);
            } else if (field.kind === 'boolean') {
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
      this.scheduleRead();
      return;
    }
    if (this.owner !== this.identity) {
      this.renderer?.dispose();
      this.renderer = undefined;
      this.dirtyValues.clear();
      this.fields = {};
    }
    this.owner = this.identity;
    this.instance = this.model.instanceId;
    this.renderedModel = this.model;
    this.previousValues = nextValues;
    this.revision++;
    try {
      validateJSONModel(this.model.compiled);
      const compiled = structuredClone(this.model.compiled);
      for (const tree of compiled.trees ?? []) {
        if (hasOwn(this.values, tree.name)) {
          tree.options.value = this.values[tree.name] as string | string[];
        }
      }
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
      this.serialized = JSON.stringify(this.values);
      this.renderer ??= createUIRenderer(
        this.uiRoot,
        (message) => this.receive(message),
        this.components,
      );
      this.renderer.receive({
        data: {
          method: 'init',
          renderRevision: this.revision,
          payload: {
            compiled,
            instanceId: this.instance,
            renderRevision: this.revision,
            surface: 'scripts',
          },
        },
      });
      this.updates(
        this.model.updates.filter((update) => {
          const binding = compiled.expressions.find((b) => b.id === update.id);
          const field = compiled.fields.find((f) => f.nodeId === binding?.nodeId);
          return !field || !hasOwn(this.values, field.name);
        }),
      );
      this.error('');
      this.stopped = false;
      if (!this.reading) {
        this.recovering = false;
      }
      this.scheduleRead();
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
  private scheduleRead() {
    clearTimeout(this.polling);
    if (
      this.isConnected &&
      this.active &&
      !this.stopped &&
      !this.reading &&
      this.model.boundFields?.length
    ) {
      this.polling = setTimeout(() => {
        void this.readValues();
      }, 4000);
    }
  }
  /** Read-only recovery is bounded; submitted event programs are never replayed. */
  async readValues(): Promise<void> {
    if (this.reading) {
      return this.reading;
    }
    const revision = this.revision;
    const dataGeneration = this.dataGeneration;
    const identity = this.identity;
    const work = (async () => {
      try {
        const result = await this.invoke({
          version: 'v2',
          instanceId: this.instance,
          bindingId: '$read',
          readOnly: true,
          eventId: crypto.randomUUID(),
          fields: structuredClone(this.fields),
        });
        if (
          revision !== this.revision ||
          dataGeneration !== this.dataGeneration ||
          !this.isConnected
        ) {
          return;
        }
        this.updates(result.updates);
        this.error('');
        this.recovering = false;
      } catch (error) {
        let failure = error;
        if (
          revision !== this.revision ||
          dataGeneration !== this.dataGeneration ||
          !this.isConnected
        ) {
          return;
        }
        const stale =
          error instanceof Error &&
          'code' in error &&
          ['UI_STALE_INSTANCE', 'UI_STALE_RENDER'].includes(String(error.code));
        if (stale && !this.recovering && this.refreshModel) {
          this.recovering = true;
          try {
            const model = await this.refreshModel(this.refreshBaseline());
            if (
              !this.isConnected ||
              this.identity !== identity ||
              (revision !== this.revision && this.model !== model)
            ) {
              return;
            }
            this.model = model;
            await this.updateComplete;
            this.reading = undefined;
            await this.readValues();
            return;
          } catch (refreshError) {
            failure = refreshError;
          }
        }
        this.stopped = true;
        this.error(failure);
      }
    })();
    this.reading = work;
    try {
      await work;
    } finally {
      if (this.reading === work) {
        this.reading = undefined;
      }
      this.scheduleRead();
    }
  }
  refreshBaseline() {
    return {
      instanceId: this.instance,
      dirtyFields: [...this.dirtyValues.keys()].filter((name) =>
        this.model.boundFields?.includes(name),
      ),
    };
  }
  private updates(updates: ScriptUIResult['updates']) {
    for (const update of updates) {
      const binding = this.model.compiled.expressions.find((b) => b.id === update.id);
      if (binding?.attribute && !update.error) {
        validateJSONAttribute(binding.attribute, update.value);
      }
    }
    this.renderer?.receive({
      data: { method: 'updates', renderRevision: this.revision, payload: updates },
    });
  }
  private receive(message: UIRendererMessage) {
    if (message.method === 'tree') {
      const request = message.payload as import('../tree.ts').TreeRequest;
      const revision = this.revision;
      void this.invoke({
        version: 'v2',
        instanceId: this.instance,
        bindingId: '$tree',
        eventId: request.requestId,
        readOnly: request.kind !== 'command' || request.command.type !== 'move',
        fields: structuredClone(this.fields),
        treeRequest: { ...request, renderRevision: 1 },
      })
        .then((result) => {
          if (this.isConnected && revision === this.revision && result.treeResponse) {
            this.renderer?.receive({
              data: { method: 'tree', renderRevision: revision, payload: result.treeResponse },
            });
          }
        })
        .catch((error: unknown) => {
          if (revision === this.revision) {
            this.renderer?.receive({
              data: {
                method: 'tree',
                renderRevision: revision,
                payload: {
                  ...request,
                  sequence: 0,
                  error: {
                    code: 'TREE_REQUEST_FAILED',
                    message: error instanceof Error ? error.message : '树请求失败',
                    retryable: true,
                  },
                },
              },
            });
          }
        });
    } else if (message.method === 'fields') {
      const next = message.payload as ScriptUIEvent['fields'];
      for (const [name, field] of Object.entries(next)) {
        if (field.editSequence > (this.fields[name]?.editSequence ?? 0)) {
          this.dataGeneration++;
          this.dirtyValues.set(name, field.value);
        }
      }
      this.fields = next;
      const values = Object.fromEntries(
        Object.entries(this.fields)
          .filter(([name]) => !this.model.boundFields?.includes(name))
          .map(([name, item]) => [name, item.value]),
      );
      const serialized = JSON.stringify(values);
      if (serialized !== this.serialized) {
        this.serialized = serialized;
        this.saveValues(values);
      }
    } else if (message.method === 'event' || message.method === 'tree-event') {
      this.dataGeneration++;
      const payload = message.payload as Pick<
        ScriptUIEvent,
        'bindingId' | 'event' | 'fields' | 'tree'
      >;
      const instance = this.instance;
      const revision = this.revision;
      const sequences = Object.fromEntries(
        Object.entries(payload.fields).map(([name, field]) => [name, field.editSequence]),
      );
      const invoke = () =>
        this.invoke({
          ...payload,
          fields: structuredClone({ ...this.fields, ...payload.fields }),
          version: 'v2',
          instanceId: instance,
          eventId: crypto.randomUUID(),
        });
      const work =
        message.method === 'tree-event'
          ? this.treeEvents.catch(() => undefined).then(invoke)
          : invoke();
      if (message.method === 'tree-event') {
        this.treeEvents = work;
      }
      void work
        .then((result) => {
          if (this.instance === instance && this.revision === revision && this.isConnected) {
            this.dataGeneration++;
            for (const name of Object.keys(result.saved ?? {})) {
              if (this.fields[name]?.editSequence === sequences[name]) {
                this.dirtyValues.delete(name);
              }
            }
            this.renderer?.receive({
              data: {
                method: 'result',
                renderRevision: revision,
                payload: {
                  saved: true,
                  errorEditSequences: sequences,
                  validatedFields: Object.keys(payload.fields),
                  editSequences: Object.fromEntries(
                    Object.keys(result.saved ?? {}).map((name) => [name, sequences[name]]),
                  ),
                  effects: [
                    ...(result.effects ?? []),
                    ...Object.entries(result.saved ?? {}).map(([name, value]) => ({
                      id: crypto.randomUUID(),
                      type: 'value.write',
                      args: [name, value],
                    })),
                  ],
                },
              },
            });
            this.updates(
              result.updates.filter(
                (update) =>
                  !update.field ||
                  this.fields[update.field]?.editSequence === sequences[update.field],
              ),
            );
            if (
              Object.entries(sequences).every(
                ([name, sequence]) => this.fields[name]?.editSequence === sequence,
              )
            ) {
              this.error('');
            }
          }
        })
        .catch((error: unknown) => {
          if (
            this.instance === instance &&
            this.revision === revision &&
            this.isConnected &&
            Object.entries(sequences).every(
              ([name, sequence]) => this.fields[name]?.editSequence === sequence,
            )
          ) {
            this.renderer?.receive({
              data: {
                method: 'result',
                renderRevision: revision,
                payload: {
                  error: error instanceof Error ? error.message : String(error),
                  field: error instanceof Error && 'field' in error ? error.field : undefined,
                  editSequences: sequences,
                },
              },
            });
          }
        });
    }
  }
}
