import { describe, expect, it } from 'vitest';
import { shouldRefreshUrl } from './refreshRuleMatcher.ts';

const origin = 'https://example.com';
describe('URL refresh rule execution', () => {
  it.each([
    ['//', '/a', '/b', true],
    ['//', '/a?q=1#x', '/a?q=2#y', false],
    ['', '/a?q=1#x', '/b?q=2#y', false],
    ['//\\c/', '/a/one', '/a/two', false],
    ['//\\c/', '/a/one', '/b/one', true],
    ['//\\a', '/a', '/a/b', true],
    ['//\\a', '/a', '/b', false],
    ['//\\d', '/a/b', '/a', true],
    ['//\\d', '/a', '/b', false],
    ['?q', '/?q=1&other=1', '/?q=1&other=2', false],
    ['?q', '/?q=1', '/?q=2', true],
    ['?\\aq', '/', '/?q=', true],
    ['?\\aq', '/?q=1', '/?q=2', false],
    ['?\\dq', '/?q=', '/', true],
    ['?', '/?a=1&b=2&a=3', '/?b=2&a=3&a=1', false],
    ['?', '/?a=1&a=3', '/?a=1&a=4', true],
    ['#\\c/', '/#/book/1', '/#/book/2', false],
    ['#', '/#book/1', '/#book/2', true],
  ])('%s compares %s → %s', (rule, before, after, expected) => {
    expect(shouldRefreshUrl(origin + before, origin + after, rule)).toBe(expected);
  });
  it('always refreshes across origins', () =>
    expect(shouldRefreshUrl(origin, 'https://other.com', '')).toBe(true));
});
