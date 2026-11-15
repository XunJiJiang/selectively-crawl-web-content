import type { NotifyHandle } from '../../shared/types/notify.d.ts';

// 入口在判断页面归属前关闭展示；独立组件及测试默认可见。
let visible = true;
const handles = new Set<NotifyHandle>();
const elements = new Set<Element>();
export const isScriptVisible = () => visible;
export function trackScriptNotification(handle: NotifyHandle) {
  handles.add(handle);
  if (handles.size > 1000) {
    const first = handles.values().next().value;
    if (first) {
      handles.delete(first);
    }
  }
}
export function trackScriptNoticeElement(element: Element) {
  elements.add(element);
}
export function setScriptVisible(value: boolean) {
  visible = value;
  if (!value) {
    for (const handle of handles) {
      handle.close();
    }
    for (const element of elements) {
      element.remove();
    }
    handles.clear();
    elements.clear();
  }
}
