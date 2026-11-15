import { ConfigController } from '../../../shared/store/config.ts';
import { API_TOKEN_CHANGED_EVENT } from '../../../shared/userscript-config.ts';
import { notify } from '../utils/notify.ts';

const storageKey = 'scwc.userscript.sync-circuit.v1';
const maxFailures = 3;
export const CORE_SYNC_BLOCKED_MESSAGE =
  '核心连接失败，自动重试已暂停。请检查地址、端口和 API Token；再次操作时会尝试连接一次。';
export const CORE_CONNECTION_RECOVERED_EVENT = 'scwc-core-connection-recovered';

interface CircuitState {
  failures: number;
  blocked: boolean;
}

function readLastResult(): boolean | undefined {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (typeof saved === 'boolean') {
      return saved;
    }
    // 旧格式只有耗尽重试的 blocked 才能证明失败，部分失败不算最终结果。
    if (saved && typeof saved === 'object') {
      if ('blocked' in saved && saved.blocked === true) {
        localStorage.setItem(storageKey, 'false');
        return false;
      }
      localStorage.removeItem(storageKey);
    }
  } catch {
    // 存储不可用时仍可在本页重试。
  }
}

let state: CircuitState = { failures: 0, blocked: false };
// 生命周期属于当前文档；浮窗重新挂载、设置变化和连接恢复都不重新分配启动预算。
let initialConnection = true;
let suppressAutomaticNotice = readLastResult() === false;
let lastNoticeAt = -Infinity;

function saveResult(success: boolean) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(success));
  } catch {
    // 最终结果保存失败不影响当前页的熔断。
  }
}

export function resetCoreSyncCircuit() {
  state = { failures: 0, blocked: false };
  initialConnection = false;
  lastNoticeAt = -Infinity;
  ConfigController.setSyncAuthRequired(false);
}

export function isCoreSyncBlocked() {
  return state.blocked;
}

export function shouldNotifyAutomaticConnectionFailure() {
  return !suppressAutomaticNotice;
}

export function recordCoreSyncFailure() {
  if (state.blocked) {
    return true;
  }
  state.failures++;
  if (!initialConnection || state.failures >= maxFailures) {
    pauseCoreSync();
    notifyCoreSyncBlocked(true);
  }
  return state.blocked;
}

function pauseCoreSync() {
  initialConnection = false;
  state.blocked = true;
  saveResult(false);
  ConfigController.setSyncAuthRequired(true);
}

/** 用户操作的单次请求已失败，不能重新启动后台重试。 */
export function recordCoreRequestFailure() {
  pauseCoreSync();
  notifyCoreSyncBlocked();
}

export function isCoreConnectionError(error: unknown): error is Error & { code: string } {
  return error instanceof Error && 'code' in error && error.code === 'CORE_CONNECTION_FAILED';
}

export function recordCoreSyncSuccess() {
  const recovered = state.blocked;
  resetCoreSyncCircuit();
  saveResult(true);
  suppressAutomaticNotice = false;
  if (recovered) {
    window.dispatchEvent(new Event(CORE_CONNECTION_RECOVERED_EVENT));
  }
}

export function notifyCoreSyncBlocked(automatic = false) {
  if (automatic && suppressAutomaticNotice) {
    return;
  }
  const now = Date.now();
  if (automatic && now - lastNoticeAt < 750) {
    return;
  }
  lastNoticeAt = now;
  notify({
    title: '核心连接失败',
    description: CORE_SYNC_BLOCKED_MESSAGE,
    type: 'error',
    placement: ConfigController.config.notify.placement,
  });
}

export function assertCoreRequestAllowed(interactive = true) {
  if (interactive || !isCoreSyncBlocked()) {
    return;
  }
  throw Object.assign(new Error(CORE_SYNC_BLOCKED_MESSAGE), { code: 'CORE_SYNC_BLOCKED' });
}

window.addEventListener(API_TOKEN_CHANGED_EVENT, resetCoreSyncCircuit);
