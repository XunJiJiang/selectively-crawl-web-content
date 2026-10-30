import { RefreshRuleParser, type TParseResult } from './refreshRuleParser.ts';

type Rule = TParseResult['pathname']['base'];
function changed(rule: Rule, before: string | undefined, after: string | undefined) {
  if (rule === 'a') {
    return before === undefined && after !== undefined;
  }
  if (rule === 'd') {
    return before !== undefined && after === undefined;
  }
  return rule === 'c' && before !== after;
}
function segments(value: string) {
  return value && value !== '/' ? value.replace(/^\//, '').split('/') : [];
}
function changedSegments(before: string, after: string, rules: TParseResult['pathname']) {
  const a = segments(before),
    b = segments(after);
  return Array.from({ length: Math.max(a.length, b.length) }, (_, i) => i).some((i) =>
    changed(rules.segments[i]?.rule ?? rules.base, a[i], b[i]),
  );
}
/** 按已解析规则比较 URL；查询键及重复值的顺序不影响结果。 */
export function shouldRefreshUrl(before: string, after: string, rule: string) {
  const oldUrl = new URL(before),
    newUrl = new URL(after);
  if (oldUrl.origin !== newUrl.origin) {
    return true;
  }
  const parsed = new RefreshRuleParser().parse(rule);
  if (parsed.state === 'error') {
    throw new Error('插件 URL 刷新规则无法解析');
  }
  const rules = parsed.result;
  if (
    changedSegments(oldUrl.pathname, newUrl.pathname, rules.pathname) ||
    changedSegments(oldUrl.hash.slice(1), newUrl.hash.slice(1), rules.hash)
  ) {
    return true;
  }
  const keys = new Set([...oldUrl.searchParams.keys(), ...newUrl.searchParams.keys()]);
  for (const key of keys) {
    const values = (url: URL) =>
      url.searchParams.has(key) ? JSON.stringify(url.searchParams.getAll(key).sort()) : undefined;
    if (
      changed(rules.search.params.get(key) ?? rules.search.base, values(oldUrl), values(newUrl))
    ) {
      return true;
    }
  }
  return false;
}
