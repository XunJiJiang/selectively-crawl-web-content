import type { JSONValue, JSONValueWithFunction, ResolvedJSONValue } from '../types/utils';
import { scwcError, scwcWarn } from './console.ts';

/** 不可控的内部错误 */
class InternalError extends Error {
  private _error: unknown;

  constructor(error: unknown) {
    super(
      (() => {
        if (error instanceof Error) {
          return error.message;
        } else {
          return String(error);
        }
      })(),
    );
    if (error instanceof InternalError) {
      return error;
    }
    this._error = error;
  }

  readonly __internalError__ = true;
  readonly name = 'InternalError';
  get originalError() {
    return this._error;
  }
}

function resolveJSONValueWithFunction<T extends JSONValueWithFunction>(
  value: T,
  notRunFun: boolean,
): ResolvedJSONValue<T> {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  ) {
    return value as ResolvedJSONValue<T>;
  } else if (typeof value === 'function') {
    try {
      const result = notRunFun ? [] : (value() as unknown[]);
      return result as ResolvedJSONValue<T>;
    } catch (error) {
      scwcError('Error while resolving function in config:', error);
      throw new InternalError(error);
    }
  } else if (Array.isArray(value)) {
    scwcWarn(
      'Unexpected array in config value. Arrays should be defined as functions that return arrays. Value:',
      value,
    );
    return value.map((item: JSONValueWithFunction) =>
      resolveJSONValueWithFunction(item, notRunFun),
    ) as ResolvedJSONValue<T>;
  } else if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const key in value) {
      result[key] = resolveJSONValueWithFunction(value[key], notRunFun);
    }
    return result as ResolvedJSONValue<T>;
  } else {
    scwcError('Unexpected type in config value:', typeof value);
    throw new Error(`Unsupported type in config value: ${typeof value}`);
  }
}

/**
 * 深层属性修复
 * 将a对象修改为和b对象结构完全相同, 缺少的属性会被补全, 冲突的属性直接使用b中的内容, 多余的属性根据keepExtra参数决定是否保留(暂不实现)
 * 当直接将a中的属性替换为b中的属性时, 此时相当于使用默认值, 将不再深度合并, 但仍然需要进行深度检查, 将函数直接替换为这个函数的调用结果
 * 对于数组类型的属性, 存在以下特殊处理:
 *   如果a中某个属性的值为数组, 那么要求b中对于位置为一个函数, 否则直接覆盖a中的数组
 *   该函数接受a中这个数组的每一个值作为参数, 返回一个新的值, 这些新值组成一个新的数组, 替换a中原来的数组
 *   如果调用时没有传递任何参数, 则返回一个数组作为默认值, 这个值将不再进行深度检查, 要求返回的数组的满足 JSONValue 的定义
 * @param a 需要被修改的对象
 * @param b 用于修改的对象
 * @param notRunFun 是否不执行函数, 当为 true 时将不再对数组进行检查, 默认值直接使用空数组. 用于规避外部函数中可能出现的报错.
 * @param whichOnSameType 在a和b类型相同时，选择使用哪个值
 */
export function completeProperties<T extends JSONValue, U extends JSONValueWithFunction>(
  a: T,
  b: U /* , keepExtra = false */,
  notRunFun: boolean,
  whichOnSameType: 'a' | 'b',
): ResolvedJSONValue<U> {
  if (typeof a === 'string' || typeof a === 'number' || typeof a === 'boolean' || a === null) {
    if (typeof b === 'string' || typeof b === 'number' || typeof b === 'boolean' || b === null) {
      return (whichOnSameType === 'a' ? a : b) as ResolvedJSONValue<U>;
    } else {
      return resolveJSONValueWithFunction(b, notRunFun);
    }
  }

  if (Array.isArray(a)) {
    if (typeof b === 'function') {
      try {
        return a.map((item) =>
          completeProperties(
            item,
            (notRunFun ? item : b(item)) as JSONValueWithFunction /* , keepExtra */,
            notRunFun,
            whichOnSameType,
          ),
        ) as ResolvedJSONValue<U>;
      } catch (error) {
        scwcError('Error while resolving array processor in config:', error);
        throw new InternalError(error);
      }
    } else {
      return resolveJSONValueWithFunction(b, notRunFun);
    }
  }

  if (typeof a === 'object' && a !== null) {
    if (typeof b === 'object' && b !== null) {
      const result: Record<string, unknown> = {};
      const bObj = b as Record<string, JSONValueWithFunction>;
      for (const key in bObj) {
        const bVal = bObj[key];
        if (key in a) {
          const aVal = a[key];
          result[key] = completeProperties(
            aVal,
            bVal /* , keepExtra */,
            notRunFun,
            whichOnSameType,
          );
        } else {
          result[key] = resolveJSONValueWithFunction(bVal, notRunFun);
        }
      }
      // if (keepExtra) {
      //   for (const key in a) {
      //     if (!(key in b)) {
      //       result[key] = a[key];
      //     }
      //   }
      // }
      return result as ResolvedJSONValue<U>;
    } else {
      return resolveJSONValueWithFunction(b, notRunFun);
    }
  }

  scwcError('Unexpected type in config value:', typeof a, typeof b);
  throw new Error(`Unsupported type in config value: ${typeof a}`);
}

export function saveToStorage<T extends JSONValue>(key: string, items: T) {
  localStorage.setItem(key, JSON.stringify(items));
  return items;
}

export function loadFromStorage<T extends JSONValueWithFunction>(
  key: string,
  defaultValue: T,
  whichOnSameType: 'a' | 'b',
): ResolvedJSONValue<T> {
  try {
    const val = JSON.parse(localStorage.getItem(key) ?? '');
    return saveToStorage(key, completeProperties(val, defaultValue, false, whichOnSameType));
  } catch (e) {
    scwcWarn(
      `Failed to load config for key "${key}", using default value.`,
      (e as Error).message ?? '',
    );
    return saveToStorage(key, completeProperties(null, defaultValue, true, whichOnSameType));
  }
}
