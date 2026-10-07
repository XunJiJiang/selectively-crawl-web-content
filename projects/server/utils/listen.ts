import type { Server } from 'node:net';

/** 直接绑定候选端口，避免先探测再绑定之间的竞争。range 是起始端口后的最大偏移。 */
export async function listenAvailable(
  server: Server,
  port: number,
  range: number,
): Promise<number> {
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !Number.isInteger(range) ||
    range < 0 ||
    port + range > 65535
  ) {
    throw new Error('无效的端口或端口查询范围');
  }
  for (let candidate = port; candidate <= port + range; candidate++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
          server.off('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          server.off('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(candidate);
      });
      return candidate;
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EADDRINUSE') {
        throw error;
      }
    }
  }
  throw new Error(`端口 ${port} 到 ${port + range} 均被占用，超过最大查询范围 ${range}`);
}
