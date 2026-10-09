import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect } from 'vitest';
import { StateStore } from './storage.ts';
import { TerminalModel } from './model.ts';

describe('atomic terminal persistence', () => {
  it('persists names and background preferences without saving global panel output', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'scwc-state-test-'));
    const store = new StateStore(path.join(directory, 'state.json'));
    try {
      await store.lock();
      const model = new TerminalModel();
      model.rename(model.windows[1], 'saved title');
      model.transparentBackground = false;
      model.beginPanel('help');
      model.writePanel('transient global output');
      await store.save(model);
      const restored = await store.load();
      expect(restored.title(restored.windows[1])).toBe('saved title');
      expect(restored.transparentBackground).toBe(false);
      expect(restored.panel).toBeUndefined();
      expect(await fs.readFile(store.filename, 'utf8')).not.toContain('transient global output');
    } finally {
      await store.release();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
  it('rejects concurrent owners, recovers the backup and preserves corrupt input', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'scwc-state-test-'));
    const filename = path.join(directory, 'state.json');
    const store = new StateStore(filename);
    try {
      await store.lock();
      await expect(new StateStore(filename).lock()).rejects.toThrow('另一个终端');
      const model = new TerminalModel();
      await store.save(model);
      model.globalDraft = 'second';
      await store.save(model);
      await fs.writeFile(filename, '{broken');
      const restored = await store.load();
      expect(restored.output.id).toBe(model.output.id);
      expect(restored.globalDraft).toBe('');
      expect((await fs.readdir(directory)).some((name) => name.includes('.corrupt-'))).toBe(true);
      await store.save(restored);
      await store.release();
      const next = new StateStore(filename);
      await next.lock();
      await next.release();
    } finally {
      await store.release();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
