import { randomUUID } from 'node:crypto';
import type { ExecutionEvent, OutputEvent } from './protocol.ts';

export type Mode = 'normal' | 'command' | 'global' | 'confirmation';
export interface WindowState {
  id: string;
  kind: 'output' | 'command';
  number?: number;
  lines: string[];
  bytes: number;
  lineOffset: number;
  anchor?: { line: number; offset: number };
  scroll: number;
  history: string[];
  historyCursor: number;
  draft: string;
  historyDraft: string;
  cursor: number;
  selection?: number;
  task?: ExecutionEvent;
}
export interface Confirmation {
  text: string;
  input: string;
  before: Mode;
  accept: () => Promise<void> | void;
  decline?: () => Promise<void> | void;
}
export function sanitizeOutput(text: string) {
  // Keep SGR colors, remove OSC/DCS/other CSI sequences and screen controls.
  return text
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[P^_][\s\S]*?\x1b\\/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, (sequence) =>
      /^\x1b\[[\d;]*m$/.test(sequence) ? sequence : '',
    )
    .replace(/\x1b(?!\[)[@-_]/g, '')
    .replace(/\x1b(?!\[[\d;]*m)/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f\x7f]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}
export class TerminalModel {
  windows: WindowState[] = [];
  activeId = '';
  mode: Mode = 'normal';
  globalDraft = '';
  globalCursor = 0;
  globalSelection?: number;
  confirmation?: Confirmation;
  message = '';
  tabOffset = 0;
  private boundary?: { direction: number; time: number };
  private closedNumbers = new Map<string, number | undefined>();
  constructor() {
    this.windows.push(this.make('output'));
    this.newWindow();
    this.activeId = this.windows[0].id;
  }
  private make(kind: WindowState['kind'], number?: number): WindowState {
    return {
      id: randomUUID(),
      kind,
      number,
      lines: [],
      bytes: 0,
      lineOffset: 0,
      scroll: 0,
      history: [],
      historyCursor: 0,
      draft: '',
      historyDraft: '',
      cursor: 0,
    };
  }
  get active() {
    return this.windows.find((window) => window.id === this.activeId) ?? this.windows[0];
  }
  get output() {
    return this.windows[0];
  }
  byIndex(value: string) {
    if (!/^\d+$/.test(value) || !this.windows[Number(value)]) {
      throw new Error('无效的标签序号');
    }
    return this.windows[Number(value)];
  }
  byId(id: string) {
    return this.windows.find((window) => window.id === id);
  }
  title(window: WindowState) {
    return window.kind === 'output'
      ? '输出'
      : window.task
        ? window.task.command.trim().split(/\s/)[0]
        : `cmd${window.number}`;
  }
  newWindow() {
    if (this.windows.length >= 128) {
      throw new Error('窗口数量达到 128 个上限');
    }
    let number = 1;
    while (this.windows.some((window) => window.number === number)) {
      number++;
    }
    const window = this.make('command', number);
    this.windows.push(window);
    this.switch(window.id);
    return window;
  }
  switch(id: string) {
    const window = this.byId(id);
    if (!window) {
      throw new Error('窗口不存在');
    }
    this.activeId = id;
    this.boundary = undefined;
    if (this.mode === 'command' && window.kind === 'output') {
      this.mode = 'normal';
    }
  }
  tab(direction: number, now = Date.now()) {
    const index = this.windows.indexOf(this.active);
    const next = index + direction;
    if (next >= 0 && next < this.windows.length) {
      this.switch(this.windows[next].id);
      return;
    }
    if (this.boundary?.direction === direction && now - this.boundary.time <= 600) {
      this.switch(direction > 0 ? this.windows[0].id : this.windows[this.windows.length - 1].id);
    } else {
      this.boundary = { direction, time: now };
    }
  }
  clearBoundary() {
    this.boundary = undefined;
  }
  close(id: string) {
    const window = this.byId(id);
    if (!window) {
      return;
    }
    if (window.kind === 'output') {
      throw new Error('输出窗口不能关闭');
    }
    if (window.task) {
      throw new Error('当前窗口仍有任务');
    }
    const index = this.windows.indexOf(window);
    this.closedNumbers.set(id, window.number);
    if (this.closedNumbers.size > 1024) {
      const oldest = this.closedNumbers.keys().next().value;
      if (oldest) {
        this.closedNumbers.delete(oldest);
      }
    }
    this.windows.splice(index, 1);
    this.clearBoundary();
    if (id === this.activeId) {
      this.switch(this.windows[Math.max(0, index - 1)].id);
    }
  }
  append(output: OutputEvent) {
    const target = output.windowId ? this.byId(output.windowId) : undefined;
    const window = target ?? this.output;
    const prefix =
      output.windowId && !target
        ? `[已关闭窗口 ${this.closedNumbers.has(output.windowId) ? `cmd${this.closedNumbers.get(output.windowId)} ` : ''}${output.windowId} / ${output.executionId ?? '-'}] `
        : '';
    const text = sanitizeOutput(prefix + output.text);
    const lines = text.split('\n');
    if (lines[lines.length - 1] === '') {
      lines.pop();
    }
    if (window.scroll > 0) {
      window.scroll += lines.length;
    }
    window.lines.push(...lines);
    window.bytes += lines.reduce((sum, line) => sum + Buffer.byteLength(line), 0);
    let truncated = false;
    while (window.lines.length > 10000 || window.bytes > 10 * 1024 * 1024) {
      const line = window.lines.shift();
      if (line === undefined) {
        break;
      }
      window.bytes -= Buffer.byteLength(line);
      window.lineOffset++;
      truncated = true;
    }
    if (truncated && window.lines[0] !== '[历史输出已截断]') {
      while (
        window.lines.length >= 10000 ||
        window.bytes + Buffer.byteLength('[历史输出已截断]') > 10 * 1024 * 1024
      ) {
        window.bytes -= Buffer.byteLength(window.lines.shift() ?? '');
        window.lineOffset++;
      }
      window.lines.unshift('[历史输出已截断]');
      window.bytes += Buffer.byteLength('[历史输出已截断]');
      window.lineOffset--;
    }
    window.scroll = Math.max(0, Math.min(window.scroll, Math.max(0, window.lines.length - 1)));
  }
  execution(event: ExecutionEvent) {
    const window = this.byId(event.windowId);
    if (!window || window.kind === 'output') {
      return;
    }
    if (['running', 'background', 'cancelling'].includes(event.status)) {
      if (!window.task || window.task.executionId === event.executionId) {
        window.task = event;
      }
    } else {
      if (window.task?.executionId === event.executionId) {
        window.task = undefined;
      }
      this.append({
        windowId: event.windowId,
        executionId: event.executionId,
        text: `[${event.status}] ${event.command}${event.error ? `：${event.error}` : ''}`,
      });
    }
  }
  record(window: WindowState, command: string) {
    if (window.history[window.history.length - 1] !== command) {
      window.history.push(command);
    }
    if (window.history.length > 1000) {
      window.history.shift();
    }
    window.historyCursor = window.history.length;
    window.historyDraft = '';
  }
  history(direction: number) {
    const window = this.active;
    if (window.historyCursor === window.history.length) {
      window.historyDraft = window.draft;
    }
    window.historyCursor = Math.max(
      0,
      Math.min(window.history.length, window.historyCursor + direction),
    );
    window.draft =
      window.historyCursor === window.history.length
        ? window.historyDraft
        : window.history[window.historyCursor];
    window.cursor = window.draft.length;
    window.selection = undefined;
  }
  scroll(amount: number) {
    this.active.scroll = Math.max(
      0,
      Math.min(Math.max(0, this.active.lines.length - 1), this.active.scroll + amount),
    );
  }
  get text() {
    return this.mode === 'global' ? this.globalDraft : this.active.draft;
  }
  get cursor() {
    return this.mode === 'global' ? this.globalCursor : this.active.cursor;
  }
  get selection() {
    return this.mode === 'global' ? this.globalSelection : this.active.selection;
  }
  setInput(text: string, cursor: number, selection?: number) {
    if (this.mode === 'global') {
      this.globalDraft = text;
      this.globalCursor = cursor;
      this.globalSelection = selection;
    } else {
      this.active.draft = text;
      this.active.cursor = cursor;
      this.active.selection = selection;
    }
  }
  edit(insert = '', remove: 'backspace' | 'delete' | undefined = undefined) {
    let start = this.cursor;
    let end = this.cursor;
    if (this.selection !== undefined) {
      start = Math.min(start, this.selection);
      end = Math.max(end, this.selection);
    } else if (remove === 'backspace') {
      start = this.previous(start);
    } else if (remove === 'delete') {
      end = this.next(end);
    }
    this.setInput(this.text.slice(0, start) + insert + this.text.slice(end), start + insert.length);
  }
  private boundaries() {
    return [
      0,
      ...[...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(this.text)].map(
        (item) => item.index + item.segment.length,
      ),
    ];
  }
  private previous(cursor: number) {
    return (
      this.boundaries()
        .filter((index) => index < cursor)
        .at(-1) ?? 0
    );
  }
  private next(cursor: number) {
    return this.boundaries().find((index) => index > cursor) ?? this.text.length;
  }
  move(direction: number, selecting = false) {
    const cursor = direction < 0 ? this.previous(this.cursor) : this.next(this.cursor);
    this.setInput(this.text, cursor, selecting ? (this.selection ?? this.cursor) : undefined);
  }
  ask(text: string, accept: Confirmation['accept'], decline?: Confirmation['decline']) {
    if (this.confirmation) {
      throw new Error('正在等待其他确认');
    }
    this.confirmation = { text, accept, decline, input: '', before: this.mode };
    this.mode = 'confirmation';
  }
  async confirmKey(sequence: string, enter = false) {
    const confirmation = this.confirmation;
    if (!confirmation) {
      return;
    }
    let answer: boolean | undefined;
    if (enter) {
      answer = confirmation.input === ':y';
    } else {
      confirmation.input += sequence;
      if (![':', ':y', ':n'].some((candidate) => candidate.startsWith(confirmation.input))) {
        answer = false;
      }
    }
    if (answer === undefined) {
      return;
    }
    this.confirmation = undefined;
    this.mode = confirmation.before;
    if (answer) {
      await confirmation.accept();
    } else {
      await confirmation.decline?.();
    }
  }
}
