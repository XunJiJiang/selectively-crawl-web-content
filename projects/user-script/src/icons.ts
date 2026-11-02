import { css, html, LitElement } from 'lit';
import { property } from 'lit/decorators.js';
import { unsafeSVG } from 'lit/directives/unsafe-svg.js';
import { customElement } from '../../shared/utils/customElement.ts';
import selection from '@vscode/codicons/src/icons/list-selection.svg?raw';
import plugins from '@vscode/codicons/src/icons/extensions.svg?raw';
import minimize from '@vscode/codicons/src/icons/chrome-minimize.svg?raw';
import right from '@vscode/codicons/src/icons/chevron-right.svg?raw';
import down from '@vscode/codicons/src/icons/chevron-down.svg?raw';
import check from '@vscode/codicons/src/icons/check.svg?raw';
import fallback from '@vscode/codicons/src/icons/question.svg?raw';

const icons: Record<string, string> = {
  'list-selection': selection,
  plugins,
  'chrome-minimize': minimize,
  right,
  down,
  check,
};

/** 在菜单组件注册 wb-icon 之前安装 SVG 实现，不加载受 font-src 限制的字体。 */
@customElement('wb-icon')
export class UserScriptIcon extends LitElement {
  @property() accessor name = 'list-selection';
  @property() accessor size = '';
  static styles = css`
    :host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
    }
    span,
    svg {
      display: block;
      width: 1em;
      height: 1em;
    }
  `;
  render() {
    return html`<span aria-hidden="true" style=${`font-size:${this.size === 'sm' ? 1 : 16 / 14}rem`}
      >${unsafeSVG(icons[this.name] ?? fallback)}</span
    >`;
  }
}
