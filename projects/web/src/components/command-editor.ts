/// <reference lib="es2022.intl" />
import { completionSource } from '../../../terminal/command-text.ts';
import { requireValue } from '../../../shared/workbench-protocol.ts';
import { LitElement, html, css, nothing, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';
import type { WorkbenchStore } from '../workbench/store.ts';
import type { Terminal } from '../workbench/types.ts';
import { commands, effectiveKeys, matchesKey } from '../workbench/commands.ts';

type Completion = {
  from: number;
  to: number;
  items: { name: string; insertText: string; description?: string }[];
};
type Edit = { value: string; anchor: number; head: number };
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export function hasOpenQuote(text: string) {
  let quote = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\' && quote !== "'") {
      const next = text[i + 1];
      if (next === quote || next === '\\' || (!quote && ['"', "'", '`'].includes(next))) {
        i++;
      }
      continue;
    }
    if (quote) {
      if (c === quote) {
        quote = '';
      }
    } else if (['"', "'", '`'].includes(c)) {
      quote = c;
    }
  }
  return Boolean(quote);
}

@customElement('wb-command-editor')
export class CommandEditor extends LitElement {
  @property({ attribute: false }) accessor store!: WorkbenchStore;
  @property({ attribute: false }) accessor terminal!: Terminal;
  @property({ type: Boolean }) accessor busy = false;
  @property({ type: Boolean }) accessor waiting = false;
  @property() accessor value = '';
  @state() private accessor candidates: Completion | null = null;
  @state() private accessor candidateIndex = 0;
  @state() private accessor focused = false;
  private completing = false;
  private completion?: AbortController;
  private terminalId = '';
  private anchor = 0;
  private head = 0;
  private composing = false;
  private resizeObserver?: ResizeObserver;
  private measuredWidth = -1;
  private position = { line: 1, column: 1, lines: 1 };
  private states = new Map<string, { undo: Edit[]; redo: Edit[] }>();
  static styles = css`
    :host {
      display: block;
      min-height: 0;
      font-family: var(--font-mono);
      font-size: 1rem;
      color: var(--terminal-foreground);
    }
    .input-surface {
      position: relative;
      line-height: var(--leading-relaxed);
      overflow: hidden;
    }
    .input-mirror {
      position: absolute;
      top: 0;
      left: 2ch;
      margin: 0;
      white-space: normal;
      overflow-wrap: anywhere;
      tab-size: 4;
      pointer-events: none;
    }
    .input-line {
      white-space: pre-wrap;
      min-height: 1lh;
      position: relative;
    }
    .input-line::before {
      content: '>';
      position: absolute;
      right: calc(100% + 1ch);
      color: var(--accent-primary);
      font-weight: var(--font-semibold);
    }
    textarea {
      position: relative;
      display: block;
      width: calc(100% - 2ch);
      min-height: 1lh;
      max-height: 50vh;
      margin: 0 0 0 2ch;
      padding: 0;
      border: 0;
      outline: 0;
      resize: none;
      overflow: auto;
      scrollbar-width: thin;
      scrollbar-gutter: stable;
      border-radius: 0;
      background: transparent;
      color: transparent;
      caret-color: transparent;
      font: inherit;
      line-height: inherit;
      letter-spacing: inherit;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      tab-size: 4;
    }
    textarea::selection {
      background: transparent;
      color: transparent;
    }
    .selected {
      background: var(--accent-subtle);
    }
    .cursor {
      display: inline-block;
      vertical-align: top;
      height: 1lh;
      outline: 1px solid var(--terminal-cursor);
      outline-offset: -1px;
    }
    :host(:focus-within) .cursor {
      background: var(--terminal-cursor);
      color: var(--surface-0);
    }
    .terminal-completion-list {
      position: fixed;
      z-index: 5;
      max-height: 200px;
      overflow: auto;
      padding: 4px;
      background: var(--surface-1);
      border: 1px solid var(--border-default);
      border-radius: 4px;
      box-shadow: var(--shadow-menu);
    }
    .terminal-completion-item {
      display: flex;
      gap: 12px;
      padding: 4px 8px;
      cursor: pointer;
    }
    .terminal-completion-item[data-selected='true'] {
      background: var(--surface-3);
      color: var(--accent-primary);
    }
    small {
      color: var(--text-secondary);
      font: inherit;
      overflow-wrap: anywhere;
    }
  `;
  private get input() {
    return this.renderRoot.querySelector<HTMLTextAreaElement>('textarea');
  }
  private get stacks() {
    let stacks = this.states.get(this.terminal.id);
    if (!stacks) {
      this.states.set(this.terminal.id, (stacks = { undo: [], redo: [] }));
    }
    return stacks;
  }
  private snapshot(): Edit {
    return { value: this.value, anchor: this.anchor, head: this.head };
  }
  private emitDraft(history = false) {
    const local = this.store.terminalView(this.terminal);
    local.draft = this.value;
    local.selectionAnchor = this.anchor;
    local.selectionHead = this.head;
    if (!history) {
      local.historyLocked = local.historyCursor >= 0 && this.value.includes('\n');
      if (!local.historyLocked) {
        local.historyCursor = -1;
      }
    }
    this.closeCompletion();
    this.updatePosition();
    this.dispatchEvent(
      new CustomEvent('draft-change', { detail: this.value, bubbles: true, composed: true }),
    );
  }
  private select(anchor: number, head = anchor) {
    this.anchor = Math.max(0, Math.min(this.value.length, anchor));
    this.head = Math.max(0, Math.min(this.value.length, head));
    this.input?.setSelectionRange(
      Math.min(this.anchor, this.head),
      Math.max(this.anchor, this.head),
      this.anchor > this.head ? 'backward' : 'forward',
    );
    const local = this.store.terminalView(this.terminal);
    local.selectionAnchor = this.anchor;
    local.selectionHead = this.head;
    this.updatePosition();
    this.requestUpdate();
  }
  private readSelection = () => {
    const input = this.input;
    if (!input) {
      return;
    }
    const backward = input.selectionDirection === 'backward';
    const anchor = backward ? input.selectionEnd : input.selectionStart;
    const head = backward ? input.selectionStart : input.selectionEnd;
    if (anchor !== this.anchor || head !== this.head) {
      this.closeCompletion();
      this.select(anchor, head);
    }
  };
  private replace(from: number, to: number, text: string, history = false) {
    this.stacks.undo.push(this.snapshot());
    this.stacks.redo = [];
    this.value = this.value.slice(0, from) + text + this.value.slice(to);
    if (this.input) {
      this.input.value = this.value;
    }
    this.select(from + text.length);
    this.emitDraft(history);
  }
  private insert(text: string) {
    this.replace(Math.min(this.anchor, this.head), Math.max(this.anchor, this.head), text);
  }
  private undo(redo = false) {
    const stacks = this.stacks,
      source = redo ? stacks.redo : stacks.undo,
      target = redo ? stacks.undo : stacks.redo;
    const edit = source.pop();
    if (!edit) {
      return;
    }
    target.push(this.snapshot());
    this.value = edit.value;
    if (this.input) {
      this.input.value = this.value;
    }
    this.select(edit.anchor, edit.head);
    this.emitDraft();
  }
  private onInput = () => {
    const input = this.input;
    if (!input || input.value === this.value) {
      return;
    }
    this.stacks.undo.push(this.snapshot());
    this.stacks.redo = [];
    this.value = input.value;
    this.anchor =
      input.selectionDirection === 'backward' ? input.selectionEnd : input.selectionStart;
    this.head = input.selectionDirection === 'backward' ? input.selectionStart : input.selectionEnd;
    this.emitDraft();
  };
  private renderLine(line: string, offset: number) {
    const start = Math.min(this.anchor, this.head),
      end = Math.max(this.anchor, this.head);
    const parts = Array.from(graphemes.segment(line), (part) => {
      const index = offset + part.index;
      const selected = start !== end && index < end && index + part.segment.length > start;
      const cursor = start === end && index === this.head && !this.composing;
      return html`<span class=${selected ? 'selected' : cursor ? 'cursor' : ''}
        >${part.segment}</span
      >`;
    });
    const tail =
      this.head === offset + line.length && start === end && !this.composing
        ? html`<span class="cursor"> </span>`
        : !line
          ? html`<br />`
          : nothing;
    return html`<div class="input-line">${parts}${tail}</div>`;
  }

  render() {
    let offset = 0;
    return html`${this.candidates
        ? html`<div
            class="terminal-completion-list"
            id="completions"
            role="listbox"
            aria-label="命令补全"
          >
            ${this.candidates.items.length
              ? this.candidates.items.map(
                  (item, i) =>
                    html`<div
                      class="terminal-completion-item"
                      id=${`completion-${i}`}
                      role="option"
                      aria-selected=${i === this.candidateIndex}
                      data-selected=${i === this.candidateIndex}
                      @mousedown=${(e: MouseEvent) => {
                        e.preventDefault();
                        this.accept(i);
                      }}
                    >
                      <span>${item.name}</span>${item.description
                        ? html`<small>${item.description}</small>`
                        : nothing}
                    </div>`,
                )
              : html`<div>没有匹配的命令候选</div>`}
          </div>`
        : nothing}
      <div class="input-surface">
        <div class="input-mirror" aria-hidden="true">
          ${this.value.split('\n').map((line) => {
            const result = this.renderLine(line, offset);
            offset += line.length + 1;
            return result;
          })}
        </div>
        <textarea
          aria-label="命令输入"
          aria-multiline="true"
          aria-expanded=${Boolean(this.candidates)}
          aria-controls=${this.candidates ? 'completions' : nothing}
          aria-activedescendant=${this.candidates?.items.length
            ? `completion-${this.candidateIndex}`
            : nothing}
          spellcheck="false"
          autocapitalize="off"
          autocomplete="off"
          .value=${live(this.value)}
          @scroll=${this.syncScroll}
          @input=${this.onInput}
          @select=${this.readSelection}
          @keyup=${this.readSelection}
          @pointerup=${this.readSelection}
          @keydown=${this.keydown}
          @compositionstart=${() => {
            this.composing = true;
            this.requestUpdate();
          }}
          @compositionend=${() => {
            this.composing = false;
            this.onInput();
            this.requestUpdate();
          }}
          @focus=${() => {
            this.focused = true;
          }}
          @blur=${() => {
            this.focused = false;
            this.closeCompletion();
          }}
        ></textarea>
      </div>`;
  }
  firstUpdated() {
    this.resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width !== undefined && width !== this.measuredWidth) {
        this.measuredWidth = width;
        this.resizeInput();
      }
    });
    this.resizeObserver.observe(this);
  }
  private syncScroll = () => {
    const mirror = this.renderRoot.querySelector<HTMLElement>('.input-mirror');
    if (mirror && this.input) {
      mirror.style.transform = `translate(${-this.input.scrollLeft}px, ${-this.input.scrollTop}px)`;
    }
  };
  private resizeInput() {
    const input = this.input,
      mirror = this.renderRoot.querySelector<HTMLElement>('.input-mirror');
    if (!input || !mirror) {
      return;
    }
    const top = input.scrollTop;
    input.style.height = '0px';
    input.style.height = `${input.scrollHeight}px`;
    mirror.style.width = `${input.clientWidth}px`;
    input.scrollTop = top;
    this.syncScroll();
  }
  updated(changed: PropertyValues) {
    if (this.terminalId !== this.terminal.id) {
      this.terminalId = this.terminal.id;
      this.closeCompletion();
      const local = this.store.terminalView(this.terminal);
      this.select(local.selectionAnchor, local.selectionHead);
    } else if (changed.has('value')) {
      this.select(this.anchor, this.head);
    }
    if (changed.has('value') || changed.has('terminal')) {
      this.resizeInput();
    }
    if (this.focused && this.anchor === this.head) {
      const input = this.input;
      const cursor = this.renderRoot.querySelector<HTMLElement>('.cursor');
      if (input && cursor) {
        const viewport = input.getBoundingClientRect(),
          caret = cursor.getBoundingClientRect();
        if (caret.top < viewport.top) {
          input.scrollTop += caret.top - viewport.top;
        } else if (caret.bottom > viewport.bottom) {
          input.scrollTop += caret.bottom - viewport.bottom;
        }
        this.syncScroll();
      }
    }
    if (this.busy || this.waiting) {
      this.closeCompletion();
    }
    const list = this.renderRoot.querySelector<HTMLElement>('.terminal-completion-list');
    if (list) {
      const rect = this.getBoundingClientRect();
      const height = Math.min(
        200,
        list.scrollHeight,
        Math.max(rect.top, window.innerHeight - rect.bottom),
      );
      list.style.cssText = `left:${rect.left}px;width:${rect.width}px;max-height:${height}px;top:${rect.top >= height ? rect.top - height : rect.bottom}px`;
      list
        .querySelector<HTMLElement>('[data-selected="true"]')
        ?.scrollIntoView?.({ block: 'nearest' });
    }
  }
  private updatePosition() {
    const before = this.value.slice(0, this.head),
      lines = before.split('\n');
    const position = {
      line: lines.length,
      column: lines[lines.length - 1].length + 1,
      lines: this.value.split('\n').length,
    };
    if (JSON.stringify(position) !== JSON.stringify(this.position)) {
      this.position = position;
      this.dispatchEvent(
        new CustomEvent('editor-status-change', { bubbles: true, composed: true }),
      );
    }
  }
  private closeCompletion() {
    this.completion?.abort();
    this.completion = undefined;
    this.candidates = null;
    this.completing = false;
  }
  private async complete() {
    if (this.busy || this.waiting) {
      return;
    }
    this.closeCompletion();
    const original = this.value,
      cursor = this.head,
      terminalId = this.terminal.id;
    const source = completionSource(original, cursor),
      command = source.command;
    const controller = (this.completion = new AbortController());
    this.completing = true;
    try {
      const result = await this.store.api.request<Completion & { command?: string }>(
        '/commands/complete',
        { ...this.store.session(), terminalId, command, cursor: source.cursor },
        controller.signal,
      );
      if (
        controller.signal.aborted ||
        this.completion !== controller ||
        this.value !== original ||
        this.head !== cursor ||
        this.terminal.id !== terminalId ||
        (result.command !== undefined && result.command !== command)
      ) {
        return;
      }
      const prefix = command.slice(result.from, source.cursor);
      this.candidates = {
        ...result,
        items: result.items.filter((item) => item.name.startsWith(prefix)),
        ...source.range(result.from, result.to),
      };
      this.candidateIndex = 0;
    } catch (error) {
      if (!controller.signal.aborted) {
        this.store.toast(this.store.message(error), 'error');
      }
    } finally {
      if (this.completion === controller) {
        this.completing = false;
      }
    }
  }
  private accept(index = this.candidateIndex) {
    const result = this.candidates,
      item = result?.items[index];
    if (!result || !item) {
      return;
    }
    this.replace(result.from, result.to, item.insertText);
    this.focus();
  }
  private wordPosition(direction: number) {
    const before = this.value.slice(0, this.head),
      after = this.value.slice(this.head);
    return direction < 0
      ? this.head -
          (before.match(/(?:[\p{L}\p{N}_]+|[^\p{L}\p{N}_\s]+)\s*$|\s+$/u)?.[0].length ?? 1)
      : this.head +
          (after.match(/^\s*(?:[\p{L}\p{N}_]+|[^\p{L}\p{N}_\s]+)|^\s+/u)?.[0].length ?? 1);
  }
  private keydown = (event: KeyboardEvent) => {
    if (event.isComposing || this.composing || event.keyCode === 229) {
      return;
    }
    this.readSelection();
    const overrides = this.store.preferences.values.keybindings ?? [];
    const matches = (id: string) =>
      effectiveKeys(requireValue(commands.find((c) => c.id === id)), overrides).some((key) =>
        matchesKey(key, event),
      );
    const handled = () => event.preventDefault();
    const mod = event.metaKey || event.ctrlKey,
      mac = /Mac|iPhone|iPad/.test(navigator.platform);
    if (mod && event.key.toLowerCase() === 'z') {
      this.undo(event.shiftKey);
      return handled();
    }
    if (mod && event.key.toLowerCase() === 'a') {
      this.select(0, this.value.length);
      return handled();
    }
    if (matches('terminal.complete') || (event.key === 'Tab' && !mod && !event.altKey)) {
      if (this.candidates) {
        const n = this.candidates.items.length;
        if (n) {
          this.candidateIndex = (this.candidateIndex + (event.shiftKey ? -1 : 1) + n) % n;
        }
      } else if (!this.completing) {
        void this.complete();
      }
      return handled();
    }
    if (this.candidates && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
      const n = this.candidates.items.length;
      if (n) {
        this.candidateIndex = (this.candidateIndex + (event.key === 'ArrowUp' ? -1 : 1) + n) % n;
      }
      return handled();
    }
    if (event.key === 'Enter' && event.metaKey) {
      return handled();
    }
    if (event.key === 'Enter' && event.shiftKey) {
      this.insert('\n');
      return handled();
    }
    if (matches('terminal.submit') && !event.shiftKey) {
      if (this.candidates) {
        this.accept();
      } else if (!this.completing) {
        if (
          hasOpenQuote(this.value) ||
          (this.head === this.value.length && this.value.endsWith('\\'))
        ) {
          this.insert('\n');
        } else if (!this.busy || this.waiting) {
          this.dispatchEvent(
            new CustomEvent('submit-command', {
              detail: this.value,
              bubbles: true,
              composed: true,
            }),
          );
        }
      }
      return handled();
    }
    if (event.key === 'Escape') {
      if (this.candidates || this.completing) {
        this.closeCompletion();
      } else {
        this.clear();
      }
      return handled();
    }
    if (
      matches('terminal.cancel') &&
      !event.metaKey &&
      (mac || (this.anchor === this.head && !window.getSelection()?.toString()))
    ) {
      this.closeCompletion();
      if (this.busy) {
        this.dispatchEvent(new CustomEvent('cancel-command', { bubbles: true, composed: true }));
      } else {
        this.clear();
      }
      return handled();
    }
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      const left = event.key === 'ArrowLeft',
        lineStart = this.value.lastIndexOf('\n', this.head - 1) + 1;
      const nextLine = this.value.indexOf('\n', this.head),
        lineEnd = nextLine < 0 ? this.value.length : nextLine;
      let next = this.head;
      if (event.key === 'Home') {
        next = lineStart;
      } else if (event.key === 'End') {
        next = lineEnd;
      } else if (mod || event.altKey) {
        next = this.wordPosition(left ? -1 : 1);
      } else if (!event.shiftKey && this.anchor !== this.head) {
        next = left ? Math.min(this.anchor, this.head) : Math.max(this.anchor, this.head);
      } else {
        const boundaries = [
          0,
          ...Array.from(graphemes.segment(this.value), (p) => p.index + p.segment.length),
        ];
        next = left
          ? (boundaries.filter((p) => p < this.head).pop() ?? 0)
          : (boundaries.find((p) => p > this.head) ?? this.value.length);
      }
      this.closeCompletion();
      this.select(event.shiftKey ? this.anchor : next, next);
      return handled();
    }
    if ((mod || event.altKey) && ['Backspace', 'Delete'].includes(event.key)) {
      const next =
        this.anchor !== this.head
          ? this.anchor
          : this.wordPosition(event.key === 'Backspace' ? -1 : 1);
      this.replace(
        Math.max(0, Math.min(next, this.head)),
        Math.min(this.value.length, Math.max(next, this.head)),
        '',
      );
      return handled();
    }
    if (
      !this.busy &&
      !this.waiting &&
      !event.shiftKey &&
      !mod &&
      !event.altKey &&
      ['ArrowUp', 'ArrowDown'].includes(event.key) &&
      !this.value.includes('\n') &&
      this.anchor === this.head
    ) {
      const local = this.store.terminalView(this.terminal),
        entries = this.terminal.history;
      if (!entries.length) {
        return;
      }
      if (local.historyCursor < 0) {
        local.historyDraft = this.value;
        local.historyCursor = entries.length;
      }
      local.historyCursor = Math.max(
        0,
        Math.min(entries.length, local.historyCursor + (event.key === 'ArrowUp' ? -1 : 1)),
      );
      const recalled =
        local.historyCursor === entries.length ? local.historyDraft : entries[local.historyCursor];
      this.replace(0, this.value.length, recalled, true);
      return handled();
    }
  };
  private clear() {
    const local = this.store.terminalView(this.terminal);
    local.historyCursor = -1;
    local.historyDraft = '';
    local.historyLocked = false;
    this.replace(0, this.value.length, '');
  }
  focus() {
    this.input?.focus({ preventScroll: true });
  }
  disconnectedCallback() {
    this.resizeObserver?.disconnect();
    this.closeCompletion();
    super.disconnectedCallback();
  }
}
