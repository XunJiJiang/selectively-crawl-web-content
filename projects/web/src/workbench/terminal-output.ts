import type { OutputRecord } from './types.ts';

export interface AnsiStyle {
  [property: string]: string | undefined;
  color?: string;
  backgroundColor?: string;
  fontWeight?: string;
  fontStyle?: string;
  textDecoration?: string;
}
export interface AnsiSegment {
  text: string;
  style: AnsiStyle;
}
const palette = [
  'var(--terminal-ansi-black)',
  'var(--terminal-color-error)',
  'var(--terminal-color-success)',
  'var(--terminal-color-warning)',
  'var(--terminal-color-info)',
  'var(--terminal-ansi-magenta)',
  'var(--accent-primary)',
  'var(--text-primary)',
];
function indexedColor(index: number) {
  if (index < 16) {
    return palette[index % 8];
  }
  if (index >= 232) {
    const gray = 8 + (index - 232) * 10;
    return `rgb(${gray}, ${gray}, ${gray})`;
  }
  const n = index - 16,
    channel = (v: number) => (v ? 55 + v * 40 : 0);
  return `rgb(${channel(Math.floor(n / 36))}, ${channel(Math.floor(n / 6) % 6)}, ${channel(n % 6)})`;
}
/** Only SGR affects styling. OSC links and terminal control sequences never become HTML. */
export function ansiSegments(text: string, initial: AnsiStyle = {}) {
  let style = { ...initial };
  const segments: AnsiSegment[] = [];
  const sequence = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[@-_]/g;
  let offset = 0;
  const append = (value: string) => {
    const clean = value.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
    if (clean) {
      segments.push({ text: clean, style: { ...style } });
    }
  };
  for (const match of text.matchAll(sequence)) {
    append(text.slice(offset, match.index));
    offset = match.index + match[0].length;
    if (!/^\x1b\[[0-9;]*m$/.test(match[0])) {
      continue;
    }
    const codes = match[0].slice(2, -1).split(';').map(Number);
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      if (code === 0) {
        style = {};
      } else if (code === 1) {
        style.fontWeight = 'var(--font-semibold)';
      } else if (code === 3) {
        style.fontStyle = 'italic';
      } else if (code === 4) {
        style.textDecoration = 'underline';
      } else if (code === 22) {
        delete style.fontWeight;
      } else if (code === 23) {
        delete style.fontStyle;
      } else if (code === 24) {
        delete style.textDecoration;
      } else if (code === 39) {
        delete style.color;
      } else if (code === 49) {
        delete style.backgroundColor;
      } else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
        style.color = palette[code % 10];
      } else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) {
        style.backgroundColor = palette[code % 10];
      } else if (code === 38 || code === 48) {
        const key = code === 38 ? 'color' : 'backgroundColor';
        if (codes[i + 1] === 5 && codes[i + 2] >= 0 && codes[i + 2] <= 255) {
          style[key] = indexedColor(codes[i + 2]);
          i += 2;
        } else if (
          codes[i + 1] === 2 &&
          codes.slice(i + 2, i + 5).length === 3 &&
          codes.slice(i + 2, i + 5).every((v) => v >= 0 && v <= 255)
        ) {
          style[key] = `rgb(${codes.slice(i + 2, i + 5).join(', ')})`;
          i += 4;
        }
      }
    }
  }
  append(text.slice(offset));
  return { segments, style };
}
export function terminalRows(records: OutputRecord[]) {
  const styles = new Map<string, AnsiStyle>();
  return records.map((record) => {
    const type =
      record.type ??
      (record.level === 'warn'
        ? 'warning'
        : ['error', 'warning', 'info', 'success'].includes(record.level ?? '')
          ? record.level
          : 'output');
    const key = record.executionId ?? record.streamId;
    const parsed = ansiSegments(record.text, type === 'command' ? {} : styles.get(key));
    if (type !== 'command') {
      styles.set(key, parsed.style);
    }
    return {
      ...record,
      type,
      segments: parsed.segments,
      plainText: parsed.segments.map((s) => s.text).join(''),
    };
  });
}
