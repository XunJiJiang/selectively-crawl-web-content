import { expect, it } from 'vitest';
import { WbIcon } from './icon.ts';
import '../../../user-script/src/icons.ts';

it('keeps the full icon registration when the userscript loads after the workbench', async () => {
  expect(customElements.get('wb-icon')).toBe(WbIcon);
  const icon = document.createElement('wb-icon') as WbIcon;
  icon.name = 'settings';
  document.body.append(icon);
  await icon.updateComplete;
  expect(icon.shadowRoot?.querySelector('.codicon-settings-gear')).not.toBeNull();
  icon.remove();
});
