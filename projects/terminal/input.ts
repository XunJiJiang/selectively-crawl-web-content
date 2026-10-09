import { StringDecoder } from 'node:string_decoder';
export interface Key {
  name: string;
  sequence: string;
  shift?: boolean;
  ctrl?: boolean;
  alt?: boolean;
  meta?: boolean;
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
      const escape = /^\x1b(?:\[([\d;:]*)([A-Za-z~])|O([A-DHF]))/.exec(this.text);
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
        const parameters = (escape[1] ?? '').split(';');
        const modifier = Math.max(0, Number(parameters[1]?.split(':')[0] ?? 1) - 1);
        // CSI-u and modifyOtherKeys preserve combinations including Cmd/Super+C.
        const unicode =
          code === 'u'
            ? Number(parameters[0].split(':')[0])
            : code === '~' && parameters[0] === '27'
              ? Number(parameters[2])
              : undefined;
        if (parameters[1]?.split(':')[1] === '3') {
          continue;
        } // Key release, not input.
        const name =
          unicode !== undefined
            ? ({
                13: 'enter',
                9: 'tab',
                27: 'escape',
                127: 'backspace',
                57350: 'left',
                57351: 'right',
                57352: 'up',
                57353: 'down',
                57358: 'home',
                57359: 'end',
              }[unicode] ??
              (unicode === 99 && modifier & 44
                ? 'c'
                : unicode >= 57344 && unicode <= 63743
                  ? 'unknown'
                  : 'text'))
            : code === '~'
              ? ({
                  '1': 'home',
                  '3': 'delete',
                  '4': 'end',
                  '5': 'pageup',
                  '6': 'pagedown',
                  '7': 'home',
                  '8': 'end',
                }[parameters[0]] ?? 'unknown')
              : (names[code] ?? 'unknown');
        this.emit({
          name,
          sequence:
            unicode !== undefined && unicode <= 0x10ffff
              ? String.fromCodePoint(unicode)
              : escape[0],
          shift: code === 'Z' || Boolean(modifier & 1),
          alt: Boolean(modifier & 2),
          ctrl: Boolean(modifier & 4),
          meta: Boolean(modifier & 40),
        });
        continue;
      }
      if (this.text[0] === '\x1b') {
        const altArrow = /^\x1b\x1b(?:\[|O)([CD])/.exec(this.text);
        if (altArrow) {
          this.text = this.text.slice(altArrow[0].length);
          this.emit({
            name: altArrow[1] === 'C' ? 'right' : 'left',
            sequence: altArrow[0],
            alt: true,
          });
          continue;
        }
        if (this.text.length > 1 && !['[', 'O'].includes(this.text[1])) {
          const character = [...this.text.slice(1)][0];
          if (character === 'b' || character === 'f') {
            this.text = this.text.slice(2);
            this.emit({
              name: character === 'b' ? 'left' : 'right',
              sequence: character,
              alt: true,
            });
          } else if (character !== '\x1b') {
            this.text = this.text.slice(1);
            this.emit({ name: 'escape', sequence: '\x1b' });
          } else {
            this.timer = setTimeout(() => {
              this.text = '';
              this.emit({ name: 'escape', sequence: '\x1b' });
            }, 35);
            return;
          }
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
