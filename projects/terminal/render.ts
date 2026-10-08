import stringWidth from 'string-width';
import sliceAnsi from 'slice-ansi';
import type { TerminalModel, WindowState } from './model.ts';
import { sanitizeOutput } from './model.ts';

const spinner = [...'⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'];
interface Hit {
  from: number;
  to: number;
  id?: string;
  arrow?: number;
}
interface Row {
  text: string;
  line: number;
  offset: number;
}
export class Renderer {
  width = 80;
  height = 24;
  hits: Hit[] = [];
  private hover?: string;
  private scrollRows: Row[] = [];
  private viewStart = 0;
  private viewHeight = 1;
  private cache = new WeakMap<
    WindowState,
    { width: number; bytes: number; count: number; rows: Row[] }
  >();
  private last = '';
  hoverAt(column: number) {
    this.hover = this.hits.find((hit) => column >= hit.from && column < hit.to)?.id;
  }
  hit(column: number) {
    return this.hits.find((hit) => column >= hit.from && column < hit.to);
  }
  private fit(text: string, width: number) {
    const clipped = sliceAnsi(text, 0, Math.max(0, width));
    return clipped + ' '.repeat(Math.max(0, width - stringWidth(clipped)));
  }
  private title(model: TerminalModel, window: WindowState, tick: number) {
    const title = model.title(window);
    const width = Math.min(18, Math.max(4, this.width - 12));
    let displayed = title;
    if (stringWidth(title) > width) {
      if (window.id === model.activeId || window.id === this.hover) {
        const loop = title + '   ' + title;
        const offset = Math.floor(tick / 3) % (stringWidth(title) + 3);
        displayed = sliceAnsi(loop, offset, offset + width);
      } else {
        displayed = sliceAnsi(title, 0, width - 1) + '…';
      }
    }
    return ` ${displayed}${window.task ? ` ${spinner[tick % spinner.length]} cmd${window.number}` : ''} ${model.windows.indexOf(window)} `;
  }
  private tabs(model: TerminalModel, tick: number) {
    if (this.width < 3) {
      this.hits = [];
      return this.fit(String(model.windows.indexOf(model.active)), this.width);
    }
    const labels = model.windows.map((window) => ({
      id: window.id,
      text: this.title(model, window, tick),
    }));
    const positions: { start: number; end: number }[] = [];
    let total = 0;
    for (const label of labels) {
      const start = total;
      total += stringWidth(label.text) + 1;
      positions.push({ start, end: total });
    }
    const active = positions[model.windows.indexOf(model.active)];
    const usable = Math.max(1, this.width - 2);
    model.tabOffset = Math.max(0, Math.min(model.tabOffset, Math.max(0, total - usable)));
    // Only reposition when a newly selected window would be invisible.
    if (this.lastActive !== model.activeId) {
      model.tabOffset = Math.max(
        0,
        Math.min(active.start, Math.max(model.tabOffset, active.end - usable)),
      );
      this.lastActive = model.activeId;
    }
    const left = model.tabOffset > 0;
    const right = total > model.tabOffset + usable;
    this.hits = [{ from: 0, to: 1, arrow: left ? -1 : undefined }];
    let middle = '';
    for (let index = 0; index < labels.length; index++) {
      const label = labels[index];
      const position = positions[index];
      const start = Math.max(0, model.tabOffset - position.start);
      const end = Math.min(stringWidth(label.text), model.tabOffset + usable - position.start);
      if (end > start) {
        const text = sliceAnsi(label.text, start, end);
        this.hits.push({
          from: 1 + Math.max(0, position.start - model.tabOffset),
          to: 1 + Math.min(usable, position.start + end - model.tabOffset),
          id: label.id,
        });
        middle += label.id === model.activeId ? `\x1b[7m${text}\x1b[0m` : text;
        if (position.end <= model.tabOffset + usable) {
          middle += '│';
        }
      }
    }
    this.hits.push({ from: this.width - 1, to: this.width, arrow: right ? 1 : undefined });
    return (left ? '‹' : ' ') + this.fit(middle, usable) + (right ? '›' : ' ');
  }
  private lastActive = '';
  reveal() {
    this.lastActive = '';
  }
  scrollTabs(model: TerminalModel, direction: number, columns = false) {
    if (columns) {
      model.tabOffset = Math.max(0, model.tabOffset + direction);
      return;
    }
    const starts: number[] = [];
    let position = 0;
    for (const window of model.windows) {
      starts.push(position);
      position += stringWidth(this.title(model, window, 0)) + 1;
    }
    model.tabOffset =
      direction > 0
        ? (starts.find((start) => start > model.tabOffset) ??
          Math.max(0, position - this.width + 2))
        : (starts.filter((start) => start < model.tabOffset).at(-1) ?? 0);
  }
  scroll(model: TerminalModel, amount: number) {
    const maximum = Math.max(0, this.scrollRows.length - this.viewHeight);
    const start = Math.max(0, Math.min(maximum, this.viewStart - amount));
    if (start === maximum) {
      model.active.anchor = undefined;
      model.active.scroll = 0;
    } else {
      const row = this.scrollRows[start];
      if (row) {
        model.active.anchor = { line: row.line, offset: row.offset };
        model.active.scroll = maximum - start;
      }
    }
  }
  frame(model: TerminalModel, tick = Math.floor(Date.now() / 100)): string {
    const window = model.active;
    const cached = this.cache.get(window);
    let rows: Row[];
    if (
      cached &&
      cached.width === this.width &&
      cached.bytes === window.bytes &&
      cached.count === window.lines.length
    ) {
      rows = cached.rows;
    } else {
      rows = [];
      for (let line = 0; line < window.lines.length; line++) {
        const text = window.lines[line];
        const columns = stringWidth(text);
        for (let offset = 0; offset < Math.max(1, columns);) {
          const wrapped = sliceAnsi(text, offset, offset + this.width);
          rows.push({ text: wrapped, line: line + window.lineOffset, offset });
          offset += Math.max(1, stringWidth(wrapped));
        }
      }
      this.cache.set(window, {
        width: this.width,
        bytes: window.bytes,
        count: window.lines.length,
        rows,
      });
    }
    const prompts = model.confirmation
      ? this.wrap(model.confirmation.text + ' :y / :n')
      : window.input
        ? this.wrap(window.input.message + ` [${window.input.type}]`)
        : model.message
          ? this.wrap(model.message)
          : [];
    const promptRows = prompts.slice(0, Math.max(0, this.height - 2));
    this.viewHeight = Math.max(0, this.height - 2 - promptRows.length);
    const maximum = Math.max(0, rows.length - this.viewHeight);
    const anchor = window.anchor;
    this.viewStart = anchor
      ? Math.max(
          0,
          rows.findIndex(
            (row) =>
              row.line >= anchor.line && (row.line > anchor.line || row.offset >= anchor.offset),
          ),
        )
      : Math.max(0, maximum - window.scroll);
    this.viewStart = Math.min(maximum, this.viewStart);
    this.scrollRows = rows;
    const body = rows
      .slice(this.viewStart, this.viewStart + this.viewHeight)
      .map((row) => this.fit(row.text, this.width));
    while (body.length < this.viewHeight) {
      body.push(' '.repeat(this.width));
    }
    const prefix =
      model.mode === 'global' || model.mode === 'confirmation'
        ? ':'
        : model.mode === 'command'
          ? window.input
            ? '? '
            : '> '
          : 'Enter/i 输入 · : 全局命令 · Tab 切换';
    const raw =
      model.mode === 'confirmation'
        ? (model.confirmation?.input ?? '').replace(/^:/, '')
        : model.mode === 'normal'
          ? ''
          : model.text;
    const cursor = model.mode === 'confirmation' ? raw.length : model.cursor;
    const available = Math.max(1, this.width - stringWidth(prefix));
    const offset = Math.max(0, stringWidth(raw.slice(0, cursor)) - available + 1);
    let input = sliceAnsi(raw, offset, offset + available);
    if (model.selection !== undefined && (model.mode === 'global' || model.mode === 'command')) {
      const from = stringWidth(raw.slice(0, Math.min(model.selection, cursor)));
      const to = stringWidth(raw.slice(0, Math.max(model.selection, cursor)));
      input =
        sliceAnsi(raw, offset, Math.max(offset, from)) +
        '\x1b[7m' +
        sliceAnsi(raw, Math.max(offset, from), Math.min(offset + available, to)) +
        '\x1b[0m' +
        sliceAnsi(raw, Math.max(offset, to), offset + available);
    }
    const lines = [
      this.tabs(model, tick),
      ...body,
      ...promptRows.map((line) => this.fit(line, this.width)),
      this.fit(prefix + input, this.width),
    ].slice(0, this.height);
    if (this.height === 1) {
      lines[0] = this.fit(prefix + input, this.width);
    }
    const screen = '\x1b[H' + lines.join('\x1b[0m\r\n') + '\x1b[0m';
    const caret =
      model.mode === 'normal'
        ? '\x1b[?25l'
        : `\x1b[${this.height};${Math.min(this.width, stringWidth(prefix) + stringWidth(raw.slice(0, cursor)) - offset + 1)}H\x1b[?25h`;
    return screen + caret;
  }
  private wrap(text: string): string[] {
    if (text.includes('\n')) {
      return text.split('\n').flatMap((line) => this.wrap(line));
    }
    const clean = sanitizeOutput(text);
    const result: string[] = [];
    for (let offset = 0; offset < Math.max(1, stringWidth(clean)); offset += this.width) {
      result.push(sliceAnsi(clean, offset, offset + this.width));
    }
    return result;
  }
  paint(model: TerminalModel, output: NodeJS.WriteStream) {
    this.width = Math.max(1, output.columns || 80);
    this.height = Math.max(1, output.rows || 24);
    const frame = this.frame(model);
    if (frame !== this.last) {
      output.write(frame);
      this.last = frame;
    }
  }
}
