import type { VersionNotice } from '../../shared/client-version.ts';
/** 只声明本扩展使用的 WebExtensions 子集；Chrome MV3、Firefox 和 Safari 共用 Promise API。 */
export interface BrowserTab {
  id?: number;
  url?: string;
  title?: string;
}
export interface MessageSender {
  id?: string;
  url?: string;
  tab?: BrowserTab;
}
interface BrowserAPI {
  runtime: {
    id: string;
    getURL(path: string): string;
    sendMessage<T = unknown>(message: unknown): Promise<T>;
    onMessage: {
      addListener(
        listener: (
          message: unknown,
          sender: MessageSender,
          respond: (response: unknown) => void,
        ) => boolean | void,
      ): void;
    };
  };
  storage: {
    local: {
      get(key: string): Promise<Record<string, unknown>>;
      set(values: Record<string, unknown>): Promise<void>;
      remove(key: string): Promise<void>;
      setAccessLevel?: (options: { accessLevel: 'TRUSTED_CONTEXTS' }) => Promise<void>;
    };
  };
  tabs: {
    query(query: { active: boolean; currentWindow: boolean }): Promise<BrowserTab[]>;
    get(id: number): Promise<BrowserTab>;
    sendMessage<T = unknown>(id: number, message: unknown): Promise<T>;
    onRemoved: { addListener(listener: (id: number) => void): void };
    onUpdated: {
      addListener(listener: (id: number, change: { status?: string; url?: string }) => void): void;
    };
  };
  scripting: {
    executeScript(options: { target: { tabId: number }; files: string[] }): Promise<unknown>;
  };
  permissions: {
    contains(options: { origins: string[] }): Promise<boolean>;
    request(options: { origins: string[] }): Promise<boolean>;
  };
}
const globals = globalThis as typeof globalThis & { browser?: BrowserAPI; chrome?: BrowserAPI };
export const browser = (globals.browser ?? globals.chrome) as BrowserAPI;
export interface Reply<T> {
  versionNotice?: VersionNotice;
  ok: boolean;
  data?: T;
  error?: string;
}
export async function call<T>(message: unknown): Promise<T> {
  const reply = await browser.runtime.sendMessage<Reply<T>>(message);
  if (reply?.versionNotice && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('scwc-version-notice', { detail: reply.versionNotice }));
  }
  if (!reply?.ok) {
    throw new Error(reply?.error ?? '扩展后台没有响应');
  }
  return reply.data as T;
}
