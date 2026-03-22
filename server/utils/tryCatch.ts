/**
 * 判断一个值是否是类 Promise 对象
 * @param value
 * @returns
 */
export function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof value === 'object' && value !== null && 'then' in value && typeof value.then === 'function';
}

/**
 * 将可能抛出异常的同步或异步函数包装为返回元组的函数
 * @param callback
 * @returns 如果执行成功，返回 [undefined, 结果]；如果抛出异常，返回 [错误对象, undefined]
 */
export default function tryCatch<T>(callback: () => Promise<T>): Promise<[undefined, T] | [Error, undefined]>;
export default function tryCatch<T>(callback: () => T): [undefined, T] | [Error, undefined];
export default function tryCatch<T>(
  callback: () => T | Promise<T>,
): Promise<[undefined, T] | [Error, undefined]> | [undefined, T] | [Error, undefined] {
  try {
    const result = callback();

    if (isPromiseLike(result)) {
      return result
        .then(res => [void 0, res] as [undefined, T])
        .catch(err => [err instanceof Error ? err : new Error('Unknown error: ' + err), void 0] as [Error, undefined]);
    }

    return [void 0, result];
  } catch (error) {
    if (error instanceof Error) {
      return [error, void 0];
    } else {
      return [new Error('Unknown error: ' + error), void 0];
    }
  }
}

/**
 * tryCatch 函数的返回类型
 */
type TryCatchResult<E, T> =
  | [undefined, T]
  | [
      (
        | {
            /** 是否是预定的错误类型 */
            isExpectedError: true;
            /** 错误实例 */
            error: E;
          }
        | {
            isExpectedError: false;
            error: unknown;
          }
      ),
      undefined,
    ];

/**
 * 创建一个自定义错误类型的 tryCatch 函数
 * @param ErrorClass 预定的错误类型
 * @returns 包装后的 tryCatch 函数
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createTryCatch<E>(ErrorClass: new (...arg: any[]) => E) {
  function _tryCatch<T>(callback: () => Promise<T>): Promise<TryCatchResult<E, T>>;
  function _tryCatch<T>(callback: () => T): TryCatchResult<E, T>;
  function _tryCatch<T>(
    callback: (() => T) | (() => Promise<T>),
  ): Promise<TryCatchResult<E, T>> | TryCatchResult<E, T> {
    try {
      const result = callback();

      if (isPromiseLike(result)) {
        return result
          .then(res => [void 0, res] as [undefined, T])
          .catch(err => [
            {
              isExpectedError: err instanceof ErrorClass,
              error: err,
            },
            void 0,
          ]);
      }

      return [void 0, result];
    } catch (error) {
      // 此处使用了不符合事实的类型断言
      // 但是外部类型已经可以正确推断错误类型，因此这里暂时忽略类型检查
      return [
        {
          isExpectedError: error instanceof ErrorClass,
          error,
        } as unknown as undefined,
        void 0 as T,
      ];
    }
  }

  return _tryCatch;
}
