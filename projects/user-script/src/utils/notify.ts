import { notify as sharedNotify } from '../../../shared/components/notify.ts';
import type { INotifyOptions } from '../../../shared/types/notify.d.ts';
import {
  isScriptVisible,
  trackScriptNotification,
  trackScriptNoticeElement,
} from '../visibility.ts';

export function notify(options: INotifyOptions) {
  if (!isScriptVisible()) {
    return;
  }
  const previousRoot = document.getElementById('scwc-notify-root');
  const handle = sharedNotify(options);
  if (handle) {
    trackScriptNotification(handle);
  }
  const root = document.getElementById('scwc-notify-root');
  if (!previousRoot && root) {
    trackScriptNoticeElement(root);
  }
  return handle;
}
