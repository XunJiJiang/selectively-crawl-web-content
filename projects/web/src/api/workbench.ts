import type { TConfig } from '../../../shared/types/config.d.ts';
import type { ListPage, WorkbenchEvent } from '../workbench/types.ts';
export class ApiError extends Error {
  code: string;
  status: number;
  data?: unknown;
  constructor(code: string, message: string, status: number, data?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.data = data;
  }
}
export class WorkbenchAPI {
  readonly clientWindowId = crypto.randomUUID();
  readonly config: TConfig;
  constructor(config: TConfig) {
    this.config = config;
  }
  async request<T>(
    path: string,
    body?: unknown,
    signal?: AbortSignal,
    keepalive = false,
  ): Promise<T> {
    const response = await fetch(`/web/api/workbench${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      keepalive,
      headers: {
        Authorization: `Bearer ${this.config.api.token}`,
        'Content-Type': 'application/json',
        'X-SCWC-Client-Window': this.clientWindowId,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      cache: 'no-store',
      credentials: 'same-origin',
      referrerPolicy: 'same-origin',
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new ApiError(
        result.code ?? 'request_failed',
        result.message ?? `请求失败 (${response.status})`,
        response.status,
        result.data,
      );
    }
    return result.data as T;
  }
  async list<T>(
    path: string,
    cursor?: string | null,
    params: Record<string, string> = {},
  ): Promise<ListPage<T>> {
    const q = new URLSearchParams({ ...params, limit: '100' });
    if (cursor) {
      q.set('cursor', cursor);
    }
    return this.request(`${path}?${q}`);
  }
}
/** Single-use tickets only; never put the manager token in a WebSocket URL. */
export class EventConnection {
  private socket?: WebSocket;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private attempts = 0;
  private positions: Record<string, number> = {};
  private generation = 0;
  private api: WorkbenchAPI;
  private session: () => { workspaceId: string; lease: string; coreBootId: string };
  private event: (event: WorkbenchEvent) => void;
  private status: (state: 'connected' | 'connecting' | 'disconnected') => void;
  private resync: () => Promise<void>;
  constructor(
    api: WorkbenchAPI,
    session: () => { workspaceId: string; lease: string; coreBootId: string },
    event: (event: WorkbenchEvent) => void,
    status: (state: 'connected' | 'connecting' | 'disconnected') => void,
    resync: () => Promise<void>,
  ) {
    this.api = api;
    this.session = session;
    this.event = event;
    this.status = status;
    this.resync = resync;
  }
  async connect() {
    const generation = ++this.generation;
    this.status('connecting');
    try {
      const session = this.session();
      const result = await this.api.request<{ ticket: string }>('/stream-ticket', {
        workspaceId: session.workspaceId,
        lease: session.lease,
      });
      if (this.stopped || generation !== this.generation) {
        return;
      }
      const url = new URL('/web/websocket/workbench', location.origin);
      url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      url.searchParams.set('ticket', result.ticket);
      const socket = (this.socket = new WebSocket(url));
      socket.onopen = () => {
        this.attempts = 0;
        socket.send(
          JSON.stringify({
            type: 'resume',
            coreBootId: session.coreBootId,
            positions: this.positions,
          }),
        );
        this.status('connected');
      };
      socket.onmessage = async (message) => {
        try {
          const e = JSON.parse(message.data) as WorkbenchEvent;
          if (
            e.type === 'connection.resync-required' ||
            (e.coreBootId && e.coreBootId !== this.session().coreBootId)
          ) {
            this.positions = {};
            await this.resync();
            return;
          }
          if (
            e.version !== 1 ||
            !Number.isSafeInteger(e.seq) ||
            e.seq <= (this.positions[e.stream] ?? 0)
          ) {
            return;
          }
          this.positions[e.stream] = e.seq;
          this.event(e);
        } catch {
          socket.close();
        }
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => this.retry();
    } catch {
      this.retry();
    }
  }
  private retry() {
    if (this.stopped) {
      return;
    }
    this.status('disconnected');
    clearTimeout(this.timer);
    this.timer = setTimeout(
      () => void this.connect(),
      Math.min(15000, 1000 * 2 ** this.attempts++),
    );
  }
  close() {
    this.stopped = true;
    this.generation++;
    clearTimeout(this.timer);
    this.socket?.close();
  }
}
