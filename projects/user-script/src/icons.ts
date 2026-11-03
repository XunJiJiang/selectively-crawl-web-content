import { css, html } from 'lit';
import { WbIconBase, iconGlyph } from '../../web/src/components/icon-base.ts';
import { unsafeSVG } from 'lit/directives/unsafe-svg.js';
import { customElement } from '../../shared/utils/customElement.ts';
const icons = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('../../../node_modules/@vscode/codicons/src/icons/*.svg', {
      eager: true,
      query: '?raw',
      import: 'default',
    }),
  ).map(([path, svg]) => [path.slice(path.lastIndexOf('/') + 1, -4), svg]),
);

/** Float-window glyphs use SVG for CSP; other names retain the full workbench contract. */
@customElement('wb-icon')
export class UserScriptIcon extends WbIconBase {
  static styles = css`
    ${WbIconBase.styles}
    span:has(svg),
    svg {
      display: block;
      width: 1em;
      height: 1em;
    }
  `;
  render() {
    const svg = icons[iconGlyph(this.name)] ?? icons.question;
    return html`<span aria-hidden="true" style=${`font-size:${this.size === 'sm' ? 1 : 16 / 14}rem`}
      >${unsafeSVG(svg)}</span
    >`;
  }
}
