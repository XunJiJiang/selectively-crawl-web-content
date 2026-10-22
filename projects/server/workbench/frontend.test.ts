import { describe, expect, it } from 'vitest';
import { defaultSnapshot, validateSnapshot } from './workspace.ts';
import {
  addTab,
  defaultLayout,
  focusTab,
  groups,
  internalTab,
  mergeGroups,
  moveTab,
  navigateTab,
  newPluginTab,
  splitGroup,
} from '../../web/src/workbench/model.ts';

function fixture() {
  const s = defaultSnapshot();
  const url = 'http://localhost/web/page/plugin/notes/a?x=1&x=2#draft';
  const tab = newPluginTab('notes', '资料库', url, {
    installationId: 'i',
    pluginId: 'notes',
    path: '/a',
    search: '?x=1&x=2',
    hash: '#draft',
  });
  addTab(s, tab);
  return { s, tab };
}
describe('frontend snapshots satisfy the real backend layout contract', () => {
  it('appends a dropped tab and collapses its empty source group without introducing missing IDs', () => {
    const { s, tab } = fixture();
    const settings = internalTab('settings');
    addTab(s, settings);
    splitGroup(s, 'horizontal', tab.id);
    const first = groups(s.layout.center)[0];
    moveTab(s, tab.id, first.id);
    expect(groups(s.layout.center)).toHaveLength(1);
    expect(groups(s.layout.center)[0].tabIds).toEqual([settings.id, tab.id]);
    const before = JSON.stringify(s);
    moveTab(s, '', first.id);
    expect(JSON.stringify(s)).toBe(before);
    validateSnapshot(s);
  });
  it('preserves every tab exactly once across recursive splits, moves and merges', () => {
    const { s, tab } = fixture();
    addTab(s, internalTab('settings'));
    focusTab(s, tab.id);
    splitGroup(s, 'horizontal', tab.id);
    validateSnapshot(s);
    splitGroup(s, 'vertical', tab.id);
    validateSnapshot(s);
    const original = groups(s.layout.center)[0];
    moveTab(s, tab.id, original.id, 0);
    validateSnapshot(s);
    expect(s.tabs.filter((t) => t.id === tab.id)).toHaveLength(1);
    expect(
      groups(s.layout.center)
        .flatMap((g) => g.tabIds)
        .filter((id) => id === tab.id),
    ).toHaveLength(1);
    mergeGroups(s);
    validateSnapshot(s);
    expect(groups(s.layout.center)).toHaveLength(1);
    expect(s.tabs).toHaveLength(2);
  });
  it('keeps independent navigation and exact repeated query/hash; truncates forward entries only on a new push', () => {
    const { s, tab } = fixture();
    const other = newPluginTab('notes', 'same plugin', tab.url, tab.locator);
    addTab(s, other);
    const next = 'http://localhost/web/page/plugin/notes/b?x=2&x=1#b';
    navigateTab(tab, next, { ...tab.locator, path: '/b', search: '?x=2&x=1', hash: '#b' });
    navigateTab(
      tab,
      'http://localhost/web/page/plugin/notes/a?x=1&x=2#draft',
      { ...tab.locator, path: '/a', search: '?x=1&x=2', hash: '#draft' },
      'traverse',
      0,
    );
    expect(tab.navigation.entries).toHaveLength(2);
    expect(other.navigation.entries).toHaveLength(1);
    navigateTab(tab, 'http://localhost/web/page/plugin/notes/c', {
      ...tab.locator,
      path: '/c',
      search: '',
      hash: '',
    });
    expect(tab.navigation.entries).toHaveLength(2);
    expect(tab.navigation.entries[1]).toMatchObject({
      url: 'http://localhost/web/page/plugin/notes/c',
    });
    validateSnapshot(s);
  });
  it('restores visual defaults without discarding logical tabs or retained sizes on hide', () => {
    const { s, tab } = fixture();
    s.layout.mainSidebar.size = 420;
    s.layout.mainSidebar.visible = false;
    validateSnapshot(s);
    expect(s.layout.mainSidebar.size).toBe(420);
    splitGroup(s, 'horizontal', tab.id);
    defaultLayout(s);
    validateSnapshot(s);
    expect(s.tabs[0]).toBe(tab);
    expect(s.layout.mainSidebar.size).toBe(280);
    expect(s.layout.panel.height).toBe(240);
  });
});
