/**
 * 缓存函数
 * 当参数相同时，返回之前的结果
 */
export function cache<ARGS extends unknown[], RETURN> (fn: (...args: ARGS) => RETURN): (...args: ARGS) => RETURN {
  const cacheMap = new Map<string, RETURN>();

  return (...args: ARGS) => {
    const key = JSON.stringify(args);
    if (cacheMap.has(key)) {
      return cacheMap.get(key) as RETURN;
    }
    const result = fn(...args);
    cacheMap.set(key, result);
    return result;
  };
}