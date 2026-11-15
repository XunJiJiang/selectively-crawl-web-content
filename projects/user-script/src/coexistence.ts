import { GM_info } from 'vite-plugin-monkey/dist/client';
import { CLIENT_VERSION } from '../../shared/client-version.ts';
import { COEXISTENCE_PROTOCOL } from '../../shared/client-coexistence.ts';

export function startCoexistenceAnnouncement() {
  if (window.parent !== window || !/^https?:$/.test(location.protocol)) {
    return () => undefined;
  }
  const announce = () =>
    window.postMessage(
      {
        protocol: COEXISTENCE_PROTOCOL,
        type: 'script',
        script: {
          version: GM_info?.script?.version || CLIENT_VERSION,
          handler: GM_info?.scriptHandler || 'Unknown',
          handlerVersion: GM_info?.version || '',
        },
      },
      location.origin,
    );
  const receive = (event: MessageEvent) => {
    if (
      event.source === window &&
      event.origin === location.origin &&
      event.data?.protocol === COEXISTENCE_PROTOCOL &&
      event.data.type === 'probe'
    ) {
      announce();
    }
  };
  window.addEventListener('message', receive);
  announce();
  return () => window.removeEventListener('message', receive);
}
