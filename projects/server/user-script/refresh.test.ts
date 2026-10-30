import { describe, expect, it } from 'vitest';
import { pluginRefreshRule, shouldRefreshPlugin } from './refresh.ts';
import { matchLink } from '../router/utils/index.ts';

const scripts = {
  title: 'test',
  controls: [],
  refreshRule: '//',
  refreshRules: [
    { sites: ['https://one.example/*'], rule: '?q' },
    { sites: ['https://two.example/*'], rule: '#' },
  ],
};
describe('plugin-owned per-website refresh policy', () => {
  it('uses the first matching website declaration and the plugin default elsewhere', () => {
    expect(pluginRefreshRule(scripts, 'https://one.example/a')).toBe('?q');
    expect(pluginRefreshRule(scripts, 'https://two.example/a')).toBe('#');
    expect(pluginRefreshRule(scripts, 'https://other.example/a')).toBe('//');
    expect(matchLink('https://other.example/a', ['https://one.example/*'])).toBe(false);
  });
  it('evaluates each plugin independently and always loads newly matching plugins', () => {
    const links = ['https://one.example/*'];
    expect(
      shouldRefreshPlugin(scripts, links, 'https://one.example/a?q=1', 'https://one.example/b?q=1'),
    ).toBe(false);
    expect(
      shouldRefreshPlugin(
        { title: 'path', controls: [] },
        links,
        'https://one.example/a?q=1',
        'https://one.example/b?q=1',
      ),
    ).toBe(true);
    expect(
      shouldRefreshPlugin(scripts, links, 'https://one.example/a?q=1', 'https://one.example/b?q=2'),
    ).toBe(true);
    expect(
      shouldRefreshPlugin(
        { ...scripts, refreshRule: '', refreshRules: [] },
        ['https://one.example/special'],
        'https://one.example/a',
        'https://one.example/special',
      ),
    ).toBe(true);
  });
});
