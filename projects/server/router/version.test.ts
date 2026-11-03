import { expect, it } from 'vitest';
import type { Request, Response } from 'express';
import { routeVersion } from './version.ts';
import { compareVersions } from '../../shared/client-version.ts';

function request(client: string | undefined, route = '3.2.0') {
  let status = 200,
    body: unknown,
    next = false;
  const headers: Record<string, string> = {};
  const response = {
    setHeader: (key: string, value: string) => {
      headers[key] = value;
    },
    status: (code: number) => {
      status = code;
      return response;
    },
    json: (value: unknown) => {
      body = value;
      return response;
    },
  };
  routeVersion(route)(
    { get: () => client } as unknown as Request,
    response as unknown as Response,
    () => {
      next = true;
    },
  );
  if (next) {
    response.json({ success: true, data: { value: 42 } });
  }
  return { status, body, next, headers };
}
it('allows equal/new clients and the co-released Web without a version header', () => {
  for (const version of [undefined, '3.2.0', '4.0.0']) {
    expect(request(version)).toMatchObject({
      status: 200,
      next: true,
      body: { success: true, data: { value: 42 } },
    });
  }
});
it('warns while preserving data on an older compatible route, including its boundary', () => {
  for (const version of ['3.1.29', '3.1.99']) {
    expect(request(version, '3.1.29')).toMatchObject({
      status: 200,
      next: true,
      body: {
        data: { value: 42 },
        version: { status: 'warning', client: version, route: '3.1.29', latest: '3.2.0' },
      },
    });
  }
});
it('blocks obsolete clients before the route executes and rejects malformed versions', () => {
  expect(request('3.1.29')).toMatchObject({
    status: 426,
    next: false,
    body: { success: false, version: { status: 'error' } },
  });
  expect(request('3.2.0-rc.21')).toMatchObject({ status: 426, next: false });
  expect(request('invalid')).toMatchObject({ status: 400, next: false });
  expect(compareVersions('3.2.0-rc.9', '3.2.0-rc.21')).toBe(-1);
  expect(compareVersions('3.2.0+build.1', '3.2.0')).toBe(0);
});
