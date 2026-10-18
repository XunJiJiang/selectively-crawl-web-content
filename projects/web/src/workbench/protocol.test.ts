import { describe, expect, it } from 'vitest';
import { MessageChannel as NodeMessageChannel } from 'node:worker_threads';
import { InstancePort, PROTOCOL } from '../../../shared/workbench-protocol.ts';
function ports() {
  const channel = new NodeMessageChannel();
  return { a: channel.port1 as unknown as MessagePort, b: channel.port2 as unknown as MessagePort };
}
describe('instance port ownership and cleanup', () => {
  it('routes RPC only for the bound tab and epoch, rejecting stale or out-of-order messages', async () => {
    const { a, b } = ports(),
      host = new InstancePort(a, 'tab', 'epoch');
    const events: unknown[] = [];
    host.onEvent = (_method, payload) => events.push(payload);
    const envelope = {
      protocol: PROTOCOL,
      version: 1,
      kind: 'event',
      method: 'page.update',
      tabId: 'tab',
      frameEpoch: 'epoch',
      sequence: 1,
      payload: 'current',
    };
    b.postMessage({ ...envelope, frameEpoch: 'old', payload: 'stale' });
    b.postMessage(envelope);
    b.postMessage({ ...envelope, payload: 'duplicate' });
    b.postMessage({ ...envelope, tabId: 'other', sequence: 2, payload: 'wrong tab' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(events).toEqual(['current']);
    host.close();
    b.close();
  });
  it('supports correlated replies and rejects pending callbacks when the frame disappears', async () => {
    const { a, b } = ports(),
      host = new InstancePort(a, 'tab', 'epoch'),
      page = new InstancePort(b, 'tab', 'epoch');
    page.onRequest = async (_method, payload) => payload;
    await expect(host.request('echo', { value: 'ok' })).resolves.toEqual({ value: 'ok' });
    page.onRequest = () =>
      new Promise(() => {
        /* Remain pending until channel cleanup. */
      });
    const pending = host.request('wait', {});
    host.close();
    await expect(pending).rejects.toThrow('关闭');
    page.close();
  });
});
