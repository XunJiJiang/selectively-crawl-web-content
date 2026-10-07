import { describe, expect, it } from 'vitest';
import { Peer } from './peer.ts';
import type { Packet } from './protocol.ts';
describe('terminal IPC sessions and status delivery', () => {
  it('delivers execution state in order even with deferred send callbacks', async () => {
    const packets: Packet[] = [];
    const callbacks: (() => void)[] = [];
    const peer = new Peer((packet, callback) => {
      packets.push(packet);
      callbacks.push(() => callback(null));
    });
    peer.sessionId = 'session';
    peer.event('command.started', { executionId: 'a' });
    peer.event('command.returned', { executionId: 'a' });
    peer.event('command.finished', { executionId: 'a' });
    expect(packets.length).toBe(1);
    callbacks.shift()?.();
    await Promise.resolve();
    await Promise.resolve();
    callbacks.shift()?.();
    await Promise.resolve();
    await Promise.resolve();
    callbacks.shift()?.();
    expect(packets.map((packet) => (packet.kind === 'event' ? packet.event : ''))).toEqual([
      'command.started',
      'command.returned',
      'command.finished',
    ]);
    peer.close();
  });
  it('ignores a stale core result and rejects pending calls on disconnect', async () => {
    let request: Packet | undefined;
    const peer = new Peer((packet, callback) => {
      request = packet;
      callback(null);
    });
    peer.sessionId = 'new';
    const call = peer.call('hello');
    const id = request && request.kind === 'call' ? request.id : '';
    peer.receive({ version: 1, sessionId: 'old', kind: 'result', id, value: 'stale' });
    peer.receive({ version: 1, sessionId: 'new', kind: 'result', id, value: 'current' });
    expect(await call).toBe('current');
    const pending = peer.call('pending');
    peer.close();
    await expect(pending).rejects.toThrow('断开');
  });
});
