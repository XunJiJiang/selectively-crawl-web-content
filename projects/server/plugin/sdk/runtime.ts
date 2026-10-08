import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, type WorkerOptions } from 'node:worker_threads';
export { RpcPeer } from '../process/rpc.ts';
export { PluginProcessError } from '../process/protocol.ts';

export type PluginWorkerOptions = Omit<WorkerOptions, 'eval' | 'env'> & {
  env?: NodeJS.ProcessEnv;
};

/** Workers have their own module hooks; initialize the SDK before their entry. */
export function createPluginWorker(entry: URL, options: PluginWorkerOptions = {}): Worker {
  if (entry.protocol !== 'file:') {
    throw new TypeError('插件 Worker 入口必须是 file: URL');
  }
  const runtimeRoot = process.env.SCWC_RUNTIME_ROOT;
  const bootstrap = runtimeRoot
    ? path.join(runtimeRoot, 'plugin-worker.cjs')
    : fileURLToPath(new URL('./worker-bootstrap.ts', import.meta.url));
  return new Worker(bootstrap, {
    ...options,
    env: {
      ...(options.env ?? process.env),
      SCWC_PLUGIN_WORKER_ENTRY: entry.href,
    },
  });
}
