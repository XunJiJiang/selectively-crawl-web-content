export function getRootUrl(url: string) {
  try {
    const u = new URL(url);
    return u.origin;
  } catch {
    return '';
  }
}
