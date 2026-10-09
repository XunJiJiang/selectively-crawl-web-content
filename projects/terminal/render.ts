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
  private regions = new Map<string, Row[]>();
  private cells = new Map<number, { region: string; index: number }>();
  private inputHit?: { row: number; prefix: number; offset: number; text: string };
  private drag?: { region?: string; index: number; column: number; inputStart?: number };
  private selection?: {
    region: string;
    start: { index: number; column: number };
    end: { index: number; column: number };
  };
  private selectionActive = '';
  private panelSelectionVersion = '';
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
    return this.fit(lead + displayed, tabWidth - 2);
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
      text:
        (window.id === model.activeId ||
        model.windows[model.windows.indexOf(window) - 1]?.id === model.activeId
          ? '┃'
          : '│') +
        this.title(model, window, tick) +
        (window === model.windows.at(-1) ? (window.id === model.activeId ? '┃' : '│') : ''),
    }));
    const positions: { start: number; end: number }[] = [];
    let total = 0;
    for (const label of labels) {
      const start = total;
      total += stringWidth(label.text);
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
  private plain(text: string) {
    return text.replace(/\x1b\[[\d;]*m/g, '');
  }
  private bounds(text: string, from: number, to: number) {
    const plain = this.plain(text);
    let column = 0;
    let start = plain.length;
    let end = 0;
    for (const item of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(plain)) {
      const next = column + stringWidth(item.segment);
      if (next > from && column < to) {
        start = Math.min(start, item.index);
        end = item.index + item.segment.length;
      }
      column = next;
    }
    return { plain, start, end: Math.max(start, end) };
  }
  private range(region: string, index: number) {
    const selection = this.selection;
    if (!selection || selection.region !== region) {
      return undefined;
    }
    let { start, end } = selection;
    if (start.index > end.index || (start.index === end.index && start.column > end.column)) {
      [start, end] = [end, start];
    }
    if (index < start.index || index > end.index) {
      return undefined;
    }
    return {
      from: index === start.index ? start.column : 0,
      to: index === end.index ? end.column + 1 : Infinity,
    };
  }
  private selectedRow(text: string, region: string, index: number) {
    const range = this.range(region, index);
    if (!range) {
      return text;
    }
    const { plain, start, end } = this.bounds(text, range.from, range.to);
    const from = stringWidth(plain.slice(0, start));
    const to = stringWidth(plain.slice(0, end));
    return (
      sliceAnsi(text, 0, from) +
      this.style(plain.slice(start, end), colors.background, colors.accent) +
      sliceAnsi(text, to)
    );
  }
  clearSelection(model: TerminalModel) {
    this.selection = undefined;
    this.drag = undefined;
    model.setInput(model.text, model.cursor);
  }
  clearOutputSelection() {
    this.selection = undefined;
    this.drag = undefined;
  }
  selectedText(model: TerminalModel) {
    if (this.selection) {
      const rows = this.regions.get(this.selection.region) ?? [];
      let text = '';
      let previous: Row | undefined;
      for (let index = 0; index < rows.length; index++) {
        const range = this.range(this.selection.region, index);
        if (!range) {
          continue;
        }
        const row = rows[index];
        const { plain, start, end } = this.bounds(row.text, range.from, range.to);
        if (previous && row.line !== previous.line) {
          text += '\n';
        }
        text += plain.slice(start, end);
        previous = row;
      }
      return text;
    }
    if (model.editing && model.selection !== undefined) {
      return model.text.slice(
        Math.min(model.cursor, model.selection),
        Math.max(model.cursor, model.selection),
      );
    }
    return '';
  }
  private inputIndex(column: number, upper = false) {
    const hit = this.inputHit;
    if (!hit) {
      return 0;
    }
    const target = Math.max(0, column - hit.prefix + hit.offset);
    const { start, end } = this.bounds(hit.text, target, target + 1);
    return upper ? end : start;
  }
  beginSelection(model: TerminalModel, column: number, row: number) {
    if (model.completionPreview) {
      model.commitGlobalCompletion();
    }
    this.clearSelection(model);
    if (this.inputHit?.row === row && model.editing) {
      const index = this.inputIndex(column);
      this.drag = { index: 0, column, inputStart: index };
      model.setInput(model.text, index);
      return;
    }
    const cell = this.cells.get(row);
    if (cell) {
      this.drag = { ...cell, column };
    }
  }
  dragSelection(
    model: TerminalModel,
    column: number,
    row: number,
    release: boolean,
    motion: boolean,
  ) {
    const drag = this.drag;
    if (!drag || (!release && !motion)) {
      return false;
    }
    if (drag.inputStart !== undefined) {
      const hit = this.inputHit;
      if (hit && (column !== drag.column || row !== hit.row)) {
        const forward = column >= drag.column;
        const cursor = this.inputIndex(column, forward);
        const anchor = forward ? drag.inputStart : this.inputIndex(drag.column, true);
        model.setInput(model.text, cursor, anchor);
      }
    } else if (drag.region) {
      const choices = [...this.cells].filter(([, cell]) => cell.region === drag.region);
      const nearest = choices.reduce<(typeof choices)[number] | undefined>(
        (best, entry) =>
          !best || Math.abs(entry[0] - row) < Math.abs(best[0] - row) ? entry : best,
        undefined,
      );
      if (nearest && (column !== drag.column || nearest[1].index !== drag.index)) {
        this.selection = {
          region: drag.region,
          start: { index: drag.index, column: drag.column },
          end: { index: nearest[1].index, column: Math.max(0, Math.min(this.width - 1, column)) },
        };
      }
    }
    if (release) {
      this.drag = undefined;
    }
    return true;
  }
  private panel(model: TerminalModel) {
    this.panelHeight = 0;
    this.panelFrom = Infinity;
    this.panelRowCount = 0;
    const content: { text: string; index?: number }[] = [];
    const output = (model.panel?.lines ?? []).flatMap((line, index) => this.wrapRows(line, index));
    this.regions.set('panel', output);
    output.forEach((row, index) => content.push({ text: row.text, index }));
    let heading = model.panel
      ? ` :${model.panel.command} · ${model.panel.input ? '等待输入' : model.panel.running ? '执行中' : '↑/↓ 滚动 · : 继续 · Esc 关闭'}`
      : ' 命令候选 · Tab / Shift+Tab';
    const candidates = model.candidates;
    if (model.mode === 'global' || candidates.length) {
      heading = ' 命令候选 · Tab / Shift+Tab';
      if (candidates.length) {
        candidates.forEach((command, index) =>
          content.push({
            text: this.style(
              this.fit(
                ` ${index === model.completionIndex ? '›' : ' '} ${model.mode === 'global' ? ':' : ''}${command.name}  ${command.description ?? ''}`,
                this.width,
              ),
              index === model.completionIndex ? colors.accent : colors.text,
              index === model.completionIndex ? colors.selected : colors.panel,
            ),
          }),
        );
      } else {
        content.push(
          ...this.wrap(
            model.globalHint
              ? `:${model.globalHint.usage}\n${model.globalHint.description}`
              : '没有匹配的全局命令',
          ).map((text) => ({ text })),
        );
      }
    } else if (!model.panel) {
      return [];
    }
    if (model.panel?.input) {
      content.push(...this.wrap(model.panel.input.text).map((text) => ({ text })));
    }
    const maximum = Math.max(0, Math.min(5, Math.floor(this.height / 2), this.height - 2));
    this.panelHeight = Math.min(maximum, content.length + 1);
    this.panelFrom = this.height - 1 - this.panelHeight;
    this.panelRowCount = content.length;
    if (!this.panelHeight) {
      return [];
    }
    const visible = this.panelHeight - 1;
    let start = Math.max(0, content.length - visible - (model.panel?.scroll ?? 0));
    if (candidates.length) {
      start = Math.max(0, output.length + model.completionIndex - visible + 1);
    }
    if (model.panel) {
      model.panel.scroll = Math.min(model.panel.scroll, Math.max(0, content.length - visible));
    }
    let visibleRows = content.slice(start, start + visible);
    if (model.mode === 'global' && output.length && !model.panel?.input) {
      const retained = Math.min(2, Math.max(0, visible - 1), output.length);
      const outputEnd = Math.max(retained, output.length - (model.panel?.scroll ?? 0));
      const candidateRows = visible - retained;
      const candidateStart = output.length + Math.max(0, model.completionIndex - candidateRows + 1);
      visibleRows = [
        ...content.slice(outputEnd - retained, outputEnd),
        ...content.slice(candidateStart, candidateStart + candidateRows),
      ];
    }
    while (visibleRows.length < visible) {
      visibleRows.push({ text: '' });
    }
    return [
      this.style(this.fit(heading, this.width), colors.accent, colors.selected),
      ...visibleRows.map((row, index) => {
        const screenRow = this.panelFrom + index + 1;
        this.cells.delete(screenRow);
        if (row.index !== undefined) {
          this.cells.set(screenRow, { region: 'panel', index: row.index });
        }
        return this.style(
          this.fit(
            row.index === undefined ? row.text : this.selectedRow(row.text, 'panel', row.index),
            this.width,
          ),
          colors.text,
          colors.panel,
        );
      }),
    ];
  }
  private input(
    text: string,
    cursor: number,
    selection: number | undefined,
    prefix: string,
    row: number,
    active: boolean,
  ) {
    const prefixWidth = stringWidth(prefix);
    const available = Math.max(1, this.width - prefixWidth);
    const offset = Math.max(0, stringWidth(text.slice(0, cursor)) - available + 1);
    let input = sliceAnsi(text, offset, offset + available);
    if (selection !== undefined) {
      const from = stringWidth(text.slice(0, Math.min(selection, cursor)));
      const to = stringWidth(text.slice(0, Math.max(selection, cursor)));
      input =
        sliceAnsi(text, offset, Math.max(offset, from)) +
        this.style(
          sliceAnsi(text, Math.max(offset, from), Math.min(offset + available, to)),
          colors.background,
          colors.accent,
        ) +
        sliceAnsi(text, Math.max(offset, to), offset + available);
    }
    if (active) {
      this.inputHit = { row, prefix: prefixWidth, offset, text };
    }
    return {
      text: prefix + input,
      column: Math.min(this.width, prefixWidth + stringWidth(text.slice(0, cursor)) - offset + 1),
    };
  }
  frame(model: TerminalModel, tick = Math.floor(Date.now() / 100)): string {
    const window = model.active;
    this.cells.clear();
    this.inputHit = undefined;
    this.regions.clear();
    if (!model.panel && this.selection?.region === 'panel') {
      this.selection = undefined;
    }
    const panelVersion = `${model.panel?.lineOffset ?? 0}:${this.width}`;
    if (panelVersion !== this.panelSelectionVersion && this.selection?.region === 'panel') {
      this.selection = undefined;
    }
    this.panelSelectionVersion = panelVersion;
    const panel = this.panel(model);
    const panelCells = new Map(this.cells);
    const region = `window:${window.id}:${window.lineOffset}:${this.width}`;
    if (
      this.selectionActive !== window.id ||
      (this.selection?.region.startsWith('window:') && this.selection.region !== region)
    ) {
      this.selection = undefined;
    }
    this.selectionActive = window.id;
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
      rows = window.lines.flatMap((line, index) => this.wrapRows(line, index + window.lineOffset));
      this.cache.set(window, {
        width: this.width,
        bytes: window.bytes,
        count: window.lines.length,
        rows,
      });
    }
    this.regions.set(region, rows);
    const inline = window.kind === 'command' || Boolean(window.input);
    const inlineActive = inline && model.mode === 'normal';
    const text = inlineActive ? model.displayText : (window.input?.draft ?? window.draft);
    const cursor = inlineActive
      ? model.completionPreview
        ? text.length
        : model.cursor
      : (window.input?.cursor ?? window.cursor);
    const allRows = inline
      ? [...rows, { text: '', line: window.lineOffset + window.lines.length, offset: 0 }]
      : rows;
    this.viewHeight = Math.max(0, this.height - 2 - (inlineActive ? this.panelHeight : 0));
    const maximum = Math.max(0, allRows.length - this.viewHeight);
    const anchor = window.anchor;
    this.viewStart = anchor
      ? Math.max(
          0,
          allRows.findIndex(
            (row) =>
              row.line >= anchor.line && (row.line > anchor.line || row.offset >= anchor.offset),
          ),
        )
      : Math.max(0, maximum - window.scroll);
    this.viewStart = Math.min(maximum, this.viewStart);
    this.scrollRows = allRows;
    const background = model.transparentBackground ? undefined : colors.background;
    let caret: { row: number; column: number } | undefined;
    const body = allRows
      .slice(this.viewStart, this.viewStart + this.viewHeight)
      .map((row, index) => {
        const sourceIndex = this.viewStart + index;
        const screenRow = index + 1;
        if (inline && sourceIndex === rows.length) {
          const input = this.input(
            text,
            cursor,
            inlineActive && !model.completionPreview ? model.selection : undefined,
            this.style(window.input ? '? ' : '> ', colors.accent),
            screenRow,
            inlineActive,
          );
          if (inlineActive && (text || window.input)) {
            caret = { row: screenRow, column: input.column };
          }
          return this.style(this.fit(input.text, this.width), colors.text, background);
        }
        this.cells.set(screenRow, { region, index: sourceIndex });
        return this.style(
          this.fit(this.selectedRow(row.text, region, sourceIndex), this.width),
          colors.text,
          background,
        );
      });
    while (body.length < Math.max(0, this.height - 2)) {
      body.push(this.style(' '.repeat(this.width), colors.text, background));
    }
    const state =
      model.mode === 'confirmation' ? ' INPUT ' : model.mode === 'normal' ? ' NORMAL ' : ' GLOBAL ';
    let tail = model.message
      ? ` ${model.message}`
      : model.mode === 'global-output'
        ? ` ${model.panel?.running ? '执行中' : '↑/↓ 滚动 · : 继续 · Esc 关闭'}`
        : ' : 全局命令 · Tab 切换 · Esc 底部';
    if (model.mode === 'global' || model.mode === 'confirmation') {
      const raw = model.displayText;
      const input = this.input(
        raw,
        model.completionPreview ? raw.length : model.cursor,
        model.completionPreview ? undefined : model.selection,
        state + (model.mode === 'global' ? ':' : ''),
        this.height - 1,
        true,
      );
      tail = input.text.slice(state.length);
      caret = { row: this.height - 1, column: input.column };
    }
    const menu =
      this.style(
        state,
        colors.text,
        model.mode === 'global-output' ? colors.global : colors[model.mode],
      ) +
      this.style(
        this.fit(tail, Math.max(0, this.width - stringWidth(state))),
        colors.text,
        colors.panel,
      );
    const lines = [this.tabs(model, tick), ...body, menu].slice(0, this.height);
    if (panel.length) {
      for (let row = this.panelFrom; row < this.panelFrom + panel.length; row++) {
        this.cells.delete(row);
        const cell = panelCells.get(row);
        if (cell) {
          this.cells.set(row, cell);
        }
      }
      lines.splice(this.panelFrom, panel.length, ...panel);
      if (caret && this.panelAt(caret.row)) {
        caret = undefined;
        this.hideCoveredInput();
      }
    }
    if (this.height === 1) {
      lines[0] = this.style(this.fit(state + tail, this.width), colors.text, colors.panel);
      caret = undefined;
    }
    // Clip the state label too for very narrow terminals.
    const screen =
      '\x1b[H' + lines.map((line) => this.fit(line, this.width)).join('\x1b[0m\r\n') + '\x1b[0m';
    return screen + (caret ? `\x1b[${caret.row + 1};${caret.column}H\x1b[?25h` : '\x1b[?25l');
  }
  private hideCoveredInput() {
    if (this.inputHit && this.panelAt(this.inputHit.row)) {
      this.inputHit = undefined;
    }
  }
  private wrapRows(text: string, line: number): Row[] {
    const clean = sanitizeOutput(text);
    const result: Row[] = [];
    const columns = stringWidth(clean);
    for (let offset = 0; offset < Math.max(1, columns);) {
      let wrapped = sliceAnsi(clean, offset, offset + this.width);
      let advance = stringWidth(wrapped);
      // A width-2 glyph in a width-1 terminal cannot fit; consume it once.
      if (!advance && columns > offset) {
        wrapped = '';
        advance = 2;
      }
      result.push({ text: wrapped, line, offset });
      offset += Math.max(1, advance);
    }
    return result;
  }
  private wrap(text: string): string[] {
    return text
      .split('\n')
      .flatMap((line, index) => this.wrapRows(line, index).map((row) => row.text));
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
