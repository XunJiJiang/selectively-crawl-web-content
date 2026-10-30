import { customElement } from '../../../shared/utils/customElement.ts';
import { LitElement, html, css, unsafeCSS } from 'lit';
import { property } from 'lit/decorators.js';
import glyphStyles from '@vscode/codicons/dist/codicon.css?raw';
const names: Record<string, string> = {
  pages: 'files',
  plugins: 'extensions',
  history: 'history',
  bookmarks: 'bookmark',
  search: 'search',
  settings: 'settings-gear',
  keyboard: 'keyboard',
  welcome: 'home',
  close: 'close',
  plus: 'add',
  more: 'ellipsis',
  left: 'chevron-left',
  right: 'chevron-right',
  up: 'chevron-up',
  down: 'chevron-down',
  check: 'check',
  refresh: 'refresh',
  stop: 'debug-stop',
  play: 'play',
  split: 'split-horizontal',
  terminal: 'terminal',
  output: 'output',
  bell: 'bell',
  sun: 'sun',
  moon: 'moon',
  copy: 'copy',
  external: 'link-external',
  sidebar: 'layout-sidebar-left',
  auxiliary: 'layout-sidebar-right',
  panel: 'layout-panel',
  pin: 'pinned',
  sleep: 'debug-pause',
  warning: 'warning',
  info: 'info',
  error: 'error',
  success: 'pass',
  filter: 'filter',
  trash: 'trash',
  expand: 'screen-full',
  collapse: 'screen-normal',
  arrow: 'arrow-right',
  back: 'arrow-left',
  forward: 'arrow-right',
  link: 'link',
  save: 'save',
  folder: 'folder',
  code: 'code',
  network: 'radio-tower',
  command: 'symbol-method',
  download: 'desktop-download',
  move: 'move',
  edit: 'edit',
  clock: 'clock',
  sync: 'sync',
  circle: 'circle-filled',
  loading: 'loading',
};
@customElement('wb-icon')
export class WbIcon extends LitElement {
  @property() accessor name = 'pages';
  @property() accessor size = '';
  static styles = css`
    ${unsafeCSS(glyphStyles.replace(/@font-face\s*\{[^}]*\}/g, ''))}:host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
    }
  `;
  render() {
    return html`<span
      aria-hidden="true"
      class=${`codicon codicon-${names[this.name] ?? this.name}`}
      style=${`font-size:${this.size === 'sm' ? 1 : 16 / 14}rem`}
    ></span>`;
  }
}
