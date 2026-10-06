import { describe, expect, it, vi } from 'vitest';
import { RpcPeer } from './rpc.ts';
import { MAX_PENDING_CALLS } from './protocol.ts';

describe('bounded plugin RPC', () => {
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
