import type { ProcessOptions } from '../../types/plugin-process.d.ts';

/** Missing settings always select the isolated v2 runtime, never the core process. */
export function resolveProcessOptions(value: unknown): ProcessOptions {
  if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) {
    throw new Error('runtime 必须是配置对象');
  }
  const input = (value ?? {}) as Record<string, unknown>;
  if (input.mode !== undefined && input.mode !== 'process') {
    throw new Error('runtime.mode 仅支持 process（默认独立进程）');
  }
  if (input.apiVersion !== undefined && input.apiVersion !== 2) {
    throw new Error('runtime.apiVersion 仅支持 2（默认第二版契约）');
  }
  const result: ProcessOptions = { mode: 'process', apiVersion: 2 };
  for (const key of ['startupTimeoutMs', 'requestTimeoutMs', 'shutdownTimeoutMs'] as const) {
    const timeout = input[key];
    if (timeout !== undefined) {
      if (
        typeof timeout !== 'number' ||
        !Number.isInteger(timeout) ||
        timeout < 100 ||
        timeout > 600_000
      ) {
        throw new Error(`runtime.${key} 必须为 100–600000 的整数`);
      }
      result[key] = timeout;
    }
  }
  return result;
}
