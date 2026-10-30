import { matchLink } from '../router/utils/index.ts';
import { shouldRefreshUrl } from '../../shared/utils/refreshRuleMatcher.ts';
import { RefreshRuleParser } from '../../shared/utils/refreshRuleParser.ts';

type Scripts = NonNullable<NonNullable<SCWC.IPluginHandler['pluginConfig']>['scripts']>;
export function pluginRefreshRule(scripts: Scripts, site: string) {
  const rule =
    scripts.refreshRules?.find((profile) => matchLink(site, profile.sites))?.rule ??
    scripts.refreshRule ??
    '//';
  if (
    typeof rule !== 'string' ||
    rule.length > 4096 ||
    new RefreshRuleParser().parse(rule).state === 'error'
  ) {
    throw new Error('插件声明了无效的 URL 刷新规则');
  }
  return rule;
}
export function shouldRefreshPlugin(
  scripts: Scripts,
  links: string[],
  before: string | undefined,
  after: string,
) {
  if (!before || !matchLink(before, links)) {
    return true;
  }
  const rule = pluginRefreshRule(scripts, after);
  return pluginRefreshRule(scripts, before) !== rule || shouldRefreshUrl(before, after, rule);
}
