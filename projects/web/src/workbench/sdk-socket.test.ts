import { describe, expect, it, vi } from 'vitest';
import { TicketSocket } from '../../../webutils/lib/ticket-socket.ts';
class FakeSocket extends EventTarget {
  readyState = 0;
  binaryType: BinaryType = 'blob';
  bufferedAmount = 0;
  extensions = '';
  protocol = '';
  url = 'ws://localhost/';
  send = vi.fn();
  close = vi.fn();
}
describe('ticket-backed synchronous SDK socket', () => {
  it('reopens an interruptible socket without losing handlers or delivering stale close events', async () => {
    const first = new FakeSocket(),
      second = new FakeSocket();
    const connect = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const socket = new TicketSocket(connect);
    const close = vi.fn(),
      message = vi.fn();
    socket.onclose = close;
    socket.onmessage = message;
    await Promise.resolve();
    socket.suspend();
    first.dispatchEvent(new CloseEvent('close'));
    expect(first.close).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    socket.resume();
    await Promise.resolve();
    second.dispatchEvent(new MessageEvent('message', { data: 'fresh' }));
    expect(connect).toHaveBeenCalledTimes(2);
    expect(message).toHaveBeenCalledOnce();
  });
  it('keeps callbacks, listeners and send behavior while a ticket is acquired', async () => {
    const native = new FakeSocket(),
      socket = new TicketSocket(async () => native as unknown as WebSocket),
      onmessage = vi.fn(),
      listener = vi.fn();
    socket.onmessage = onmessage;
    socket.addEventListener('message', listener);
    socket.binaryType = 'arraybuffer';
    expect(socket.readyState).toBe(0);
    expect(() => socket.send('early')).toThrow('not open');
    await Promise.resolve();
    native.readyState = 1;
    native.dispatchEvent(new Event('open'));
    native.dispatchEvent(new MessageEvent('message', { data: 'message' }));
    socket.send('reply');
    expect(native.binaryType).toBe('arraybuffer');
    expect(native.send).toHaveBeenCalledWith('reply');
    expect(onmessage).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });
  it('closes the eventual native socket when a page closes before ticket acquisition completes', async () => {
    const native = new FakeSocket();
    let connected: (socket: WebSocket) => void = () => {
      /* Assigned by the connection promise. */
    };
    const socket = new TicketSocket(() => new Promise((resolve) => (connected = resolve)));
    socket.close(1000, 'leaving');
    connected(native as unknown as WebSocket);
    await Promise.resolve();
    expect(native.close).toHaveBeenCalledWith(1000, 'leaving');
  });
});
