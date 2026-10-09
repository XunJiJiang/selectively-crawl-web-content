import { randomUUID } from 'node:crypto';
import type { ExecutionEvent, OutputEvent, CommandInfo } from './protocol.ts';
import type {
  InputConstructor,
  InputFailure,
  InputRequest,
  InputResult,
  InputValue,
  InputFormat,
} from '../server/types/task.d.ts';
import { InvocationInputError, formatInput, inputFormat } from '../server/common/interaction.ts';
import { globalCommands, type GlobalCommandInfo } from './global.ts';
import type { PluginPreferences } from './plugin/types.d.ts';

export type Mode = 'normal' | 'global' | 'global-output' | 'confirmation';
export interface WindowState {
  id: string;
  kind: 'output' | 'command';
  number?: number;
  title?: string;
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
  input?: InputRequest & {
    draft: string;
    cursor: number;
    selection?: number;
    answer(value?: string, error?: InputFailure): Promise<void>;
  };
}
export interface PanelInput {
  text: string;
  type: InputFormat;
  draft: string;
  cursor: number;
  selection?: number;
  fixedPrefix?: string;
  reply(value?: string, error?: InvocationInputError): void;
}
export interface CommandPanel {
  command: string;
  lines: string[];
  bytes: number;
  lineOffset: number;
  scroll: number;
  running: boolean;
  input?: PanelInput;
  step: PromiseWithResolvers<void>;
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
  globalHistory: string[] = [];
  globalHistoryCursor = 0;
  globalHistoryDraft = '';
  globalExtensions: GlobalCommandInfo[] = [];
  commands: CommandInfo[] = [];
  pluginPreferences: PluginPreferences = {};
  completionIndex = 0;
  completionPreview = false;
  panel?: CommandPanel;
  transparentBackground = true;
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
  get confirmation() {
    return this.panel?.input;
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
      : (window.title ??
          (window.task ? window.task.command.trim().split(/\s/)[0] : `cmd${window.number}`));
  }
  rename(window: WindowState, title: string) {
    if (window.kind === 'output') {
      throw new Error('输出标签不能重命名');
    }
    const clean = sanitizeOutput(title)
      .replace(/\x1b\[[\d;]*m/g, '')
      .replace(/\n/g, ' ')
      .trim();
    if (!clean || clean.length > 256) {
      throw new Error('标签名称须为 1 至 256 个字符');
    }
    window.title = clean;
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
    this.completionPreview = false;
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
        window.input = undefined;
      }
      if (event.status !== 'succeeded') {
        this.append({
          windowId: event.windowId,
          executionId: event.executionId,
          text: `[${event.status}] ${event.command}${event.error ? `：${event.error}` : ''}`,
        });
      }
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
    this.completionPreview = false;
    if (this.mode === 'global') {
      if (this.globalHistoryCursor === this.globalHistory.length) {
        this.globalHistoryDraft = this.globalDraft;
      }
      this.globalHistoryCursor = Math.max(
        0,
        Math.min(this.globalHistory.length, this.globalHistoryCursor + direction),
      );
      this.globalDraft =
        this.globalHistoryCursor === this.globalHistory.length
          ? this.globalHistoryDraft
          : this.globalHistory[this.globalHistoryCursor];
      this.globalCursor = this.globalDraft.length;
      this.globalSelection = undefined;
      return;
    }
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
  recordGlobal(command: string) {
    if (command && this.globalHistory.at(-1) !== command) {
      this.globalHistory.push(command);
      this.globalHistory = this.globalHistory.slice(-1000);
    }
    this.globalHistoryCursor = this.globalHistory.length;
    this.globalHistoryDraft = '';
  }
  get editing() {
    return (
      this.mode === 'global' ||
      Boolean(this.panel?.input) ||
      (this.mode === 'normal' && (this.active.kind === 'command' || Boolean(this.active.input)))
    );
  }
  enterGlobal() {
    this.mode = 'global';
    this.completionPreview = false;
    this.completionIndex = 0;
  }
  scroll(amount: number) {
    this.active.scroll = Math.max(
      0,
      Math.min(Math.max(0, this.active.lines.length - 1), this.active.scroll + amount),
    );
  }
  get text() {
    return this.panel?.input
      ? this.panel.input.draft
      : this.mode === 'global'
        ? this.globalDraft
        : (this.active.input?.draft ?? this.active.draft);
  }
  get cursor() {
    return this.panel?.input
      ? this.panel.input.cursor
      : this.mode === 'global'
        ? this.globalCursor
        : (this.active.input?.cursor ?? this.active.cursor);
  }
  get selection() {
    return this.panel?.input
      ? this.panel.input.selection
      : this.mode === 'global'
        ? this.globalSelection
        : this.active.input
          ? this.active.input.selection
          : this.active.selection;
  }
  setInput(text: string, cursor: number, selection?: number) {
    if (text !== this.text) {
      this.completionPreview = false;
      this.completionIndex = 0;
    }
    if (this.panel?.input) {
      const prefix = this.panel.input.fixedPrefix ?? '';
      if (!text.startsWith(prefix)) {
        text = prefix + text;
      }
      cursor = Math.max(prefix.length, Math.min(text.length, cursor));
      if (selection !== undefined) {
        selection = Math.max(prefix.length, Math.min(text.length, selection));
      }
      this.panel.input.draft = text;
      this.panel.input.cursor = cursor;
      this.panel.input.selection = selection;
    } else if (this.mode === 'global') {
      if (text !== this.globalDraft) {
        this.completionPreview = false;
        this.completionIndex = 0;
      }
      this.globalDraft = text;
      this.globalCursor = cursor;
      this.globalSelection = selection;
    } else if (this.active.input) {
      this.active.input.draft = text;
      this.active.input.cursor = cursor;
      this.active.input.selection = selection;
    } else {
      this.active.draft = text;
      this.active.cursor = cursor;
      this.active.selection = selection;
    }
  }
  edit(insert = '', remove: 'backspace' | 'delete' | undefined = undefined) {
    const prefix = this.panel?.input?.fixedPrefix ?? '';
    if (prefix && this.text === prefix && insert.startsWith(prefix)) {
      insert = insert.slice(prefix.length);
    }
    let start = this.cursor;
    let end = this.cursor;
    if (this.selection !== undefined) {
      start = Math.min(start, this.selection);
      end = Math.max(end, this.selection);
    } else if (remove === 'backspace') {
      start = this.previous(start);
    } else if (remove === 'delete') {
      end = this.nextBoundary(end);
    }
    start = Math.max(prefix.length, start);
    end = Math.max(prefix.length, end);
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
  private nextBoundary(cursor: number) {
    return this.boundaries().find((index) => index > cursor) ?? this.text.length;
  }
  move(direction: number, selecting = false, unit: 'grapheme' | 'word' | 'edge' = 'grapheme') {
    this.completionPreview = false;
    let cursor = this.cursor;
    if (!selecting && this.selection !== undefined && unit === 'grapheme') {
      cursor = direction < 0 ? Math.min(cursor, this.selection) : Math.max(cursor, this.selection);
    } else if (unit === 'edge') {
      cursor = direction < 0 ? 0 : this.text.length;
    } else if (unit === 'word') {
      if (direction < 0) {
        while (cursor > 0 && /\s/.test(this.text[cursor - 1])) {
          cursor--;
        }
        while (cursor > 0 && !/\s/.test(this.text[cursor - 1])) {
          cursor--;
        }
      } else {
        while (cursor < this.text.length && !/\s/.test(this.text[cursor])) {
          cursor++;
        }
        while (cursor < this.text.length && /\s/.test(this.text[cursor])) {
          cursor++;
        }
      }
    } else {
      cursor = direction < 0 ? this.previous(cursor) : this.nextBoundary(cursor);
    }
    this.setInput(this.text, cursor, selecting ? (this.selection ?? this.cursor) : undefined);
  }
  get globalCommands(): GlobalCommandInfo[] {
    return [...globalCommands, ...this.globalExtensions];
  }
  get globalCandidates() {
    return /\s/.test(this.globalDraft)
      ? []
      : this.globalCommands.filter((command) => command.name.startsWith(this.globalDraft));
  }
  get globalHint() {
    const name = this.globalDraft.split(/\s/)[0];
    return this.globalCommands.find(
      (command) => command.name === name || command.aliases?.includes(name),
    );
  }
  get candidates() {
    return this.mode === 'global'
      ? this.globalCandidates
      : this.mode === 'normal' &&
          this.active.kind === 'command' &&
          !this.active.input &&
          this.text &&
          !/\s/.test(this.text)
        ? this.commands.filter((command) => command.name.startsWith(this.text))
        : [];
  }
  get displayText() {
    return this.completionPreview
      ? (this.candidates[this.completionIndex]?.name ?? this.text)
      : this.text;
  }
  completeGlobal(direction: number) {
    const count = this.candidates.length;
    if (!count) {
      return;
    }
    this.completionIndex = this.completionPreview
      ? (this.completionIndex + direction + count) % count
      : direction < 0
        ? count - 1
        : 0;
    this.completionPreview = true;
  }
  commitGlobalCompletion() {
    if (this.completionPreview) {
      this.setInput(this.displayText, this.displayText.length);
      this.completionPreview = false;
    }
  }
  beginPanel(command: string) {
    const previous = this.panel;
    this.panel = {
      command,
      lines: previous?.lines ?? [],
      bytes: previous?.bytes ?? 0,
      lineOffset: previous?.lineOffset ?? 0,
      scroll: 0,
      running: true,
      step: Promise.withResolvers<void>(),
    };
    this.mode = 'global-output';
    this.completionPreview = false;
    return this.panel;
  }
  writePanel(text: string) {
    const panel = this.panel;
    if (!panel) {
      return;
    }
    const lines = sanitizeOutput(text).split('\n');
    if (lines.at(-1) === '') {
      lines.pop();
    }
    panel.lines.push(...lines);
    panel.bytes += lines.reduce((sum, line) => sum + Buffer.byteLength(line), 0);
    while (panel.lines.length > 10000 || panel.bytes > 10 * 1024 * 1024) {
      panel.bytes -= Buffer.byteLength(panel.lines.shift() ?? '');
      panel.lineOffset++;
    }
    panel.scroll = 0;
  }
  finishPanel(panel: CommandPanel) {
    panel.running = false;
    panel.step.resolve();
    if (this.panel !== panel) {
      return;
    }
    this.globalDraft = '';
    this.globalCursor = 0;
    this.globalSelection = undefined;
    if (panel.lines.length) {
      this.mode = 'global-output';
    } else {
      this.panel = undefined;
      this.mode = 'normal';
    }
  }
  cancelPanelInput(code: 'cancelled' | 'closed' = 'cancelled') {
    this.panel?.input?.reply(undefined, new InvocationInputError(code, '输入已取消'));
  }
  next(message: string): Promise<InputResult<string>>;
  next<T extends InputConstructor>(message: string, type: T): Promise<InputResult<InputValue<T>>>;
  next(
    message: string,
    type: InputConstructor = String,
  ): Promise<InputResult<string | number | boolean | bigint | Date>> {
    return this.readPanelInput(message, type);
  }
  nextChoice(message: string): Promise<InputResult<string>> {
    return this.readPanelInput(message, String, ':') as Promise<InputResult<string>>;
  }
  private async readPanelInput(
    message: string,
    type: InputConstructor,
    fixedPrefix = '',
  ): Promise<InputResult<string | number | boolean | bigint | Date>> {
    const panel = this.panel;
    if (!panel) {
      return [new InvocationInputError('unavailable', '没有正在执行的全局命令'), undefined];
    }
    if (panel.input) {
      return [new InvocationInputError('busy', '正在等待其他输入'), undefined];
    }
    try {
      const format = inputFormat(type);
      let prompt = message;
      for (;;) {
        const answer = await new Promise<string>((resolve, reject) => {
          panel.input = {
            text: prompt,
            type: format,
            draft: fixedPrefix,
            cursor: fixedPrefix.length,
            fixedPrefix,
            reply: (value, error) => {
              panel.input = undefined;
              this.mode = 'global-output';
              if (error) {
                reject(error);
              } else {
                const text = value ?? '';
                resolve(text.startsWith(fixedPrefix) ? text : fixedPrefix + text);
              }
            },
          };
          this.mode = 'confirmation';
          panel.scroll = 0;
          panel.step.resolve();
        });
        try {
          return [undefined, formatInput(answer, format)];
        } catch (error) {
          prompt = `${error instanceof Error ? error.message : error}\n${message}`;
        }
      }
    } catch (error) {
      return [
        error instanceof InvocationInputError
          ? error
          : new InvocationInputError('unavailable', String(error)),
        undefined,
      ];
    }
  }
}
