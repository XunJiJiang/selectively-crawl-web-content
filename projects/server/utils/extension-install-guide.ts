import { randomUUID } from 'node:crypto';
import { HOST, ACTIVE_PORT } from '../common/env.ts';

interface InstallGuide {
  browser: string;
  directory: string;
  managerUrl: string;
  variant: 'chromium' | 'firefox';
}
const guides = new Map<string, { guide: InstallGuide; expires: number }>();
export function issueInstallGuide(guide: InstallGuide, host = HOST, port = ACTIVE_PORT) {
  const now = Date.now();
  for (const [key, value] of guides) {
    if (value.expires <= now) {
      guides.delete(key);
    }
  }
  if (guides.size >= 100) {
    throw new Error('安装向导数量过多，请稍后重试');
  }
  const url = new URL(host);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('核心地址必须使用 HTTP 或 HTTPS');
  }
  if (['0.0.0.0', '[::]', '::'].includes(url.hostname)) {
    url.hostname = 'localhost';
  }
  url.username = '';
  url.password = '';
  url.port = String(port);
  const ticket = randomUUID();
  url.pathname = `/web/browser-extension/install/${ticket}`;
  url.search = '';
  url.hash = '';
  guides.set(ticket, { guide, expires: now + 30 * 60 * 1000 });
  return url.href;
}
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );
export function installGuidePage(ticket: string) {
  const item = guides.get(ticket);
  if (!item || item.expires <= Date.now()) {
    guides.delete(ticket);
    return;
  }
  const { guide } = item,
    nonce = randomUUID();
  const steps =
    guide.variant === 'firefox'
      ? '打开“此 Firefox”，点击“临时载入附加组件”，选择扩展目录内的 manifest.json。当前包尚未经过 Mozilla 签名，重启浏览器后需重新载入。'
      : '启用右上角“开发者模式”，点击“加载已解压的扩展程序”，选择下面的扩展目录。';
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SCWC 浏览器扩展安装向导</title>
<style nonce="${nonce}">:root{color-scheme:dark;font:14px/1.7 system-ui;background:#0a0d12;color:#ebedf0}*{box-sizing:border-box}body{max-width:760px;margin:48px auto;padding:0 24px}header{border-bottom:1px solid #ffffff20;padding-bottom:20px;margin-bottom:28px}h1{font-size:24px;margin:4px 0}h2{font-size:16px;margin:0 0 12px}.muted{color:#ffffff9c}.badge{color:#6ee7b7}section{margin:20px 0;padding:20px;background:#0f131c;border:1px solid #ffffff20;border-radius:4px}label{display:block;color:#ffffffba;margin:12px 0 6px}.field{display:flex;gap:8px}input{flex:1;min-width:0;background:#05070c;border:1px solid #ffffff25;color:#fff;border-radius:4px;font:13px/1.5 ui-monospace,monospace;padding:9px}button{border:1px solid #38bdf8;border-radius:4px;color:#38bdf8;background:#38bdf820;padding:8px 12px;font:inherit;cursor:pointer;white-space:nowrap}input:focus,button:focus-visible{outline:2px solid #38bdf8;outline-offset:2px}#copy-status{min-height:24px;color:#6ee7b7}strong{color:#fff}footer{font-size:12px;color:#ffffff80;margin-top:28px}</style></head><body>
<header><span class="badge">SCWC · ${escape(guide.browser)}</span><h1>浏览器扩展安装向导</h1><div class="muted">按下面两步完成安装，核心已为你准备好对应的扩展目录。</div></header>
<section><h2>1. 打开扩展管理页</h2><p>点击复制，将地址粘贴到<strong>浏览器地址栏</strong>，按 Enter。浏览器可能拦截从外部程序或网页直接跳转到内部管理页。</p><label for="manager">扩展管理页地址</label><div class="field"><input id="manager" readonly value="${escape(guide.managerUrl)}"><button data-copy="manager">复制管理页地址</button></div></section>
<section><h2>2. 加载扩展目录</h2><p>${steps}</p><label for="directory">扩展目录</label><div class="field"><input id="directory" readonly value="${escape(guide.directory)}"><button data-copy="directory">复制扩展目录</button></div><p class="muted">安装后请保留此目录。完成安装后，在浏览器工具栏固定 SCWC 图标即可使用。</p></section><div id="copy-status" role="status" aria-live="polite"></div><footer>此向导不会自动安装扩展或修改浏览器安全设置。向导有效期为 30 分钟；过期后重新执行安装命令即可。</footer>
<script nonce="${nonce}">for(const button of document.querySelectorAll('[data-copy]')){button.addEventListener('click',async()=>{const input=document.getElementById(button.dataset.copy);const status=document.getElementById('copy-status');try{if(!navigator.clipboard)throw new Error('clipboard unavailable');await navigator.clipboard.writeText(input.value);status.textContent='已复制，请粘贴到相应位置。';}catch{input.focus();input.select();status.textContent='已选中，请按 Ctrl+C（Mac 为 ⌘C）复制。';}});}</script></body></html>`;
  return {
    html,
    csp: `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  };
}
