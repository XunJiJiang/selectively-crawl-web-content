export interface TCommandOption {
  name: string;
  alias?: string;
  description?: string;
  required?: boolean; // 默认 false
  defaultValue?: string | boolean | number;
}

export type TCommandExecute = (
  log: TLogger & Partial<PluginLogger>,
  options: (TCommandOption & { value: string | boolean | number })[], // 包含值的选项数组
  // 未使用的参数部分的数组
  unusedArgs: string[],
  // 原始命令参数数组
  originArgs: string[],
  context: InvocationContext,
) => Promise<void> | void;

export interface TSubCommand {
  name: string;
  description?: string;
  exampleUsage?: string;
  execute: TCommandExecute;
}

export interface CommandCompletionCacheEntry<T = unknown> {
  value: T;
  /** Unix milliseconds, updated by each set. Providers decide when to refresh. */
  updatedAt: number;
}
/** One cache per registered first-level command, retained until it is unregistered. */
export interface CommandCompletionCache {
  get<T = unknown>(key: string): CommandCompletionCacheEntry<T> | undefined;
  set<T>(key: string, value: T): CommandCompletionCacheEntry<T>;
  delete(key: string): boolean;
  clear(): void;
}
export interface CommandCompletionContext {
  signal: AbortSignal;
  logger: TLogger;
}
/** Return every valid word/value at this position; the terminal performs prefix filtering. */
export type TCommandComplete = (
  command: string,
  parents: string[],
  cache: CommandCompletionCache,
  subCommand: string,
  isKey: boolean,
  isValue: boolean,
  key: string | undefined,
  context: CommandCompletionContext,
) => { command: string; commands: string[] } | Promise<{ command: string; commands: string[] }>;
import type { InvocationContext, PluginLogger } from './task.d.ts';
import type { TLogger } from './log.d.ts';
