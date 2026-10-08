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
import type { InvocationContext, PluginLogger } from './task.d.ts';
import type { TLogger } from './log.d.ts';
