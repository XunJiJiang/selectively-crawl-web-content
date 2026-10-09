import stringWidth from 'string-width';
import sliceAnsi from 'slice-ansi';
import type { TerminalModel, WindowState } from './model.ts';
import { sanitizeOutput } from './model.ts';

const spinner = [...'⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'];
const colors = {
  text: '226;232;240',
  muted: '148;163;184',
  border: '71;85;105',
  accent: '103;232;249',
  background: '15;23;42',
  panel: '30;41;59',
  selected: '51;65;85',
  normal: '30;58;95',
  command: '20;83;65',
  global: '76;29;149',
  confirmation: '120;53;15',
};
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
  private panelFrom = Infinity;
  private panelHeight = 0;
  private panelRowCount = 0;
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
  private style(text: string, foreground: string, background?: string) {
    const base = `\x1b[38;2;${foreground}m${background ? `\x1b[48;2;${background}m` : '\x1b[49m'}`;
    return base + text.replace(/\x1b\[(?:0|39|49)?m/g, base) + '\x1b[0m';
  }
  private title(model: TerminalModel, window: WindowState, tick: number) {
    const title = model.title(window);
    const tabWidth = Math.min(26, Math.max(3, this.width - 2));
    const lead = ` ${model.windows.indexOf(window)} ${window.task ? spinner[tick % spinner.length] : window.id === model.activeId ? '●' : '○'} `;
    const width = Math.max(1, tabWidth - stringWidth(lead) - 3);
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
    const edge = window.id === model.activeId ? '┃' : '│';
    return edge + this.fit(lead + displayed, tabWidth - 2) + edge;
  }
  private tabs(model: TerminalModel, tick: number) {
    if (this.width < 3) {
      this.hits = [];
      return this.style(
        this.fit(String(model.windows.indexOf(model.active)), this.width),
        colors.text,
        colors.background,
      );
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
        middle += this.style(
          text,
          label.id === model.activeId ? colors.accent : colors.muted,
          label.id === model.activeId ? colors.selected : colors.background,
        );
        if (position.end <= model.tabOffset + usable) {
          middle += ' ';
        }
      }
    }
    this.hits.push({ from: this.width - 1, to: this.width, arrow: right ? 1 : undefined });
    return this.style(
      (left ? '‹' : ' ') + this.fit(middle, usable) + (right ? '›' : ' '),
      colors.muted,
      colors.background,
    );
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
  panelAt(row: number) {
    return row >= this.panelFrom && row < this.panelFrom + this.panelHeight;
  }
  scrollPanel(model: TerminalModel, amount: number) {
    if (model.panel) {
      model.panel.scroll = Math.max(
        0,
        Math.min(
          Math.max(0, this.panelRowCount - Math.max(0, this.panelHeight - 1)),
          model.panel.scroll + amount,
        ),
      );
    }
  }
  private panel(model: TerminalModel) {
    this.panelHeight = 0;
    this.panelFrom = Infinity;
    this.panelRowCount = 0;
    let heading: string;
    let content: string[];
    if (model.mode === 'global') {
      const candidates = model.globalCandidates;
      heading = ' 命令候选 · Tab / Shift+Tab · [] 必填 <> 选填';
      content = candidates.length
        ? candidates.map((command, index) =>
            this.style(
              this.fit(
                ` ${index === model.completionIndex ? '›' : ' '} :${command.name}  ${command.description}`,
                this.width,
              ),
              index === model.completionIndex ? colors.accent : colors.text,
              index === model.completionIndex ? colors.selected : colors.panel,
            ),
          )
        : this.wrap(
            model.globalHint
              ? `:${model.globalHint.usage}\n${model.globalHint.description}\n[] 必填 · <> 选填 · 含空格的参数请加引号`
              : '没有匹配的全局命令',
          );
    } else if (model.panel) {
      heading = ` :${model.panel.command} · ${model.panel.input ? '等待输入' : model.panel.running ? '执行中' : '↑/↓ 滚动 · Esc 关闭'}`;
      content = model.panel.lines.flatMap((line) => this.wrap(line));
      if (model.panel.input) {
        content.push(...this.wrap(model.panel.input.text));
      }
    } else {
      return [];
    }
    const maximum = Math.max(0, Math.min(Math.floor(this.height / 2), this.height - 2));
    this.panelHeight = Math.min(maximum, Math.max(5, content.length + 1));
    this.panelFrom = this.height - 1 - this.panelHeight;
    this.panelRowCount = content.length;
    if (!this.panelHeight) {
      return [];
    }
    const visible = this.panelHeight - 1;
    let start = 0;
    if (model.mode === 'global' && model.globalCandidates.length) {
      start = Math.max(0, model.completionIndex - visible + 1);
    } else if (model.panel) {
      model.panel.scroll = Math.min(model.panel.scroll, Math.max(0, content.length - visible));
      start = Math.max(0, content.length - visible - model.panel.scroll);
    }
    const rows = content.slice(start, start + visible);
    while (rows.length < visible) {
      rows.push('');
    }
    return [
      this.style(this.fit(heading, this.width), colors.accent, colors.selected),
      ...rows.map((row) => this.style(this.fit(row, this.width), colors.text, colors.panel)),
    ];
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
    const prompts =
      model.panel || model.mode === 'global'
        ? []
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
      .map((row) =>
        this.style(
          this.fit(row.text, this.width),
          colors.text,
          model.transparentBackground ? undefined : colors.background,
        ),
      );
    while (body.length < this.viewHeight) {
      body.push(
        this.style(
          ' '.repeat(this.width),
          colors.text,
          model.transparentBackground ? undefined : colors.background,
        ),
      );
    }
    const prefix =
      model.mode === 'global'
        ? ' GLOBAL  :'
        : model.mode === 'confirmation'
          ? ' INPUT  '
          : model.mode === 'global-output'
            ? ` GLOBAL  ${model.panel?.running ? '执行中' : '↑/↓ 滚动 · Esc 关闭'}`
            : model.mode === 'command'
              ? window.input
                ? ' COMMAND  ? '
                : ' COMMAND  > '
              : ' NORMAL  Enter/i 输入 · : 全局命令 · Tab 切换 · Esc 底部';
    const raw = model.mode === 'normal' || model.mode === 'global-output' ? '' : model.displayText;
    const cursor = model.mode === 'global' && model.completionPreview ? raw.length : model.cursor;
    const available = Math.max(1, this.width - stringWidth(prefix));
    const offset = Math.max(0, stringWidth(raw.slice(0, cursor)) - available + 1);
    let input = sliceAnsi(raw, offset, offset + available);
    if (model.selection !== undefined && !model.completionPreview) {
      const from = stringWidth(raw.slice(0, Math.min(model.selection, cursor)));
      const to = stringWidth(raw.slice(0, Math.max(model.selection, cursor)));
      input =
        sliceAnsi(raw, offset, Math.max(offset, from)) +
        this.style(
          sliceAnsi(raw, Math.max(offset, from), Math.min(offset + available, to)),
          colors.background,
          colors.accent,
        ) +
        sliceAnsi(raw, Math.max(offset, to), offset + available);
    }
    const menuBackground = model.mode === 'global-output' ? colors.global : colors[model.mode];
    const menu = this.style(this.fit(prefix + input, this.width), colors.text, menuBackground);
    const lines = [
      this.tabs(model, tick),
      ...body,
      ...promptRows.map((line) =>
        this.style(this.fit(line, this.width), colors.text, colors.panel),
      ),
      menu,
    ].slice(0, this.height);
    const panel = this.panel(model);
    if (panel.length) {
      lines.splice(this.panelFrom, panel.length, ...panel);
    }
    if (this.height === 1) {
      lines[0] = menu;
    }
    const screen = '\x1b[H' + lines.join('\x1b[0m\r\n') + '\x1b[0m';
    const caret =
      model.mode === 'normal' || model.mode === 'global-output'
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
