import type { WorkspaceSnapshot } from './types.ts';

export interface WorkspaceSession {
  workspaceId: string;
  clientWindowId: string;
}
// Desktop hosts can implement this interface for a workspace bound to a local file.
export interface WorkspacePersistence {
  load(): WorkspaceSnapshot | undefined;
  publish(snapshot: WorkspaceSnapshot): void;
  loadSession?(): WorkspaceSession | undefined;
  publishSession?(session: WorkspaceSession): void;
}
export class BrowserWorkspace implements WorkspacePersistence {
  private installationId: string;
  constructor(installationId: string) {
    this.installationId = installationId;
  }
  private get key() {
    return `scwc.browser-workspace.${this.installationId}`;
  }
  loadSession(): WorkspaceSession | undefined {
    const navigation = performance.getEntriesByType?.('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined;
    // Duplicated tabs inherit sessionStorage too, but must keep their own workspace.
    if (navigation?.type !== 'reload' && navigation?.type !== 'back_forward') {
      return;
    }
    try {
      const session = JSON.parse(sessionStorage.getItem(`${this.key}.session`) ?? 'null');
      if (
        typeof session?.workspaceId === 'string' &&
        /^[\w-]{1,128}$/.test(session.workspaceId) &&
        typeof session.clientWindowId === 'string' &&
        /^[\w-]{1,128}$/.test(session.clientWindowId)
      ) {
        return session;
      }
    } catch {
      /* Fall back to a new workspace when session storage is unavailable. */
    }
  }
  publishSession(session: WorkspaceSession) {
    try {
      sessionStorage.setItem(`${this.key}.session`, JSON.stringify(session));
    } catch {
      /* Layout persistence remains available independently of the tab session. */
    }
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
