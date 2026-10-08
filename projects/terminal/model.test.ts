import { describe, it, expect, vi } from 'vitest';
import stringWidth from 'string-width';
import { TerminalModel } from './model.ts';
import { Renderer } from './render.ts';
import { InputDecoder } from './input.ts';
import { restoreState } from './storage.ts';

describe('terminal windows and input', () => {
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
    model.mode = 'command';
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
  it('only accepts the explicit confirmation and consumes unrelated input', async () => {
    const model = new TerminalModel();
    const accept = vi.fn();
    const decline = vi.fn();
    model.mode = 'global';
    model.globalDraft = 'run 1 task';
    model.ask('replace?', accept, decline);
    await model.confirmKey(':');
    await model.confirmKey('y');
    expect(accept).not.toHaveBeenCalled();
    await model.confirmKey('', true);
    expect(accept).toHaveBeenCalledOnce();
    expect(model.mode).toBe('global');
    expect(model.globalDraft).toBe('run 1 task');
    model.ask('replace?', accept, decline);
    await model.confirmKey(':q');
    expect(decline).toHaveBeenCalledOnce();
    expect(accept).toHaveBeenCalledOnce();
  });
  it('preserves fixed IDs and marks background tasks interrupted during restore', () => {
    const model = new TerminalModel();
    model.switch(model.windows[1].id);
    model.globalDraft = 'run 1 test';
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
      windows: model.windows,
    });
    expect(restored.activeId).toBe(model.activeId);
    expect(restored.active.task).toBeUndefined();
    expect(restored.active.lines.at(-1)).toContain('未重新执行');
    expect(restored.globalDraft).toBe(model.globalDraft);
    expect(restored.mode).toBe('normal');
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
    model.append({ windowId: model.output.id, text: '甲乙丙丁戊己' });
    const renderer = new Renderer();
    renderer.width = 11;
    renderer.height = 10;
    const frame = renderer.frame(model, 0).replace(/\x1b\[[\d;?]*[A-Za-z]/g, '');
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
