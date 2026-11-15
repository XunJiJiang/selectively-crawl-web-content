import { afterEach, expect, it, vi } from 'vitest';
import { COEXISTENCE_PROTOCOL } from '../../shared/client-coexistence.ts';
vi.mock('vite-plugin-monkey/dist/client', () => ({
  GM_info: {
    script: { version: '3.4.7' },
    scriptHandler: 'Tampermonkey',
    version: '5.5.1',
  },
}));
import { startCoexistenceAnnouncement } from './coexistence.ts';
let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  vi.restoreAllMocks();
});
it('announces on startup and answers a later probe using the installed script version', () => {
  const post = vi.spyOn(window, 'postMessage');
  stop = startCoexistenceAnnouncement();
  expect(post).toHaveBeenCalledWith(
    {
      protocol: COEXISTENCE_PROTOCOL,
      type: 'script',
      script: {
        version: '3.4.7',
        handler: 'Tampermonkey',
        handlerVersion: '5.5.1',
      },
    },
    location.origin,
  );
  post.mockClear();
  for (const source of [{} as Window, window]) {
    window.dispatchEvent(
      new MessageEvent('message', {
        source,
        origin: location.origin,
        data: { protocol: COEXISTENCE_PROTOCOL, type: 'probe' },
      }),
    );
  }
  expect(post).toHaveBeenCalledTimes(1);
  stop();
  post.mockClear();
  window.dispatchEvent(
    new MessageEvent('message', {
      source: window,
      origin: location.origin,
      data: { protocol: COEXISTENCE_PROTOCOL, type: 'probe' },
    }),
  );
  expect(post).not.toHaveBeenCalled();
});
it('does not announce from child frames', () => {
  vi.spyOn(window, 'parent', 'get').mockReturnValue({} as Window);
  const post = vi.spyOn(window, 'postMessage');
  stop = startCoexistenceAnnouncement();
  expect(post).not.toHaveBeenCalled();
});
