/* eslint-disable @typescript-eslint/no-explicit-any */
export const SCWC_TAG = 'SCWC';

const styleLog = 'background:#2563eb;color:#fff;padding:2px 6px;border-radius:3px;font-weight:bold';
const styleWarn = 'background:#facc15;color:#222;padding:2px 6px;border-radius:3px;font-weight:bold';
const styleError = 'background:#ef4444;color:#fff;padding:2px 6px;border-radius:3px;font-weight:bold';

export function scwcLog(...args: any[]) {
  console.log(`%c${SCWC_TAG}`, styleLog, ...args);
}
export function scwcWarn(...args: any[]) {
  console.warn(`%c${SCWC_TAG}`, styleWarn, ...args);
}
export function scwcError(...args: any[]) {
  console.error(`%c${SCWC_TAG}`, styleError, ...args);
}
