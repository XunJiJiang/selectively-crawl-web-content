import './scroll-container.ts';
import { requireValue } from '../../../shared/workbench-protocol.ts';
import { LitElement, html, css, unsafeCSS, nothing, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';
import style from '../workbench/workbench.css?raw';
import type { WorkbenchStore } from '../workbench/store.ts';
import type { FramePool } from '../workbench/frames.ts';
import type { ConfigDefinition, ConfigSnapshot, PluginTab, Tab } from '../workbench/types.ts';
import { runtimeNames, uiNames, pageStateNames } from '../workbench/types.ts';
import { titleOf } from '../workbench/model.ts';
import { icon, iconButton, tabNavigation } from '../workbench/ui.ts';
@customElement('wb-page-inspector')
export class PageInspector extends LitElement {
  @property({ attribute: false }) accessor store!: WorkbenchStore;
  @property({ attribute: false }) accessor pool: FramePool | undefined = undefined;
  @property({ attribute: false }) accessor tab: Tab | undefined = undefined;
  @state() private accessor view = 'properties';
  @state() private accessor snapshot: ConfigSnapshot | undefined = undefined;
  @state() private accessor drafts: Record<string, string> = {};
  @state() private accessor errors = '';
  @state() private accessor saving = false;
  @state() private accessor remote = false;
  private generation = 0;
  private conflictSnapshot: ConfigSnapshot | undefined;
  static styles = css`
    ${unsafeCSS(style)}:host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }
  `;
  connectedCallback() {
    super.connectedCallback();
    queueMicrotask(() => {
      this.store?.addEventListener('server-event', this.changed);
      this.pool?.addEventListener('settings-changed', this.changed);
    });
  }
  disconnectedCallback() {
    this.generation++;
    this.store?.removeEventListener('server-event', this.changed);
    this.pool?.removeEventListener('settings-changed', this.changed);
    super.disconnectedCallback();
  }
  private changed = (event: Event) => {
    if (this.saving) {
      return;
    }
    if (event instanceof CustomEvent) {
      const value = event.detail as { type?: string; entityId?: string };
      if (
        value.type !== 'config.changed' ||
        this.tab?.kind !== 'plugin' ||
        value.entityId !== this.tab.pluginId
      ) {
        return;
      }
    }
    void this.load(true);
  };
  private tabIdentity = '';
  protected updated(changed: PropertyValues) {
    if (changed.has('tab') && this.tab?.id !== this.tabIdentity) {
      this.tabIdentity = this.tab?.id ?? '';
      this.generation++;
      if (this.tab?.kind === 'plugin') {
        this.drafts = {};
        this.remote = false;
        void this.load();
      } else {
        this.snapshot = undefined;
        this.drafts = {};
      }
    }
    if (changed.has('pool')) {
      this.pool?.addEventListener('settings-changed', this.changed);
    }
  }
  private async load(merge = false) {
    const tab = this.tab;
    if (tab?.kind !== 'plugin') {
      return;
    }
    const generation = ++this.generation;
    this.errors = '';
    try {
      const snapshot = await this.store.api.request<ConfigSnapshot>(
        `/plugins/${encodeURIComponent(tab.pluginId)}/config`,
      );
      if (generation !== this.generation || this.tab?.id !== tab.id) {
        return;
      }
      if (merge && this.snapshot && Object.keys(this.drafts).length) {
        const conflicts = Object.keys(this.drafts).filter(
          (key) =>
            this.snapshot?.effectiveValues[key] !== snapshot.effectiveValues[key] &&
            this.drafts[key] !== snapshot.effectiveValues[key],
        );
        this.remote = conflicts.length > 0;
        if (this.remote) {
          this.conflictSnapshot = snapshot;
        }
        if (this.remote) {
          return;
        }
      }
      this.snapshot = snapshot;
      this.remote = false;
    } catch (e) {
      if (generation === this.generation) {
        this.errors = this.store.message(e);
      }
    }
  }
  private async save(keys?: string[]) {
    const tab = this.tab,
      snapshot = this.snapshot;
    if (tab?.kind !== 'plugin' || !snapshot) {
      return;
    }
    const generation = this.generation;
    this.saving = true;
    this.errors = '';
    try {
      let values = keys ? {} : { ...this.drafts };
      let validationTicket: string | undefined;
      const changedKeys = keys ?? Object.keys(values);
      const required = snapshot.definitions
        .flatMap((d) => d.items)
        .some((i) => changedKeys.includes(i.key) && i.validationPolicy === 'page-required');
      if (required) {
        const runtime = this.pool?.runtimes.get(tab.id);
        if (!runtime?.port) {
          throw new Error('此配置需要原页面在线校验，请先唤醒页面。');
        }
        const result = await runtime.port.request<{
          values: Record<string, string>;
          validationTicket: string;
        }>('config.validate', {
          values,
          keys: keys ?? [],
          baseRevision: snapshot.revision,
          schemaRevision: snapshot.schemaRevision,
        });
        values = result.values;
        validationTicket = result.validationTicket;
      }
      if (this.tab?.id !== tab.id || this.generation !== generation) {
        throw new Error('当前页面已变化，请重新确认配置。');
      }
      const result = await this.store.api.request<ConfigSnapshot>(
        `/plugins/${encodeURIComponent(tab.pluginId)}/config/${keys ? 'reset' : 'update'}`,
        {
          ...(keys ? { keys } : { values }),
          baseRevision: snapshot.revision,
          schemaRevision: snapshot.schemaRevision,
          originRequestId: crypto.randomUUID(),
          validationTicket,
        },
      );
      if (this.tab?.id === tab.id) {
        this.snapshot = result;
        this.drafts = {};
        this.remote = false;
        this.store.toast(keys ? '已恢复默认值' : '配置已保存', 'success');
      }
    } catch (e) {
      if (this.tab?.id === tab.id) {
        this.errors = this.store.message(e);
      }
    } finally {
      this.saving = false;
    }
  }
  private control(item: ConfigDefinition['items'][number]) {
    const value =
      this.drafts[item.key] ?? this.snapshot?.effectiveValues[item.key] ?? item.defaultValue ?? '';
    const runtime = this.tab && this.pool?.runtimes.get(this.tab.id);
    const plugin =
      this.tab?.kind === 'plugin'
        ? this.store.catalog.find((p) => p.pluginId === (this.tab as PluginTab).pluginId)
        : undefined;
    const disabled =
      item.control === 'readonly' ||
      this.saving ||
      (item.validationPolicy === 'page-required' && !runtime?.port) ||
      (item.validationPolicy === 'backend-required' && plugin?.runtime.status !== 'ready');
    const change = (raw: string) => {
      this.drafts = { ...this.drafts, [item.key]: raw };
    };
    if (item.control === 'readonly') {
      return html`<output>${value || '未定义'}</output>`;
    }
    if (item.control === 'switch') {
      return html`<label class="switch"
        ><input
          type="checkbox"
          aria-label=${item.label}
          ?disabled=${disabled}
          .checked=${value === 'true'}
          @change=${(e: Event) =>
            change(String((e.target as HTMLInputElement).checked))} /><span></span
      ></label>`;
    }
    if (item.control === 'select') {
      return html`<select
        aria-label=${item.label}
        ?disabled=${disabled}
        .value=${live(value)}
        @change=${(e: Event) => change((e.target as HTMLSelectElement).value)}
      >
        ${(item.rules?.options ?? []).map(
          (option) => html`<option value=${option}>${option}</option>`,
        )}
      </select>`;
    }
    if (item.control === 'textarea') {
      return html`<textarea
        aria-label=${item.label}
        ?disabled=${disabled}
        .value=${live(value)}
        @input=${(e: Event) => change((e.target as HTMLTextAreaElement).value)}
      ></textarea>`;
    }
    return html`<input
      aria-label=${item.label}
      type=${item.control === 'number' ? 'number' : item.control === 'color' ? 'color' : 'text'}
      ?disabled=${disabled}
      .value=${live(value)}
      min=${item.rules?.min ?? nothing}
      max=${item.rules?.max ?? nothing}
      maxlength=${item.rules?.maxLength ?? nothing}
      @input=${(e: Event) => change((e.target as HTMLInputElement).value)}
    />`;
  }
  render() {
    const tab = this.tab;
    if (!tab) {
      return html`<div class="empty compact">
        ${icon('info')}
        <p>当前页面属性</p>
        <span>选择一个插件标签，查看属性与配置。</span>
      </div>`;
    }
    if (tab.kind === 'internal') {
      return html`<div class="inspector-heading">
        <small>内置页面</small>
        <h2>${titleOf(tab)}</h2>
        <p>工作台页面不创建插件实例。</p>
      </div>`;
    }
    const plugin = this.store.catalog.find((p) => p.pluginId === tab.pluginId),
      runtime = this.pool?.runtimes.get(tab.id);
    return html`<div class="inspector-heading">
        <small class="mono" title=${tab.id}>${tab.id.slice(0, 8)} · ${tab.pluginId}</small>
        <h2>${titleOf(tab)}</h2>
        <p>${plugin?.description ?? tab.originalPluginTitle}</p>
      </div>
      <div class="inspector-tabs" role="tablist" @keydown=${tabNavigation}>
        ${[
          ['properties', '属性'],
          ['config', '配置'],
          ['diagnostics', '诊断'],
        ].map(
          ([v, label]) =>
            html`<button
              role="tab"
              aria-selected=${this.view === v}
              tabindex=${this.view === v ? 0 : -1}
              @click=${() => (this.view = v)}
            >
              ${label}
            </button>`,
        )}
      </div>
      <wb-scroll-container class="inspector-content">
        ${this.view === 'properties'
          ? html`<div class="property-group">
                <h3>页面</h3>
                ${this.property('插件', plugin?.title ?? tab.pluginId)}${this.property(
                  '版本',
                  plugin?.version ?? '未提供',
                )}${this.property('进程 PID', String(plugin?.runtime.pid ?? '—'))}${this.property(
                  '后端状态',
                  runtimeNames[plugin?.runtime.status ?? ''] ?? '不可用',
                )}${this.property(
                  '页面状态',
                  runtime ? (pageStateNames[runtime.state] ?? runtime.state) : '未加载 / 休眠',
                )}${this.property(
                  'UI 状态',
                  uiNames[plugin?.ui.state ?? ''] ?? '未知',
                )}${this.property('URL', tab.url)}
              </div>
              <div class="property-group">
                <h3>运行资源</h3>
                ${this.property(
                  'SDK 请求',
                  `${runtime?.requests ?? 0} 进行中 / ${runtime?.observedRequests ?? 0} 累计`,
                )}${this.property(
                  '保活原因',
                  [...(runtime?.activity.values() ?? [])].join('、') || '无',
                )}${this.property('编辑状态', runtime?.dirty ? '有未保存更改' : '无未保存更改')}
                <p class="muted small-text">请求统计只覆盖 SDK 管理的请求。</p>
              </div>
              ${runtime?.properties.length
                ? html`<div class="property-group">
                    <h3>插件属性</h3>
                    ${runtime.properties.map((p) => this.property(p.label, p.value))}
                  </div>`
                : nothing}`
          : nothing}
        ${this.view === 'config'
          ? html`${this.remote
              ? html`<div class="notice warn">
                  远端配置已变化，本地编辑已保留。<button
                    class="text-button"
                    @click=${() => {
                      this.drafts = {};
                      void this.load();
                    }}
                  >
                    接受远端值
                  </button>
                  <button
                    class="text-button"
                    @click=${() => {
                      if (this.conflictSnapshot) {
                        this.snapshot = this.conflictSnapshot;
                        this.remote = false;
                      }
                    }}
                  >
                    保留本地编辑并重新校验
                  </button>
                </div>`
              : nothing}${this.snapshot?.definitions.map(
              (def) =>
                html`<section class="property-group">
                  <h3>${def.id}</h3>
                  ${def.items.map(
                    (item) =>
                      html`<div class="config-item">
                        <div class="config-item-header">
                          <label>${item.label}</label>${iconButton(
                            'refresh',
                            '重置此配置',
                            () => void this.save([item.key]),
                            this.saving || item.control === 'readonly',
                          )}
                        </div>
                        ${item.description
                          ? html`<p>${item.description}</p>`
                          : nothing}${this.control(item)}<small class="mono"
                          >${item.key}
                          ${Object.prototype.hasOwnProperty.call(
                            requireValue(this.snapshot).values,
                            item.key,
                          )
                            ? '· 已修改'
                            : '· 默认'}</small
                        >${item.validationPolicy === 'page-required'
                          ? html`<small>需要原页面在线校验</small>`
                          : nothing}
                      </div>`,
                  )}
                </section>`,
            )}${!this.snapshot?.definitions.length
              ? html`<div class="empty compact">
                  ${icon('settings')}
                  <p>插件未注册配置项</p>
                  <span>配置定义由插件后端或在线页面提供。</span>
                </div>`
              : nothing}${Object.keys(this.drafts).length
              ? html`<div class="sticky-actions">
                  <button
                    class="btn primary"
                    ?disabled=${this.saving}
                    @click=${() => void this.save()}
                  >
                    保存更改</button
                  ><button class="btn secondary" @click=${() => (this.drafts = {})}>
                    放弃编辑
                  </button>
                </div>`
              : nothing}`
          : nothing}
        ${this.view === 'diagnostics'
          ? html`<div class="property-group">
              <h3>连接与能力</h3>
              ${this.property(
                '页面桥接',
                runtime?.port ? '已连接' : '未接入 / 等待握手',
              )}${this.property(
                '可恢复状态',
                runtime?.capabilities.serialize && runtime.capabilities.restore ? '支持' : '未提供',
              )}${this.property('内容搜索', runtime?.searchAvailable ? '已注册' : '未注册')}
              <p class="notice">
                ${runtime?.error ?? plugin?.runtime.reason ?? '当前没有运行错误。'}
              </p>
              ${[...(plugin?.diagnostics ?? []), ...(plugin?.ui.diagnostics ?? [])].map(
                (d) => html`<p class="error">${d.code} · ${d.message}</p>`,
              )}
            </div>`
          : nothing}
        ${this.errors ? html`<p role="alert" class="notice error">${this.errors}</p>` : nothing}
      </wb-scroll-container>`;
  }
  private property(label: string, value: string) {
    return html`<div class="property-row"><span>${label}</span><span>${value}</span></div>`;
  }
}
