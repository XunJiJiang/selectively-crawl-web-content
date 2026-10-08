import { describe, expect, it, vi } from 'vitest';
import { RpcPeer } from './rpc.ts';
import { MAX_PENDING_CALLS } from './protocol.ts';

describe('bounded plugin RPC', () => {
  it('reports an oversized log without silently dropping the first event', async () => {
    const logs: unknown[] = [];
    const receiver = new RpcPeer((_packet, callback) => callback(null));
    receiver.onEvent = (_event, data) => logs.push(data);
    const sender = new RpcPeer((packet, callback) => {
      receiver.receive(packet);
      callback(null);
    });
    sender.event('log', { text: 'x'.repeat(17 * 1024 * 1024), executionId: 'execution' });
    await sender.drainEvents();
    expect(logs).toEqual([
      expect.objectContaining({ executionId: 'execution', text: expect.stringContaining('截断') }),
    ]);
    sender.close();
    receiver.close();
  });
  it('delivers log bursts in order through a slow IPC sender', async () => {
    const texts: string[] = [];
    const peer = new RpcPeer((packet, callback) => {
      setImmediate(() => {
        if (packet.kind === 'event') texts.push((packet.data as { text: string }).text);
        callback(null);
      });
    });
    for (let i = 0; i < 500; i++) peer.event('log', { text: String(i) });
    await peer.drainEvents();
    expect(texts).toEqual(Array.from({ length: 500 }, (_, i) => String(i)));
    peer.close();
  });
  it('pauses execution deadlines while waiting for input and resumes the remaining time', async () => {
    vi.useFakeTimers();
    const peer = new RpcPeer((_packet, callback) => callback(null));
    try {
      const call = peer.call('command', {}, 100, 'command-id');
      const rejection = expect(call).rejects.toMatchObject({ status: 504 });
      await vi.advanceTimersByTimeAsync(25);
      const resume = peer.pauseTimeout('command-id');
      await vi.advanceTimersByTimeAsync(60000);
      resume();
      await vi.advanceTimersByTimeAsync(74);
      await vi.advanceTimersByTimeAsync(1);
      await rejection;
      const input = peer.call('input.next', {}, 0, 'input-id');
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
      peer.receive({ version: 2, kind: 'result', id: 'input-id', value: '' });
      expect(await input).toBe('');
    } finally {
      peer.close();
      vi.useRealTimers();
    }
  });
  it('rejects excess requests and clears pending promises when a peer disconnects', async () => {
    const peer = new RpcPeer((_message, callback) => callback(null));
    const pending = Array.from({ length: MAX_PENDING_CALLS }, () => peer.call('work', {}, 1000));
    const results = Promise.allSettled(pending);
    await expect(peer.call('work', {}, 1000)).rejects.toMatchObject({ status: 429 });
    peer.close();
    expect((await results).every((result) => result.status === 'rejected')).toBe(true);
    await expect(peer.call('work', {}, 1000)).rejects.toMatchObject({ status: 503 });
  });

  it('rejects functions and oversized values before passing them to Node IPC', async () => {
    const send = vi.fn((_message, callback: (error: Error | null) => void) => callback(null));
    const peer = new RpcPeer(send);
    await expect(peer.call('work', { callback: () => 1 }, 1000)).rejects.toThrow();
    await expect(peer.call('work', Buffer.alloc(17 * 1024 * 1024), 1000)).rejects.toMatchObject({
      status: 413,
    });
    expect(send).not.toHaveBeenCalled();
    peer.close();
  });

  it('contains malformed event callbacks and ignores results for timed out requests', () => {
    const peer = new RpcPeer((_message, callback) => callback(null));
    peer.onEvent = () => {
      throw new Error('invalid event');
    };
    const onError = vi.fn();
    peer.onEventError = onError;
    expect(() =>
      peer.receive({ version: 2, kind: 'event', event: 'socket', data: {} }),
    ).not.toThrow();
    expect(onError).toHaveBeenCalledOnce();
    expect(() =>
      peer.receive({ version: 2, kind: 'result', id: 'expired', value: {} }),
    ).not.toThrow();
    peer.close();
  });
});
