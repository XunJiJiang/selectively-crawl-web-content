export function getSelector (el: Element): string {
  if (!el) return '';
  if (el.id) return `#${el.id}`;
  let path = '';
  let cur: Element | null = el;
  while (cur && cur.nodeType === 1 && path.length < 200) {
    let name = cur.nodeName.toLowerCase();
    if (cur.className) name += '.' + Array.from(cur.classList).join('.');
    // 计算同级中的索引
    if (cur.parentElement) {
      const siblings = Array.from(cur.parentElement.children).filter(sib => sib.nodeName === cur!.nodeName);
      if (siblings.length > 1) {
        const idx = siblings.indexOf(cur) + 1;
        name += `:nth-of-type(${idx})`;
      }
    }
    path = name + (path ? '>' + path : '');
    cur = cur.parentElement;
  }
  return path;
}

export function getElementBySelector (selector: string): Element | null {
  if (!selector) return null;
  try {
    if (selector.startsWith('#')) return document.getElementById(selector.slice(1));
    return document.querySelector(selector);
  } catch {
    return null;
  }
}