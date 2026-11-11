import { uiAssert, UIError, hasOwn, type UIValue } from './declarative-ui.ts';

export function validateUIRules(rules: Record<string, UIValue>) {
  uiAssert(
    Object.keys(rules).every((key) =>
      [
        'codec',
        'min',
        'max',
        'minLength',
        'maxLength',
        'pattern',
        'patternMessage',
        'options',
      ].includes(key),
    ),
    'UI_INVALID_CONTENT',
    '校验规则含未知字段',
  );
  for (const key of ['min', 'max', 'minLength', 'maxLength']) {
    const value = rules[key];
    uiAssert(
      value === undefined ||
        (typeof value === 'number' &&
          Number.isFinite(value) &&
          (!key.endsWith('Length') || (Number.isInteger(value) && value >= 0))),
      'UI_INVALID_CONTENT',
      `${key} 必须为有效${key.endsWith('Length') ? '非负整数' : '数字'}`,
    );
  }
  for (const [min, max] of [
    ['min', 'max'],
    ['minLength', 'maxLength'],
  ]) {
    uiAssert(
      rules[min] === undefined ||
        rules[max] === undefined ||
        Number(rules[min]) <= Number(rules[max]),
      'UI_INVALID_CONTENT',
      `${min} 不能大于 ${max}`,
    );
  }
  uiAssert(
    rules.codec === undefined ||
      ['string', 'boolean', 'number', 'integer'].includes(String(rules.codec)),
    'UI_INVALID_CONTENT',
    '校验类型无效',
  );
  uiAssert(
    rules.options === undefined || Array.isArray(rules.options),
    'UI_INVALID_CONTENT',
    'options 必须为数组',
  );
  uiAssert(
    rules.patternMessage === undefined || typeof rules.patternMessage === 'string',
    'UI_INVALID_CONTENT',
    'patternMessage 必须为字符串',
  );
  uiAssert(
    rules.patternMessage === undefined || rules.pattern !== undefined,
    'UI_INVALID_CONTENT',
    'patternMessage 需要 pattern',
  );
  if (rules.pattern !== undefined) {
    uiAssert(
      typeof rules.pattern === 'string',
      'UI_INVALID_CONTENT',
      'pattern 必须为正则表达式字符串',
    );
    try {
      new RegExp(rules.pattern, 'u');
      new RegExp(`^(?:${rules.pattern})$(?![\\s\\S])`, 'u');
    } catch {
      throw new UIError('UI_INVALID_CONTENT', 'pattern 正则表达式无效');
    }
  }
}

export function assertUIValidationResult(value: unknown): void {
  uiAssert(
    value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      hasOwn(value, 'success') &&
      'success' in value &&
      typeof value.success === 'boolean' &&
      (!('message' in value) || typeof value.message === 'string') &&
      Object.keys(value).every((key) => key === 'success' || key === 'message'),
    'UI_INVALID_VALIDATOR_RESULT',
    '验证控制器必须返回 { success: boolean, message?: string }',
  );
  uiAssert(
    value.success,
    'UI_VALIDATION_FAILED',
    'message' in value && value.message ? String(value.message) : '输入验证未通过',
  );
}

/** Validate without coercing: number inputs and plugin configuration remain strings. */
export function validateUIValue(value: UIValue, rules: UIValue): UIValue {
  uiAssert(
    rules !== null && typeof rules === 'object' && !Array.isArray(rules),
    'UI_INVALID_VALUE_TYPE',
    '需要校验规则',
  );
  validateUIRules(rules);
  if (rules.minLength !== undefined) {
    uiAssert(
      typeof value === 'string' && value.length >= Number(rules.minLength),
      'UI_INVALID_VALUE_TYPE',
      `至少输入 ${rules.minLength} 个字符`,
    );
  }
  if (rules.maxLength !== undefined) {
    uiAssert(
      typeof value === 'string' && value.length <= Number(rules.maxLength),
      'UI_INVALID_VALUE_TYPE',
      `最多输入 ${rules.maxLength} 个字符`,
    );
  }
  if (rules.pattern !== undefined) {
    uiAssert(
      typeof value === 'string' &&
        new RegExp(`^(?:${rules.pattern})$(?![\\s\\S])`, 'u').test(value),
      'UI_VALIDATION_FAILED',
      typeof rules.patternMessage === 'string' && rules.patternMessage
        ? rules.patternMessage
        : '输入格式不匹配',
    );
  }
  if (rules.options) {
    uiAssert(
      Array.isArray(rules.options) &&
        rules.options.some((option) => JSON.stringify(option) === JSON.stringify(value)),
      'UI_INVALID_VALUE_TYPE',
      '值不在选项中',
    );
  }
  if (rules.codec === 'string') {
    uiAssert(typeof value === 'string', 'UI_INVALID_VALUE_TYPE', '需要字符串');
  }
  if (rules.codec === 'boolean') {
    uiAssert(
      typeof value === 'boolean' || value === 'true' || value === 'false',
      'UI_INVALID_VALUE_TYPE',
      '需要布尔值',
    );
  }
  if (
    rules.codec === 'number' ||
    rules.codec === 'integer' ||
    rules.min !== undefined ||
    rules.max !== undefined
  ) {
    const numeric =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value)
          ? Number(value)
          : NaN;
    uiAssert(
      Number.isFinite(numeric) &&
        (rules.codec !== 'integer' || Number.isInteger(numeric)) &&
        (rules.min === undefined || numeric >= Number(rules.min)) &&
        (rules.max === undefined || numeric <= Number(rules.max)),
      'UI_INVALID_VALUE_TYPE',
      '数值不符合声明式规则',
    );
  }
  return value;
}
