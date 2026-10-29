import {
  hasOwn,
  UIError,
  uiAssert,
  uiName,
  safeKey,
  uiValue,
  type ArgumentNode,
  type CallNode,
  type TemplatePart,
  type UIProgram,
  type UIValue,
} from './declarative-ui.ts';

class Parser {
  text: string;
  position = 0;
  count = 0;
  constructor(text: string) {
    uiAssert(
      new TextEncoder().encode(text).length <= 4096,
      'UI_QUOTA_EXCEEDED',
      '表达式超过 4096 字节',
    );
    this.text = text;
  }
  fail(message = '模板语法无效'): never {
    throw new UIError('UI_INVALID_EXPRESSION', `${message}（位置 ${this.position}）`);
  }
  space() {
    while (/[\t\n\r ]/.test(this.text[this.position] ?? '') && this.position < this.text.length) {
      this.position++;
    }
  }
  take(token: string) {
    this.space();
    if (this.text.startsWith(token, this.position)) {
      this.position += token.length;
      return true;
    }
    return false;
  }
  name() {
    this.space();
    const name = this.text.slice(this.position).match(/^[A-Za-z0-9_.-]+/)?.[0];
    if (!name) {
      this.fail('缺少名称');
    }
    uiName(name);
    this.position += name.length;
    return name;
  }
  string(): string {
    const quote = this.text[this.position++];
    let result = '';
    while (this.position < this.text.length) {
      const char = this.text[this.position++];
      if (char === quote) {
        return result;
      }
      if (char === '\\') {
        const next = this.text[this.position++];
        if (next === 'u') {
          const hex = this.text.slice(this.position, this.position + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
            this.fail('Unicode 转义无效');
          }
          result += String.fromCharCode(parseInt(hex, 16));
          this.position += 4;
        } else {
          const escapes: Record<string, string> = {
            n: '\n',
            r: '\r',
            t: '\t',
            b: '\b',
            f: '\f',
            '\\': '\\',
            '/': '/',
            "'": "'",
            '"': '"',
          };
          if (!(next in escapes)) {
            this.fail('字符串转义无效');
          }
          result += escapes[next];
        }
      } else {
        if (char.charCodeAt(0) < 32) {
          this.fail('字符串含控制字符');
        }
        result += char;
      }
    }
    return this.fail('字符串未闭合');
  }
  call(depth = 0, bare = true): CallNode {
    this.space();
    let name = this.name();
    while (this.text[this.position] === ':') {
      this.position++;
      name += ':' + this.name();
    }
    uiAssert(
      /^(?:(?:watch:)?(?:core:|ui:)?)[A-Za-z0-9_.-]{1,64}$/.test(name),
      'UI_INVALID_HANDLER_NAME',
      '命名空间无效',
    );
    const watch = name.startsWith('watch:');
    const target = watch ? name.slice(6) : name;
    const args: ArgumentNode[] = [];
    if (this.take('(')) {
      if (!this.take(')')) {
        do {
          args.push(this.argument(depth + 1));
          uiAssert(args.length <= 16, 'UI_QUOTA_EXCEEDED', '实参过多');
        } while (this.take(','));
        if (!this.take(')')) {
          this.fail('缺少右括号');
        }
      }
    } else if (bare) {
      args.push({ type: 'event' });
    }
    uiAssert(++this.count <= 64, 'UI_QUOTA_EXCEEDED', '调用步骤过多');
    return {
      type: 'call',
      name: target,
      watch,
      args,
      domain: target.startsWith('ui:') ? 'frontend' : 'backend',
    };
  }
  argument(depth = 0): ArgumentNode {
    uiAssert(depth <= 8, 'UI_QUOTA_EXCEEDED', '表达式嵌套过深');
    this.space();
    const char = this.text[this.position];
    if (char === '"' || char === "'") {
      return { type: 'literal', value: this.string() };
    }
    if (this.take('$event')) {
      return { type: 'event' };
    }
    if (this.take('$prev')) {
      return { type: 'prev' };
    }
    if (this.take('$for:')) {
      return { type: 'field', name: this.name() };
    }
    if (this.take('[')) {
      const items: ArgumentNode[] = [];
      if (!this.take(']')) {
        do {
          items.push(this.argument(depth + 1));
        } while (this.take(','));
        if (!this.take(']')) {
          this.fail();
        }
      }
      return { type: 'array', items };
    }
    if (this.take('{')) {
      const entries: [string, ArgumentNode][] = [];
      if (!this.take('}')) {
        do {
          this.space();
          const key = ['"', "'"].includes(this.text[this.position]) ? this.string() : this.name();
          safeKey(key);
          if (!this.take(':') || entries.some(([k]) => k === key)) {
            this.fail('对象键重复或缺少冒号');
          }
          entries.push([key, this.argument(depth + 1)]);
        } while (this.take(','));
        if (!this.take('}')) {
          this.fail();
        }
      }
      return { type: 'object', entries };
    }
    const number = this.text
      .slice(this.position)
      .match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/)?.[0];
    if (number) {
      this.position += number.length;
      return { type: 'literal', value: uiValue(Number(number)) };
    }
    for (const [token, value] of [
      ['true', true],
      ['false', false],
      ['null', null],
    ] as const) {
      if (
        this.text.startsWith(token, this.position) &&
        !/[A-Za-z0-9_.:-]/.test(this.text[this.position + token.length] ?? '')
      ) {
        this.position += token.length;
        return { type: 'literal', value };
      }
    }
    return this.call(depth, false);
  }
  end() {
    this.space();
    if (this.position !== this.text.length) {
      this.fail('存在未识别内容');
    }
  }
}
export function walkArgument(node: ArgumentNode, visit: (node: ArgumentNode) => void) {
  visit(node);
  if (node.type === 'call') {
    node.args.forEach((arg) => walkArgument(arg, visit));
  }
  if (node.type === 'array') {
    node.items.forEach((arg) => walkArgument(arg, visit));
  }
  if (node.type === 'object') {
    node.entries.forEach(([, arg]) => walkArgument(arg, visit));
  }
}
export function parseProgram(text: string): UIProgram {
  const parser = new Parser(text);
  const branches: CallNode[][] = [];
  do {
    const chain: CallNode[] = [];
    do {
      const call = parser.call();
      uiAssert(chain.length < 16, 'UI_QUOTA_EXCEEDED', '调用链过长');
      walkArgument(call, (node) => {
        if (node.type === 'prev' && !chain.length) {
          throw new UIError('UI_PREV_UNAVAILABLE', '第一步不能引用 $prev');
        }
        if (node.type === 'call') {
          uiAssert(
            node.domain === call.domain,
            'UI_CROSS_DOMAIN_PIPE',
            '前后端不能通过实参传递处理器结果',
          );
        }
      });
      if (chain.length) {
        uiAssert(
          chain[0].domain === call.domain,
          'UI_CROSS_DOMAIN_PIPE',
          '前后端处理器不能通过管道传递数据',
        );
      }
      chain.push(call);
    } while (parser.take('|'));
    branches.push(chain);
    uiAssert(branches.length <= 8, 'UI_QUOTA_EXCEEDED', '分支过多');
  } while (parser.take(','));
  parser.end();
  return { branches };
}
export function parseExpression(text: string): ArgumentNode {
  const parser = new Parser(text);
  const expression = parser.argument();
  parser.end();
  let domain: string | undefined;
  walkArgument(expression, (node) => {
    uiAssert(
      node.type !== 'event' && node.type !== 'prev',
      'UI_INVALID_EXPRESSION',
      '渲染模板不能读取 $event 或 $prev',
    );
    if (node.type === 'call') {
      domain ??= node.domain;
      uiAssert(node.domain === domain, 'UI_CROSS_DOMAIN_PIPE', '前后端处理器不能嵌套传值');
    }
  });
  return expression;
}
export function parseTemplate(text: string): TemplatePart[] {
  const parts: TemplatePart[] = [];
  let plain = '';
  for (let p = 0; p < text.length;) {
    if (text.startsWith('\\${', p)) {
      plain += '${';
      p += 3;
      continue;
    }
    if (!text.startsWith('${', p)) {
      plain += text[p++];
      continue;
    }
    if (plain) {
      parts.push(plain);
      plain = '';
    }
    const begin = (p += 2);
    let depth = 0,
      quote = '',
      escaped = false;
    for (; p < text.length; p++) {
      const c = text[p];
      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (c === '\\') {
          escaped = true;
        } else if (c === quote) {
          quote = '';
        }
        continue;
      }
      if (c === "'" || c === '"') {
        quote = c;
      } else if (c === '{') {
        depth++;
      } else if (c === '}' && depth-- === 0) {
        break;
      }
    }
    uiAssert(p < text.length, 'UI_INVALID_EXPRESSION', '模板插值未闭合');
    parts.push(parseExpression(text.slice(begin, p++)));
  }
  if (plain || !parts.length) {
    parts.push(plain);
  }
  return parts;
}
export interface EvaluationScope {
  event?: UIValue;
  prev?: UIValue;
  fields: Record<string, UIValue>;
  invoke(call: CallNode, args: UIValue[]): Promise<UIValue | undefined>;
}
export async function evaluateArgument(
  node: ArgumentNode,
  scope: EvaluationScope,
): Promise<UIValue | undefined> {
  if (node.type === 'literal') {
    return node.value;
  }
  if (node.type === 'event') {
    uiAssert(scope.event !== undefined, 'UI_INVALID_EXPRESSION', '事件上下文不可用');
    return scope.event;
  }
  if (node.type === 'prev') {
    uiAssert(scope.prev !== undefined, 'UI_NO_RETURN_VALUE', '上一处理器没有返回值');
    return scope.prev;
  }
  if (node.type === 'field') {
    uiAssert(hasOwn(scope.fields, node.name), 'UI_UNKNOWN_VALUE', `未采集字段 ${node.name}`);
    return scope.fields[node.name];
  }
  const nodes =
    node.type === 'object'
      ? node.entries.map(([, v]) => v)
      : node.type === 'array'
        ? node.items
        : node.args;
  const args: UIValue[] = [];
  for (const argument of nodes) {
    const result = await evaluateArgument(argument, scope);
    uiAssert(result !== undefined, 'UI_NO_RETURN_VALUE', '实参处理器没有返回值');
    args.push(result);
  }
  if (node.type === 'array') {
    return args;
  }
  if (node.type === 'object') {
    return Object.fromEntries(node.entries.map(([key], i) => [key, args[i]]));
  }
  uiValue(args);
  const result = await scope.invoke(node, args);
  return result === undefined ? undefined : uiValue(result);
}
export async function evaluateTemplate(
  parts: TemplatePart[],
  scope: EvaluationScope,
): Promise<UIValue> {
  const values: UIValue[] = [];
  for (const part of parts) {
    const value = typeof part === 'string' ? part : await evaluateArgument(part, scope);
    uiAssert(value !== undefined, 'UI_NO_RETURN_VALUE', '模板处理器没有返回值');
    values.push(value);
  }
  if (parts.length === 1 && typeof parts[0] !== 'string') {
    return values[0];
  }
  return values
    .map((value) => {
      uiAssert(
        value === null || typeof value !== 'object',
        'UI_INVALID_VALUE_TYPE',
        '对象需要显式 JSON 序列化',
      );
      return value === null ? '' : String(value);
    })
    .join('');
}
