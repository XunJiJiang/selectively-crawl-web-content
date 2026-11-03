import { css, html } from 'lit';
import { WbIconBase } from '../../web/src/components/icon-base.ts';
import { unsafeSVG } from 'lit/directives/unsafe-svg.js';
import { customElement } from '../../shared/utils/customElement.ts';
import selection from '@vscode/codicons/src/icons/list-selection.svg?raw';
import plugins from '@vscode/codicons/src/icons/extensions.svg?raw';
import minimize from '@vscode/codicons/src/icons/chrome-minimize.svg?raw';
import right from '@vscode/codicons/src/icons/chevron-right.svg?raw';
import down from '@vscode/codicons/src/icons/chevron-down.svg?raw';
import check from '@vscode/codicons/src/icons/check.svg?raw';

const icons: Record<string, string> = {
  'list-selection': selection,
  plugins,
  'chrome-minimize': minimize,
  right,
  down,
  check,
};

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
    if (!icons[this.name]) {
      return super.render();
    }
    return html`<span aria-hidden="true" style=${`font-size:${this.size === 'sm' ? 1 : 16 / 14}rem`}
      >${unsafeSVG(icons[this.name])}</span
    >`;
  }
}
