import { describe, expect, it, vi } from 'vitest';
import { TicketSocket } from '../../../webUtils/lib/ticket-socket.ts';
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
