/** Portable terminal plugin contract. Include this file in the plugin's own tsconfig. */
declare namespace SCWCTerminal {
  export interface TaskReporter {
    begin(label?: string): { id: string; end(): void };
    setBusy(busy: boolean, label?: string): void;
  }
  export interface InputError extends Error {
    readonly code: 'cancelled' | 'closed' | 'unavailable' | 'busy' | 'invalid-type';
  }
  export type InputResult<T> = [InputError, undefined] | [undefined, T];
  export type InputConstructor =
    | StringConstructor
    | NumberConstructor
    | BooleanConstructor
    | BigIntConstructor
    | DateConstructor;
  export type InputValue<T extends InputConstructor> = T extends StringConstructor
    ? string
    : T extends NumberConstructor
      ? number
      : T extends BooleanConstructor
        ? boolean
        : T extends BigIntConstructor
          ? bigint
          : Date;
  export interface InvocationContext {
    executionId: string;
    windowId: string | null;
    sessionId?: string;
    parentExecutionId?: string;
    signal: AbortSignal;
    tasks: TaskReporter;
    next(message: string): Promise<InputResult<string>>;
    next<T extends InputConstructor>(message: string, type: T): Promise<InputResult<InputValue<T>>>;
  }
  export interface Logger {
    readonly pluginId: string;
    readonly windowId: string | null;
    readonly executionId?: string;
    readonly sessionId?: string;
    info(...args: unknown[]): void;
    pathInfo(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
  }
  export interface CommandInfo {
    name: string;
    description?: string;
    subCommands?: string[];
    system?: boolean;
    scope?: 'command' | 'global';
    usage?: string;
  }
  export interface CommandContext extends InvocationContext {
    args: string[];
    logger: Logger;
    write(text: string): void;
    invokeCore(command: string): Promise<void>;
  }
  export interface Command {
    name: string;
    description: string;
    /** Omitted scope registers an ordinary command; global uses the transient footer. */
    scope?: 'command' | 'global';
    usage?: string;
    execute(context: CommandContext): void | Promise<void>;
  }
  export interface LoadContext {
    coreCommands: readonly CommandInfo[];
    tasks: TaskReporter;
    registerCommand(command: Command): void;
    logger: Logger;
    signal: AbortSignal;
  }
  export interface Plugin {
    /** Short identifier used to distinguish the plugin; defaults to its directory name. */
    id?: string;
    apiVersion?: 1;
    onLoad(context: LoadContext): void | Promise<void>;
    onUnload?(): void | Promise<void>;
  }
}
