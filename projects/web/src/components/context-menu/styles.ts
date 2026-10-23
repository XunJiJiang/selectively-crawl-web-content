import { css } from 'lit';
export const menuStyles = css`
  :host {
    color: var(--text-primary);
    font: 0.928571rem/1.4 var(--font-sans);
    --wb-color-bg-surface: var(--surface-elevated);
    --wb-color-bg-surface-2: var(--surface-3);
    --wb-color-text-secondary: var(--text-secondary);
  }
  * {
    box-sizing: border-box;
  }
  button,
  input,
  select {
    font: inherit;
    color: inherit;
  }
  button {
    cursor: pointer;
  }
  :focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: -2px;
  }
  .wb-menu,
  .wb-menu__submenu-panel {
    position: fixed;
    width: max-content;
    min-width: 200px;
    max-width: 300px;
    padding: 4px;
    border: 1px solid var(--border-default);
    border-radius: 4px;
    background: var(--menu-background);
    backdrop-filter: blur(16px);
    box-shadow: var(--shadow-menu);
  }
  .wb-menu__item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 25px;
    padding: 3px 10px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    text-align: left;
    white-space: nowrap;
  }
  .wb-menu__item:hover:not(.disabled),
  .wb-menu__submenu[data-open='true'] > .wb-menu__item {
    background: var(--surface-3);
  }
  .wb-menu__item.disabled {
    color: var(--text-disabled);
    cursor: not-allowed;
  }
  .wb-menu__check {
    width: 14px;
    display: flex;
    flex-shrink: 0;
    color: var(--accent-primary);
  }
  [data-has-checked='false'] .wb-menu__check {
    display: none;
  }
  .wb-menu__label {
    flex: 1;
  }
  .wb-menu__icon,
  .wb-menu__arrow {
    display: flex;
  }
  .wb-menu__shortcut {
    font: var(--text-xs) var(--font-mono);
    color: var(--text-tertiary);
    margin-left: 24px;
  }
  .wb-menu__separator {
    height: 1px;
    margin: 4px;
    background: var(--border-subtle);
  }
  .wb-menu__input {
    width: 100px;
    min-width: 0;
    background: var(--surface-2);
    border: 1px solid var(--border-default);
    border-radius: 4px;
    padding: 3px 6px;
  }
  .wb-outline-button,
  .wb-select {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 5px 12px;
    border: 1px solid var(--border-default);
    border-radius: 4px;
    background: var(--surface-3);
  }
  .wb-loading {
    padding: 12px;
    color: var(--text-secondary);
  }
`;
