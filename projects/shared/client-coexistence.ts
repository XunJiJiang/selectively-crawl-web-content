/** Public page handshake only carries versions, never credentials or core configuration. */
export const COEXISTENCE_PROTOCOL = 'scwc-client-coexistence/v1';
export interface ScriptPresence {
  version: string;
  handler: string;
  handlerVersion: string;
}
export function readScriptPresence(input: unknown): ScriptPresence | undefined {
  if (!input || typeof input !== 'object') {
    return;
  }
  const { version, handler, handlerVersion } = input as ScriptPresence;
  if (
    typeof version === 'string' &&
    /^[\w.+-]{1,64}$/.test(version) &&
    typeof handler === 'string' &&
    /^[\w .-]{1,64}$/.test(handler) &&
    typeof handlerVersion === 'string' &&
    /^[\w.+-]{0,64}$/.test(handlerVersion)
  ) {
    return { version, handler, handlerVersion };
  }
}
export type CoexistenceInfo =
  | { suppressed: true }
  | {
      suppressed: false;
      extensionVersion: string;
      scriptManager: boolean;
      extensionManager: boolean;
      instructions: string;
    };
/** No WebExtensions API returns the browser's internal extension-management URL. */
export function chromiumExtensionManager(agent: {
  userAgent: string;
  brands?: readonly { brand: string }[];
}): string | undefined {
  if (
    /Edg\//.test(agent.userAgent) ||
    agent.brands?.some(({ brand }) => brand === 'Microsoft Edge')
  ) {
    return 'edge://extensions/';
  }
  if (agent.brands?.some(({ brand }) => brand === 'Google Chrome')) {
    return 'chrome://extensions/';
  }
  // A generic Chrome UA is also used by other Chromium browsers. Do not guess its scheme.
}
