import { createServer, type Server, type AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listenAvailable } from './listen.ts';

const servers: Server[] = [];
function newServer() {
  const server = createServer();
  servers.push(server);
  return server;
}
async function ephemeral(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, () => {
      server.off('error', reject);
      resolve();
    });
  });
  return (server.address() as AddressInfo).port;
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    servers
      .splice(0)
      .filter((server) => server.listening)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

describe('HTTP port search', () => {
  it('binds a later port and retains the actual listening socket', async () => {
    const start = await ephemeral(newServer());
    const server = newServer();
    const actual = await listenAvailable(server, start, Math.min(20, 65535 - start));
    expect(actual).toBeGreaterThan(start);
    expect((server.address() as AddressInfo).port).toBe(actual);
    expect(server.listenerCount('error')).toBe(0);
    expect(server.listenerCount('listening')).toBe(0);
  });
  it('reports exhaustion without expanding the configured range', async () => {
    const start = await ephemeral(newServer());
    const server = newServer();
    await expect(listenAvailable(server, start, 0)).rejects.toThrow(
      `端口 ${start} 到 ${start} 均被占用`,
    );
    expect(server.listening).toBe(false);
  });
  it('propagates permission errors without trying more ports', async () => {
    const server = newServer();
    const error = Object.assign(new Error('denied'), { code: 'EACCES' });
    const listen = vi.spyOn(server, 'listen').mockImplementation(() => {
      queueMicrotask(() => server.emit('error', error));
      return server;
    });
    await expect(listenAvailable(server, 3200, 10)).rejects.toBe(error);
    expect(listen).toHaveBeenCalledOnce();
  });
});
