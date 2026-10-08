import { randomUUID } from 'node:crypto';
import type {
  InputConstructor,
  InputErrorCode,
  InputFormat,
  InputReply,
  InputRequest,
  InputResult,
  InvocationIdentity,
} from '../types/task.d.ts';

export class InvocationInputError extends Error {
  readonly code: InputErrorCode;
  constructor(code: InputErrorCode, message: string) {
    super(message);
    this.name = 'InvocationInputError';
    this.code = code;
  }
}
export function inputError(error: unknown, signal?: AbortSignal): InvocationInputError {
  if (error instanceof InvocationInputError) {
    return error;
  }
  if (signal?.aborted) {
    return new InvocationInputError('cancelled', '输入已取消');
  }
  return new InvocationInputError(
    'unavailable',
    error instanceof Error ? error.message : String(error),
  );
}
export async function inputReply(
  work: () => Promise<string>,
  signal: AbortSignal,
): Promise<InputReply> {
  try {
    return { value: await work() };
  } catch (error) {
    const failure = inputError(error, signal);
    return { error: { code: failure.code, message: failure.message } };
  }
}

type InputHandler = (request: InputRequest, signal: AbortSignal) => Promise<string>;
let handler: InputHandler | undefined;
export function setInputHandler(value?: InputHandler) {
  handler = value;
}
export function readInput(request: InputRequest, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  if (!handler) {
    throw new InvocationInputError('unavailable', '当前调用没有可用的交互输入终端');
  }
  return handler(request, signal);
}
export function inputFormat(type: InputConstructor): InputFormat {
  if (type === String) {
    return 'string';
  }
  if (type === Number) {
    return 'number';
  }
  if (type === Boolean) {
    return 'boolean';
  }
  if (type === BigInt) {
    return 'bigint';
  }
  if (type === Date) {
    return 'date';
  }
  throw new InvocationInputError(
    'invalid-type',
    '输入类型仅支持 String、Number、Boolean、BigInt、Date',
  );
}
export function formatInput(value: string, type: InputFormat) {
  if (type === 'string') {
    return value;
  }
  const text = value.trim();
  if (type === 'number' && text && Number.isFinite(Number(text))) {
    return Number(text);
  }
  if (type === 'boolean') {
    if (/^(true|yes|y|1)$/i.test(text)) {
      return true;
    }
    if (/^(false|no|n|0)$/i.test(text)) {
      return false;
    }
  }
  if (type === 'bigint' && /^[+-]?\d+$/.test(text)) {
    return BigInt(text);
  }
  if (type === 'date' && text) {
    const date = new Date(text);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }
  throw new TypeError(
    `请输入有效的 ${type}${type === 'boolean' ? '（true/false、yes/no、y/n、1/0）' : ''}`,
  );
}
export async function nextInput(
  identity: InvocationIdentity,
  message: string,
  type: InputConstructor,
  signal: AbortSignal,
): Promise<InputResult<string | number | boolean | bigint | Date>> {
  try {
    const format = inputFormat(type);
    let prompt = message;
    for (;;) {
      const value = await readInput(
        { id: randomUUID(), identity, message: prompt, type: format },
        signal,
      );
      signal.throwIfAborted();
      try {
        return [undefined, formatInput(value, format)];
      } catch (error) {
        prompt = `${error instanceof Error ? error.message : error}\n${message}`;
      }
    }
  } catch (error) {
    return [inputError(error, signal), undefined];
  }
}

/** Input has no wall-clock deadline. Cancellation is sent separately across IPC. */
export function remoteInput(
  peer: {
    call<T>(method: string, args: unknown, timeout: number): Promise<T>;
    event(event: string, data: unknown): void;
  },
  request: InputRequest,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {
      peer.event('input.cancel', { id: request.id });
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
    peer
      .call<InputReply>('input.next', request, 0)
      .then((reply) => {
        if (reply.error) {
          reject(new InvocationInputError(reply.error.code, reply.error.message));
        } else {
          resolve(reply.value);
        }
      }, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}
