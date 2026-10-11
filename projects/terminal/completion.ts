import { AsyncLocalStorage } from 'node:async_hooks';

const completionOutput = new AsyncLocalStorage<{
  stdout(text: string): void;
  stderr(text: string): void;
}>();
let outputInstalled = false;

/** Raw writes within a candidate callback belong to the output tab, even during execution. */
export function withCompletionOutput<T>(
  output: { stdout(text: string): void; stderr(text: string): void },
  callback: () => T,
): T {
  if (!outputInstalled) {
    outputInstalled = true;
    for (const kind of ['stdout', 'stderr'] as const) {
      const stream = process[kind];
      const write = stream.write.bind(stream);
      stream.write = (
        chunk: string | Uint8Array,
        encoding?: BufferEncoding | ((error?: Error | null) => void),
        callback?: (error?: Error | null) => void,
      ) => {
        const target = completionOutput.getStore()?.[kind];
        if (!target) {
          return typeof encoding === 'function'
            ? write(chunk, encoding)
            : encoding === undefined
              ? write(chunk, callback)
              : write(chunk, encoding, callback);
        }
        target(
          typeof chunk === 'string'
            ? chunk
            : Buffer.from(chunk).toString(typeof encoding === 'string' ? encoding : 'utf8'),
        );
        const done = typeof encoding === 'function' ? encoding : callback;
        if (done) {
          queueMicrotask(() => done());
        }
        return true;
      };
    }
  }
  return completionOutput.run(output, callback);
}

/** Completion intentionally splits literal spaces, preserving the unfinished last word. */
export function completionInput(command: string, cursor = command.length) {
  const parts = command.split(' ');
  const word = parts.pop() ?? '';
  const parents = parts.filter(Boolean);
  const start = command.length - word.length;
  const isKey = word.startsWith('-');
  const equals = isKey ? word.indexOf('=') : -1;
  const isValue = equals >= 0;
  const from = isValue ? start + equals + 1 : start;
  return {
    parents,
    word,
    start,
    from,
    to: command.length,
    isKey,
    isValue,
    key: isValue ? word.slice(0, equals).replace(/^--?/, '') : undefined,
    prefix: command.slice(from, Math.max(from, cursor)),
    deep: parents.length >= 2,
    eligible: cursor >= start && cursor <= command.length,
    stem: command.slice(0, from),
  };
}

/** Release cancelled requests even if a provider does not cooperate with its signal. */
export function abortable<T>(work: T | PromiseLike<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error('命令提示已取消'));
    const cleanup = () => signal.removeEventListener('abort', abort);
    Promise.resolve(work).then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
    if (signal.aborted) {
      abort();
    } else {
      signal.addEventListener('abort', abort, { once: true });
    }
  });
}
