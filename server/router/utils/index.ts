export function getRootUrl (url: string) {
  try {
    const u = new URL(url);
    return u.origin;
  } catch {
    return '';
  }
}

/**
 * 判断链接是否匹配匹配项. 支持通配符 * 和否定模式 !, 例如 https://*.example.com/*, 以及否定模式 !https://*.example.com/private/*
 * link 只需要符合其中的一项即可被认为匹配成功
 * @param link 待匹配的链接, 需要是解码后的完整链接
 * @param patterns 匹配项列表, 支持通配符和否定模式
 * @param link 解码后的完整链接
 * @param patterns 匹配项, link 只需要符合其中的一项
 */
export function matchLink (link: string, patterns: string[]): boolean {
  // 获取 pattern 中存在通配符的项, 例如: https://*.com !https://*.com/path
  const wildcardPatterns = patterns.filter(pattern => pattern.includes('*') || pattern.startsWith('!'));
  const nonWildcardPatterns = patterns.filter(pattern => !pattern.includes('*') && !pattern.startsWith('!'));
  let root = link;
  // 统一去除尾部斜杠
  // if (root.endsWith('/')) root = root.slice(0, -1);
  /** 去除协议部分, 例如 https://example.com/path -> example.com/path */
  const rootWithoutProtocol = root.replace(/^https?:\/\//, '');
  /** startsWith 匹配结果 */
  let isStartsWithMatch = false;
  {
    // 统一去除尾部斜杠
    const unifiedRoot = root.endsWith('/') ? root.slice(0, -1) : root;
    // 尝试直接匹配
    const isDirectMatch = (nonWildcardPatterns.some(link => unifiedRoot.startsWith(link)) || nonWildcardPatterns.length === 0)
    if (isDirectMatch) {
      isStartsWithMatch = true;
    }
    // 尝试匹配去除协议后的链接
    const isMatchWithoutProtocol = (nonWildcardPatterns.some(link => rootWithoutProtocol.startsWith(link)) || nonWildcardPatterns.length === 0);
    if (isMatchWithoutProtocol) {
      isStartsWithMatch = true;
    }
  }
  // 尝试匹配通配符模式
  for (const pattern of wildcardPatterns) {
    const isNegated = pattern.startsWith('!');
    const actualPattern = isNegated ? pattern.slice(1) : pattern;
    // 转换通配符为正则表达式
    const regexPattern = actualPattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '\\?');
    const regex = new RegExp(`^${regexPattern}`);
    if (regex.test(root) || regex.test(rootWithoutProtocol)) {
      if (isStartsWithMatch) {
        // 如果已经有 startsWith 匹配成功, 但是又匹配上了一个否定模式, 则最终结果应该为不匹配
        if (isNegated) {
          return false;
        }
      }
      return !isNegated;
    }
  }
  return isStartsWithMatch;
}