import '../server/common/environment.ts';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { isPackaged, ROOT, ENV_DIR, APP_DIR } from '../server/common/paths.ts';
import { parseStartupArgs } from '../server/common/config.ts';
import { CoreConnection } from './core.ts';
import { TerminalController } from './controller.ts';
import { TerminalModel } from './model.ts';
import { StateStore } from './storage.ts';
import { InputDecoder } from './input.ts';
import { copyText } from './clipboard.ts';

export async function startTerminal(args: string[] = process.argv.slice(2)) {
  const parsed = parseStartupArgs(args);
  const stateFilename = path.resolve(
    ENV_DIR,
    process.env.SCWC_TERMINAL_STATE_FILE ?? 'data/terminal/state.json',
  );
  const store =
    process.env.SCWC_TERMINAL_PERSIST === 'false' ? undefined : new StateStore(stateFilename);
  await store?.lock();
  const model = store ? await store.load() : new TerminalModel();
  const coreArgs = args.filter(
    (arg) => !arg.startsWith('--terminal') && !arg.startsWith('--use-tsx'),
  );
  const core = new CoreConnection({
    args: coreArgs,
    useTsx: parsed['use-tsx'] === true || parsed['use-tsx'] === 'true',
  });
  const controller = new TerminalController(model, core);
  const tty = Boolean(process.stdin.isTTY && process.stdout.isTTY && process.env.TERM !== 'dumb');
  controller.onCopy = (text) => copyText(text, process.stdout);
  let dirty = false;
  let stopped = false;
  const stop = Promise.withResolvers<void>();
  const decoder = new InputDecoder((key) => {
    void controller.key(key);
  });
  const data = (chunk: Buffer) => decoder.feed(chunk);
  const paint = () => {
    if (tty) {
      controller.renderer.schedulePaint(model, process.stdout);
    }
  };
  controller.onChange = () => {
    dirty = true;
    paint();
  };
  controller.onOutput = (text) => {
    if (!tty) {
      process.stdout.write(text + '\n');
    }
  };
  const animate = tty ? setInterval(paint, 100) : undefined;
  const persist = store
    ? setInterval(() => {
        if (dirty) {
          dirty = false;
          void store.save(model).catch((error) => {
            model.message = `状态保存失败：${error.message}`;
            paint();
          });
        }
      }, 1000)
    : undefined;
  let reader: readline.Interface | undefined;
  const inputLines: string[] = [];
  let lineRunning = false;
  let interactiveReady = false;
  let inputEnded = false;
  const drain = () => {
    if (lineRunning || !inputLines.length || (!interactiveReady && !model.confirmation)) {
      return;
    }
    const window =
      model.active.kind === 'command'
        ? model.active
        : model.windows.find((item) => item.kind === 'command');
    if (window?.task && !window.input && !model.panel?.input && !inputLines[0].startsWith(':')) {
      return;
    }
    lineRunning = true;
    const line = inputLines.shift() ?? '';
    void controller.line(line).finally(() => {
      lineRunning = false;
      drain();
    });
  };
  const originalChange = controller.onChange;
  controller.onChange = () => {
    originalChange?.();
    drain();
    if (inputEnded && !inputLines.length && !lineRunning) {
      void controller.endInput();
    }
  };
  if (tty) {
    process.stdout.write('\x1b[?1049h\x1b[>1u\x1b[?25l\x1b[?1003h\x1b[?1006h\x1b[?2004h');
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', data);
    process.stdout.on('resize', paint);
    paint();
  } else {
    reader = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
    reader.on('line', (line) => {
      inputLines.push(line);
      drain();
    });
    reader.on('close', () => {
      inputEnded = true;
      if (!inputLines.length && !lineRunning) {
        void controller.endInput();
      }
    });
    process.stdout.write('SCWC 终端：普通命令直接输入；:help 查看窗口及全局命令；:q 退出。\n');
  }
  const cleanup = async () => {
    if (stopped) {
      return;
    }
    stopped = true;
    clearInterval(animate);
    clearInterval(persist);
    controller.renderer.cancelPaint();
    decoder.dispose();
    reader?.close();
    process.stdin.off('data', data);
    process.stdout.off('resize', paint);
    if (tty) {
      process.stdin.setRawMode(false);
      process.stdout.write('\x1b[?1003l\x1b[?1006l\x1b[?2004l\x1b[<u\x1b[?25h\x1b[?1049l');
      process.stdin.pause();
    }
    try {
      if (store) {
        try {
          await store.save(model);
        } finally {
          await store.release();
        }
      }
    } catch (error) {
      process.exitCode = 1;
      console.error('状态保存失败', error);
    }
    process.off('SIGTERM', terminate);
    process.off('SIGINT', interrupt);
    process.off('uncaughtException', fatal);
    stop.resolve();
  };
  controller.onExit = cleanup;
  const terminate = () => {
    void controller.dispose().finally(cleanup);
  };
  const interrupt = () => {
    if (!tty) {
      void controller
        .cancelInput()
        .then((cancelled) => (cancelled ? undefined : controller.lifecycle(false)))
        .catch((error) => {
          model.message = String(error);
        });
    }
  };
  const fatal = (error: Error) => {
    process.exitCode = 1;
    void controller
      .dispose()
      .finally(cleanup)
      .finally(() => console.error(error));
  };
  process.once('SIGTERM', terminate);
  process.on('SIGINT', interrupt);
  process.once('uncaughtException', fatal);
  try {
    await controller.start();
    const directory = path.resolve(
      ENV_DIR,
      process.env.SCWC_CMD_PLUGIN_DIR ??
        (isPackaged
          ? path.join(APP_DIR, 'terminal/plugins')
          : path.join(ROOT, 'projects/terminal/plugins')),
    );
    await controller.plugins.load(directory, model.output.id, controller.commands);
    interactiveReady = true;
    drain();
    await stop.promise;
  } catch (error) {
    model.message = error instanceof Error ? error.message : String(error);
    controller.output({ windowId: model.output.id, text: model.message });
    interactiveReady = true;
    drain();
    // Keep the terminal available after a core startup failure so :r and :q remain usable.
    if (!stopped) {
      await stop.promise;
    }
  } finally {
    await cleanup();
  }
}
if (
  isPackaged ||
  (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]))
) {
  void startTerminal().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
