import React, { useRef, useState, useEffect } from 'react';

interface FloatingWindowLayoutProps {
  expanded: boolean;
  onPosChange?: (pos: { x: number; y: number }) => void;
  onExpandedChange?: (expanded: boolean) => void;
  children: React.ReactNode;
}

const INIT_POS = { x: 40, y: 120 };
const POS_KEY = 'scw-floating-pos';
const EXPANDED_KEY = 'scw-floating-expanded';

const FloatingWindowLayout: React.FC<FloatingWindowLayoutProps> = ({
  expanded,
  onPosChange,
  onExpandedChange,
  children,
}) => {
  // 加载初始位置和展开状态
  const [pos, setPos] = useState(() => {
    const saved = localStorage.getItem(POS_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        /* ignore */
      }
    }
    return INIT_POS;
  });
  useEffect(() => {
    localStorage.setItem(POS_KEY, JSON.stringify(pos));
    if (typeof onPosChange === 'function') onPosChange(pos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos]);
  useEffect(() => {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify(expanded));
    if (typeof onExpandedChange === 'function') onExpandedChange(expanded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  const dragging = useRef(false);
  const offset = useRef({ x: 0, y: 0 });

  // 拖动栏事件
  const onDragBarMouseDown = (e: React.MouseEvent) => {
    dragging.current = true;
    offset.current = {
      x: e.clientX - pos.x,
      y: e.clientY - pos.y,
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };
  const onMouseMove = (e: MouseEvent) => {
    if (!dragging.current) return;
    // 计算悬浮窗宽高
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const width = expanded ? 320 : 150; // minWidth
    const height = expanded ? 180 : 56; // minHeight
    const maxWidth = 420;
    const maxHeight = expanded ? winH * 0.7 : 56;
    // 先计算目标位置
    let x = e.clientX - offset.current.x;
    let y = e.clientY - offset.current.y;
    // 限制范围：全部在窗口内
    // 取实际宽高（max/min）
    let w = expanded ? Math.min(maxWidth, Math.max(width, 320)) : 150;
    let h = expanded ? Math.min(maxHeight, Math.max(height, 180)) : 56;
    if (typeof w === 'string') w = parseInt(w);
    if (typeof h === 'string') h = parseInt(h);
    x = Math.max(0, Math.min(x, winW - w));
    y = Math.max(0, Math.min(y, winH - h));
    setPos({ x, y });
  };
  const onMouseUp = () => {
    dragging.current = false;
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  };

  return (
    <div
      id="selective-crawl-floating-root"
      className="scw-floating-window"
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        zIndex: 2147483647,
        minWidth: expanded ? 320 : 150,
        minHeight: expanded ? 124 : 56,
        maxWidth: 420,
        maxHeight: expanded ? 210 : 56,
        width: expanded ? 320 : 150,
        height: expanded ? 'auto' : 56,
        background: '#23272e',
        border: '1px solid #222',
        borderRadius: 4,
        boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
        padding: 0,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* 拖动栏 */}
      <div
        style={{
          width: '100%',
          height: 24,
          cursor: 'move',
          background: '#181a20',
          borderTopLeftRadius: 8,
          borderTopRightRadius: 8,
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 8,
          fontSize: 12,
          color: '#ccc',
          userSelect: 'none',
        }}
        onMouseDown={onDragBarMouseDown}
      >
        选择性爬虫
      </div>
      {/* 悬浮窗内容 */}
      <div>{children}</div>
    </div>
  );
};

export default FloatingWindowLayout;
