import { StringDecoder } from 'node:string_decoder';
export interface Key {
  name: string;
  sequence: string;
  shift?: boolean;
  ctrl?: boolean;
  mouse?: { button: number; column: number; row: number; release: boolean };
}
export class InputDecoder {
  private text = '';
  private decoder = new StringDecoder('utf8');
  private timer?: NodeJS.Timeout;
  private paste?: string;
  private emit: (key: Key) => void;
  constructor(emit: (key: Key) => void) {
    this.emit = emit;
  }
  feed(data: Buffer | string) {
    clearTimeout(this.timer);
    this.text += typeof data === 'string' ? data : this.decoder.write(data);
    while (this.text) {
      if (this.paste !== undefined) {
        const end = this.text.indexOf('\x1b[201~');
        if (end < 0) {
          return;
        }
        const paste = this.text.slice(0, end);
        this.text = this.text.slice(end + 6);
        this.paste = undefined;
        this.emit({ name: 'paste', sequence: paste });
        continue;
      }
      if (this.text.startsWith('\x1b[200~')) {
        this.text = this.text.slice(6);
        this.paste = '';
        continue;
      }
      const mouse = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/.exec(this.text);
      if (mouse) {
        this.text = this.text.slice(mouse[0].length);
        this.emit({
          name: 'mouse',
          sequence: mouse[0],
          mouse: {
            button: Number(mouse[1]),
            column: Number(mouse[2]) - 1,
            row: Number(mouse[3]) - 1,
            release: mouse[4] === 'm',
          },
        });
        continue;
      }
      const escape = /^\x1b(?:\[([\d;]*)([A-Za-z~])|O([A-DHF]))/.exec(this.text);
      if (escape) {
        this.text = this.text.slice(escape[0].length);
        const code = escape[2] ?? escape[3];
        const names: Record<string, string> = {
          A: 'up',
          B: 'down',
          C: 'right',
          D: 'left',
          H: 'home',
          F: 'end',
          Z: 'tab',
        };
        const name =
          code === '~'
            ? ({ '3': 'delete', '5': 'pageup', '6': 'pagedown' }[escape[1]] ?? 'unknown')
            : (names[code] ?? 'unknown');
        this.emit({
          name,
          sequence: escape[0],
          shift: code === 'Z' || /;2$/.test(escape[1]),
          ctrl: /;5$/.test(escape[1]),
        });
        continue;
      }
      if (this.text[0] === '\x1b') {
        if (this.text.length > 1 && !['[', 'O'].includes(this.text[1])) {
          this.text = this.text.slice(1);
          this.emit({ name: 'escape', sequence: '\x1b' });
          continue;
        }
        this.timer = setTimeout(() => {
          this.text = '';
          this.emit({ name: 'escape', sequence: '\x1b' });
        }, 35);
        return;
      }
      const character = [...this.text][0];
      this.text = this.text.slice(character.length);
      const names: Record<string, string> = {
        '\r': 'enter',
        '\n': 'enter',
        '\t': 'tab',
        '\x7f': 'backspace',
        '\b': 'backspace',
        '\x03': 'c',
      };
      this.emit({
        name: names[character] ?? 'text',
        sequence: character,
        ctrl: character === '\x03',
      });
    }
  }
  dispose() {
    clearTimeout(this.timer);
  }
}
