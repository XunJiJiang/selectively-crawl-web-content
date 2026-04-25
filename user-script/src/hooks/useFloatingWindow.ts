import { scwcLog } from "../utils/console";

/**
 * 深层属性补全
 * 将a对象中不存在的属性从b对象中补全到a对象中，并返回a对象
 * 不处理数组
 */
export function completeProperties<T extends object, U extends object> (a: T, b: U): T & U {
  if (Array.isArray(a) || Array.isArray(b)) {
    scwcLog('completeProperties函数不处理数组, 直接返回a对象');
    return a as T & U;
  }
  for (const key in b) {
    if (!(key in a)) {
      (a as T & U)[key] = b[key as keyof U] as (T & U)[typeof key];
    } else if (key in a && typeof (a as T & U)[key] === 'object' && typeof b[key as keyof U] === 'object') {
      (a as T & U)[key] = completeProperties((a as T & U)[key] as object, b[key as keyof U] as object) as (T & U)[typeof key];
    }
  }
  return a as T & U;
}

export function saveToStorage<T extends object> (key: string, items: T) {
  localStorage.setItem(key, JSON.stringify(items));
  return items;
}

export function loadFromStorage<K extends string, T extends object> (key: K, defaultValue: T): T {
  try {
    const arr = JSON.parse(localStorage.getItem(key) ?? '') as T;
    return key === '__selective_crawl_items__' && Array.isArray(arr)
      ? (arr.map(item => ({ ...item, prefix: typeof item.prefix === 'string' ? item.prefix : '' })) as T)
      : (completeProperties(arr, defaultValue) ?? saveToStorage(key, defaultValue));
  } catch {
    return saveToStorage(key, defaultValue);
  }
}
