import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import '../icon.ts';
import './wb-context-menu.ts';
import { emit, resolveMenuPresentation } from './helpers.ts';
import { menuStyles } from './styles.ts';

import type { ContextMenuItem, MenuPresentationMode } from './menu-types.ts';

export interface MenuSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

@customElement('wb-menu-select')
export class WbMenuSelect extends LitElement {
  @property({ type: String }) accessor value = '';
  @property({ attribute: false }) accessor options: MenuSelectOption[] = [];
  @property({ type: String }) accessor presentation: MenuPresentationMode = 'custom';
  @property({ type: String }) accessor label = '选择菜单项';
  @property({ type: Boolean }) accessor disabled = false;
  @property({ type: Boolean, reflect: true }) accessor compact = false;

  @state() private accessor menu: { x: number; y: number } | null = null;

  static styles = [
    menuStyles,
    css`
      :host {
        min-width: 132px;
        display: inline-flex;
      }

      .wb-menu-select__button,
      .wb-menu-select__native {
        width: 100%;
        min-width: 132px;
      }

      .wb-menu-select__button {
        justify-content: space-between;
      }

      .wb-menu-select__button span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      :host([compact]) {
        min-width: 90px;
      }
      :host([compact]) .wb-menu-select__button,
      :host([compact]) .wb-menu-select__native {
        min-width: 90px;
        min-height: 26px;
        height: 26px;
        padding: 2px 6px;
        border-radius: 0;
        box-shadow: none;
      }
    `,
  ];

  render() {
    if (resolveMenuPresentation(this.presentation) === 'native') {
      return html`<select
        class="wb-select wb-menu-select__native"
        .value=${this.value}
        ?disabled=${this.disabled}
        aria-label=${this.label}
        @change=${this.changeNative}
      >
        ${this.options.map(
          (option) =>
            html`<option value=${option.value} ?disabled=${option.disabled}>
              ${option.label}
            </option>`,
        )}
      </select>`;
    }

    const selected = this.options.find((option) => option.value === this.value);
    return html`<button
        class="wb-outline-button wb-menu-select__button"
        type="button"
        ?disabled=${this.disabled}
        aria-label=${this.label}
        aria-haspopup="menu"
        aria-expanded=${this.menu ? 'true' : 'false'}
        @click=${this.openMenu}
      >
        <span>${selected?.label ?? this.label}</span><wb-icon name="down" size="sm"></wb-icon>
      </button>
      ${this.menu
        ? html`<wb-context-menu
            .x=${this.menu.x}
            .y=${this.menu.y}
            .items=${this.menuItems()}
            .presentation=${this.presentation}
            .compact=${this.compact}
            @wb-menu-select=${this.selectCustom}
            @wb-menu-close=${this.closeMenu}
            @contextmenu=${(event: Event) => event.preventDefault()}
          ></wb-context-menu>`
        : ''}`;
  }

  private menuItems(): ContextMenuItem[] {
    return this.options.map((option) => ({
      kind: 'checkbox',
      id: `menu-select:${option.value}`,
      label: option.label,
      checked: option.value === this.value,
      disabled: option.disabled,
      action: () => undefined,
    }));
  }

  private changeNative = (event: Event): void => {
    this.commit((event.currentTarget as HTMLSelectElement).value);
  };

  private openMenu = (event: MouseEvent): void => {
    event.stopPropagation();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.menu = {
      x: Math.max(8, rect.right - 278),
      y: rect.bottom + 4,
    };
  };

  private selectCustom = (event: Event): void => {
    event.stopPropagation();
    const id = String((event as CustomEvent<{ id?: string }>).detail?.id ?? '');
    if (!id.startsWith('menu-select:')) {
      return;
    }
    this.commit(id.slice('menu-select:'.length));
    this.menu = null;
  };

  private closeMenu = (event?: Event): void => {
    event?.stopPropagation();
    this.menu = null;
  };

  private commit(value: string): void {
    const option = this.options.find((candidate) => candidate.value === value);
    if (!option || option.disabled || value === this.value) {
      return;
    }
    emit(this, 'wb-menu-change', { value });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wb-menu-select': WbMenuSelect;
  }
}
