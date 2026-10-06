/** Version 2 contains data and local callbacks, never Express or live socket objects. */
export interface PluginRequest {
  method: string;
  url: string;
  params: Record<string, string | string[]>;
  query: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
}

export interface ProcessRequestContext {
  request: PluginRequest;
}

export interface ProcessApi {
  method: SCWC.THostedPluginApi['method'];
  path: string;
  handler: (data: unknown, context: ProcessRequestContext) => unknown | Promise<unknown>;
}

export type ResourceResponse =
  | {
      kind: 'file';
      path: string;
      contentType?: string;
      downloadName?: string;
      headers?: Record<string, string>;
    }
  | {
      kind: 'response';
      status: number;
      body?: string | Buffer;
      headers?: Record<string, string>;
    };

export interface ProcessResource {
  method?: 'GET';
  path: string;
  handler: (
    data: unknown,
    context: ProcessRequestContext,
  ) => ResourceResponse | Promise<ResourceResponse>;
}

export interface ProcessSocketContext extends ProcessRequestContext {
  connectionId: string;
  channel: string;
  query: URLSearchParams;
  send: (data: unknown) => void;
  broadcast: (data: unknown, excludeSelf?: boolean) => void;
  close: (code?: number, reason?: string) => void;
}

export interface ProcessSocket {
  path: string;
  onConnect?: (context: ProcessSocketContext) => void | (() => void) | Promise<void | (() => void)>;
  onMessage?: (data: string | Buffer, context: ProcessSocketContext) => void | Promise<void>;
  onClose?: (context: ProcessSocketContext) => void | Promise<void>;
}

export interface ProcessPluginHandler extends Omit<SCWC.IHostedPluginHandler, 'ui'> {
  /** Omitted versions use the default portable v2 contract. */
  apiVersion?: 2;
  ui?: {
    entry: string;
    html?: () => string | Promise<string>;
    api?: ProcessApi[] | ((tools: { add: (...apis: ProcessApi[]) => void }) => void);
    resources?: ProcessResource[];
    websocket?:
      | ProcessSocket[]
      | ((tools: { add: (...channels: ProcessSocket[]) => void }) => void);
  };
}

export interface ProcessOptions {
  mode: 'process';
  apiVersion: 2;
  startupTimeoutMs?: number;
  requestTimeoutMs?: number;
  shutdownTimeoutMs?: number;
}

export interface ProcessInfo {
  mode: 'process';
  apiVersion: 2;
  status: 'starting' | 'ready' | 'unresponsive' | 'failed' | 'stopping' | 'stopped';
  pid?: number;
  reason?: string;
}
