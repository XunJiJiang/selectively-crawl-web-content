export type SystemNotificationMode = 'core-and-remote-browsers' | 'core' | 'browser';
export interface SystemNotificationSettings {
  mode: SystemNotificationMode;
  enabled: boolean;
  answered: boolean;
}
export const initialSystemNotificationSettings: SystemNotificationSettings = {
  mode: 'core-and-remote-browsers',
  enabled: false,
  answered: false,
};
export function isLoopbackHostname(hostname: string) {
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '::1' ||
    /^127(?:\.\d{1,3}){3}$/.test(host) ||
    /^::ffff:127(?:\.\d{1,3}){3}$/.test(host) ||
    /^::ffff:7f[\da-f]{2}:[\da-f]{1,4}$/.test(host)
  );
}
export function browserNotificationRoute(
  mode: SystemNotificationMode,
  hostname: string,
  desktop = false,
) {
  return (
    !desktop &&
    (mode === 'browser' || (mode === 'core-and-remote-browsers' && !isLoopbackHostname(hostname)))
  );
}
export function coreNotificationRoute(mode: SystemNotificationMode, desktop = false) {
  return desktop || mode !== 'browser';
}
