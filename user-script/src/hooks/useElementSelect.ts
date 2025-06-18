import { useEffect, useState } from 'react';
import { highlightElementForSelecting, clearHighlightForSelecting } from './useCrawlLogic';

export function useElementSelect(selecting: boolean, forceEl?: Element | null) {
  const [hoverEl, setHoverEl] = useState<Element | null>(null);
  useEffect(() => {
    if (forceEl) {
      highlightElementForSelecting(forceEl);
      setHoverEl(forceEl);
      return () => clearHighlightForSelecting();
    }
    if (!selecting) {
      clearHighlightForSelecting(); // 取消选择时清除高亮
      return;
    }
    const onMove = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      setHoverEl(el);
      highlightElementForSelecting(el);
    };
    document.addEventListener('mousemove', onMove, true);
    return () => {
      document.removeEventListener('mousemove', onMove, true);
      clearHighlightForSelecting();
    };
  }, [selecting, forceEl]);
  return hoverEl;
}
