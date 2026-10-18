import { tabNavigation } from '../workbench/ui.ts';
import './context-menu/wb-context-menu.ts';
import type { ContextMenuItem } from './context-menu/menu-types.ts';
import { requireValue } from '../../../shared/workbench-protocol.ts';
import { LitElement, html, css, unsafeCSS, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { virtualize } from '@lit-labs/virtualizer/virtualize.js';
import { live } from 'lit/directives/live.js';
import './command-editor.ts';
import './icon.ts';
import style from '../workbench/workbench.css?raw';
import type { WorkbenchStore } from '../workbench/store.ts';
import type { Execution, Terminal } from '../workbench/types.ts';
import { uid } from '../workbench/model.ts';
@customElement('wb-terminal')
export class WorkbenchTerminal extends LitElement {
  @property({ attribute: false }) accessor store!: WorkbenchStore;
  @state() private accessor selected = '';
  @state() private accessor outputQuery = '';
  @state() private accessor follow = true;
  @state() private accessor draft = '';
  @state() private accessor menu: { x: number; y: number; items: ContextMenuItem[] } | null = null;
  private draftSave: Promise<void> = Promise.resolve();
  private draftTimer?: ReturnType<typeof setTimeout>;
  private loadingId = '';
  static styles = css`
    ${unsafeCSS(style)}:host {
      display: flex;
      min-width: 0;
      min-height: 0;
      flex: 1;
    }
    .terminal-view {
      width: 100%;
    }
  `;
  connectedCallback() {
    super.connectedCallback();
    queueMicrotask(() => this.store?.addEventListener('change', this.changed));
  }
  disconnectedCallback() {
    this.store?.removeEventListener('change', this.changed);
    clearTimeout(this.draftTimer);
    super.disconnectedCallback();
  }
  private changed = () => this.requestUpdate();
  private get terminal() {
    return (
      this.store.terminals.find((t) => t.id === this.selected && !t.archivedAt) ??
      this.store.terminals.find((t) => !t.archivedAt)
    );
  }
  private execution(id?: string) {
    return this.store.executions.find(
      (e) => e.terminalId === id && ['running', 'returned'].includes(e.status),
    );
  }
  private act(run: () => Promise<unknown>) {
    void run().catch((e) => this.store.toast(this.store.message(e), 'error'));
  }
  private choose(t: Terminal) {
    if (this.terminal?.id !== t.id) {
      void this.saveDraft();
    }
    this.selected = t.id;
    this.draft = t.draft;
    this.loadingId = t.id;
    this.act(() => this.store.loadOutput(t.id));
  }
  async create() {
    const t = await this.store.api.request<Terminal>('/terminals', {
      ...this.store.session(),
      terminal: { title: `终端 ${this.store.terminals.length + 1}` },
    });
    await this.store.refreshTerminals();
    this.choose(t);
  }
  async cancel(execution: Execution) {
    const body = {
      ...this.store.session(),
      terminalId: execution.terminalId,
      executionId: execution.id,
      coreBootId: execution.coreBootId,
    };
    const result = await this.store.api.request<{ needsForce: boolean; owners: string[] }>(
      '/commands/cancel',
      body,
    );
    if (
      result.needsForce &&
      confirm(
        `协作取消仍未完成。强制停止将终止整个插件宿主，影响 ${result.owners.join('、')} 的其他任务。继续？`,
      )
    ) {
      await this.store.api.request('/commands/cancel', { ...body, force: true });
    }
    await this.store.syncExecutions();
  }
  async alter(id: string, action: string) {
    const execution = this.execution(id);
    if (execution) {
      if (!confirm('终端正在执行命令。取消执行后关闭？')) {
        return;
      }
      await this.cancel(execution);
      if (this.execution(id)) {
        return;
      }
    }
    await this.store.api.request(
      `/terminals/${encodeURIComponent(id)}/${action}`,
      this.store.session(),
    );
    await this.store.refreshTerminals();
    if (action === 'clear-output') {
      this.store.outputs.delete(id);
      await this.store.loadOutput(id, true);
    }
  }
  private openMenu(event: MouseEvent) {
    const target = event.currentTarget as HTMLElement,
      rect = target.getBoundingClientRect(),
      terminal = this.terminal;
    const items: ContextMenuItem[] = [];
    if (terminal) {
      const id = terminal.id;
      items.push(
        {
          kind: 'action',
          id: 'rename-terminal',
          label: '重命名终端',
          action: async () => {
            const title = prompt('终端名称', terminal.title);
            if (!title) {
              return;
            }
            const latest = this.store.terminals.find((t) => t.id === id);
            if (!latest) {
              return;
            }
            await this.store.api.request('/terminals', {
              ...this.store.session(),
              terminal: {
                id,
                title,
                draft: id === this.terminal?.id ? this.draft : latest.draft,
                baseRevision: latest.revision,
              },
            });
            await this.store.refreshTerminals();
          },
        },
        {
          kind: 'action',
          id: 'close-terminal',
          label: '关闭终端（归档）',
          action: () => this.alter(id, 'close'),
        },
        {
          kind: 'action',
          id: 'clear-output',
          label: '清空此终端输出',
          disabled: Boolean(this.execution(id)),
          action: () => this.alter(id, 'clear-output'),
        },
        {
          kind: 'action',
          id: 'clear-history',
          label: '清空此终端命令历史',
          disabled: Boolean(this.execution(id)),
          action: () => this.alter(id, 'clear-history'),
        },
      );
    }
    const archived = this.store.terminals.filter((t) => t.archivedAt);
    if (archived.length) {
      items.push({
        kind: 'submenu',
        id: 'restore-terminals',
        label: '恢复已归档终端',
        children: archived.map((t) => ({
          kind: 'action',
          id: t.id,
          label: t.title,
          action: () => this.alter(t.id, 'restore'),
        })),
      });
    }
    this.menu = { x: rect.left, y: rect.bottom, items };
  }
  async clearCurrent(action: 'clear-output' | 'clear-history') {
    const t = this.terminal;
    if (t) {
      await this.alter(t.id, action);
    }
  }
  private async submit(command: string) {
    const terminal = this.terminal;
    if (!terminal) {
      return;
    }
    const input = this.store.inputs.find((i) => i.identity.windowId === terminal.id);
    if (input) {
      await this.store.api.request('/commands/input', {
        ...this.store.session(),
        terminalId: terminal.id,
        executionId: input.identity.executionId,
        coreBootId: requireValue(this.store.bootstrap).coreBootId,
        requestId: input.id,
        value: command,
      });
    } else {
      if (!command.trim() || this.execution(terminal.id)) {
        return;
      }
      await this.saveDraft();
      await this.store.api.request('/commands/execute', {
        ...this.store.session(),
        terminalId: terminal.id,
        command,
        idempotencyKey: uid(),
      });
    }
    if (this.terminal?.id === terminal.id) {
      this.draft = '';
    }
    await this.store.refreshTerminals();
    await this.store.syncExecutions();
    await this.store.loadOutput(terminal.id);
  }
  private saveDraft(): Promise<void> {
    clearTimeout(this.draftTimer);
    const id = this.terminal?.id,
      draft = this.draft;
    const run = async () => {
      const terminal = this.store.terminals.find((t) => t.id === id);
      if (!terminal || terminal.draft === draft || this.execution(terminal.id)) {
        return;
      }
      const saved = await this.store.api.request<Terminal>('/terminals', {
        ...this.store.session(),
        terminal: {
          id: terminal.id,
          title: terminal.title,
          draft,
          baseRevision: terminal.revision,
        },
      });
      this.store.terminals = this.store.terminals.map((t) => (t.id === saved.id ? saved : t));
      this.store.changed();
    };
    const result = this.draftSave.then(run);
    this.draftSave = result.catch(() => undefined);
    return result;
  }
  render() {
    if (!this.store) {
      return nothing;
    }
    const terminals = this.store.terminals.filter((t) => !t.archivedAt),
      t = this.terminal,
      execution = this.execution(t?.id),
      input = this.store.inputs.find((i) => i.identity.windowId === t?.id);
    if (t && this.loadingId !== t.id) {
      this.loadingId = t.id;
      this.draft = t.draft;
      queueMicrotask(() => this.act(() => this.store.loadOutput(t.id)));
    }
    const records = (this.store.outputs.get(t?.id ?? '') ?? []).filter(
      (r) => !this.outputQuery || r.text.toLowerCase().includes(this.outputQuery.toLowerCase()),
    );
    return html`<div class="terminal-view">
      <div class="terminal-main">
        <div class="output-toolbar">
          <span class="muted">核心命令</span><span class="spacer"></span
          ><button class="icon-button" aria-label="终端操作" @click=${this.openMenu}>
            <wb-icon name="more"></wb-icon></button
          ><input
            aria-label="筛选终端输出"
            placeholder="筛选输出…"
            .value=${live(this.outputQuery)}
            @input=${(e: Event) => (this.outputQuery = (e.target as HTMLInputElement).value)}
          /><button
            class="icon-button"
            aria-label="跟随输出"
            aria-pressed=${this.follow}
            @click=${() => (this.follow = !this.follow)}
          >
            <wb-icon name="down"></wb-icon></button
          ><button
            class="icon-button"
            aria-label="清空终端输出"
            ?disabled=${!t || Boolean(execution)}
            @click=${() => t && this.act(() => this.alter(t.id, 'clear-output'))}
          >
            <wb-icon name="trash"></wb-icon></button
          ><button
            class="icon-button"
            aria-label="新建命令终端"
            @click=${() => this.act(() => this.create())}
          >
            <wb-icon name="plus"></wb-icon>
          </button>
        </div>
        <div
          class="terminal-output"
          role="log"
          aria-label="终端输出"
          @scroll=${(e: Event) => {
            const el = e.currentTarget as HTMLElement;
            this.follow = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
        >
          ${!t
            ? html`<div class="empty compact">
                <wb-icon name="terminal"></wb-icon>
                <p>创建终端，运行核心已注册的命令。</p>
                <p class="muted">此处是核心命令界面，不是系统 Shell。</p>
                <button class="btn primary" @click=${() => this.act(() => this.create())}>
                  新建终端
                </button>
              </div>`
            : nothing}
          ${t && this.store.outputGaps.has(t.id)
            ? html`<p class="notice">更早输出已按服务端保留策略截断。</p>`
            : nothing}
          ${virtualize({
            items: records,
            renderItem: (r) =>
              html`<div class="output-line">
                <time>${new Date(r.timestamp).toLocaleTimeString()}</time
                ><span class=${`level ${r.level ?? 'info'}`}>${r.level ?? 'info'}</span
                ><span class="output-text">${r.text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')}</span>
              </div>`,
          })}
        </div>
        ${t
          ? html`<div class="terminal-input-area">
              <div class="terminal-input-toolbar">
                <span
                  >${input
                    ? `等待输入 · ${input.message}`
                    : execution
                      ? execution.status === 'returned'
                        ? '命令已返回 · 后台任务仍在运行'
                        : '命令执行中'
                      : 'Enter 执行 · Shift+Enter 换行 · Tab 补全'}</span
                ><span class="spacer"></span>${terminals.length === 1 && execution
                  ? html`<button
                      class="icon-button danger-text"
                      aria-label="取消执行"
                      @click=${() => this.act(() => this.cancel(execution))}
                    >
                      <wb-icon name="stop"></wb-icon>
                    </button>`
                  : nothing}<button
                  class="btn primary small"
                  ?disabled=${Boolean(execution) && !input}
                  @click=${() => this.act(() => this.submit(this.draft))}
                >
                  ${input ? '回复' : '执行'}<wb-icon name="play"></wb-icon>
                </button>
              </div>
              <wb-command-editor
                .store=${this.store}
                .terminal=${t}
                .busy=${Boolean(execution)}
                .waiting=${Boolean(input)}
                .value=${this.draft}
                @draft-change=${(e: CustomEvent<string>) => {
                  this.draft = e.detail;
                  clearTimeout(this.draftTimer);
                  this.draftTimer = setTimeout(() => this.act(() => this.saveDraft()), 500);
                }}
                @submit-command=${(e: CustomEvent<string>) => this.act(() => this.submit(e.detail))}
                @cancel-command=${() => execution && this.act(() => this.cancel(execution))}
              ></wb-command-editor>
            </div>`
          : nothing}
      </div>
      ${terminals.length > 1
        ? html`<aside
            class="terminal-list"
            role="tablist"
            aria-label="命令终端列表"
            @keydown=${tabNavigation}
          >
            <div class="section-heading">终端 <span class="badge">${terminals.length}</span></div>
            ${terminals.map((term) => {
              const run = this.execution(term.id),
                waiting = this.store.inputs.some((i) => i.identity.windowId === term.id);
              return html`<div class="terminal-row" aria-selected=${term.id === t?.id}>
                <button
                  class="terminal-select"
                  role="tab"
                  aria-selected=${term.id === t?.id}
                  tabindex=${term.id === t?.id ? 0 : -1}
                  @click=${() => this.choose(term)}
                >
                  <span>${term.title}</span
                  ><small
                    ><i class=${`dot ${run ? 'success' : ''}`}></i>${waiting
                      ? '等待输入'
                      : run
                        ? '运行中'
                        : '空闲'}</small
                  ></button
                >${run
                  ? html`<button
                      class="icon-button"
                      aria-label=${`取消 ${term.title}`}
                      @click=${() => this.act(() => this.cancel(run))}
                    >
                      <wb-icon name="stop"></wb-icon>
                    </button>`
                  : nothing}<button
                  class="icon-button"
                  aria-label=${`关闭 ${term.title}`}
                  @click=${() => this.act(() => this.alter(term.id, 'close'))}
                >
                  <wb-icon name="close"></wb-icon>
                </button>
              </div>`;
            })}
          </aside>`
        : nothing}
      ${this.menu
        ? html`<wb-context-menu
            presentation="custom"
            .x=${this.menu.x}
            .y=${this.menu.y}
            .items=${this.menu.items}
            @wb-menu-close=${() => (this.menu = null)}
            @wb-menu-select=${(e: CustomEvent<{ id: string }>) => {
              const find = (items: ContextMenuItem[]): ContextMenuItem | undefined => {
                for (const item of items) {
                  if (item.id === e.detail.id) {
                    return item;
                  }
                  if (item.kind === 'submenu') {
                    const found = find(item.children);
                    if (found) {
                      return found;
                    }
                  }
                }
              };
              const item = find(this.menu?.items ?? []);
              if (item?.kind === 'action' && !item.disabled) {
                this.menu = null;
                this.act(async () => item.action());
              }
            }}
          ></wb-context-menu>`
        : nothing}
    </div>`;
  }
  updated() {
    if (this.follow) {
      const el = this.renderRoot.querySelector('.terminal-output');
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    }
  }
}
