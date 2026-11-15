import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  GM_xmlhttpRequest,
  type GmXmlhttpRequestOption,
  type GmResponseEvent,
} from 'vite-plugin-monkey/dist/client';
import { requestCore } from './request.ts';
import {
  isCoreSyncBlocked,
  recordCoreSyncFailure,
  recordCoreSyncSuccess,
  CORE_CONNECTION_RECOVERED_EVENT,
} from './sync-circuit.ts';
import { CLIENT_VERSION } from '../../../shared/client-version.ts';
import { setScriptVisible } from '../visibility.ts';
import { showVersionNotice } from '../../../shared/components/version-notice.ts';
import { notify } from '../utils/notify.ts';
import { invokeScriptUI } from './plugins.ts';
import { sendCrawlRequest } from './crawl.ts';
import { defaultSiteData } from '../../../shared/userscript-config.ts';

vi.mock('vite-plugin-monkey/dist/client', () => ({ GM_xmlhttpRequest: vi.fn() }));
vi.mock('../../../shared/components/version-notice.ts', () => ({ showVersionNotice: vi.fn() }));
vi.mock('../utils/notify.ts', () => ({ notify: vi.fn() }));
const gm = vi.mocked(GM_xmlhttpRequest);
let details: GmXmlhttpRequestOption<'text'>;
const abort = vi.fn();
const response = (overrides: Partial<GmResponseEvent<'text'>> = {}): GmResponseEvent<'text'> => ({
  status: 200,
  statusText: 'OK',
  responseText: '{"success":true}',
  response: '',
  responseHeaders: 'content-type: application/json\r\nx-test: value\r\n',
  readyState: 4,
  responseXML: null,
  finalUrl: 'http://localhost:3200/api/test',
  context: undefined,
  ...overrides,
});
function load(result = response()) {
  details.onload?.call(result, result);
}
beforeEach(() => {
  recordCoreSyncSuccess();
  setScriptVisible(true);
  vi.mocked(showVersionNotice).mockClear();
  vi.mocked(notify).mockClear();
  gm.mockReset();
  abort.mockReset();
  gm.mockImplementation((options) => {
    details = options as GmXmlhttpRequestOption<'text'>;
    return { abort };
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('blocked by CSP');
    }),
  );
});
afterEach(() => {
  recordCoreSyncSuccess();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('sends authenticated JSON through the manager with website identity and no cookies', async () => {
  const pending = requestCore(new URL('http://localhost:3200/api/test'), {
    method: 'POST',
    headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
    body: '{}',
  });
  expect(details).toMatchObject({
    url: 'http://localhost:3200/api/test',
    method: 'POST',
    data: '{}',
    headers: {
      'X-SCWC-Version': CLIENT_VERSION,
      Authorization: 'Bearer secret',
      Origin: location.origin,
      Referer: `${location.origin}/`,
    },
    anonymous: true,
    nocache: true,
    redirect: 'error',
  });
  load();
  const result = await pending;
  expect(result.headers.get('x-test')).toBe('value');
  expect(await result.json()).toEqual({ success: true });
  expect(fetch).not.toHaveBeenCalled();
});
it('preserves HTTP failures and JSON parse errors for callers', async () => {
  const pending = requestCore('http://localhost:3200/api/test');
  load(
    response({ status: 403, statusText: 'Forbidden', responseText: '{"message":"unauthorized"}' }),
  );
  const result = await pending;
  expect(result.ok).toBe(false);
  expect(result.status).toBe(403);
  expect(await result.json()).toEqual({ message: 'unauthorized' });
  const invalid = requestCore('http://localhost:3200/api/test');
  load(response({ responseText: '<html>not JSON</html>' }));
  await expect((await invalid).json()).rejects.toThrow();
});
it('suppresses late version notices after the script is hidden', async () => {
  const pending = requestCore('http://localhost:3200/api/test');
  setScriptVisible(false);
  load(
    response({
      responseHeaders:
        'X-SCWC-Version-Notice: ' +
        encodeURIComponent(JSON.stringify({ status: 'warning', message: '升级提示' })),
    }),
  );
  expect((await pending).ok).toBe(true);
  expect(showVersionNotice).not.toHaveBeenCalled();
});
it('cancels the manager request, cleans up its listener and ignores late callbacks', async () => {
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  const pending = requestCore('http://localhost:3200/api/test', { signal: controller.signal });
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await rejected;
  expect(abort).toHaveBeenCalledOnce();
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  load();
});
it('does not start a request when already cancelled', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    requestCore('http://localhost:3200/api/test', { signal: controller.signal }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(gm).not.toHaveBeenCalled();
});
it('blocks automatic requests after failure while allowing each user request exactly once', async () => {
  recordCoreSyncFailure();
  recordCoreSyncFailure();
  expect(recordCoreSyncFailure()).toBe(true);

  vi.mocked(notify).mockClear();
  await expect(
    requestCore('http://localhost:3200/api/plugin/config', { interactive: false }),
  ).rejects.toMatchObject({
    code: 'CORE_SYNC_BLOCKED',
  });
  expect(gm).not.toHaveBeenCalled();
  expect(notify).not.toHaveBeenCalled();
  vi.useFakeTimers();
  for (let attempt = 0; attempt < 2; attempt++) {
    const pending = requestCore('http://localhost:3200/api/plugin/toggle', { method: 'POST' });
    const rejected = expect(pending).rejects.toMatchObject({ code: 'CORE_CONNECTION_FAILED' });
    expect(gm).toHaveBeenCalledTimes(attempt + 1);
    expect(notify).toHaveBeenCalledTimes(attempt);
    const failed = { ...response({ status: 0 }), error: 'offline' };
    details.onerror?.call(failed, failed);
    await rejected;
    await vi.advanceTimersByTimeAsync(60000);
    expect(gm).toHaveBeenCalledTimes(attempt + 1);
    expect(notify).toHaveBeenCalledTimes(attempt + 1);
  }
});
it('records recovery after a successful user request without replaying it', async () => {
  recordCoreSyncFailure();
  vi.mocked(notify).mockClear();
  const recovered = vi.fn();
  window.addEventListener(CORE_CONNECTION_RECOVERED_EVENT, recovered, { once: true });
  const pending = requestCore('http://localhost:3200/api/plugin/toggle', { method: 'POST' });
  load();
  await pending;
  expect(gm).toHaveBeenCalledOnce();
  expect(isCoreSyncBlocked()).toBe(false);
  expect(recovered).toHaveBeenCalledOnce();
  expect(notify).not.toHaveBeenCalled();
});
it('reports a manager request timeout once without retrying the operation', async () => {
  vi.useFakeTimers();
  const pending = requestCore('http://localhost:3200/api/test');
  const rejected = expect(pending).rejects.toMatchObject({
    name: 'TimeoutError',
    code: 'CORE_CONNECTION_FAILED',
  });
  details.ontimeout?.();
  await rejected;
  await vi.advanceTimersByTimeAsync(60000);
  expect(gm).toHaveBeenCalledOnce();
  expect(notify).toHaveBeenCalledOnce();
});
it('does not record a cancellation or a late response as connectivity recovery', async () => {
  recordCoreSyncFailure();
  vi.mocked(notify).mockClear();
  const controller = new AbortController();
  const pending = requestCore('http://localhost:3200/api/test', { signal: controller.signal });
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await rejected;
  load();
  expect(isCoreSyncBlocked()).toBe(true);
  expect(notify).not.toHaveBeenCalled();
});
it('allows a user tree read once after failure while keeping periodic binding reads paused', async () => {
  recordCoreSyncFailure();
  vi.mocked(notify).mockClear();
  const plugin = { id: 'tree', title: 'Tree', description: '', controls: [] };
  const request = {
    version: 'v2' as const,
    instanceId: 'instance',
    eventId: 'read',
    bindingId: '$read',
    readOnly: true,
    fields: {},
  };
  await expect(
    invokeScriptUI(plugin, request, { result: [], failed: [] }, defaultSiteData().config),
  ).rejects.toMatchObject({ code: 'CORE_SYNC_BLOCKED' });
  expect(gm).not.toHaveBeenCalled();
  const pending = invokeScriptUI(
    plugin,
    { ...request, bindingId: '$tree:items' },
    { result: [], failed: [] },
    defaultSiteData().config,
  );
  expect(gm).toHaveBeenCalledOnce();
  load(response({ responseText: JSON.stringify({ code: 200, data: { updates: [] } }) }));
  await pending;
  expect(notify).not.toHaveBeenCalled();
});
it('marks a crawl network failure as already notified so the UI does not show a second popup', async () => {
  const pending = sendCrawlRequest([], defaultSiteData().config);
  const failed = { ...response({ status: 0 }), error: 'offline' };
  details.onerror?.call(failed, failed);
  expect(await pending).toMatchObject({ success: false, notificationHandled: true });
  expect(gm).toHaveBeenCalledOnce();
  expect(notify).toHaveBeenCalledOnce();
});
it('cleans up after success and rejects invalid network responses without falling back to fetch', async () => {
  const controller = new AbortController();
  const pending = requestCore('http://localhost:3200/api/test', { signal: controller.signal });
  load();
  await pending;
  controller.abort();
  expect(abort).not.toHaveBeenCalled();
  const failed = requestCore('http://localhost:3200/api/test');
  load(response({ status: 0 }));
  await expect(failed).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});
