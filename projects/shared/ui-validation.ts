import { uiAssert, type UIValue } from './declarative-ui.ts';

/** Validate without coercing: number inputs and plugin configuration remain strings. */
export function validateUIValue(value: UIValue, rules: UIValue): UIValue {
  uiAssert(
    rules !== null && typeof rules === 'object' && !Array.isArray(rules),
    'UI_INVALID_VALUE_TYPE',
    '需要校验规则',
  );
  uiAssert(
    Object.keys(rules).every((key) =>
      ['codec', 'min', 'max', 'maxLength', 'options'].includes(key),
    ),
    'UI_INVALID_CONTENT',
    '校验规则含未知字段',
  );
  if (rules.maxLength !== undefined) {
    uiAssert(
      typeof value === 'string' && value.length <= Number(rules.maxLength),
      'UI_INVALID_VALUE_TYPE',
      '值过长',
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
  if (rules.codec === 'string')
    uiAssert(typeof value === 'string', 'UI_INVALID_VALUE_TYPE', '需要字符串');
  if (rules.codec === 'boolean')
    uiAssert(
      typeof value === 'boolean' || value === 'true' || value === 'false',
      'UI_INVALID_VALUE_TYPE',
      '需要布尔值',
    );
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
