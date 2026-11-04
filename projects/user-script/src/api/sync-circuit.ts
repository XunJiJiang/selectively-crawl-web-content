import { ConfigController } from '../../../shared/store/config.ts';
import { API_TOKEN_CHANGED_EVENT } from '../../../shared/userscript-config.ts';
import { notify } from '../utils/notify.ts';

const storageKey = 'scwc.userscript.sync-circuit.v1';
const maxFailures = 3;
export const CORE_SYNC_BLOCKED_MESSAGE = '核心连接已暂停。请修改设置中的 API Token 后重新尝试。';

interface CircuitState {
  failures: number;
  blocked: boolean;
}

function readState(fallback: CircuitState): CircuitState {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return fallback;
    }
    const saved = JSON.parse(raw) as Partial<CircuitState>;
    const failures =
      typeof saved?.failures === 'number' && Number.isInteger(saved.failures) ? saved.failures : 0;
    return {
      failures: Math.max(0, Math.min(maxFailures, failures)),
      blocked: saved?.blocked === true,
    };
  } catch {
    return fallback;
  }
}

let state = readState({ failures: 0, blocked: false });
let lastNoticeAt = 0;
ConfigController.setSyncAuthRequired(state.blocked);

function saveState(next: CircuitState) {
  state = next;
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // The current page still enforces the circuit if storage is unavailable.
  }
  ConfigController.setSyncAuthRequired(state.blocked);
}

export function isCoreSyncBlocked() {
  const saved = readState(state);
  if (saved.blocked !== state.blocked || saved.failures !== state.failures) {
    state = saved;
    ConfigController.setSyncAuthRequired(state.blocked);
  }
  return state.blocked;
}

export function recordCoreSyncFailure() {
  const saved = readState(state);
  const failures = Math.min(maxFailures, saved.failures + 1);
  saveState({ failures, blocked: failures >= maxFailures });
  return state.blocked;
}

export function recordCoreSyncSuccess() {
  saveState({ failures: 0, blocked: false });
}

export function notifyCoreSyncBlocked() {
  const now = Date.now();
  if (now - lastNoticeAt < 750) {
    return;
  }
  lastNoticeAt = now;
  notify({
    title: '核心连接已暂停',
    description: CORE_SYNC_BLOCKED_MESSAGE,
    type: 'error',
    placement: ConfigController.config.notify.placement,
  });
}

export function assertCoreRequestAllowed() {
  if (!isCoreSyncBlocked()) {
    return;
  }
  notifyCoreSyncBlocked();
  throw Object.assign(new Error(CORE_SYNC_BLOCKED_MESSAGE), { code: 'CORE_SYNC_BLOCKED' });
}

window.addEventListener(API_TOKEN_CHANGED_EVENT, () => {
  saveState({ failures: 0, blocked: false });
});

window.addEventListener('storage', (event) => {
  if (event.key === storageKey || event.key === null) {
    state = readState({ failures: 0, blocked: false });
    ConfigController.setSyncAuthRequired(state.blocked);
  }
});
