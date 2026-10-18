import { describe, it, expect } from 'vitest';
import { ansiSegments, terminalRows } from './terminal-output.ts';

describe('terminal output formatting', () => {
  it('keeps color across wrapped newlines and records, and resets it explicitly', () => {
    const rows = terminalRows([
      { seq: 1, streamId: 't', timestamp: '', text: '\x1b[31mred\nwrapped', executionId: 'a' },
      { seq: 2, streamId: 't', timestamp: '', text: 'still red\x1b[0m default', executionId: 'a' },
      { seq: 3, streamId: 't', timestamp: '', text: 'separate', executionId: 'b' },
    ]);
    expect(rows[0].plainText).toBe('red\nwrapped');
    expect(rows[1].segments[0].style.color).toBe('var(--terminal-color-error)');
    expect(rows[1].segments[1].style).toEqual({});
    expect(rows[2].segments[0].style).toEqual({});
  });
  it('supports extended colors while treating markup as text and discarding terminal controls', () => {
    const result = ansiSegments(
      '\x1b[38;2;10;20;30m<b>literal</b>\x1b[2J\x1b]8;;javascript:alert(1)\x07link\x1b]8;;\x07\x1b[0m',
    );
    expect(result.segments.map((s) => s.text).join('')).toBe('<b>literal</b>link');
    expect(result.segments[0].style.color).toBe('rgb(10, 20, 30)');
    expect(result.style).toEqual({});
  });
  it('normalizes log warnings and preserves command and restored identities', () => {
    const rows = terminalRows([
      { seq: 1, streamId: 't', timestamp: '', text: 'run', type: 'command', restored: true },
      { seq: 2, streamId: 't', timestamp: '', text: 'warning', level: 'warn' },
    ]);
    expect(rows[0]).toMatchObject({ type: 'command', restored: true });
    expect(rows[1].type).toBe('warning');
  });
});
