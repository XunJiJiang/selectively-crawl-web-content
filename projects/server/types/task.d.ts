import type { TLogger } from './log.d.ts';
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
