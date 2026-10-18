import { requireValue } from '../../../shared/workbench-protocol.ts';
import { LitElement, html, css, type PropertyValues } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, insertNewline } from '@codemirror/commands';
import {
  autocompletion,
  acceptCompletion,
  startCompletion,
  completionStatus,
} from '@codemirror/autocomplete';
import type { WorkbenchStore } from '../workbench/store.ts';
import type { Terminal } from '../workbench/types.ts';
import { commands, effectiveKeys, matchesKey } from '../workbench/commands.ts';
@customElement('wb-command-editor')
export class CommandEditor extends LitElement {
  @property({ attribute: false }) accessor store!: WorkbenchStore;
  @property({ attribute: false }) accessor terminal!: Terminal;
  @property({ type: Boolean }) accessor busy = false;
  @property({ type: Boolean }) accessor waiting = false;
  @property() accessor value = '';
  private editor?: EditorView;
  private historyIndex = -1;
  private draft = '';
  private completion?: AbortController;
  static styles = css`
    :host {
      display: block;
      min-height: 60px;
      font-family: var(--font-mono);
    }
    .cm-editor {
      min-height: 60px;
      max-height: 160px;
      background: var(--surface-0);
      font-size: 13px;
    }
    .cm-scroller {
      overflow: auto;
    }
    .cm-content {
      padding: 8px 12px;
    }
    .cm-focused {
      outline: 2px solid var(--accent-primary) !important;
      outline-offset: -2px;
    }
    .cm-cursor {
      border-left-color: var(--accent-primary);
    }
    .cm-selectionBackground {
      background: var(--accent-subtle) !important;
    }
    .cm-tooltip {
      background: var(--surface-elevated) !important;
      border: 1px solid var(--border-default) !important;
      color: var(--text-primary);
    }
    .cm-tooltip-autocomplete > ul > li[aria-selected] {
      background: var(--surface-4) !important;
      color: var(--accent-primary) !important;
    }
  `;
  render() {
    return html`<div id="editor"></div>`;
  }
  firstUpdated() {
    this.editor = new EditorView({
      parent: requireValue(this.renderRoot.querySelector('#editor')),
      state: EditorState.create({
        doc: this.value,
        extensions: [
          history(),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            'aria-label': '命令输入',
            role: 'textbox',
            'aria-multiline': 'true',
          }),
          placeholder('输入核心命令 · Enter 执行 · Shift+Enter 换行'),
          keymap.of([
            { key: 'Shift-Enter', run: insertNewline },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          Prec.highest(
            EditorView.domEventHandlers({ keydown: (event, view) => this.keydown(event, view) }),
          ),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              this.value = update.state.doc.toString();
              this.dispatchEvent(
                new CustomEvent('draft-change', {
                  detail: this.value,
                  bubbles: true,
                  composed: true,
                }),
              );
            }
          }),
          autocompletion({
            override: [
              async (context) => {
                if (!this.terminal || this.busy || this.waiting) {
                  return null;
                }
                this.completion?.abort();
                const controller = (this.completion = new AbortController());
                context.addEventListener('abort', () => controller.abort(), { onDocChange: true });
                try {
                  const result = await this.store.api.request<{
                    from: number;
                    to: number;
                    items: { name: string; insertText: string; description?: string }[];
                  }>(
                    '/commands/complete',
                    {
                      ...this.store.session(),
                      terminalId: this.terminal.id,
                      command: context.state.doc.toString(),
                      cursor: context.pos,
                    },
                    controller.signal,
                  );
                  if (context.aborted || controller.signal.aborted) {
                    return null;
                  }
                  return {
                    from: result.from,
                    to: result.to,
                    options: result.items.map((i) => ({
                      label: i.name,
                      apply: i.insertText,
                      detail: i.description,
                    })),
                  };
                } catch {
                  return null;
                }
              },
            ],
          }),
        ],
      }),
    });
  }
  updated(changed: PropertyValues) {
    if (changed.has('value') && this.editor && this.editor.state.doc.toString() !== this.value) {
      this.editor.dispatch({
        changes: { from: 0, to: this.editor.state.doc.length, insert: this.value },
      });
    }
    if (changed.has('terminal')) {
      this.historyIndex = -1;
      this.completion?.abort();
    }
  }
  private keydown(event: KeyboardEvent, view: EditorView) {
    if (event.isComposing) {
      return false;
    }
    const overrides = this.store.preferences.values.keybindings ?? [];
    const matches = (id: string) => {
      const command = requireValue(commands.find((c) => c.id === id));
      return effectiveKeys(command, overrides).some((key) => matchesKey(key, event));
    };
    if (matches('terminal.submit') && !event.shiftKey) {
      if (completionStatus(view.state) === 'active' && acceptCompletion(view)) {
        event.preventDefault();
        return true;
      }
      event.preventDefault();
      if (!this.busy || this.waiting) {
        this.dispatchEvent(
          new CustomEvent('submit-command', {
            detail: view.state.doc.toString(),
            bubbles: true,
            composed: true,
          }),
        );
      }
      return true;
    }
    if (matches('terminal.complete')) {
      event.preventDefault();
      if (!acceptCompletion(view)) {
        startCompletion(view);
      }
      return true;
    }
    if (
      matches('terminal.cancel') &&
      !event.metaKey &&
      view.state.selection.main.empty &&
      !window.getSelection()?.toString()
    ) {
      if (this.busy) {
        event.preventDefault();
        this.dispatchEvent(new CustomEvent('cancel-command', { bubbles: true, composed: true }));
        return true;
      }
    }
    if (
      !this.busy &&
      (event.key === 'ArrowUp' || event.key === 'ArrowDown') &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !completionStatus(view.state)
    ) {
      const selection = view.state.selection.main,
        line = view.state.doc.lineAt(selection.head),
        isUp = event.key === 'ArrowUp';
      if (!selection.empty || (isUp ? line.number !== 1 : line.number !== view.state.doc.lines)) {
        return false;
      }
      const entries = this.terminal?.history ?? [];
      if (!entries.length) {
        return false;
      }
      if (this.historyIndex < 0) {
        this.draft = view.state.doc.toString();
        this.historyIndex = entries.length;
      }
      this.historyIndex = Math.min(
        entries.length,
        Math.max(0, this.historyIndex + (isUp ? -1 : 1)),
      );
      const text = this.historyIndex === entries.length ? this.draft : entries[this.historyIndex];
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: text.length },
      });
      event.preventDefault();
      return true;
    }
    return false;
  }
  focus() {
    this.editor?.focus();
  }
  disconnectedCallback() {
    this.completion?.abort();
    this.editor?.destroy();
    this.editor = undefined;
    super.disconnectedCallback();
  }
}
