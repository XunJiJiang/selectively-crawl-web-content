import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../common/env.ts', () => ({ HOST: 'http://localhost', ACTIVE_PORT: 3217 }));
import { installGuidePage, issueInstallGuide } from './extension-install-guide.ts';

describe('extension installation guide', () => {
  afterEach(() => vi.useRealTimers());
  it('opens a regular HTTP page on the actual port and strips credentials', () => {
    const url = new URL(
      issueInstallGuide(
        {
          browser: 'Chrome',
          directory: 'C:\\SCWC\\chromium',
          managerUrl: 'chrome://extensions/',
          variant: 'chromium',
        },
        'http://name:secret@0.0.0.0/path?token=secret',
        3218,
      ),
    );
    expect(url.origin).toBe('http://localhost:3218');
    expect(url.username).toBe('');
    expect(url.search).toBe('');
    const page = installGuidePage(url.pathname.split('/').at(-1) ?? '');
    expect(page?.html).toContain('复制管理页地址');
    expect(page?.html).toContain('chrome://extensions/');
    expect(page?.html).toContain('加载已解压的扩展程序');
    expect(page?.csp).toContain("frame-ancestors 'none'");
  });
  it('escapes displayed paths and browser names, and expires unguessable guide tickets', () => {
    vi.useFakeTimers();
    const url = new URL(
      issueInstallGuide({
        browser: '<script>alert(1)</script>',
        directory: 'C:\\A&B\\" onfocus="oops',
        managerUrl: 'about:debugging#/runtime/this-firefox',
        variant: 'firefox',
      }),
    );
    const ticket = url.pathname.split('/').at(-1) ?? '';
    const page = installGuidePage(ticket);
    expect(page?.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(page?.html).toContain('临时载入附加组件');
    expect(page?.html).not.toContain('value="C:\\A&B');
    expect(installGuidePage('unknown')).toBeUndefined();
    vi.advanceTimersByTime(30 * 60 * 1000 + 1);
    expect(installGuidePage(ticket)).toBeUndefined();
  });
});
