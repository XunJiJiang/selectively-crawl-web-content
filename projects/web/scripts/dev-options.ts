export function parseCorePort(value: string | undefined): string {
  if (value === undefined || !/^\d+$/.test(value)) {
    throw new Error('--core-port 必须是 1 到 65535 之间的整数');
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error('--core-port 必须是 1 到 65535 之间的整数');
  }
  return String(port);
}

/** Consume project options while preserving Vite's own flags and positional arguments. */
export function parseWebDevArgs(args: string[]) {
  const viteArgs: string[] = [];
  let corePort: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') {
      viteArgs.push(...args.slice(i));
      break;
    }
    if (arg === '--core-port' || arg.startsWith('--core-port=')) {
      corePort = parseCorePort(
        arg === '--core-port' ? args[++i] : arg.slice('--core-port='.length),
      );
    } else {
      viteArgs.push(arg);
    }
  }
  return { viteArgs, corePort };
}
