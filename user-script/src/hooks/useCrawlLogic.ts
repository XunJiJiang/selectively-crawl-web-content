export function getSelector(el: Element): string {
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

export function getElementBySelector(selector: string): Element | null {
  if (!selector) return null;
  try {
    if (selector.startsWith('#')) return document.getElementById(selector.slice(1));
    return document.querySelector(selector);
  } catch {
    return null;
  }
}

// 高亮元素，立即显示和消失，无过渡，不滚动页面
export function highlightElement(el: Element | null) {
  clearHighlightForSelecting();
  if (!el) return;
  if (isExcludedElement(el)) return;
  const rect = el.getBoundingClientRect();
  const mask = document.createElement('div');
  Object.assign(mask.style, {
    position: 'fixed',
    left: rect.left + 'px',
    top: rect.top + 'px',
    width: rect.width + 'px',
    height: rect.height + 'px',
    background: 'rgba(255,200,0,0.25)',
    border: '2px solid orange',
    zIndex: 2147483646, // 比悬浮窗略低
    pointerEvents: 'none',
  });
  document.body.appendChild(mask);
  selectingMask = mask;
}

// 用于元素选择时的高亮，移入高亮，移开立即消失，无过渡
let selectingMask: HTMLDivElement | null = null;
export function highlightElementForSelecting(el: Element | null) {
  clearHighlightForSelecting();
  if (!el) return;
  if (isExcludedElement(el)) return;
  const rect = el.getBoundingClientRect();
  const mask = document.createElement('div');
  Object.assign(mask.style, {
    position: 'fixed',
    left: rect.left + 'px',
    top: rect.top + 'px',
    width: rect.width + 'px',
    height: rect.height + 'px',
    background: 'rgba(255,200,0,0.25)',
    border: '2px solid orange',
    zIndex: 2147483646, // 比悬浮窗略低
    pointerEvents: 'none',
  });
  document.body.appendChild(mask);
  selectingMask = mask;
}

export function clearHighlightForSelecting() {
  if (selectingMask) {
    selectingMask.remove();
    selectingMask = null;
  }
}

// 判断是否为悬浮窗或其子元素
export function isExcludedElement(el: Element): boolean {
  let cur: Element | null = el;
  while (cur) {
    if (cur.id === 'selective-crawl-floating-root' || cur.classList.contains('scw-floating-window')) {
      return true;
    }
    cur = cur.parentElement;
  }
  return false;
}
