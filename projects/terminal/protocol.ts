export const TERMINAL_PROTOCOL_VERSION = 1;
import type { LogLevel } from '../server/utils/log.ts';
export interface CommandInfo {
  name: string;
  description?: string;
  subCommands?: string[];
  system?: boolean;
  scope?: 'command' | 'global';
  usage?: string;
}
/** Input excludes the terminal's global ':' prompt. Offsets are UTF-16 indices. */
export interface CompletionRequest {
  command: string;
  cursor: number;
}
export interface CompletionResult {
  from: number;
  to: number;
  items: { name: string; insertText: string; description?: string }[];
}
export type Packet =
  | { version: 1; sessionId: string; kind: 'call'; id: string; method: string; args: unknown }
  | { version: 1; sessionId: string; kind: 'result'; id: string; value?: unknown; error?: string }
  | { version: 1; sessionId: string; kind: 'event'; event: string; data: unknown };
export interface OutputEvent {
  windowId: string | null;
  executionId?: string;
  text: string;
  pluginId?: string;
  level?: LogLevel;
}
export interface ExecutionEvent {
  executionId: string;
  windowId: string;
  command: string;
  status:
    | 'running'
    | 'background'
    | 'cancelling'
    | 'succeeded'
    | 'failed'
    | 'cancelled'
    | 'interrupted';
  error?: string;
}
