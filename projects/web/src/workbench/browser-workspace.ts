import type { WorkspaceSnapshot } from './types.ts';

// Desktop hosts can implement this interface for a workspace bound to a local file.
export interface WorkspacePersistence {
  load(): WorkspaceSnapshot | undefined;
  publish(snapshot: WorkspaceSnapshot): void;
}
export class BrowserWorkspace implements WorkspacePersistence {
  private installationId: string;
  constructor(installationId: string) {
    this.installationId = installationId;
  }
  private get key() {
    return `scwc.browser-workspace.${this.installationId}`;
  }
  load(): WorkspaceSnapshot | undefined {
    try {
      const text = localStorage.getItem(this.key);
      if (!text) {
        return;
      }
      const data = JSON.parse(text);
      if (data.version === 1 && data.snapshot?.layout && Array.isArray(data.snapshot.tabs)) {
        return structuredClone(data.snapshot);
      }
    } catch {
      /* A browser can disable storage; the current page still owns its workspace. */
    }
  }
  publish(snapshot: WorkspaceSnapshot) {
    try {
      localStorage.setItem(this.key, JSON.stringify({ version: 1, snapshot }));
    } catch {
      /* The server workspace remains available while browser storage is unavailable. */
    }
  }
}
