import { afterEach, expect, it } from 'vitest';
import { UserScriptIcon } from './icons.ts';
import './theme.ts';
import { WbIcon } from '../../web/src/components/icon.ts';

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

it.each([
  'pages',
  'history',
  'search',
  'settings',
  'close',
  'refresh',
  'sidebar',
  'panel',
  'arrow-left',
])('preserves %s when the userscript registers before the workbench', async (name) => {
  const registered = customElements.get('wb-icon');
  const icon = document.createElement('wb-icon') as UserScriptIcon;
  icon.name = name;
  document.body.append(icon);
  await icon.updateComplete;
  expect(registered).toBe(UserScriptIcon);
  expect(WbIcon).not.toBe(registered);
  expect(customElements.get('wb-icon')).toBe(registered);
  expect(icon.shadowRoot?.querySelector('svg')).not.toBeNull();
  expect(icon.shadowRoot?.querySelector('image,use,img')).toBeNull();
});

it('renders unknown names with the inline question fallback under strict font-src', async () => {
  const icon = document.createElement('wb-icon') as UserScriptIcon;
  icon.name = 'missing-icon-name';
  document.body.append(icon);
  await icon.updateComplete;
  expect(icon.shadowRoot?.querySelector('svg')).not.toBeNull();
  expect(icon.shadowRoot?.innerHTML).not.toMatch(/@font-face|data:font|url\(/);
});
