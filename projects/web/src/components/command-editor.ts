import { requireValue } from '../../../shared/workbench-protocol.ts';
import { LitElement, html, css, nothing, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, insertNewline } from '@codemirror/commands';
import type { WorkbenchStore } from '../workbench/store.ts';
import type { Terminal } from '../workbench/types.ts';
import { commands, effectiveKeys, matchesKey } from '../workbench/commands.ts';

type Completion = {
  from: number;
  to: number;
  items: { name: string; insertText: string; description?: string }[];
};

@customElement('wb-command-editor')
export class CommandEditor extends LitElement {
  @property({ attribute: false }) accessor store!: WorkbenchStore;
  @property({ attribute: false }) accessor terminal!: Terminal;
  @property({ type: Boolean }) accessor busy = false;
  @property({ type: Boolean }) accessor waiting = false;
  @property() accessor value = '';
  @state() private accessor candidates: Completion | null = null;
  @state() private accessor candidateIndex = 0;
  @state() private accessor completing = false;
  private position = { line: 1, column: 1, lines: 1 };
  private editor?: EditorView;
  private completion?: AbortController;
  private lastTab = 0;
  private applying = false;
  private terminalId = '';
  // Undo stacks belong to a terminal, never to the previously selected terminal.
  private states = new Map<string, EditorState>();
  static styles = css`
    :host {
      display: block;
      min-height: 0;
      font-family: var(--font-mono);
    }
    .terminal-input-prompt-line {
      display: flex;
      align-items: flex-start;
      background: var(--surface-0);
    }
    .terminal-input-prompt {
      padding: 0 var(--space-2) 0 0;
      color: var(--accent-primary);
      font-weight: var(--font-semibold);
      line-height: var(--leading-relaxed);
      font-size: 1rem;
      user-select: none;
    }
    .terminal-input-editor {
      flex: 1;
      min-width: 0;
    }
    .cm-editor .cm-line {
      padding: 0 !important;
    }
    .cm-editor {
      min-height: 1lh;
      max-height: 50vh;
      background: var(--surface-0);
      color: var(--text-primary);
      font-size: 1rem;
    }
    .cm-scroller {
      overflow: auto;
      font-family: var(--font-mono);
      line-height: var(--leading-relaxed);
    }
    .cm-editor .cm-content {
      padding: 0 !important;
      caret-color: transparent;
    }
    .cm-focused {
      outline: none !important;
    }
    .cm-cursor {
      display: block !important;
      width: 1ch !important;
      border: 1px solid var(--terminal-cursor) !important;
      box-sizing: border-box;
      background: transparent;
      margin-left: 0 !important;
    }
    .cm-focused .cm-cursor {
      background: var(--terminal-cursor);
    }
    .cm-cursorLayer {
      animation: none !important;
      opacity: 1 !important;
    }
    .cm-selectionBackground {
      background: var(--accent-subtle) !important;
    }
    .completion-container {
      position: relative;
    }
    .terminal-completion-list {
      position: fixed;
      z-index: 5;
      max-height: 200px;
      overflow: auto;
      margin: 0;
      padding: var(--space-1);
      background: var(--surface-1);
      border: 1px solid var(--border-default);
      border-radius: 4px;
      box-shadow: var(--shadow-menu);
    }
    .terminal-completion-item {
      display: flex;
      gap: var(--space-3);
      padding: var(--space-1) var(--space-2);
      color: var(--text-primary);
      font-size: 1rem;
      cursor: pointer;
    }
    .terminal-completion-item[data-selected='true'] {
      background: var(--surface-3);
      color: var(--accent-primary);
    }
    .terminal-completion-item small {
      color: var(--text-secondary);
      font: inherit;
      overflow-wrap: anywhere;
    }
  `;
  render() {
    return html`<div class="completion-container">
        ${this.candidates
          ? html`<div
              class="terminal-completion-list"
              id="completions"
              role="listbox"
              aria-label="命令补全"
            >
              ${this.candidates.items.length
                ? this.candidates.items.map(
                    (item, i) => html`<div
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
                : html`<div class="terminal-completion-item">没有匹配的命令候选</div>`}
            </div>`
          : nothing}
      </div>
      <div class="terminal-input-prompt-line">
        <span class="terminal-input-prompt" aria-hidden="true">&gt;</span>
        <div id="editor" class="terminal-input-editor"></div>
      </div> `;
  }
  private extensions() {
    return [
      history(),
      drawSelection({ cursorBlinkRate: 0, drawRangeCursor: false }),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({
        'aria-label': '命令输入',
        role: 'textbox',
        'aria-multiline': 'true',
      }),
      keymap.of([{ key: 'Shift-Enter', run: insertNewline }, ...defaultKeymap, ...historyKeymap]),
      Prec.highest(
        EditorView.domEventHandlers({
          keydown: (e, view) => this.keydown(e, view),
          blur: () => {
            this.closeCompletion();
            return false;
          },
        }),
      ),
      EditorView.updateListener.of((update) => {
        if (this.applying) {
          return;
        }
        const selection = update.state.selection.main;
        const local = this.store.terminalView(this.terminal);
        local.selectionAnchor = selection.anchor;
        local.selectionHead = selection.head;
        if (update.docChanged) {
          this.closeCompletion();
          this.lastTab = 0;
          this.value = update.state.doc.toString();
          local.draft = this.value;
          if (local.historyCursor >= 0 && local.historyCursor < this.terminal.history.length) {
            local.historyLocked = this.value.includes('\n');
          } else {
            local.historyCursor = -1;
          }
          this.dispatchEvent(
            new CustomEvent('draft-change', { detail: this.value, bubbles: true, composed: true }),
          );
        } else if (update.selectionSet) {
          this.closeCompletion();
        }
        this.updatePosition();
      }),
    ];
  }
  firstUpdated() {
    this.editor = new EditorView({
      parent: requireValue(this.renderRoot.querySelector('#editor')),
      state: this.newState(),
    });
    this.terminalId = this.terminal.id;
    this.updatePosition();
  }
  private newState() {
    const local = this.store.terminalView(this.terminal);
    return EditorState.create({
      doc: this.value,
      selection: {
        anchor: Math.min(this.value.length, local.selectionAnchor),
        head: Math.min(this.value.length, local.selectionHead),
      },
      extensions: this.extensions(),
    });
  }
  updated(changed: PropertyValues) {
    if (!this.editor) {
      return;
    }
    if (this.terminalId !== this.terminal.id) {
      this.states.set(this.terminalId, this.editor.state);
      this.terminalId = this.terminal.id;
      this.closeCompletion();
      const saved = this.states.get(this.terminal.id);
      this.editor.setState(saved?.doc.toString() === this.value ? saved : this.newState());
      this.updatePosition();
    } else if (changed.has('value') && this.editor.state.doc.toString() !== this.value) {
      this.applying = true;
      this.editor.dispatch({
        changes: { from: 0, to: this.editor.state.doc.length, insert: this.value },
        selection: { anchor: this.value.length },
      });
      this.applying = false;
      this.closeCompletion();
      this.updatePosition();
    }
    if ((this.busy || this.waiting) && this.completion) {
      this.closeCompletion();
    }
    const content = this.editor.contentDOM;
    const list = this.renderRoot.querySelector<HTMLElement>('.terminal-completion-list');
    if (list) {
      const rect = this.getBoundingClientRect();
      const viewport = this.closest('.terminal-output')?.getBoundingClientRect();
      const above = rect.top - (viewport?.top ?? 0);
      const below = (viewport?.bottom ?? window.innerHeight) - rect.bottom;
      const height = Math.min(200, list.scrollHeight, Math.max(above, below));
      list.style.left = `${rect.left}px`;
      list.style.width = `${rect.width}px`;
      list.style.maxHeight = `${height}px`;
      list.style.top = `${above >= height ? rect.top - height : rect.bottom}px`;
    }
    content.setAttribute('aria-expanded', String(Boolean(this.candidates)));
    if (this.candidates?.items.length) {
      content.setAttribute('aria-controls', 'completions');
      content.setAttribute('aria-activedescendant', `completion-${this.candidateIndex}`);
      this.renderRoot
        .querySelector<HTMLElement>('[data-selected="true"]')
        ?.scrollIntoView?.({ block: 'nearest' });
    } else {
      content.removeAttribute('aria-activedescendant');
      content.removeAttribute('aria-controls');
    }
  }
  private updatePosition() {
    if (!this.editor) {
      return;
    }
    const doc = this.editor.state.doc,
      cursor = this.editor.state.selection.main.head,
      line = doc.lineAt(cursor);
    const position = { line: line.number, column: cursor - line.from + 1, lines: doc.lines };
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
  private async complete(all: boolean) {
    if (!this.editor || this.busy || this.waiting) {
      return;
    }
    this.closeCompletion();
    const view = this.editor,
      original = view.state.doc.toString(),
      cursor = view.state.selection.main.head;
    let from = cursor;
    while (from > 0 && !/\s/.test(original[from - 1])) {
      from--;
    }
    const equals = original.indexOf('=', from);
    if (original[from] === '-' && equals >= from && equals < cursor) {
      from = equals + 1;
    }
    // An empty prefix asks the existing provider for every candidate at this position.
    const command = all ? original.slice(0, from) + original.slice(cursor) : original;
    const controller = (this.completion = new AbortController());
    this.completing = true;
    try {
      const result = await this.store.api.request<Completion & { command?: string }>(
        '/commands/complete',
        {
          ...this.store.session(),
          terminalId: this.terminal.id,
          command,
          cursor: all ? from : cursor,
        },
        controller.signal,
      );
      if (
        controller.signal.aborted ||
        this.completion !== controller ||
        view.state.doc.toString() !== original
      ) {
        return;
      }
      if (result.command !== undefined && result.command !== command) {
        return;
      }
      const prefix = original.slice(result.from, cursor);
      this.candidates = {
        ...result,
        items: result.items.filter((item) => all || item.name.startsWith(prefix)),
        to: result.to + (all ? cursor - from : 0),
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
      item = result?.items[index],
      view = this.editor;
    if (!result || !item || !view) {
      return false;
    }
    const from = Math.max(0, Math.min(result.from, view.state.doc.length));
    const to = Math.max(from, Math.min(result.to, view.state.doc.length));
    view.dispatch({
      changes: { from, to, insert: item.insertText },
      selection: { anchor: from + item.insertText.length },
    });
    this.closeCompletion();
    view.focus();
    return true;
  }
  private keydown(event: KeyboardEvent, view: EditorView) {
    if (event.isComposing) {
      return false;
    }
    const overrides = this.store.preferences.values.keybindings ?? [];
    const matches = (id: string) =>
      effectiveKeys(requireValue(commands.find((c) => c.id === id)), overrides).some((key) =>
        matchesKey(key, event),
      );
    const handled = () => {
      event.preventDefault();
      return true;
    };
    if (matches('terminal.complete') && !event.shiftKey) {
      const now = performance.now(),
        all = this.lastTab > 0 && now - this.lastTab < 600;
      this.lastTab = now;
      void this.complete(all);
      return handled();
    }
    this.lastTab = 0;
    if (this.candidates && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
      const count = this.candidates.items.length;
      if (count) {
        this.candidateIndex =
          (this.candidateIndex + (event.key === 'ArrowUp' ? -1 : 1) + count) % count;
      }
      return handled();
    }
    if (matches('terminal.submit') && !event.shiftKey) {
      if (this.candidates) {
        this.accept();
        return handled();
      }
      if (this.completing) {
        return handled();
      }
      if (!this.busy || this.waiting) {
        this.dispatchEvent(
          new CustomEvent('submit-command', {
            detail: view.state.doc.toString(),
            bubbles: true,
            composed: true,
          }),
        );
      }
      return handled();
    }
    if (event.key === 'Escape') {
      if (this.candidates || this.completing) {
        this.closeCompletion();
      } else {
        this.clear(view);
      }
      return handled();
    }
    if (
      matches('terminal.cancel') &&
      !event.metaKey &&
      view.state.selection.main.empty &&
      !window.getSelection()?.toString()
    ) {
      this.closeCompletion();
      if (this.busy) {
        this.dispatchEvent(new CustomEvent('cancel-command', { bubbles: true, composed: true }));
      } else {
        this.clear(view);
      }
      return handled();
    }
    if (
      !this.busy &&
      !this.waiting &&
      ['ArrowUp', 'ArrowDown'].includes(event.key) &&
      !event.shiftKey &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      const local = this.store.terminalView(this.terminal),
        entries = this.terminal.history,
        selection = view.state.selection.main;
      const text = view.state.doc.toString(),
        line = view.state.doc.lineAt(selection.head),
        up = event.key === 'ArrowUp';
      if (
        !entries.length ||
        !selection.empty ||
        local.historyLocked ||
        (text.includes('\n') && (up ? line.number !== 1 : line.number !== view.state.doc.lines))
      ) {
        return false;
      }
      if (local.historyCursor < 0) {
        local.historyDraft = text;
        local.historyCursor = entries.length;
      }
      local.historyCursor = Math.max(
        0,
        Math.min(entries.length, local.historyCursor + (up ? -1 : 1)),
      );
      const recalled =
        local.historyCursor === entries.length ? local.historyDraft : entries[local.historyCursor];
      this.applying = true;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: recalled },
        selection: {
          anchor: up && recalled.includes('\n') ? recalled.indexOf('\n') : recalled.length,
        },
      });
      this.applying = false;
      this.value = local.draft = recalled;
      local.selectionAnchor = local.selectionHead = view.state.selection.main.head;
      this.updatePosition();
      this.dispatchEvent(
        new CustomEvent('draft-change', { detail: recalled, bubbles: true, composed: true }),
      );
      return handled();
    }
    return false;
  }
  private clear(view: EditorView) {
    const local = this.store.terminalView(this.terminal);
    local.historyCursor = -1;
    local.historyDraft = '';
    local.historyLocked = false;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '' } });
  }
  focus() {
    this.editor?.focus();
  }
  disconnectedCallback() {
    this.closeCompletion();
    this.editor?.destroy();
    this.editor = undefined;
    super.disconnectedCallback();
  }
}
