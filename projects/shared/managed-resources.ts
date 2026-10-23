import type { RequestLifecycle } from './request-lifecycle.ts';

/** Resource URLs start loading when attached to DOM, rather than when created. */
export class ManagedResources {
  private items = new Map<
    Element,
    { attr: string; url: string; interruptible: boolean; release: () => void; paused: boolean }
  >();
  private observer: MutationObserver;
  private network: RequestLifecycle;
  constructor(network: RequestLifecycle) {
    this.network = network;
    this.observer = new MutationObserver(() => this.scan());
    this.observer.observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['src', 'href'],
    });
    document.addEventListener('load', this.loaded, true);
    document.addEventListener('error', this.loaded, true);
    this.scan();
  }
  private loaded = (e: Event) => {
    const item = this.items.get(e.target as Element);
    if (item && !item.paused) {
      item.release();
    }
  };
  private scan() {
    for (const [el, item] of this.items) {
      if (!el.isConnected || (!item.paused && el.getAttribute(item.attr) !== item.url)) {
        item.release();
        this.items.delete(el);
      }
    }
    for (const el of document.querySelectorAll(
      'img[src],video[src],audio[src],source[src],iframe[src],link[href]',
    )) {
      const attr = el.hasAttribute('src') ? 'src' : 'href';
      const url = el.getAttribute(attr) ?? '';
      if (!url.includes('/web/resource/plugin/') || this.items.has(el)) {
        continue;
      }
      const interruptible =
        new URL(url, location.href).searchParams.get('_scwc_interruptible') === '1';
      const release = interruptible ? () => undefined : this.network.protect();
      this.items.set(el, { attr, url, interruptible, release, paused: false });
      if (el instanceof HTMLImageElement && el.complete) {
        release();
      }
    }
    if (this.network.paused) {
      this.pause();
    }
  }
  pause() {
    for (const [el, item] of this.items) {
      if (!item.interruptible || item.paused) {
        continue;
      }
      item.paused = true;
      el.removeAttribute(item.attr);
      if (el instanceof HTMLMediaElement) {
        el.pause();
        el.load();
      }
    }
  }
  resume() {
    for (const [el, item] of this.items) {
      if (!item.paused) {
        continue;
      }
      item.paused = false;
      el.setAttribute(item.attr, item.url);
      if (el instanceof HTMLMediaElement) {
        el.load();
      }
    }
  }
  dispose() {
    this.observer.disconnect();
    document.removeEventListener('load', this.loaded, true);
    document.removeEventListener('error', this.loaded, true);
    for (const item of this.items.values()) {
      item.release();
    }
    this.items.clear();
  }
}
