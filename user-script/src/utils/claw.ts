import type { Item } from "../types/claw";
import { getElementBySelector } from "./selector";

/** 解析抓取项获取抓取的数据 */
export function getCrawlData (items: Item[]): { result: SCWC.TDataItem[]; failed: string[] } {
  const result: SCWC.TDataItem[] = [];
  const failed: string[] = [];

  /** 辅助：将img元素转为dataURL */
  function getImgElementData (img: HTMLImageElement): string | null {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0);
      const data = canvas.toDataURL('image/png');
      return data;
    } catch (e) {
      console.error('获取图片原始数据失败:', (e as Error).message ?? '', e);
      return img.src;
    }
  }

  for (let i = 0; i < items.length; ++i) {
    const { selector, label, prefix = '' } = items[i];
    const el = getElementBySelector(selector);
    if (!el) {
      failed.push(selector);
      continue;
    }
    // 收集所有片段
    const fragments: string[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent?.trim();
      if (text) fragments.push(prefix + text);
    }
    const value = fragments.join(' ').trim();
    // 收集图片
    let imgElements: HTMLImageElement[] = [];
    if (el instanceof HTMLImageElement) {
      imgElements.push(el);
    }
    // 查找内部所有img
    const imgEls = el.querySelectorAll ? el.querySelectorAll('img') : [];
    if (imgEls && imgEls.length) {
      imgElements = imgElements.concat(Array.from(imgEls) as HTMLImageElement[]);
    }
    imgElements = Array.from(new Set(imgElements));
    // 直接转dataURL
    const images: string[] = imgElements.map(img => getImgElementData(img)).filter(Boolean) as string[];
    if (images.length > 0) {
      result.push({ label, value, images });
    } else {
      result.push({ label, value, images: [] });
    }
  }
  return { result, failed };
}