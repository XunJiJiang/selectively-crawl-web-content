/** Preserve the synchronous socket surface while acquiring a single-use ticket asynchronously. */
export class TicketSocket extends EventTarget {
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  private socket?: WebSocket;
  private state = 0;
  private binary: BinaryType = 'blob';
  private closing?: { code?: number; reason?: string };
  onopen: ((this: WebSocket, event: Event) => unknown) | null = null;
  onmessage: ((this: WebSocket, event: MessageEvent) => unknown) | null = null;
  onerror: ((this: WebSocket, event: Event) => unknown) | null = null;
  onclose: ((this: WebSocket, event: CloseEvent) => unknown) | null = null;
  constructor(connect: () => Promise<WebSocket>) {
    super();
    void connect()
      .then((socket) => {
        this.socket = socket;
        socket.binaryType = this.binary;
        socket.addEventListener('open', (event) => {
          this.state = 1;
          this.relay('open', event);
        });
        socket.addEventListener('message', (event) => this.relay('message', event));
        socket.addEventListener('error', (event) => this.relay('error', event));
        socket.addEventListener('close', (event) => {
          this.state = 3;
          this.relay('close', event);
        });
        if (this.closing) {
          socket.close(this.closing.code, this.closing.reason);
        }
      })
      .catch(() => {
        this.state = 3;
        this.relay('error', new Event('error'));
        this.relay(
          'close',
          new CloseEvent('close', { code: 1006, reason: 'connection ticket unavailable' }),
        );
      });
  }
  get readyState() {
    return this.socket?.readyState ?? this.state;
  }
  get bufferedAmount() {
    return this.socket?.bufferedAmount ?? 0;
  }
  get extensions() {
    return this.socket?.extensions ?? '';
  }
  get protocol() {
    return this.socket?.protocol ?? '';
  }
  get url() {
    return this.socket?.url ?? '';
  }
  get binaryType() {
    return this.socket?.binaryType ?? this.binary;
  }
  set binaryType(value: BinaryType) {
    this.binary = value;
    if (this.socket) {
      this.socket.binaryType = value;
    }
  }
  send(data: Parameters<WebSocket['send']>[0]) {
    if (!this.socket || this.socket.readyState !== this.OPEN) {
      throw new DOMException('WebSocket is not open', 'InvalidStateError');
    }
    this.socket.send(data);
  }
  close(code?: number, reason?: string) {
    this.state = 2;
    this.closing = { code, reason };
    this.socket?.close(code, reason);
  }
  private relay(type: 'open' | 'message' | 'error' | 'close', event: Event) {
    const forwarded =
      type === 'message'
        ? new MessageEvent('message', { data: (event as MessageEvent).data })
        : type === 'close'
          ? new CloseEvent('close', {
              code: (event as CloseEvent).code,
              reason: (event as CloseEvent).reason,
              wasClean: (event as CloseEvent).wasClean,
            })
          : new Event(type);
    this.dispatchEvent(forwarded);
    const handler = this[`on${type}`] as ((this: WebSocket, event: Event) => unknown) | null;
    handler?.call(this as unknown as WebSocket, forwarded);
  }
  asWebSocket() {
    return this as unknown as WebSocket;
  }
}
