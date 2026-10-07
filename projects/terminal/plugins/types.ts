import type { InvocationContext, PluginLogger, TaskReporter } from '../../server/types/task.d.ts';
export interface TerminalCommandContext extends InvocationContext {
  args: string[];
  logger: PluginLogger;
  write(text: string): void;
  invokeCore(command: string): Promise<void>;
}
export interface TerminalCommand {
  name: string;
  description: string;
  execute(context: TerminalCommandContext): void | Promise<void>;
}
export interface TerminalPlugin {
  apiVersion?: 1;
  onLoad(context: {
    tasks: TaskReporter;
    registerCommand(command: TerminalCommand): void;
    logger: PluginLogger;
    signal: AbortSignal;
  }): void | Promise<void>;
  onUnload?(): void | Promise<void>;
}
