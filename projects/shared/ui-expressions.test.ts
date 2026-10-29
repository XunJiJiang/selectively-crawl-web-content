import { describe, expect, it } from 'vitest';
import {
  parseProgram,
  parseTemplate,
  parseExpression,
  evaluateArgument,
  evaluateTemplate,
} from './ui-expressions.ts';
import type { UIValue } from './declarative-ui.ts';

describe('declarative handler expressions', () => {
  it('defaults a bare handler to the filtered event, while empty parentheses pass no arguments', () => {
    expect(parseProgram('save').branches[0][0].args).toEqual([{ type: 'event' }]);
    expect(parseProgram('save()').branches[0][0].args).toEqual([]);
  });
  it('parses quoted separators, explicit arguments, branches and previous values', async () => {
    const program = parseProgram(
      "core:string.trim($for:query)|save($prev, 123, 'a,b|c', $event),clicked($event)",
    );
    expect(program.branches.map((b) => b.length)).toEqual([2, 1]);
    const calls: UIValue[][] = [];
    let prev: UIValue | undefined;
    const event = { type: 'click', values: { query: ' abc ' } };
    for (const call of program.branches[0]) {
      prev = await evaluateArgument(call, {
        fields: { query: ' abc ' },
        event,
        prev,
        invoke: async (call, args) => {
          calls.push(args);
          return call.name === 'core:string.trim' ? String(args[0]).trim() : args;
        },
      });
    }
    expect(calls[1]).toEqual(['abc', 123, 'a,b|c', event]);
  });
  it('retains JSON types and observes nested watch expressions', async () => {
    const parts = parseTemplate("${core:default(watch:core:config.read('query'), 'fallback')}");
    expect(
      await evaluateTemplate(parts, {
        fields: {},
        invoke: async (call, args) =>
          call.name === 'core:config.read' ? null : args[0] === null ? args[1] : args[0],
      }),
    ).toBe('fallback');
    expect(
      await evaluateTemplate(parseTemplate('${123}'), { fields: {}, invoke: async () => null }),
    ).toBe(123);
    expect(parseTemplate('literal \\${value}')).toEqual(['literal ${value}']);
  });
  it.each([
    'a||b',
    'a,,b',
    'a,',
    'a(',
    'a($prev)',
    'core:ui:x()',
    'watch:core:ui:x()',
    'a(()=>1)',
    'a.constructor(1)',
    'a($event.foo)',
    'a([1,])',
  ])('rejects invalid or executable syntax: %s', (text) => {
    if (text === 'a.constructor(1)') {
      expect(parseProgram(text).branches[0][0].name).toBe('a.constructor');
    } // A registered flat name, never property access.
    else {
      expect(() => parseProgram(text)).toThrow();
    }
  });
  it.each([
    'ui:read()|save($prev)',
    'save()|ui:show($prev)',
    'save(ui:read())',
    "ui:show(core:get('x'))",
  ])('rejects cross-domain values: %s', (text) => expect(() => parseProgram(text)).toThrow());
  it('rejects event/previous variables in render templates and undefined previous results', async () => {
    expect(() => parseExpression('$event')).toThrow();
    expect(() => parseExpression('$prev')).toThrow();
    await expect(
      evaluateArgument({ type: 'prev' }, { fields: {}, invoke: async () => null }),
    ).rejects.toThrow('没有返回值');
  });
});
