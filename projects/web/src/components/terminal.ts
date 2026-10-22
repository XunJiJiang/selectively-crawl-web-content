import { tabNavigation } from '../workbench/ui.ts';
import './context-menu/wb-context-menu.ts';
import type { ContextMenuItem } from './context-menu/menu-types.ts';
import { requireValue } from '../../../shared/workbench-protocol.ts';
import { LitElement, html, css, unsafeCSS, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { styleMap } from 'lit/directives/style-map.js';
import { terminalRows } from '../workbench/terminal-output.ts';
import './command-editor.ts';
import type { CommandEditor } from './command-editor.ts';
import './icon.ts';
import style from '../workbench/workbench.css?raw';
import type { WorkbenchStore } from '../workbench/store.ts';
import type { Execution, Terminal } from '../workbench/types.ts';
import { uid } from '../workbench/model.ts';
@customElement('wb-terminal')
export class WorkbenchTerminal extends LitElement {
  @property({ attribute: false }) accessor store!: WorkbenchStore;
  @state() private accessor selected = '';
  @state() private accessor cancelling = new Set<string>();
  @state() private accessor submitting = new Set<string>();
  @state() private accessor menu: { x: number; y: number; items: ContextMenuItem[] } | null = null;
  private draftSave: Promise<void> = Promise.resolve();
  private draftTimer?: ReturnType<typeof setTimeout>;
  private loadingId = '';
  private restoreScroll = false;
  private scrollFrame = 0;
  private wheelRemainder = 0;
  private lastWheel = 0;
  private userScrollUntil = 0;
  private firstSeq = 0;
  private outputResize?: ResizeObserver;
  private lastRecords?: import('../workbench/types.ts').OutputRecord[];
  private rows: ReturnType<typeof terminalRows> = [];
  private creating?: Promise<void>;
  async activate(id?: string) {
    if (!this.terminal) {
      await this.create();
      return;
    }
    const target = this.store.terminals.find((t) => t.id === id && !t.archivedAt) ?? this.terminal;
    this.choose(target);
    await this.updateComplete;
    this.renderRoot.querySelector<CommandEditor>('wb-command-editor')?.focus();
  }
  async closeCurrent() {
    if (this.terminal) {
      await this.alter(this.terminal.id, 'close');
    }
  }
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
    this.rememberScroll();
    this.act(() => this.saveDraft());
    cancelAnimationFrame(this.scrollFrame);
    this.outputResize?.disconnect();
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
      this.rememberScroll();
      this.act(() => this.saveDraft());
    }
    this.selected = t.id;
    this.loadingId = t.id;
    this.restoreScroll = true;
    this.wheelRemainder = 0;
    this.act(() => this.store.loadOutput(t.id));
    void this.updateComplete.then(async () => {
      const editor = this.renderRoot.querySelector<CommandEditor>('wb-command-editor');
      await editor?.updateComplete;
      if (this.isConnected) {
        editor?.focus();
      }
    });
    this.dispatchEvent(
      new CustomEvent('terminal-focus', { detail: t.id, bubbles: true, composed: true }),
    );
  }
  async create() {
    if (this.creating) {
      return this.creating;
    }
    this.creating = this.createTerminal();
    try {
      await this.creating;
    } finally {
      this.creating = undefined;
    }
  }
  private async createTerminal() {
    const t = await this.store.api.request<Terminal>('/terminals', {
      ...this.store.session(),
      terminal: { title: `终端 ${this.store.terminals.length + 1}` },
    });
    await this.store.refreshTerminals();
    this.choose(t);
  }
  async cancel(execution: Execution) {
    if (this.cancelling.has(execution.id)) {
      return;
    }
    this.cancelling = new Set([...this.cancelling, execution.id]);
    try {
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
        (await this.store.confirm(
          `协作取消仍未完成。强制停止将终止整个插件宿主，影响 ${result.owners.join('、')} 的其他任务。继续？`,
        ))
      ) {
        await this.store.api.request('/commands/cancel', { ...body, force: true });
      }
      await this.store.syncExecutions();
    } finally {
      this.cancelling = new Set([...this.cancelling].filter((id) => id !== execution.id));
    }
  }
  async alter(id: string, action: string) {
    const execution = this.execution(id);
    if (execution) {
      if (!(await this.store.confirm('终端正在执行命令。取消执行后关闭？'))) {
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
    if (action === 'close') {
      if (!this.terminal) {
        this.dispatchEvent(
          new CustomEvent('workbench-command', {
            detail: { id: 'lastTerminalClosed' },
            bubbles: true,
            composed: true,
          }),
        );
      } else {
        this.choose(this.terminal);
      }
    }
    if (action === 'clear-output') {
      this.store.outputs.delete(id);
      if (this.terminal?.id === id) {
        this.store.terminalView(this.terminal).follow = true;
      }
      await this.store.loadOutput(id, true);
    } else if (action === 'clear-history') {
      const latest = this.store.terminals.find((t) => t.id === id);
      if (latest) {
        const local = this.store.terminalView(latest);
        local.historyCursor = -1;
        local.historyDraft = '';
        local.historyLocked = false;
      }
    }
  }
  private openMenu(event: MouseEvent) {
    const target = event.currentTarget as HTMLElement,
      rect = target.getBoundingClientRect(),
      terminal = this.terminal;
    if (event.type === 'contextmenu') {
      event.preventDefault();
    }
    const items: ContextMenuItem[] = [
      { kind: 'action', id: 'new-terminal', label: '新建终端', action: () => this.create() },
    ];
    if (terminal) {
      items.push({
        kind: 'action',
        id: 'follow-output',
        label: '跳到末尾',
        action: () => {
          this.store.terminalView(terminal).follow = true;
          this.requestUpdate();
        },
      });
    }
    if (terminal) {
      const id = terminal.id;
      items.push(
        {
          kind: 'action',
          id: 'rename-terminal',
          label: '重命名终端',
          action: async () => {
            const title = await this.store.prompt('终端名称', terminal.title);
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
                draft: this.store.terminalView(latest).draft,
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
    this.menu = {
      x: event.type === 'contextmenu' ? event.clientX : rect.left,
      y: event.type === 'contextmenu' ? event.clientY : rect.bottom,
      items,
    };
  }
  async clearCurrent(action: 'clear-output' | 'clear-history') {
    const t = this.terminal;
    if (t) {
      await this.alter(t.id, action);
    }
  }
  private async submit(command: string) {
    const terminal = this.terminal;
    if (!terminal || this.submitting.has(terminal.id)) {
      return;
    }
    this.submitting = new Set([...this.submitting, terminal.id]);
    try {
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
      const local = this.store.terminalView(terminal);
      if (local.draft === command) {
        local.draft = '';
      }
      local.historyCursor = -1;
      local.historyDraft = '';
      local.historyLocked = false;
      local.selectionAnchor = local.selectionHead = 0;
      local.follow = true;
      await this.store.refreshTerminals();
      await this.store.syncExecutions();
      await this.store.loadOutput(terminal.id);
    } finally {
      this.submitting = new Set([...this.submitting].filter((id) => id !== terminal.id));
    }
  }
  private saveDraft(): Promise<void> {
    clearTimeout(this.draftTimer);
    const id = this.terminal?.id,
      draft = this.terminal ? this.store.terminalView(this.terminal).draft : '';
    const run = async () => {
      const terminal = this.store.terminals.find((t) => t.id === id);
      if (!terminal || terminal.draft === draft) {
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
      this.restoreScroll = true;
      queueMicrotask(() => this.act(() => this.store.loadOutput(t.id)));
    }
    const source = this.store.outputs.get(t?.id ?? '');
    if (source !== this.lastRecords) {
      this.lastRecords = source;
      this.rows = terminalRows(source ?? []);
    }
    const records = this.rows;
    const local = t ? this.store.terminalView(t) : undefined;
    const pinnedCommand = execution?.command;
    if (this.firstSeq && records[0]?.seq !== this.firstSeq) {
      this.restoreScroll = true;
    }
    this.firstSeq = records[0]?.seq ?? 0;
    return html`<div class="terminal-view">
      <div class="terminal-main" @contextmenu=${this.openMenu}>
        <div
          class="terminal-output"
          role="log"
          aria-label="终端输出"
          tabindex="0"
          @scroll=${() => this.rememberScroll(performance.now() < this.userScrollUntil)}
          @pointerdown=${() => {
            this.userScrollUntil = performance.now() + 1000;
          }}
          @pointerup=${() => {
            this.userScrollUntil = performance.now() + 200;
          }}
          @wheel=${this.wheel}
          @keydown=${this.outputKeydown}
          @click=${(event: MouseEvent) => {
            if (
              !window.getSelection()?.toString() &&
              !(event.target as HTMLElement).closest('wb-command-editor')
            ) {
              this.renderRoot.querySelector<CommandEditor>('wb-command-editor')?.focus();
            }
          }}
        >
          ${pinnedCommand
            ? html`<div class="terminal-pinned-command" title=${pinnedCommand}>
                <span class="terminal-input-prompt">&gt;</span><span>${pinnedCommand}</span>
                ${execution
                  ? html`<small
                      >${this.cancelling.has(execution.id)
                        ? '正在取消…'
                        : execution.status === 'returned'
                          ? '后台运行'
                          : '执行中'}</small
                    >`
                  : nothing}
              </div>`
            : nothing}
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
          <div class="terminal-scroll-content">
            <div class="terminal-output-lines">
              ${repeat(
                records,
                (r) => r.seq,
                (r) => html`<div class="terminal-output-line" data-type=${r.type} data-seq=${r.seq}>
                  ${r.type === 'command' || r.type === 'prompt'
                    ? html`<span class="terminal-input-prompt" aria-hidden="true">&gt;</span>`
                    : nothing}
                  <span class="terminal-output-text"
                    >${r.segments.map(
                      (segment) =>
                        html`<span style=${styleMap(segment.style)}>${segment.text}</span>`,
                    )}${r.restored && r.type === 'command'
                      ? html`<span class="terminal-restored-indicator">还原的历史记录</span>`
                      : nothing}</span
                  >
                </div>`,
              )}
            </div>
            ${t
              ? html`<div class="terminal-input-area">
                  ${input
                    ? html`<div class="terminal-input-request">${input.message}</div>`
                    : nothing}
                  <wb-command-editor
                    @focusin=${() =>
                      this.dispatchEvent(
                        new CustomEvent('terminal-focus', {
                          detail: t.id,
                          bubbles: true,
                          composed: true,
                        }),
                      )}
                    .store=${this.store}
                    .terminal=${t}
                    .busy=${Boolean(execution) || this.submitting.has(t.id)}
                    .waiting=${Boolean(input)}
                    .value=${local?.draft ?? ''}
                    @draft-change=${(e: CustomEvent<string>) => {
                      if (local) {
                        local.draft = e.detail;
                        local.follow = true;
                      }
                      clearTimeout(this.draftTimer);
                      this.draftTimer = setTimeout(() => this.act(() => this.saveDraft()), 500);
                    }}
                    @editor-status-change=${() => this.requestUpdate()}
                    @submit-command=${(e: CustomEvent<string>) =>
                      this.act(() => this.submit(e.detail))}
                    @cancel-command=${() => execution && this.act(() => this.cancel(execution))}
                  ></wb-command-editor>
                </div>`
              : nothing}
          </div>
        </div>
        <div class="terminal-input-status" role="status" @contextmenu=${this.openMenu}>
          <span
            >${input
              ? 'INPUT'
              : this.cancelling.has(execution?.id ?? '')
                ? 'CANCELLING'
                : execution
                  ? execution.status === 'returned'
                    ? 'BACKGROUND'
                    : 'RUNNING'
                  : 'NORMAL'}</span
          >
          ${local && local.draft.includes('\n')
            ? html`<span class="terminal-multiline-indicator">多行</span>`
            : nothing}
          <span class="spacer"></span>
          ${local
            ? html`<span
                >行 ${local.draft.slice(0, local.selectionHead).split('\n').length}，列
                ${local.selectionHead -
                local.draft.slice(0, local.selectionHead).lastIndexOf('\n')}</span
              >`
            : nothing}
        </div>
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
                  <wb-icon name="trash"></wb-icon>
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
  private outputElement() {
    return this.renderRoot.querySelector<HTMLElement>('.terminal-output');
  }
  private rememberScroll(user = false) {
    const t = this.terminal,
      el = this.outputElement();
    if (!t || !el || this.restoreScroll) {
      return;
    }
    const local = this.store.terminalView(t);
    if (local.follow && !user) {
      return;
    }
    local.scrollTop = el.scrollTop;
    if (user) {
      local.follow = el.scrollHeight - el.scrollTop - el.clientHeight < this.lineHeight();
    }
    const top = el.getBoundingClientRect().top;
    const rows = el.querySelectorAll<HTMLElement>('.terminal-output-line');
    let from = 0,
      to = rows.length;
    while (from < to) {
      const middle = (from + to) >>> 1;
      if (rows[middle].getBoundingClientRect().bottom > top) {
        to = middle;
      } else {
        from = middle + 1;
      }
    }
    const row = rows[from];
    if (row) {
      local.scrollAnchor = {
        seq: Number(row.dataset.seq),
        offset: row.getBoundingClientRect().top - top,
      };
    }
    this.requestUpdate();
  }
  private lineHeight() {
    const el = this.outputElement();
    return el ? Number.parseFloat(getComputedStyle(el).lineHeight) || 21 : 21;
  }
  private wheel = (event: WheelEvent) => {
    if (
      event
        .composedPath()
        .some(
          (node) =>
            node instanceof HTMLElement && node.classList.contains('terminal-completion-list'),
        )
    ) {
      return;
    }
    if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      return;
    }
    const el = this.outputElement();
    if (!el) {
      return;
    }
    event.preventDefault();
    const line = this.lineHeight(),
      now = performance.now();
    const delta =
      event.deltaY * (event.deltaMode === 1 ? line : event.deltaMode === 2 ? el.clientHeight : 1);
    const speed = Math.abs(delta) / Math.max(8, now - this.lastWheel);
    this.lastWheel = now;
    this.wheelRemainder += delta * Math.min(3, Math.max(1, speed / 4));
    const steps = Math.trunc(this.wheelRemainder / line);
    this.wheelRemainder -= steps * line;
    if (steps) {
      this.restoreScroll = false;
      this.userScrollUntil = now + 200;
      el.scrollTop += steps * line;
      this.rememberScroll(true);
    }
  };
  private outputKeydown = (event: KeyboardEvent) => {
    if (
      event
        .composedPath()
        .some((node) => node instanceof HTMLElement && node.tagName === 'WB-COMMAND-EDITOR')
    ) {
      return;
    }
    const el = this.outputElement();
    if (!el || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) {
      return;
    }
    const line = this.lineHeight(),
      page = Math.max(line, Math.floor(el.clientHeight / line) * line);
    if (!['Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
      return;
    }
    this.restoreScroll = false;
    if (event.key === 'Home') {
      el.scrollTop = 0;
    } else if (event.key === 'End') {
      el.scrollTop = el.scrollHeight;
    } else if (event.key === 'PageUp') {
      el.scrollTop -= page;
    } else if (event.key === 'PageDown') {
      el.scrollTop += page;
    } else {
      return;
    }
    event.preventDefault();
    this.userScrollUntil = performance.now() + 200;
    this.rememberScroll(true);
  };
  private scheduleScroll() {
    cancelAnimationFrame(this.scrollFrame);
    this.scrollFrame = requestAnimationFrame(() => {
      const t = this.terminal,
        el = this.outputElement();
      if (!t || !el) {
        return;
      }
      const local = this.store.terminalView(t);
      if (local.follow) {
        el.scrollTop = el.scrollHeight;
      } else if (this.restoreScroll) {
        el.scrollTop = local.scrollTop;
        const anchor = local.scrollAnchor;
        const row = anchor && el.querySelector<HTMLElement>(`[data-seq="${anchor.seq}"]`);
        if (row) {
          const top = el.getBoundingClientRect().top;
          el.scrollTop += row.getBoundingClientRect().top - top - anchor.offset;
        }
      }
      this.restoreScroll = false;
    });
  }
  updated() {
    if (!this.outputResize) {
      this.outputResize = new ResizeObserver(() => this.scheduleScroll());
      const content = this.renderRoot.querySelector('.terminal-scroll-content');
      if (content) {
        this.outputResize.observe(content);
      }
    }
    this.scheduleScroll();
  }
}
