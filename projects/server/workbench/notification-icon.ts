import path from 'node:path';
import { SERVER_ROOT } from '../common/paths.ts';

/** The 256px PNG is exported from resources/svg/scwc.svg and shipped with the core. */
export function notificationIconFile() {
  return path.join(SERVER_ROOT, 'public/resources/notification.png');
}
