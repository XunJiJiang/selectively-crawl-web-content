import type { CommandCompletionCache, CommandCompletionCacheEntry } from '../types/command.d.ts';

export function createCommandCompletionCache(): CommandCompletionCache {
  const entries = new Map<string, CommandCompletionCacheEntry>();
  return {
    get: <T>(key: string) => entries.get(key) as CommandCompletionCacheEntry<T> | undefined,
    set: <T>(key: string, value: T) => {
      const entry = { value, updatedAt: Date.now() };
      entries.set(key, entry);
      return entry;
    },
    delete: (key) => entries.delete(key),
    clear: () => entries.clear(),
  };
}
