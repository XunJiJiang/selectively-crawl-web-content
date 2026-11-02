/** 扩展页面以自己的 origin 请求核心；仅用于已有采集与脚本配置接口。 */
export function isExtensionOrigin(origin: string | undefined): boolean {
  if (!origin) {
    return false;
  }
  try {
    const url = new URL(origin);
    return (
      ['chrome-extension:', 'moz-extension:', 'safari-web-extension:'].includes(url.protocol) &&
      !!url.hostname &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.pathname === '' || url.pathname === '/')
    );
  } catch {
    return false;
  }
}
export const extensionApiPaths = new Set([
  '/api/metadata/scrape',
  '/api/plugin/config',
  '/api/plugin/toggle',
  '/api/userscript/config/sync',
]);
