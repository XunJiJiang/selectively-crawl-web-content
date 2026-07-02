/** 判断两个 url 的域名是否相同 */
export function isSameDomain(url1: string, url2: string): boolean {
  try {
    const parsedUrl1 = new URL(url1);
    const parsedUrl2 = new URL(url2);
    return parsedUrl1.hostname === parsedUrl2.hostname;
  } catch (error) {
    console.error('无效的 URL:', error);
    return false;
  }
}
