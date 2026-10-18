import type { MenuPresentationMode, ResolvedMenuPresentation } from './menu-types.ts';

type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: { platform?: string };
};

export function isMacPlatform(
  navigatorValue: NavigatorWithUserAgentData | undefined = typeof navigator === 'undefined'
    ? undefined
    : (navigator as NavigatorWithUserAgentData),
): boolean {
  if (!navigatorValue) {
    return false;
  }
  const platform = [
    navigatorValue.userAgentData?.platform,
    navigatorValue.platform,
    navigatorValue.userAgent,
  ]
    .filter(Boolean)
    .join(' ');
  return /macintosh|macintel|mac os|macos/i.test(platform);
}

export function resolveMenuPresentation(
  mode: MenuPresentationMode,
  navigatorValue?: NavigatorWithUserAgentData,
): ResolvedMenuPresentation {
  if (mode === 'native' || mode === 'custom') {
    return mode;
  }
  return isMacPlatform(navigatorValue) ? 'native' : 'custom';
}

export function emit<T>(host: HTMLElement, type: string, detail: T): void {
  host.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true, detail }));
}
