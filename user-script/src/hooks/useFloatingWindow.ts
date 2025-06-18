/* eslint-disable @typescript-eslint/no-explicit-any */
const STORAGE_KEY = '__selective_crawl_items__';

export function saveToStorage(items: any[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}
export function loadFromStorage(): any[] {
  try {
    const arr = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    // 兼容旧数据，补全prefix字段
    return Array.isArray(arr)
      ? arr.map(item => ({ ...item, prefix: typeof item.prefix === 'string' ? item.prefix : '' }))
      : [];
  } catch {
    return [];
  }
}
