import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  GM_xmlhttpRequest,
  type GmXmlhttpRequestOption,
  type GmResponseEvent,
} from 'vite-plugin-monkey/dist/client';
import { requestCore } from './request.ts';
import { recordCoreSyncFailure, recordCoreSyncSuccess } from './sync-circuit.ts';

vi.mock('vite-plugin-monkey/dist/client', () => ({ GM_xmlhttpRequest: vi.fn() }));
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
      'X-SCWC-Version': '3.2.0',
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
it('does not send any core request after the sync circuit opens', async () => {
  recordCoreSyncFailure();
  recordCoreSyncFailure();
  expect(recordCoreSyncFailure()).toBe(true);

  await expect(requestCore('http://localhost:3200/api/plugin/config')).rejects.toMatchObject({
    code: 'CORE_SYNC_BLOCKED',
  });
  expect(gm).not.toHaveBeenCalled();
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
