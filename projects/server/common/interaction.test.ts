import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatInput, setInputHandler } from './interaction.ts';
import { TaskRegistry } from './tasks.ts';

afterEach(() => setInputHandler());
describe('interactive invocation input', () => {
  it('formats primitive input strictly and preserves string whitespace', () => {
    expect(formatInput('  ', 'string')).toBe('  ');
    expect(formatInput(' 3.5 ', 'number')).toBe(3.5);
    expect(formatInput('FALSE', 'boolean')).toBe(false);
    expect(formatInput('yes', 'boolean')).toBe(true);
    expect(formatInput('9007199254740993', 'bigint')).toBe(9007199254740993n);
    expect(formatInput('2026-10-08T00:00:00Z', 'date')).toEqual(new Date('2026-10-08T00:00:00Z'));
    for (const value of ['', 'NaN', 'Infinity', '12a']) {
      expect(() => formatInput(value, 'number')).toThrow('有效');
    }
    expect(() => formatInput('maybe', 'boolean')).toThrow('true/false');
    expect(() => formatInput('1.5', 'bigint')).toThrow('有效');
    expect(() => formatInput('invalid', 'date')).toThrow('有效');
  });
  it('retries invalid input with the same identity and keeps waiting work busy after return', async () => {
    const handler = vi.fn().mockResolvedValueOnce('invalid').mockResolvedValueOnce('42');
    setInputHandler(handler);
    const registry = new TaskRegistry();
    const scope = registry.create('core', { executionId: 'a', windowId: 'w' });
    const input = scope.context.next('请输入数量', Number);
    scope.finish();
    expect(registry.busy()).toBe(true);
    expect(await input).toEqual([undefined, 42]);
    expect(handler.mock.calls[1][0]).toMatchObject({
      message: '请输入有效的 number\n请输入数量',
      identity: scope.identity,
    });
    expect(registry.busy()).toBe(false);
  });
  it('isolates simultaneous windows and rejects a second prompt in the same invocation', async () => {
    const answers = new Map<string, (value: string) => void>();
    setInputHandler(
      (request, signal) =>
        new Promise((resolve, reject) => {
          answers.set(request.identity.executionId, resolve);
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    );
    const registry = new TaskRegistry();
    const a = registry.create('core', { executionId: 'a', windowId: 'w' });
    const b = registry.create('core', { executionId: 'b', windowId: 'v' });
    const first = a.context.next('a', String);
    const second = b.context.next('b', Boolean);
    expect(await a.context.next('duplicate')).toEqual([
      expect.objectContaining({ name: 'InvocationInputError', code: 'busy' }),
      undefined,
    ]);
    answers.get('b')?.('false');
    expect(await second).toEqual([undefined, false]);
    a.cancel();
    expect(await first).toEqual([
      expect.objectContaining({ name: 'InvocationInputError', code: 'cancelled' }),
      undefined,
    ]);
    a.finish();
    b.finish();
    expect(registry.busy()).toBe(false);
  });
});
