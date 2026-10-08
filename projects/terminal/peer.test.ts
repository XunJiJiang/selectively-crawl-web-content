import { describe, expect, it } from 'vitest';
import { Peer } from './peer.ts';
import type { Packet } from './protocol.ts';
describe('terminal IPC sessions and status delivery', () => {
  it('reports oversized output in its original window even with no subsequent events', async () => {
    const outputs: unknown[] = [];
    const receiver = new Peer((_packet, callback) => callback(null));
    receiver.onEvent = (_event, data) => outputs.push(data);
    const sender = new Peer((packet, callback) => {
      receiver.receive(packet);
      callback(null);
    });
    sender.event('output', {
      windowId: 'window',
      executionId: 'execution',
      text: 'x'.repeat(1024 * 1024),
    });
    expect(outputs).toEqual([
      expect.objectContaining({
        windowId: 'window',
        executionId: 'execution',
        text: expect.stringContaining('截断'),
      }),
    ]);
    sender.close();
    receiver.close();
  });
  it('preserves burst output and sends completion after all output', async () => {
    const packets: Packet[] = [];
    const peer = new Peer((packet, callback) => {
      setImmediate(() => {
        packets.push(packet);
        callback(null);
      });
    });
    for (let i = 0; i < 600; i++) peer.event('output', { windowId: 'window', text: `line-${i}` });
    peer.event('command.finished', { executionId: 'a' });
    await new Promise<void>((resolve) => {
      const poll = () => {
        if (packets.length === 601) resolve();
        else setImmediate(poll);
      };
      poll();
    });
    expect(
      packets
        .slice(0, 600)
        .map((packet) => (packet.kind === 'event' ? (packet.data as { text: string }).text : '')),
    ).toEqual(Array.from({ length: 600 }, (_, i) => `line-${i}`));
    expect(packets.at(-1)).toMatchObject({ event: 'command.finished' });
    peer.close();
  });
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
