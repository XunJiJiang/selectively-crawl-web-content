import { browser, type ExtensionInfo, type MessageSender } from './browser.ts';
import { CLIENT_VERSION } from '../../shared/client-version.ts';
import {
  chromiumExtensionManager,
  readScriptPresence,
  type CoexistenceInfo,
  type ScriptPresence,
} from '../../shared/client-coexistence.ts';

export const coexistenceDismissedKey = 'scwc.extension.coexistence.dismissed.v1';

// Official Chrome stable/beta and Edge store IDs are independent of display language.
const tampermonkeyIds = new Set([
  'dhdgffkkebhmkfjojejmpbldmpobfkfo',
  'gcalenpjmijncebpfijmoaglllgpjagf',
  'iikmkjmpaadaobahmlepeloendndfphd',
]);

function optionsPage(info: ExtensionInfo): string | undefined {
  if (!info.optionsUrl) {
    return;
  }
  const bases = [info.optionsUrl, ...(info.icons ?? []).map((icon) => icon.url)];
  for (const base of bases) {
    try {
      const parsed = new URL(base);
      if (!['chrome-extension:', 'moz-extension:'].includes(parsed.protocol) || !parsed.hostname) {
        continue;
      }
      const url = new URL(info.optionsUrl, `${parsed.protocol}//${parsed.host}/`);
      if (
        url.protocol === parsed.protocol &&
        url.host === parsed.host &&
        !url.username &&
        !url.password
      ) {
        url.hash = 'nav=dashboard';
        return url.href;
      }
    } catch {
      /* Relative options pages need an extension URL from the browser's metadata. */
    }
  }
}
async function scriptManager(script: ScriptPresence) {
  if (!/^Tampermonkey(?:\s+BETA)?$/i.test(script.handler.trim()) || !browser.management?.getAll) {
    return;
  }
  try {
    const installed = (await browser.management.getAll()).filter((item) => item.enabled);
    const identified = installed.filter((item) => tampermonkeyIds.has(item.id));
    const matches = identified.length
      ? identified
      : installed.filter((item) => /^(?:Tampermonkey|篡改猴)(?:\s+BETA)?$/i.test(item.name.trim()));
    // GM_info and management may format the same version differently; a sole manager is unambiguous.
    if (matches.length === 1) {
      return optionsPage(matches[0]);
    }
    // Stable and beta can coexist; use version metadata only to disambiguate them.
    const exact = matches.filter(
      (item) =>
        script.handlerVersion &&
        (item.version === script.handlerVersion || item.versionName === script.handlerVersion),
    );
    if (exact.length === 1) {
      return optionsPage(exact[0]);
    }
  } catch {
    /* Unsupported or unavailable management API: show manual directions. */
  }
}
function manager() {
  const agent = navigator as Navigator & { userAgentData?: { brands: { brand: string }[] } };
  return chromiumExtensionManager({
    userAgent: agent.userAgent,
    brands: agent.userAgentData?.brands,
  });
}

/** The content-script exception can only discover or open fixed management destinations. */
export async function coexistenceRequest(
  input: unknown,
  sender: MessageSender,
): Promise<CoexistenceInfo | void> {
  const message = input as { type: string; script?: unknown; target?: unknown };
  const script = readScriptPresence(message.script);
  if (
    sender.id !== browser.runtime.id ||
    sender.tab?.id === undefined ||
    sender.frameId !== 0 ||
    !sender.url ||
    !/^https?:\/\//.test(sender.url) ||
    !script
  ) {
    throw new Error('共存提醒来源无效');
  }
  const current = await browser.tabs.get(sender.tab.id);
  // Static content-script access does not expose tabs.url without a separate host grant.
  // sender.url is still supplied by the browser; this route never reads core data.
  if (current.url !== undefined && current.url !== sender.url) {
    throw new Error('共存提醒来源无效');
  }
  if (message.type === 'coexistence.dismiss') {
    await browser.storage.local.set({ [coexistenceDismissedKey]: true });
    return;
  }
  if (
    message.type === 'coexistence.info' &&
    (await browser.storage.local.get(coexistenceDismissedKey))[coexistenceDismissedKey] === true
  ) {
    return { suppressed: true };
  }
  const extensionUrl = manager();
  const scriptUrl = await scriptManager(script);
  if (message.type === 'coexistence.open') {
    const url =
      message.target === 'script'
        ? scriptUrl
        : message.target === 'extension'
          ? extensionUrl
          : undefined;
    if (!url) {
      throw new Error('无法直接打开管理页，请按提醒中的说明手动打开。');
    }
    await browser.tabs.create({ url });
    return;
  }
  return {
    suppressed: false,
    extensionVersion: CLIENT_VERSION,
    scriptManager: !!scriptUrl,
    extensionManager: !!extensionUrl,
    instructions: [
      !scriptUrl ? '关闭油猴脚本：打开油猴管理面板，关闭 SCWC 脚本。' : '',
      !extensionUrl
        ? /Firefox\//.test(navigator.userAgent)
          ? '关闭浏览器扩展：在 Firefox 菜单中打开“扩展和主题”（about:addons）。'
          : /Safari\//.test(navigator.userAgent) && !/Chrom(?:e|ium)\//.test(navigator.userAgent)
            ? '关闭浏览器扩展：打开 Safari 设置中的“扩展”。'
            : '关闭浏览器扩展：从当前浏览器菜单打开扩展管理页。'
        : '',
    ]
      .filter(Boolean)
      .join('\n'),
  };
}
