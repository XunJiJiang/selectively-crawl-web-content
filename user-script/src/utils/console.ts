import { SCWC_TAG } from './common.ts';

const styleLog = 'background:#2563eb;color:#fff;padding:2px 6px;border-radius:3px;font-weight:bold';
const styleWarn =
  'background:#facc15;color:#222;padding:2px 6px;border-radius:3px;font-weight:bold';
const styleError =
  'background:#ef4444;color:#fff;padding:2px 6px;border-radius:3px;font-weight:bold';

export function scwcLog(...args: Parameters<Console['log']>) {
  console.log(`%c${SCWC_TAG}`, styleLog, ...args);
}
export function scwcWarn(...args: Parameters<Console['warn']>) {
  console.warn(`%c${SCWC_TAG}`, styleWarn, ...args);
}
export function scwcError(...args: Parameters<Console['error']>) {
  console.error(`%c${SCWC_TAG}`, styleError, ...args);
}
