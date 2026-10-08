import type { TLogger } from './log.d.ts';
import type { InvocationInputError } from '../common/interaction.ts';
export interface TaskReporter {
  begin(label?: string): { id: string; end(): void };
  setBusy(busy: boolean, label?: string): void;
}
export interface InvocationIdentity {
  executionId: string;
  windowId: string | null;
  sessionId?: string;
  parentExecutionId?: string;
}
export interface InvocationContext extends InvocationIdentity {
  signal: AbortSignal;
  tasks: TaskReporter;
  next(message: string): Promise<InputResult<string>>;
  next<T extends InputConstructor>(message: string, type: T): Promise<InputResult<InputValue<T>>>;
}
export type InputResult<T> = [InvocationInputError, undefined] | [undefined, T];
export type InputErrorCode = 'cancelled' | 'closed' | 'unavailable' | 'busy' | 'invalid-type';
export type InputFailure = 'eof' | 'cancelled' | 'busy';
export type InputReply =
  | { value: string; error?: never }
  | { error: { code: InputErrorCode; message: string }; value?: never };
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
export type InputFormat = 'string' | 'number' | 'boolean' | 'bigint' | 'date';
export interface InputRequest {
  id: string;
  identity: InvocationIdentity;
  message: string;
  type: InputFormat;
}
export interface PluginLogger extends TLogger {
  readonly pluginId: string;
  readonly windowId: string | null;
  readonly executionId?: string;
  readonly sessionId?: string;
}
export interface TaskSnapshot {
  id: string;
  owner: string;
  identity?: InvocationIdentity;
  automatic: number;
  manual: boolean;
  reported: number;
  returned: boolean;
  revision: number;
  busy: boolean;
  label?: string;
}
