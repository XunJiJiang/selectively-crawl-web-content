/** Injected from the repository package.json by both client build pipelines. */
declare const __SCWC_VERSION__: string;
export const CLIENT_VERSION: string = typeof __SCWC_VERSION__ === 'string' ? __SCWC_VERSION__ : '';
export const VERSION_HEADER = 'X-SCWC-Version';
export interface VersionNotice {
  status: 'warning' | 'error';
  client: string;
  route: string;
  latest: string;
  message: string;
}
const pattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/;
export function compareVersions(a: string, b: string): number {
  const parse = (value: string) => {
    const match = pattern.exec(value);
    if (!match || match[4]?.split('.').some((v) => /^0\d+$/.test(v))) {
      throw new Error('版本号必须为有效的语义化版本');
    }
    return match;
  };
  const left = parse(a),
    right = parse(b);
  for (let i = 1; i <= 3; i++) {
    const x = BigInt(left[i]),
      y = BigInt(right[i]);
    if (x !== y) {
      return x > y ? 1 : -1;
    }
  }
  if (!left[4] || !right[4]) {
    return left[4] === right[4] ? 0 : left[4] ? -1 : 1;
  }
  const x = left[4].split('.'),
    y = right[4].split('.');
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === y[i]) {
      continue;
    }
    if (x[i] === undefined || y[i] === undefined) {
      return x[i] === undefined ? -1 : 1;
    }
    const xn = /^\d+$/.test(x[i]),
      yn = /^\d+$/.test(y[i]);
    if (xn && yn) {
      return BigInt(x[i]) > BigInt(y[i]) ? 1 : -1;
    }
    if (xn !== yn) {
      return xn ? -1 : 1;
    }
    return x[i] > y[i] ? 1 : -1;
  }
  return 0;
}
export function inVersionRange(version: string, range: string): boolean {
  const [min, max, extra] = range.split('-');
  try {
    return (
      !extra &&
      compareVersions(version, min) >= 0 &&
      (max === '*' || compareVersions(version, max) <= 0)
    );
  } catch {
    return false;
  }
}
export const versionNoticeKey = (notice: VersionNotice) =>
  `scwc.version.dismiss:${notice.client}:${notice.latest}`;
