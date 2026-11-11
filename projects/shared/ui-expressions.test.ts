import { describe, expect, it } from 'vitest';
import {
  parseProgram,
  parseTemplate,
  parseExpression,
  evaluateArgument,
  evaluateTemplate,
  parseValidator,
} from './ui-expressions.ts';
import { validateUIValue } from './ui-validation.ts';
import type { UIValue, UIField } from './declarative-ui.ts';

describe('declarative handler expressions', () => {
  it('checks field references in templates and aborts the consumer on dependency failure', async () => {
    const fieldDefinitions: UIField[] = [
      {
        name: 'q',
        nodeId: 'q',
        kind: 'string',
        validation: { rules: {}, validator: parseValidator('check($this,$for:other)', 'q') },
      },
      { name: 'other', nodeId: 'other', kind: 'string', validation: { rules: { minLength: 3 } } },
    ];
    const calls: string[] = [];
    const scope = {
      fields: { q: 'draft', other: 'x' },
      fieldDefinitions,
      invoke: async (call: { name: string }) => {
        calls.push(call.name);
        return { success: true };
      },
    };
    await expect(
      evaluateTemplate(parseTemplate('${consume($for:q)}'), scope),
    ).rejects.toMatchObject({ field: 'other' });
    expect(calls).toEqual([]);
    scope.fields.other = 'valid';
    await evaluateArgument(parseExpression('consume($for:q)'), scope);
    expect(calls).toEqual(['check', 'consume']);
    scope.fields.other = 'x';
    await expect(evaluateArgument(parseExpression('consume($for:q)'), scope)).rejects.toMatchObject(
      { field: 'other' },
    );
    expect(calls).toEqual(['check', 'consume']);
  });
  it('also validates core:value.read and reports the originating control for malformed validators', async () => {
    const fieldDefinitions: UIField[] = [
      {
        name: 'q',
        nodeId: 'q',
        kind: 'string',
        validation: { rules: {}, validator: parseValidator('check($this)', 'q') },
      },
    ];
    const calls: string[] = [];
    await expect(
      evaluateArgument(parseExpression('core:value.read("q")'), {
        fields: { q: 'invalid' },
        fieldDefinitions,
        invoke: async (call) => {
          calls.push(call.name);
          return true;
        },
      }),
    ).rejects.toMatchObject({ code: 'UI_INVALID_VALIDATOR_RESULT', field: 'q' });
    expect(calls).toEqual(['check']);
  });
  it('defaults a bare handler to the filtered event, while empty parentheses pass no arguments', () => {
    expect(parseProgram('save').branches[0][0].args).toEqual([{ type: 'event' }]);
    expect(parseProgram('save()').branches[0][0].args).toEqual([]);
  });
  it.each(['load', 'watch:query', 'core:get', 'core:string.trim(load)', 'check($this, other)'])(
    'requires explicit calls outside top-level event steps: %s',
    (text) => {
      expect(() => parseExpression(text)).toThrow();
      expect(() => parseValidator(text, 'query')).toThrow();
    },
  );
  it('resolves the current validation control and other controls without using event.value', async () => {
    const call = parseValidator('check($this, $for:other, core:string.trim($this))', 'query');
    const calls: unknown[] = [];
    await evaluateArgument(call, {
      fields: { query: ' typed ', other: 'peer' },
      event: { value: 'forged' },
      invoke: async (node, args) => {
        expect(node.readOnly).toBe(true);
        calls.push([node.name, args]);
        return node.name === 'core:string.trim' ? String(args[0]).trim() : { success: true };
      },
    });
    expect(calls).toEqual([
      ['core:string.trim', [' typed ']],
      ['check', [' typed ', 'peer', 'typed']],
    ]);
    expect(() => parseProgram('save(check)')).toThrow('括号');
    expect(() => parseProgram('save($this)')).toThrow('验证器');
    expect(() => parseValidator('check($event)', 'query')).toThrow();
    expect(() => parseValidator('watch:check()', 'query')).toThrow();
  });
  it.each([
    null,
    true,
    false,
    'yes',
    1,
    [],
    {},
    { success: 1 },
    { success: true, message: 1 },
    { success: true, extra: 1 },
    undefined,
  ])('rejects malformed validation results: %j', async (result) => {
    await expect(
      evaluateArgument(parseValidator('check($this)', 'query'), {
        fields: { query: 'value' },
        invoke: async () => result as UIValue,
      }),
    ).rejects.toMatchObject({ code: 'UI_INVALID_VALIDATOR_RESULT' });
  });
  it('displays custom validation messages and checks static constraints without coercing values', async () => {
    await expect(
      evaluateArgument(parseValidator('check()', 'query'), {
        fields: { query: 'value' },
        invoke: async () => ({ success: false, message: '两次输入必须一致' }),
      }),
    ).rejects.toThrow('两次输入必须一致');
    const rules = {
      minLength: 2,
      maxLength: 4,
      pattern: '[A-Z]+',
      patternMessage: '只能输入大写字母',
    };
    expect(validateUIValue('AB', rules)).toBe('AB');
    expect(() => validateUIValue('A', rules)).toThrow('至少');
    expect(() => validateUIValue('ABCDE', rules)).toThrow('最多');
    expect(() => validateUIValue('ab', rules)).toThrow('只能输入大写字母');
    expect(validateUIValue('2.5', { min: 2, max: 3, minLength: 3, maxLength: 3 })).toBe('2.5');
    for (const value of ['', 'Infinity', '1', '4']) {
      expect(() => validateUIValue(value, { min: 2, max: 3 })).toThrow();
    }
    for (const rules of [
      { min: 3, max: 2 },
      { minLength: -1 },
      { maxLength: 1.5 },
      { pattern: '[' },
      { patternMessage: 'missing pattern' },
    ] as UIValue[]) {
      expect(() => validateUIValue('', rules)).toThrow();
    }
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
