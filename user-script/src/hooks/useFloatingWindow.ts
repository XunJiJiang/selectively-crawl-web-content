export function saveToStorage<T>(key: string, items: T) {
  localStorage.setItem(key, JSON.stringify(items));
  return items;
}
export function loadFromStorage<K extends string, T>(key: K, defaultValue: T): T {
  try {
    const arr = JSON.parse(localStorage.getItem(key) ?? '') as T;
    // 兼容旧数据，补全prefix字段
    return key === '__selective_crawl_items__' && Array.isArray(arr)
      ? (arr.map(item => ({ ...item, prefix: typeof item.prefix === 'string' ? item.prefix : '' })) as T)
      : arr ?? saveToStorage(key, defaultValue);
  } catch {
    return saveToStorage(key, defaultValue);
  }
}
