import { afterEach, expect, it } from 'vitest';
import { UserScriptIcon } from './icons.ts';
import './theme.ts';

afterEach(() => document.body.replaceChildren());
it.each(['list-selection', 'plugins', 'chrome-minimize', 'right', 'down', 'check'])(
  'renders %s as an inline SVG before shared menus register their font icon',
  async (name) => {
    const icon = document.createElement('wb-icon') as UserScriptIcon;
    icon.name = name;
    document.body.append(icon);
    await icon.updateComplete;
    expect(icon).toBeInstanceOf(UserScriptIcon);
    expect(icon.shadowRoot?.querySelector('svg[fill="currentColor"] path')).not.toBeNull();
    expect(icon.shadowRoot?.querySelector('image, use, img')).toBeNull();
    expect(icon.shadowRoot?.innerHTML).not.toMatch(/@font-face|data:font|url\(/);
  },
);
