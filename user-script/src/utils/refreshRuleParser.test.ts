import { describe, expect, it } from 'vitest';
import { RefreshRuleParser, type TParseResult } from './refreshRuleParser';
import { cloneDeep } from 'es-toolkit';

describe('RefreshRuleParser', () => {
  const parser = new RefreshRuleParser();
  const baseResult: TParseResult = {
    pathname: {
      base: 'i',
      segments: [],
    },
    search: {
      base: 'i',
      params: new Map(),
    },
    hash: {
      base: 'i',
      segments: [],
    },
  }
  const rules = {
    i: { rule: 'i' },
    c: { rule: 'c' },
    a: { rule: 'a' },
    d: { rule: 'd' },
  } as const;

  const pathnameTestCases = [
    { rule: '', expected: { base: 'i', segments: [] } },
    { rule: '//', expected: { base: 'c', segments: [] } },
    { rule: '//\\i', expected: { base: 'i', segments: [rules.i] } },
    { rule: '//\\a', expected: { base: 'a', segments: [rules.a] } },
    { rule: '//\\a/', expected: { base: 'i', segments: [rules.a] } },
    { rule: '//\\a/\\d', expected: { base: 'd', segments: [rules.a, rules.d] } },
    { rule: '//\\a/\\c/', expected: { base: 'i', segments: [rules.a, rules.c] } },
    { rule: '//\\a/\\c/\\d', expected: { base: 'd', segments: [rules.a, rules.c, rules.d] } },
    { rule: '//\\a/\\c/\\i/\\c', expected: { base: 'c', segments: [rules.a, rules.c, rules.i, rules.c] } },
    { rule: '//\\a/\\c/\\i/\\c/\\d/\\a/\\c/\\i/\\d/\\c', expected: { base: 'c', segments: [rules.a, rules.c, rules.i, rules.c, rules.d, rules.a, rules.c, rules.i, rules.d, rules.c] } },
  ];

  for (const idx in pathnameTestCases) {
    const { rule, expected } = pathnameTestCases[idx];
    it(`pathname segments success: ${rule}, idx: ${idx}`, () => {
      const { result, /* info, state */ } = parser.parse(rule);
      const expectedResult = {
        ...cloneDeep(baseResult),
        pathname: expected,
      }
      expect(result).toEqual(expectedResult);
    })
  }

  const searchTestCases = [
    { rule: '', expected: { base: 'i', params: new Map() } },
    { rule: '?', expected: { base: 'c', params: new Map() } },
    { rule: '?\\i', expected: { base: 'i', params: new Map() } },
    { rule: '?\\a', expected: { base: 'a', params: new Map() } },
    { rule: '?\\cparam', expected: { base: 'i', params: new Map([['param', 'c']]) } },
    { rule: '?\\iparam&\\c', expected: { base: 'c', params: new Map([['param', 'i']]) } },
    { rule: '?\\aparam&param2', expected: { base: 'i', params: new Map([['param', 'a'], ['param2', 'c']]) } },
    { rule: '?\\aparam&\\iparam2', expected: { base: 'i', params: new Map([['param', 'a'], ['param2', 'i']]) } },
    { rule: '?\\aparam&\\iparam2&\\cparam3', expected: { base: 'i', params: new Map([['param', 'a'], ['param2', 'i'], ['param3', 'c']]) } },
    { rule: '?\\aparam&\\iparam2&\\cparam3&\\d', expected: { base: 'd', params: new Map([['param', 'a'], ['param2', 'i'], ['param3', 'c']]) } },
    { rule: '?\\aparam&\\iparam2&\\d&\\cparam3', expected: { base: 'd', params: new Map([['param', 'a'], ['param2', 'i'], ['param3', 'c']]) } },
    { rule: '?\\d&\\aparam&\\iparam2&\\cparam3', expected: { base: 'd', params: new Map([['param', 'a'], ['param2', 'i'], ['param3', 'c']]) } },
    { rule: '?\\a&\\aparam&\\iparam2&\\cparam3&\\iparam4&\\iparam5&\\dparam6&\\aparam7&\\cparam8&\\cparam9', expected: { base: 'a', params: new Map([['param', 'a'], ['param2', 'i'], ['param3', 'c'], ['param4', 'i'], ['param5', 'i'], ['param6', 'd'], ['param7', 'a'], ['param8', 'c'], ['param9', 'c']]) } },
  ];

  for (const idx in searchTestCases) {
    const { rule, expected } = searchTestCases[idx];
    it(`search params success: ${rule}, idx: ${idx}`, () => {
      const { result, /* info, state */ } = parser.parse(rule);
      const expectedResult = {
        ...cloneDeep(baseResult),
        search: expected,
      }
      expect(result).toEqual(expectedResult);
    })
  }

  const hashTestCases = [
    { rule: '', expected: { base: 'i', segments: [] } },
    { rule: '#', expected: { base: 'c', segments: [] } },
    { rule: '#\\i', expected: { base: 'i', segments: [rules.i] } },
    { rule: '#\\a', expected: { base: 'a', segments: [rules.a] } },
    { rule: '#\\a/', expected: { base: 'i', segments: [rules.a] } },
    { rule: '#\\a/\\d', expected: { base: 'd', segments: [rules.a, rules.d] } },
    { rule: '#\\a/\\c/', expected: { base: 'i', segments: [rules.a, rules.c] } },
    { rule: '#\\a/\\c/\\d', expected: { base: 'd', segments: [rules.a, rules.c, rules.d] } },
    { rule: '#\\a/\\c/\\i/\\c', expected: { base: 'c', segments: [rules.a, rules.c, rules.i, rules.c] } },
    { rule: '#\\a/\\c/\\i/\\c/\\d/\\a/\\c/\\i/\\d/\\c', expected: { base: 'c', segments: [rules.a, rules.c, rules.i, rules.c, rules.d, rules.a, rules.c, rules.i, rules.d, rules.c] } },
  ];

  for (const idx in hashTestCases) {
    const { rule, expected } = hashTestCases[idx];
    it(`hash segments success: ${rule}, idx: ${idx}`, () => {
      const { result, /* info, state */ } = parser.parse(rule);
      const expectedResult = {
        ...cloneDeep(baseResult),
        hash: expected,
      }
      expect(result).toEqual(expectedResult);
    })
  }

  // 组合测试
  for (const idx in pathnameTestCases) {
    const { rule: pathnameRule, expected: pathnameExpected } = pathnameTestCases[idx];
    for (const idx2 in searchTestCases) {
      const { rule: searchRule, expected: searchExpected } = searchTestCases[idx2];
      for (const idx3 in hashTestCases) {
        const { rule: hashRule, expected: hashExpected } = hashTestCases[idx3];
        const combinedRules = [
          [`${pathnameRule}${searchRule}${hashRule}`, `p${idx}-s${idx2}-h${idx3}`],
          [`${pathnameRule}${hashRule}${searchRule}`, `p${idx}-h${idx3}-s${idx2}`],
          [`${searchRule}${pathnameRule}${hashRule}`, `s${idx2}-p${idx}-h${idx3}`],
          [`${searchRule}${hashRule}${pathnameRule}`, `s${idx2}-h${idx3}-p${idx}`],
          [`${hashRule}${pathnameRule}${searchRule}`, `h${idx3}-p${idx}-s${idx2}`],
          [`${hashRule}${searchRule}${pathnameRule}`, `h${idx3}-s${idx2}-p${idx}`],
        ];
        const expectedResult = {
          pathname: pathnameExpected,
          search: searchExpected,
          hash: hashExpected,
        }
        for (const combinedRule of combinedRules) {
          it(`combination success: ${combinedRule[0]}, idx: ${combinedRule[1]}`, () => {
            const { result, /* info, state */ } = parser.parse(combinedRule[0]);
            expect(result).toEqual(expectedResult);
          })
        }
      }
    }
  }
});
