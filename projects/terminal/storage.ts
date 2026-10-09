import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { TerminalModel, sanitizeOutput } from './model.ts';
import type { WindowState } from './model.ts';

export class StateStore {
  readonly filename: string;
  private token = randomUUID();
  private writing = Promise.resolve();
  private locked = false;
  private canBackup = true;
  constructor(filename: string) {
    this.filename = filename;
  }
  async lock() {
    await fs.mkdir(path.dirname(this.filename), { recursive: true });
    const lock = this.filename + '.lock';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await fs.writeFile(lock, JSON.stringify({ pid: process.pid, token: this.token }), {
          flag: 'wx',
          mode: 0o600,
        });
        this.locked = true;
        return;
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') {
          throw error;
        }
        let stale = false;
        try {
          const data = JSON.parse(await fs.readFile(lock, 'utf8'));
          try {
            process.kill(data.pid, 0);
          } catch (error) {
            stale = error instanceof Error && 'code' in error && error.code === 'ESRCH';
          }
        } catch {
          throw new Error('终端状态锁文件损坏，请检查：' + lock);
        }
        if (!stale) {
          throw new Error('另一个终端正在使用状态文件：' + this.filename, { cause: error });
        }
        await fs.unlink(lock);
      }
    }
    throw new Error('无法获取终端状态锁');
  }
  async load(): Promise<TerminalModel> {
    for (const filename of [this.filename, this.filename + '.bak']) {
      try {
        const model = restoreState(JSON.parse(await fs.readFile(filename, 'utf8')));
        if (filename !== this.filename) {
          model.message = '主状态文件不可用，已从备份恢复';
        }
        return model;
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          continue;
        }
        if (filename === this.filename) {
          this.canBackup = false;
          await fs.copyFile(filename, `${filename}.corrupt-${Date.now()}`).catch(() => undefined);
        }
      }
    }
    const model = new TerminalModel();
    try {
      await fs.access(this.filename);
      model.message = '状态文件损坏，已保留副本并恢复默认窗口';
    } catch {
      /* Initial launch. */
    }
    return model;
  }
  save(model: TerminalModel) {
    const text = JSON.stringify({
      version: 1,
      activeId: model.activeId,
      globalDraft: model.globalDraft,
      transparentBackground: model.transparentBackground,
      windows: model.windows.map(({ input: _input, ...window }) => window),
    });
    this.writing = this.writing
      .catch(() => undefined)
      .then(async () => {
        const temporary = `${this.filename}.${this.token}.tmp`;
        await fs.writeFile(temporary, text, { mode: 0o600 });
        if (this.canBackup) {
          await fs
            .copyFile(this.filename, this.filename + '.bak')
            .catch((error: NodeJS.ErrnoException) => {
              if (error.code !== 'ENOENT') {
                throw error;
              }
            });
        }
        await fs.rename(temporary, this.filename);
        this.canBackup = true;
      });
    return this.writing;
  }
  async release() {
    await this.writing.catch(() => undefined);
    if (this.locked) {
      const lock = this.filename + '.lock';
      const data = JSON.parse(await fs.readFile(lock, 'utf8'));
      if (data.token === this.token) {
        await fs.unlink(lock);
      }
      this.locked = false;
    }
  }
}
export function restoreState(value: unknown): TerminalModel {
  if (
    !value ||
    typeof value !== 'object' ||
    !('version' in value) ||
    value.version !== 1 ||
    !('windows' in value) ||
    !Array.isArray(value.windows)
  ) {
    throw new Error('不支持的状态格式');
  }
  const model = new TerminalModel();
  const windows: WindowState[] = [];
  const ids = new Set<string>();
  const numbers = new Set<number>();
  for (const entry of value.windows.slice(0, 128)) {
    if (!entry || typeof entry !== 'object' || !['output', 'command'].includes(entry.kind)) {
      continue;
    }
    if (entry.kind === 'output' && windows.some((item) => item.kind === 'output')) {
      continue;
    }
    const id =
      typeof entry.id === 'string' && /^[\da-f-]{36}$/i.test(entry.id) && !ids.has(entry.id)
        ? entry.id
        : randomUUID();
    ids.add(id);
    let number: number | undefined;
    if (entry.kind === 'command') {
      number =
        Number.isInteger(entry.number) && entry.number > 0 && !numbers.has(entry.number)
          ? entry.number
          : 1;
      while (numbers.has(number as number)) {
        number = (number as number) + 1;
      }
      numbers.add(number as number);
    }
    const strings = (data: unknown, count: number) =>
      Array.isArray(data)
        ? data.filter((item): item is string => typeof item === 'string').slice(-count)
        : [];
    const history = strings(entry.history, 1000);
    const draft = typeof entry.draft === 'string' ? entry.draft.slice(0, 65536) : '';
    const lines = strings(entry.lines, 10000).map(sanitizeOutput);
    let bytes = lines.reduce((sum, line) => sum + Buffer.byteLength(line), 0);
    while (bytes > 10 * 1024 * 1024 && lines.length) {
      bytes -= Buffer.byteLength(lines.shift() ?? '');
    }
    const window: WindowState = {
      id,
      kind: entry.kind,
      number,
      title:
        entry.kind === 'command' && typeof entry.title === 'string'
          ? sanitizeOutput(entry.title)
              .replace(/\x1b\[[\d;]*m/g, '')
              .replace(/\n/g, ' ')
              .trim()
              .slice(0, 256) || undefined
          : undefined,
      lines,
      bytes,
      lineOffset: Math.max(0, Number(entry.lineOffset) || 0),
      draft,
      cursor: Math.min(draft.length, Math.max(0, Number(entry.cursor) || 0)),
      history,
      historyCursor: Math.max(0, Math.min(history.length, Number(entry.historyCursor) || 0)),
      historyDraft: typeof entry.historyDraft === 'string' ? entry.historyDraft : '',
      scroll: Math.max(0, Math.min(lines.length, Number(entry.scroll) || 0)),
    };
    if (
      entry.anchor &&
      Number.isInteger(entry.anchor.line) &&
      Number.isInteger(entry.anchor.offset) &&
      entry.anchor.offset >= 0
    ) {
      window.anchor = { line: entry.anchor.line, offset: entry.anchor.offset };
    }
    if (entry.task && ['running', 'background', 'cancelling'].includes(entry.task.status)) {
      lines.push(`[interrupted] 上次退出时被中断，未重新执行：${String(entry.task.command ?? '')}`);
    }
    windows.push(window);
  }
  const output = windows.find((window) => window.kind === 'output') ?? model.output;
  model.windows = [output, ...windows.filter((window) => window.kind === 'command')];
  const activeId = 'activeId' in value ? value.activeId : undefined;
  model.activeId = model.windows.find((window) => window.id === activeId)?.id ?? output.id;
  model.globalDraft =
    'globalDraft' in value && typeof value.globalDraft === 'string'
      ? value.globalDraft.slice(0, 65536)
      : '';
  model.globalCursor = model.globalDraft.length;
  model.transparentBackground = !(
    'transparentBackground' in value && value.transparentBackground === false
  );
  return model;
}
