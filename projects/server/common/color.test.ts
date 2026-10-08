import { describe, expect, it } from 'vitest';
import { colorEnvironment, colorLogText, outputColorLevel } from './color.ts';

const tty = { isTTY: true, getColorDepth: () => 8 };
const pipe = { isTTY: false, getColorDepth: () => 1 };
describe('terminal colors across piped processes', () => {
  it('detects the real terminal and honors explicit environment preferences', () => {
    expect(outputColorLevel({ TERM: 'xterm-256color' }, tty)).toBe(2);
    expect(outputColorLevel({}, pipe)).toBe(0);
    expect(outputColorLevel({ TERM: 'dumb' }, tty)).toBe(0);
    expect(outputColorLevel({ NO_COLOR: '' }, tty)).toBe(0);
    expect(outputColorLevel({ FORCE_COLOR: '0' }, tty)).toBe(0);
    expect(outputColorLevel({ FORCE_COLOR: '3' }, pipe)).toBe(3);
    expect(outputColorLevel({ FORCE_COLOR: 'true' }, pipe)).toBe(1);
    expect(colorEnvironment({ FORCE_COLOR: '2', TOKEN: 'test' })).toEqual({
      FORCE_COLOR: '2',
      TOKEN: 'test',
    });
    expect(colorEnvironment({ NO_COLOR: '1' })).toEqual({ NO_COLOR: '1' });
  });
  it('colors log levels while preserving custom ANSI body colors', () => {
    expect(colorLogText('[core] info', 'info', 1)).toBe('\x1b[34m[core]\x1b[39m info');
    expect(colorLogText('[plugin] [warn] warning', 'warn', 1)).toBe(
      '\x1b[33m[plugin] [warn]\x1b[39m warning',
    );
    expect(colorLogText('error', 'error', 1)).toBe('\x1b[31merror\x1b[39m');
    expect(colorLogText('[plugin] \x1b[35mcustom\x1b[39m', 'info', 2)).toContain(
      '\x1b[35mcustom\x1b[39m',
    );
    expect(colorLogText('\x1b[38;2;10;20;30mcustom\x1b[0m', undefined, 3)).toContain(
      '38;2;10;20;30',
    );
    expect(colorLogText('[plugin] \x1b[35mcustom\x1b[39m', 'warn', 0)).toBe('[plugin] custom');
  });
});
