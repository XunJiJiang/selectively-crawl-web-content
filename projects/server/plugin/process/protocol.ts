import type { ProcessApi, ProcessOptions, PluginRequest } from '../../types/plugin-process.d.ts';

export const PROTOCOL_VERSION = 2;
export const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;
export const MAX_PENDING_CALLS = 64;

export interface Manifest {
  name?: string;
  command?: {
    description?: string;
    exampleUsage?: string;
    options?: SCWC.TCommandOption[];
    subCommands?: Omit<SCWC.TSubCommand, 'execute'>[];
  };
  scripts?: Pick<
    NonNullable<SCWC.IPluginHandler['pluginConfig']>['scripts'] & {},
    'title' | 'description'
  >;
  ui?: {
    entry: string;
    hasHtml: boolean;
    html?: string;
    apis: Pick<ProcessApi, 'method' | 'path'>[];
    resources: { path: string }[];
    sockets: { path: string }[];
  };
}

export interface Initialize {
  entry: string;
  name: string;
  options: ProcessOptions;
  pluginId?: string;
  outputWindowId?: string | null;
  sessionId?: string;
}

export interface Invocation {
  index: number;
  data: unknown;
  request: PluginRequest;
}

export interface RemoteError {
  message: string;
  code?: string;
  status?: number;
}

export type Message =
  | { version: 2; kind: 'call'; id: string; method: string; args: unknown }
  | { version: 2; kind: 'result'; id: string; value?: unknown; error?: RemoteError }
  | { version: 2; kind: 'event'; event: string; data: unknown };

export class PluginProcessError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status = 503, code = 'PLUGIN_UNAVAILABLE') {
    super(message);
    this.name = 'PluginProcessError';
    this.status = status;
    this.code = code;
  }
}

export function remoteError(error: unknown): RemoteError {
  if (error instanceof Error) {
    return {
      message: error.message.slice(0, 8000),
      code: 'code' in error && typeof error.code === 'string' ? error.code : undefined,
      status: 'status' in error && typeof error.status === 'number' ? error.status : undefined,
    };
  }
  return { message: String(error).slice(0, 8000) };
}
