import { describe, it, expect, vi } from 'vitest';
import stringWidth from 'string-width';
import { TerminalModel } from './model.ts';
import { Renderer } from './render.ts';
import { InputDecoder } from './input.ts';
import { restoreState } from './storage.ts';

describe('terminal windows and input', () => {
  it('coalesces continuous repaint requests and never paints faster than 60 fps', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const renderer = new Renderer();
    try {
      const model = new TerminalModel();
      const output = {} as NodeJS.WriteStream;
      const times: number[] = [];
      vi.spyOn(renderer, 'paint').mockImplementation(() => {
        times.push(performance.now());
      });
      for (let i = 0; i < 1000; i++) {
        renderer.schedulePaint(model, output);
        vi.advanceTimersByTime(1);
      }
      expect(times.length).toBeGreaterThanOrEqual(58);
      expect(times.length).toBeLessThanOrEqual(60);
      expect(times.slice(1).every((time, i) => time - times[i] >= 1000 / 60)).toBe(true);
      renderer.schedulePaint(model, output);
      renderer.cancelPaint();
      const count = times.length;
      vi.advanceTimersByTime(100);
      expect(times).toHaveLength(count);
    } finally {
      renderer.cancelPaint();
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });
  it('renders one colored restored-history row between saved and new output without copying it', () => {
    const original = new TerminalModel();
    original.append({ windowId: original.output.id, text: 'old output' });
    original.append({ windowId: original.windows[1].id, text: 'old command output' });
    const model = restoreState({ version: 1, windows: original.windows });
    model.append({ windowId: model.output.id, text: 'new output' });
    const renderer = new Renderer();
    const plain = (text: string) => text.replace(/\x1b\[[\d;?]*[A-Za-z]/g, '');
    const frame = renderer.frame(model, 0);
    const rows = plain(frame).split('\r\n');
    expect(rows[1].trim()).toBe('old output');
    expect(rows[2].trimEnd()).toBe('    还原的历史记录');
    expect(rows[3].trim()).toBe('new output');
    expect(frame).toContain('\x1b[38;2;0;0;0m\x1b[48;2;240;240;240m    ');
    expect(frame).toContain('\x1b[48;2;173;216;230m还原的历史记录 ');
    renderer.beginSelection(model, 0, 1);
    renderer.dragSelection(model, 10, 3, true, false);
    expect(renderer.selectedText(model)).toBe('old output\nnew output');
    model.switch(model.windows[1].id);
    const commandRows = plain(renderer.frame(model, 0)).split('\r\n');
    expect(commandRows[1].trim()).toBe('old command output');
    expect(commandRows[2].trim()).toBe('还原的历史记录');
    expect(commandRows[3].trim()).toBe('>');
    for (const width of [1, 4, 11, 80]) {
      renderer.width = width;
      const compact = plain(renderer.frame(model, 0)).split('\r\n');
      expect(compact).toHaveLength(renderer.height);
      expect(compact.every((row) => stringWidth(row) <= width)).toBe(true);
      expect(compact.filter((row) => row.trim() === '>')).toHaveLength(1);
    }
    model.switch(model.newWindow().id);
    expect(renderer.frame(model, 0)).not.toContain('还原的历史记录');
    expect(model.output.lines).toEqual(['old output', 'new output']);
  });
  it('finishes successful tasks without appending a success marker', () => {
    const model = new TerminalModel();
    const window = model.windows[1];
    const event = {
      executionId: 'a',
      windowId: window.id,
      command: 'asmr clean:dot-underscore',
      status: 'running' as const,
    };
    model.execution(event);
    model.execution({ ...event, status: 'succeeded' });
    expect(window.task).toBeUndefined();
    expect(window.lines).toEqual([]);
    model.execution({ ...event, status: 'failed', error: 'failed' });
    expect(window.lines).toEqual(['[failed] asmr clean:dot-underscore：failed']);
  });
  it('requires two boundary attempts and never reuses window identity', () => {
    const model = new TerminalModel();
    const original = model.windows[1];
    model.switch(original.id);
    model.tab(1, 1000);
    expect(model.activeId).toBe(original.id);
    model.tab(1, 1500);
    expect(model.activeId).toBe(model.output.id);
    model.tab(-1, 2000);
    model.tab(-1, 2700);
    expect(model.activeId).toBe(model.output.id);
    model.tab(-1, 2800);
    expect(model.activeId).toBe(original.id);
    model.close(original.id);
    const created = model.newWindow();
    expect(created.number).toBe(1);
    expect(created.id).not.toBe(original.id);
    model.append({ windowId: original.id, executionId: 'old', text: 'late' });
    expect(created.lines).toEqual([]);
    expect(model.output.lines[0]).toContain('已关闭窗口');
  });
  it('restores drafts after history traversal and edits complete graphemes', () => {
    const model = new TerminalModel();
    model.switch(model.windows[1].id);
    model.mode = 'normal';
    model.record(model.active, 'first');
    model.active.draft = '未提交';
    model.history(-1);
    expect(model.text).toBe('first');
    model.history(1);
    expect(model.text).toBe('未提交');
    model.setInput('A👨‍👩‍👧‍👦éB', 'A👨‍👩‍👧‍👦éB'.length);
    model.move(-1);
    model.edit('', 'backspace');
    expect(model.text).toBe('A👨‍👩‍👧‍👦B');
    model.move(-1, true);
    model.edit('中');
    expect(model.text).toBe('A中B');
  });
  it('supports typed next input, validation retries and cancellation', async () => {
    const model = new TerminalModel();
    const panel = model.beginPanel('typed');
    const number = model.next('number?', Number);
    panel.input?.reply('invalid');
    await expect.poll(() => panel.input?.text).toContain('有效的 number');
    panel.input?.reply('42');
    expect(await number).toEqual([undefined, 42]);
    const string = model.next('literal?');
    panel.input?.reply(':anything');
    expect(await string).toEqual([undefined, ':anything']);
    const cancelled = model.next('cancel?');
    model.cancelPanelInput();
    expect((await cancelled)[0]?.code).toBe('cancelled');
    model.finishPanel(panel);
    expect(model.mode).toBe('normal');
  });
  it('preserves fixed IDs and marks background tasks interrupted during restore', () => {
    const model = new TerminalModel();
    model.switch(model.windows[1].id);
    model.globalDraft = 'run 1 test';
    model.rename(model.active, '持久名称');
    model.transparentBackground = false;
    model.active.task = {
      executionId: 'a',
      windowId: model.active.id,
      command: 'test',
      status: 'background',
    };
    const restored = restoreState({
      version: 1,
      activeId: model.activeId,
      globalDraft: model.globalDraft,
      transparentBackground: model.transparentBackground,
      windows: model.windows,
    });
    expect(restored.activeId).toBe(model.activeId);
    expect(restored.active.task).toBeUndefined();
    expect(restored.active.lines.at(-1)).toContain('未重新执行');
    expect(restored.globalDraft).toBe(model.globalDraft);
    expect(restored.mode).toBe('normal');
    expect(restored.title(restored.active)).toBe('持久名称');
    expect(restored.transparentBackground).toBe(false);
    expect(restored.panel).toBeUndefined();
  });
  it('removes terminal control sequences and bounds history storage', () => {
    const model = new TerminalModel();
    model.append({ windowId: model.output.id, text: '\x1b[2J\x1b]0;bad\x07\x1b[31mred\x1b[0m' });
    expect(model.output.lines[0]).toBe('\x1b[31mred\x1b[0m');
    model.append({ windowId: model.output.id, text: Array(10010).fill('line').join('\n') });
    expect(model.output.lines.length).toBeLessThanOrEqual(10000);
    expect(model.output.lines[0]).toBe('[历史输出已截断]');
  });
  it('renders colored Chinese text without losing a character at odd widths', () => {
    const model = new TerminalModel();
    model.append({ windowId: model.output.id, text: '\x1b[38;2;10;20;30m甲乙丙丁戊己\x1b[0m' });
    const renderer = new Renderer();
    renderer.width = 11;
    renderer.height = 10;
    const colored = renderer.frame(model, 0);
    expect(colored).toContain('\x1b[38;2;10;20;30m');
    const frame = colored.replace(/\x1b\[[\d;?]*[A-Za-z]/g, '');
    for (const char of '甲乙丙丁戊己') {
      expect(frame).toContain(char);
    }
    for (const row of frame.split('\r\n')) {
      expect(stringWidth(row)).toBeLessThanOrEqual(11);
    }
  });
  it('keeps a history anchor while output arrives and the terminal resizes', () => {
    const model = new TerminalModel();
    model.append({
      windowId: model.output.id,
      text: Array.from({ length: 40 }, (_, i) => `row ${i}`).join('\n'),
    });
    const renderer = new Renderer();
    renderer.width = 20;
    renderer.height = 8;
    renderer.frame(model);
    renderer.scroll(model, 10);
    const before = renderer.frame(model);
    model.append({ windowId: model.output.id, text: 'new row' });
    expect(renderer.frame(model)).toBe(before);
    renderer.width = 30;
    renderer.frame(model);
    expect(model.output.anchor).toBeDefined();
  });
  it('bounds the floating panel, uses fixed width tabs and supplies both theme colors', () => {
    const model = new TerminalModel();
    model.newWindow();
    model.rename(model.windows[1], 'long 中文 tab name');
    const renderer = new Renderer();
    renderer.width = 100;
    renderer.height = 24;
    model.mode = 'global';
    model.globalDraft = 'rename ';
    let frame = renderer.frame(model, 0);
    expect(renderer.panelAt(20)).toBe(true);
    expect(renderer.panelAt(19)).toBe(false);
    expect(renderer.hits.filter((hit) => hit.id).map((hit) => hit.to - hit.from)).toEqual([
      25, 25, 26,
    ]);
    const panel = model.beginPanel('help');
    model.writePanel(Array.from({ length: 50 }, (_, index) => `output ${index}`).join('\n'));
    model.finishPanel(panel);
    frame = renderer.frame(model, 0);
    expect(renderer.panelAt(12)).toBe(true);
    expect(renderer.panelAt(11)).toBe(false);
    expect(frame).toContain('\x1b[38;2;');
    expect(frame).toContain('\x1b[48;2;');
    expect(frame).not.toContain('\x1b[7m');
    for (const height of [1, 2, 4, 10, 24]) {
      renderer.width = 11;
      renderer.height = height;
      const rows = renderer
        .frame(model, 0)
        .replace(/\x1b\[[\d;?]*[A-Za-z]/g, '')
        .split('\r\n');
      expect(rows).toHaveLength(height);
      expect(rows.every((row) => stringWidth(row) <= 11)).toBe(true);
    }
  });
  it('decodes fragmented mouse, paste, UTF-8 and Shift+arrow packets', () => {
    const keys: { name: string; sequence: string; shift?: boolean }[] = [];
    const decoder = new InputDecoder((key) => keys.push(key));
    decoder.feed('\x1b[<64;');
    decoder.feed('3;2M');
    decoder.feed('\x1b[1;2D');
    decoder.feed('\x1b[200~:run 1 https://x\n');
    decoder.feed('\x1b[201~');
    const chinese = Buffer.from('中');
    decoder.feed(chinese.subarray(0, 1));
    decoder.feed(chinese.subarray(1));
    expect(keys.map((key) => key.name)).toEqual(['mouse', 'left', 'paste', 'text']);
    expect(keys[1].shift).toBe(true);
    expect(keys[2].sequence).toContain('https://x');
    expect(keys[3].sequence).toBe('中');
    decoder.dispose();
  });
});
