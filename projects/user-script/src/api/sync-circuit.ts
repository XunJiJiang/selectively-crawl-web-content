import { ConfigController } from '../../../shared/store/config.ts';
import { API_TOKEN_CHANGED_EVENT } from '../../../shared/userscript-config.ts';
import { notify } from '../utils/notify.ts';

const storageKey = 'scwc.userscript.sync-circuit.v1';
const maxFailures = 3;
export const CORE_SYNC_BLOCKED_MESSAGE =
  '核心连接失败，已暂停重试。请检查地址、端口和 API Token，修改连接设置后重新尝试。';

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
  if (state.failures >= maxFailures) {
    state.blocked = true;
    saveResult(false);
    ConfigController.setSyncAuthRequired(true);
    notifyCoreSyncBlocked(true);
  }
  return state.blocked;
}

export function recordCoreSyncSuccess() {
  resetCoreSyncCircuit();
  saveResult(true);
  suppressAutomaticNotice = false;
}

export function notifyCoreSyncBlocked(automatic = false) {
  if (automatic && suppressAutomaticNotice) {
    return;
  }
  const now = Date.now();
  if (now - lastNoticeAt < 750) {
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
  if (!isCoreSyncBlocked()) {
    return;
  }
  if (interactive) {
    notifyCoreSyncBlocked();
  }
  throw Object.assign(new Error(CORE_SYNC_BLOCKED_MESSAGE), { code: 'CORE_SYNC_BLOCKED' });
}

window.addEventListener(API_TOKEN_CHANGED_EVENT, resetCoreSyncCircuit);
