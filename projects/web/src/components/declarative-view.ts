import { LitElement, html, css, unsafeCSS, nothing, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import rendererSource from './ui-renderer.js?raw';
import frameSource from './ui-frame.js?raw';
import { createUIRenderer } from './ui-renderer.js';
import contentStyles from './ui-content.css?raw';
import primitiveStyles from '../../../server/public/resources/styles/json-ui.css?raw';
import { createJSONComponents } from './json-components.ts';
import { validateJSONModel, validateJSONAttribute } from './json-renderer-policy.ts';
import './context-menu/wb-context-menu.ts';
import { DeclarativeMenu } from './declarative-menu.ts';
import type { ContextMenuItem } from './context-menu/menu-types.ts';
import {
  UI_UNAVAILABLE,
  uiAssert,
  type UIValue,
  type UISurface,
  type CompiledUI,
  type CallNode,
  type NormalizedUIEvent,
  type ClientEffect,
} from '../../../shared/declarative-ui.ts';
import { evaluateArgument, evaluateTemplate } from '../../../shared/ui-expressions.ts';
import type { WorkbenchStore } from '../workbench/store.ts';
import type { FramePool } from '../workbench/frames.ts';

type FieldSnapshot = Record<string, { value: UIValue; editSequence: number }>;
interface ViewState {
  assetRoot: string;
  assetCapability: string;
  id: string;
  renderRevision: number;
  compiled: CompiledUI;
  sourceTabId: string | null;
  sourceFrameEpoch: string | null;
  workspaceId: string;
}
@customElement('wb-declarative-view')
export class DeclarativeView extends LitElement {
  @property({ attribute: false }) accessor store!: WorkbenchStore;
  @property({ attribute: false }) accessor pool: FramePool | undefined;
  @property() accessor pluginId = '';
  @property() accessor surface: UISurface = 'mainSidebar';
  @property() accessor viewId = '';
  @property({ attribute: false }) accessor tabId: string | null = null;
  @property({ attribute: false }) accessor sourceTabId: string | null = null;
  @property({ type: Number }) accessor menuX = 0;
  @property({ type: Number }) accessor menuY = 0;
  @state() private accessor menuItems: ContextMenuItem[] = [];
  @state() private accessor menuLoaded = false;
  private menuModel?: DeclarativeMenu;
  @state() private accessor error = '';
  @state() private accessor instance: ViewState | undefined;
  private directRenderer?: ReturnType<typeof createUIRenderer>;
  private port?: MessagePort;
  private uiNonce = crypto.randomUUID();
  private generation = 0;
  private valueGeneration = 0;
  private fields: FieldSnapshot = {};
  private watches = new Map<string, { id: string; key: string; value?: UIValue }>();
  private pending = false;
  private opening=false;
  private openingContext?: string;
  private reopenAfterOpening = false;
  private inputPending = new Map<
    string,
    { bindingId: string; fields: FieldSnapshot; event: NormalizedUIEvent }
  >();
  private inputRunning = new Set<string>();
  private appliedEffects = new Set<string>();
  private usedWatches = new Set<string>();
  private frameReady = false;
  private awaitingInitialFields = false;
  static styles = [css`
    :host {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      min-height: 0;
      min-width: 0;
      overflow: hidden;
    }
    iframe {
      width: 100%;
      flex: 1;
      min-height: 0;
      border: 0;
      display: block;
      background: transparent;
    }
    .error {
      padding: 8px;
      color: var(--color-error, #e88);
    }
    :host([surface='contextMenu']) {
      position: fixed;
      inset: 0;
      z-index: 1100;
    }
  `, unsafeCSS(primitiveStyles), unsafeCSS(contentStyles)];
  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('message', this.hello);
    this.store?.addEventListener('server-event', this.changed);
    this.store?.addEventListener('change', this.workspaceChanged);
    this.store?.addEventListener('core-restarted',this.restarted);
    this.pool?.addEventListener('ui-value-changed', this.frontChanged);
    this.pool?.addEventListener('ui-handlers-changed', this.frontRegistry);
  }
  disconnectedCallback() {
    this.generation++;
    this.valueGeneration++;
    this.opening = false;
    this.openingContext = undefined;
    this.reopenAfterOpening = false;
    window.removeEventListener('message', this.hello);
    this.store?.removeEventListener('server-event', this.changed);
    this.store?.removeEventListener('change', this.workspaceChanged);
    this.store?.removeEventListener('core-restarted',this.restarted);
    this.pool?.removeEventListener('ui-value-changed', this.frontChanged);
    this.pool?.removeEventListener('ui-handlers-changed', this.frontRegistry);
    this.release();
    super.disconnectedCallback();
  }
  protected updated(changed: PropertyValues) {
    if (['pluginId', 'surface', 'viewId', 'tabId', 'sourceTabId'].some((key) => changed.has(key))) {
      void this.open();
    }
  }
  private release() {
    this.stopWatches();
    this.inputPending.clear();
    this.port?.close();
    this.port = undefined;
    this.directRenderer?.dispose();
    this.directRenderer = undefined;
    this.menuModel = undefined;
    this.menuItems = [];
    this.menuLoaded = false;
    if (this.instance) {
      void this.store.api
        .request(`/ui/instances/${this.instance.id}/release`, {})
        .catch(() => undefined);
      this.instance = undefined;
    }
  }
  private stopWatches() {
    for (const watch of this.watches.values()) {
      void this.pool
        ?.invokeUI(this.instance?.sourceTabId ?? null, this.instance?.sourceFrameEpoch ?? null, {
          kind: 'watch.stop',
          id: watch.id,
        })
        .catch(() => undefined);
    }
    this.watches.clear();
  }
  private async open() {
    const generation = ++this.generation;
    this.valueGeneration++;
    this.release();
    this.fields = {};
    this.error = '';
    this.frameReady = false;
    this.uiNonce = crypto.randomUUID();
    this.requestUpdate();
    const workspace = this.store.workspace;
    const lease = this.store.lease;
    if (!this.pluginId || !workspace || !lease) {
      this.opening = false;
      this.openingContext = undefined;
      this.reopenAfterOpening = false;
      return;
    }
    const openingContext = `${workspace.workspaceId}:${lease.token}`;
    this.reopenAfterOpening = false;
    this.opening=true;
    this.openingContext = openingContext;
    try {
      const source = this.sourceTabId ? this.pool?.runtimes.get(this.sourceTabId) : undefined;
      const instance = await this.store.api.request<ViewState>('/ui/instances', {
        pluginId: this.pluginId,
        surface: this.surface,
        viewId: this.viewId,
        ...this.store.session(),
        tabId: this.tabId,
        sourceTabId: source ? this.sourceTabId : null,
        sourceFrameEpoch: source?.epoch ?? null,
      });
      if (generation !== this.generation) {
        void this.store.api.request(`/ui/instances/${instance.id}/release`, {});
        return;
      }
      if (
        openingContext !== `${this.store.workspace?.workspaceId}:${this.store.lease?.token}` ||
        instance.workspaceId !== this.store.workspace?.workspaceId
      ) {
        void this.store.api
          .request(`/ui/instances/${instance.id}/release`, {})
          .catch(() => undefined);
        this.reopenAfterOpening = true;
        return;
      }
      this.instance = instance;
      void this.initialize();
    } catch (error) {
      if (generation === this.generation) {
        if (
          openingContext !== `${this.store.workspace?.workspaceId}:${this.store.lease?.token}`
        ) {
          this.reopenAfterOpening = true;
        } else {
          this.error = this.store.message(error);
          if (this.surface === 'contextMenu') {
            this.store.toast(this.error, 'error');
            this.closeContextMenu();
          }
        }
      }
    } finally {
      if (generation === this.generation) {
        this.opening = false;
        this.openingContext = undefined;
        if (this.reopenAfterOpening && this.isConnected) {
          this.reopenAfterOpening = false;
          void this.open();
        }
      }
    }
  }
  private hello = (event: MessageEvent) => {
    const frame = this.renderRoot.querySelector('iframe');
    if (
      event.source !== frame?.contentWindow ||
      event.data?.type !== 'scwc-ui-ready' ||event.data.protocol!=='scwc-declarative-ui'||event.data.version!==1||
      event.data.nonce !== this.uiNonce
    ) {
      return;
    }
    this.port?.close();
    const channel = new MessageChannel();
    this.port = channel.port1;
    this.port.onmessage = (event) => void this.receive(event.data);
    this.port.start();
    this.frameReady = true;
    frame.contentWindow?.postMessage({ protocol:'scwc-declarative-ui',version:1,nonce: this.uiNonce }, '*', [channel.port2]);
    void this.initialize();
  };
  private async initialize() {
    const instance = this.instance;
    await this.updateComplete;
    if (!instance || this.instance !== instance || !this.isConnected) {
      return;
    }
    if (this.surface === 'contextMenu') {
      this.menuModel = new DeclarativeMenu(instance.compiled, (bindingId, fields, type) => this.execute({ bindingId, fields, event: { type } }));
      this.fields = this.menuModel.fields;
      this.frameReady = true;
      void this.updateValues();
      return;
    }
    if (instance.compiled.format === 'json') {
      try {
        validateJSONModel(instance.compiled);
        this.port?.close();
        this.port = undefined;
        uiAssert(this.shadowRoot, 'UI_INVALID_CONTENT', 'JSON 渲染容器未就绪');
        this.directRenderer ??= createUIRenderer(this.shadowRoot, (message) => void this.receive(message), createJSONComponents());
        this.frameReady = true;
      } catch (error) {
        this.error = this.store.message(error);
        return;
      }
    } else if (this.directRenderer) {
      this.directRenderer.dispose();
      this.directRenderer = undefined;
    }
    if (this.instance && this.frameReady) {
      this.awaitingInitialFields = true;
      this.send('init', { ...this.instance, surface: this.surface });
    }
  }
  private send(method: string, payload: unknown) {
    if (!this.instance) {
      return;
    }
    const message = { method, payload, renderRevision: this.instance.renderRevision };
    if (this.surface === 'contextMenu') {
      if (method === 'updates') {
        const updates = payload as Parameters<DeclarativeMenu['update']>[0];
        const failed = updates.find((update) => update.error);
        if (failed) {
          this.store.toast(failed.error ?? '菜单数据不可用', 'error');
          this.closeContextMenu();
          return;
        }
        this.menuModel?.update(updates);
        this.menuItems = this.menuModel?.items() ?? [];
        this.menuLoaded = true;
      } else if (method === 'result') {
        const result = payload as { error?: string; status?: string; result?: UIValue };
        if (result.error || result.status === 'unavailable') {
          this.store.toast(result.error ?? String(result.result), 'error');
        }
      }
      return;
    }
    if (this.instance.compiled.format === 'json') {
      this.directRenderer?.receive({ data: message });
    } else {
      this.port?.postMessage(message);
    }
  }
  private async receive(message: { method: string; renderRevision: number; payload: unknown }) {
    if (!this.instance || message.renderRevision !== this.instance.renderRevision) {
      return;
    }
    if (message.method === 'fields') {
      const fields = message.payload as typeof this.fields;
      const fingerprint = JSON.stringify(fields),
        before = JSON.stringify(this.fields);
      this.fields = fields;
      if (fingerprint !== before || this.awaitingInitialFields) {
        this.awaitingInitialFields = false;
        void this.updateValues();
      }
    }
    if (message.method === 'event') {
      const data = message.payload as {
        bindingId: string;
        fields: FieldSnapshot;
        event: NormalizedUIEvent;
      };
      const binding = this.instance.compiled.events.find(
        (candidate) => candidate.id === data.bindingId,
      );
      if (binding?.event !== 'input') {
        await this.execute(data);
      } else {
        const owner = this.instance.id;
        const key = `${owner}:${data.bindingId}`;
        if (this.inputRunning.has(key)) {
          this.inputPending.set(key, data);
          return;
        }
        this.inputRunning.add(key);
        try {
          let current: typeof data | undefined = data;
          while (current && this.instance?.id === owner) {
            await this.execute(current);
            current = this.inputPending.get(key);
            this.inputPending.delete(key);
          }
        } finally {
          this.inputRunning.delete(key);
          this.inputPending.delete(key);
        }
      }
    }
    if (message.method === 'surface') {
      const payload = message.payload as { kind: string; x?: number; y?: number };
      if (payload.kind === 'contextmenu' && this.instance.compiled.format === 'html') {
        const rect = this.renderRoot.querySelector('iframe')?.getBoundingClientRect();
        payload.x = (payload.x ?? 0) + (rect?.left ?? 0);
        payload.y = (payload.y ?? 0) + (rect?.top ?? 0);
      }
      this.dispatchEvent(
        new CustomEvent('ui-surface-action', {
          detail: message.payload,
          bubbles: true,
          composed: true,
        }),
      );
    }
  }
  private restarted=()=>{void this.open();};
  private workspaceChanged=()=>{
    const workspaceId = this.store.workspace?.workspaceId;
    if (this.instance && workspaceId !== this.instance.workspaceId) {
      void this.open();
    } else if (!this.instance && this.pluginId && this.store.workspace && this.store.lease) {
      const currentContext = `${workspaceId}:${this.store.lease.token}`;
      if (this.opening) {
        if (currentContext !== this.openingContext) {
          this.reopenAfterOpening = true;
        }
      } else {
        void this.open();
      }
    }
  };
  private changed = (event: Event) => {
    const data = (event as CustomEvent).detail;
    if (
      data?.type === 'ui.registry.changed' &&
      (!data.entityId || data.entityId === this.pluginId)
    ) {
      void this.refresh();
    } else if (data?.type === 'ui.content.changed' && data.entityId === this.instance?.id) {
      void this.refresh();
    } else if (data?.type === 'ui.data.changed' && data.entityId === this.instance?.id) {
      void this.updateValues();
    }
  };
  async refresh() {
    const instance = this.instance;
    if (!instance) {
      await this.open();
      return;
    }
    this.valueGeneration++;
    this.stopWatches();
    try {
      const value = await this.store.api.request<ViewState>(`/ui/instances/${instance.id}/content`);
      if (this.instance === instance) {
        if (instance.compiled.format !== value.compiled.format) {
          this.directRenderer?.dispose();
          this.directRenderer = undefined;
          this.port?.close();
          this.port = undefined;
          this.frameReady = false;
          this.uiNonce = crypto.randomUUID();
        }
        this.instance = value;
        void this.initialize();
      }
    } catch {
      if (this.instance === instance) {
        await this.open();
      }
    }
  }
  private frontRegistry = () => {
    if (
      this.sourceTabId &&
      (!this.instance?.sourceTabId ||
        this.pool?.runtimes.get(this.sourceTabId)?.epoch !== this.instance.sourceFrameEpoch)
    ) {
      void this.open();
      return;
    }
    this.stopWatches();
    void this.updateValues();
  };
  private frontChanged = (event: Event) => {
    const data = (event as CustomEvent).detail;
    if (
      data.tabId !== this.instance?.sourceTabId ||
      data.frameEpoch !== this.instance?.sourceFrameEpoch
    ) {
      return;
    }
    for (const watch of this.watches.values()) {
      if (watch.id === data.id) {
        watch.value = data.value;
        void this.updateValues();
      }
    }
  };
  private async invoke(
    call: CallNode,
    args: UIValue[],
    bindingId: string,
    event?: NormalizedUIEvent,
    expected = this.instance,
    capturedFields?:Record<string,UIValue>,
  ) {
    const instance = this.instance;
    uiAssert(instance === expected, 'UI_STALE_INSTANCE', '页面上下文已改变');
    uiAssert(instance, 'UI_STALE_INSTANCE', '实例未就绪');
    if (!instance.sourceTabId) {
      return UI_UNAVAILABLE;
    }
    const key = JSON.stringify([bindingId, call.name, args]);
    this.usedWatches.add(key);
    const current = this.watches.get(key);
    if (call.watch && current?.key === key && current.value !== undefined) {
      return current.value;
    }
    if (current && current.key !== key) {
      await this.pool?.invokeUI(instance.sourceTabId, instance.sourceFrameEpoch, {
        kind: 'watch.stop',
        id: current.id,
      });
      this.watches.delete(key);
    }
    const id = crypto.randomUUID();
    if (call.watch) {
      this.watches.set(key, { id, key });
    }
    const response = await this.pool?.invokeUI(instance.sourceTabId, instance.sourceFrameEpoch, {
      kind: call.watch ? 'watch.start' : 'handler',
      id,
      name: call.name.slice(3),
      args,
      context: {
        invocation: event ? 'event' : 'render',
        instanceId: instance.id,
        windowId: this.store.api.clientWindowId,
        workspaceId: this.store.workspace?.workspaceId,
        source: { kind: this.surface, viewId: this.viewId },
        sourceTabId: instance.sourceTabId,
        fields: capturedFields??Object.fromEntries(Object.entries(this.fields).map(([k, v]) => [k, v.value])),
        event,
      },
    });
    if (response?.unavailable) {
      return UI_UNAVAILABLE;
    }
    if (response?.hasValue) {
      if (call.watch) {
        const entry = this.watches.get(key);
        if (entry?.id === id) {
          entry.value = response.value;
        }
      }
      return response.value;
    }
    return undefined;
  }
  private async updateValues() {
    if (!this.instance || !this.frameReady) {
      return;
    }
    if (this.pending) {
      this.valueGeneration++;
      return;
    }
    this.pending = true;
    this.usedWatches = new Set();
    const deadline = Date.now() + 10000;
    const generation = ++this.valueGeneration,
      instance = this.instance;
    try {
      const result = await this.store.api.request<{
        updates: { id: string; value?: UIValue; frontend?: boolean; error?: string }[];
      }>(`/ui/instances/${instance.id}/data`, {
        renderRevision: instance.renderRevision,
        fields: this.fields,
      });
      for (const update of result.updates) {
        if (update.frontend) {
          const binding = instance.compiled.expressions.find((b) => b.id === update.id);
          if (!binding) {
            continue;
          }
          try {
            uiAssert(Date.now() < deadline, 'UI_EXECUTION_TIMEOUT', '页面模板数据获取超时');
            update.value = await evaluateTemplate(binding.parts, {
              fields: Object.fromEntries(Object.entries(this.fields).map(([k, v]) => [k, v.value])),
              invoke: (call, args) => this.invoke(call, args, binding.id, undefined, instance),
            });
            if (['src', 'href'].includes(binding.attribute ?? '')) {
              uiAssert(typeof update.value === 'string', 'UI_INVALID_VALUE_TYPE', '资源需要字符串');
              const url = new URL(update.value, 'https://scwc.invalid/');
              uiAssert(
                url.origin === 'https://scwc.invalid' &&
                  !url.search &&
                  !url.hash &&
                  !update.value.includes('\\'),
                'UI_RESOURCE_DENIED',
                '只允许插件资源路径',
              );
              update.value = instance.assetRoot + url.pathname + '?cap=' + instance.assetCapability;
            }
            if (
              ['checked', 'disabled', 'selected', 'multiple', 'hidden', 'data-ui-visible'].includes(
                binding.attribute ?? '',
              )
            ) {
              uiAssert(
                typeof update.value === 'boolean',
                'UI_INVALID_VALUE_TYPE',
                '属性需要布尔值',
              );
            }
          } catch (error) {
            update.error = this.store.message(error);
          }
        }
      }
      if (this.instance === instance && generation === this.valueGeneration) {
        if (instance.compiled.format === 'json') {
          for (const update of result.updates) {
            const binding = instance.compiled.expressions.find((item) => item.id === update.id);
            if (binding?.attribute && !update.error) {
              validateJSONAttribute(binding.attribute, update.value);
            }
          }
        }
        for (const [key, watch] of this.watches) {
          if (!this.usedWatches.has(key)) {
            void this.pool
              ?.invokeUI(instance.sourceTabId, instance.sourceFrameEpoch, {
                kind: 'watch.stop',
                id: watch.id,
              })
              .catch(() => undefined);
            this.watches.delete(key);
          }
        }
        this.send('updates', result.updates);
      }
    } catch (error) {
      if (this.instance === instance && generation === this.valueGeneration) {
        this.error = this.store.message(error);
        if (this.surface === 'contextMenu') {
          this.store.toast(this.error, 'error');
          this.closeContextMenu();
        }
      }
    } finally {
      this.pending = false;
      if (generation !== this.valueGeneration && this.instance && this.isConnected) {
        void this.updateValues();
      }
    }
  }
  private async execute(data: {
    bindingId: string;
    fields: FieldSnapshot;
    event: NormalizedUIEvent;
  }) {
    const instance = this.instance;
    if (!instance) {
      return;
    }
    const editSequences = Object.fromEntries(
      Object.entries(data.fields).map(([name, v]) => [name, v.editSequence]),
    );
    try {
      let response = await this.store.api.request<{
        continuation?: string;
        error?: string | { message: string };
        status: string;
        result?: UIValue;
        effects: ClientEffect[];
        branches?: CallNode[][];
        event: NormalizedUIEvent;
        fields: Record<string, UIValue>;
      }>(`/ui/instances/${instance.id}/events`, {
        ...this.store.session(),
        ...data,
        eventId: crypto.randomUUID(),
        renderRevision: instance.renderRevision,
      });
      while (response.status === 'frontend') {
        this.send('result',{effects:response.effects,editSequences});
        await this.applyEffects(response.effects);
        try {
          for (const chain of response.branches ?? []) {
            let prev: UIValue | undefined;
            for (const call of chain) {
              uiAssert(call.domain === 'frontend', 'UI_CROSS_DOMAIN_PIPE', '前端链不能调用后端');
              prev = await evaluateArgument(call, {
                event: response.event as unknown as UIValue,
                prev,
                fields: response.fields,
                invoke: (c, args) => this.invoke(c, args, '', response.event, instance,response.fields),
              });
              if (prev === UI_UNAVAILABLE) {
                break;
              }
            }
          }
          response = await this.store.api.request(`/ui/instances/${instance.id}/events/continue`, {
            ...this.store.session(),
            continuation: response.continuation,
            succeeded: true,
          });
        } catch {
          response=await this.store.api.request(`/ui/instances/${instance.id}/events/continue`,{...this.store.session(),continuation:response.continuation,succeeded:false});
          break;
        }
      }
      if (this.instance !== instance) {
        return;
      }
      this.send('result', {
        ...response,
        error: typeof response.error === 'object' ? response.error.message : response.error,
        editSequences,
        saved: response.effects.some((effect) => effect.type === 'config.saved'),
      });
      await this.applyEffects(response.effects??[]);
      this.dispatchEvent(
        new CustomEvent('ui-executed', { detail: response, bubbles: true, composed: true }),
      );
      void this.updateValues();
    } catch (error) {
      if (this.instance === instance) {
        this.send('result', { error: this.store.message(error) });
      }
    }
  }
  private async applyEffects(effects:ClientEffect[]){
    for (const effect of effects) {
      if (this.appliedEffects.has(effect.id)) {
        continue;
      }
      this.appliedEffects.add(effect.id);
      while (this.appliedEffects.size > 2048) {
        const first = this.appliedEffects.values().next().value;
        if (first) {
          this.appliedEffects.delete(first);
        } else {
          break;
        }
      }
      try {
        await this.effect(effect);
        if (this.instance) {
          void this.store.api
            .request(`/ui/instances/${this.instance.id}/effects/ack`, {
              effectId: effect.id,
              status: 'applied',
            })
            .catch(() => undefined);
        }
      } catch (error) {
        this.send('result', { error: this.store.message(error) });
        if (this.instance) {
          void this.store.api
            .request(`/ui/instances/${this.instance.id}/effects/ack`, {
              effectId: effect.id,
              status: 'rejected',
            })
            .catch(() => undefined);
        }
      }
    }
  }
  private async effect(effect: ClientEffect) {
    if (
      ['clipboard.writeText', 'link.openExternal'].includes(effect.type) &&
      !navigator.userActivation?.isActive
    ) {
      throw new Error('浏览器用户激活已失效，效果没有执行');
    }
    if (effect.type === 'clipboard.writeText') {
      await navigator.clipboard.writeText(String(effect.args[0]));
    } else if (effect.type === 'link.openExternal') {
      const url = new URL(String(effect.args[0]));
      if (['http:', 'https:'].includes(url.protocol)) {
        window.open(url.href, '_blank', 'noopener,noreferrer');
      }
    } else if (effect.type === 'notification.show') {
      this.store.toast(String(effect.args[0]), String(effect.args[1] ?? 'info') as 'info');
    } else if (
      ![
        'value.write',
        'element.focus',
        'section.toggle',
        'scroll.to',
        'config.saved',
        'config.rebased',
      ].includes(effect.type)
    ) {
      this.dispatchEvent(
        new CustomEvent('ui-effect', {
          detail: { ...effect, pluginId: this.pluginId, sourceTabId: this.instance?.sourceTabId },
          bubbles: true,
          composed: true,
        }),
      );
    }
  }
  render() {
    if (this.surface === 'contextMenu') {
      return html`<wb-context-menu .x=${this.menuX} .y=${this.menuY} .items=${this.menuItems} .loading=${!this.menuLoaded}
        @wb-menu-close=${() => this.closeContextMenu()}
        @wb-menu-select=${async (event: CustomEvent<{ id: string }>) => {
          const find = (items: ContextMenuItem[]): ContextMenuItem | undefined => {
            for (const item of items) {
              if (item.id === event.detail.id) {return item;}
              if (item.kind === 'submenu') { const found = find(item.children); if (found) {return found;} }
            }
          };
          const item = find(this.menuItems);
          if (!item || ('disabled' in item && item.disabled)) {return;}
          if (item.kind === 'action') {await item.action();}
          else if (item.kind === 'checkbox') {await item.action(!item.checked);}
          this.closeContextMenu();
        }}></wb-context-menu>`;
    }
    if (!this.instance || this.instance.compiled.format === 'json') {
      return html`${this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing}
        <div class="ui-root ui-direct" data-surface=${this.surface}>
          <wb-scroll-container class="ui-content-scroll"><div id="content"></div></wb-scroll-container><div id="error" role="alert"></div>
        </div>`;
    }
    const origin = location.origin;
    const themeNames = [
      '--font-sans', '--font-mono', '--text-xs', '--text-sm', '--text-md', '--leading-normal',
      '--font-semibold', '--space-1', '--space-2', '--space-3', '--space-4', '--surface-0',
      '--surface-1', '--surface-2', '--surface-3', '--surface-4', '--text-primary',
      '--text-secondary', '--text-tertiary', '--text-disabled', '--border-subtle',
      '--border-default', '--border-strong', '--border-focus', '--accent-primary', '--accent-hover',
      '--status-success', '--status-warning', '--status-error', '--radius-sm', '--radius-md',
      '--accent-subtle', '--status-success-bg', '--status-warning-bg', '--status-error-bg', '--wb-tab-bar-height',
    ];
    const theme = themeNames
      .map((name) => {
        const value = getComputedStyle(this).getPropertyValue(name).trim();
        return value ? `${name}:${value}` : '';
      })
      .filter(Boolean)
      .join(';');
    const colorScheme = getComputedStyle(document.documentElement).colorScheme || 'dark';
    const srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${this.uiNonce}'; style-src 'unsafe-inline' ${origin}; img-src ${origin}; font-src ${origin}; connect-src 'none'; form-action 'none'; base-uri 'none'"><style>:root{${theme};color-scheme:${colorScheme}}html,body{height:100%;margin:0;overflow:hidden}body{display:flex}${primitiveStyles}\n${contentStyles}\n.ui-root{color-scheme:${colorScheme}}</style><style id="dynamic-style"></style></head><body class="ui-root" data-surface="${this.surface}"><div id="content"></div><div id="error" role="alert"></div><script type="module" nonce="${this.uiNonce}" data-nonce="${this.uiNonce}">${rendererSource}\n${frameSource}</script></body></html>`;
    return html`${this.error ? html`<p class="error" role="alert">${this.error}</p>` : null}<iframe
        title="声明式插件界面"
        sandbox="allow-scripts"
        .srcdoc=${srcdoc}
      ></iframe>`;
  }
  private closeContextMenu() {
    this.dispatchEvent(new CustomEvent('ui-menu-close', { bubbles: true, composed: true }));
  }
}
