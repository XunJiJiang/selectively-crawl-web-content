import { css, unsafeCSS } from 'lit';
import workbenchTheme from '../../web/var.css?raw';
import '../../web/src/components/scroll-container.ts';
import '../../web/src/components/context-menu/wb-menu-select.ts';

// 把工作台主题限定在浮窗宿主内，避免覆盖被采集网页的主题。
export const theme = css`
  ${unsafeCSS(workbenchTheme.replace(/:root/g, ':host'))}
`;
export const controls = css`
  :host {
    display: block;
    min-width: 0;
    font: inherit;
    color: var(--text-primary);
  }
  * {
    box-sizing: border-box;
  }
  scwc-input {
    display: block;
    min-width: 0;
    flex: 1;
  }
  scwc-input::part(label) {
    margin: 0;
    gap: 4px;
  }
  scwc-input::part(description),
  scwc-checkbox::part(description) {
    color: var(--text-secondary);
    font: inherit;
  }
  scwc-input::part(input) {
    width: 100%;
    min-width: 0;
    height: 28px;
    padding: 4px 8px;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--surface-0);
    color: var(--text-primary);
    font: inherit;
    outline: none;
  }
  scwc-input::part(input):focus {
    border-color: var(--accent-primary);
  }
  scwc-button::part(button) {
    height: 28px;
    padding: 4px 8px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    cursor: pointer;
  }
  scwc-button::part(button):hover {
    background: var(--surface-3);
    color: var(--text-primary);
  }
  scwc-button::part(button):focus-visible {
    outline: 1px solid var(--accent-primary);
  }
  scwc-button[active]::part(button) {
    color: var(--accent-primary);
    background: var(--accent-subtle);
  }
  scwc-checkbox::part(label) {
    display: flex;
    align-items: center;
    gap: 8px;
    font: inherit;
  }
  scwc-checkbox::part(checkbox) {
    accent-color: var(--accent-primary);
  }
  wb-menu-select {
    width: 100%;
    min-width: 0;
  }
`;
