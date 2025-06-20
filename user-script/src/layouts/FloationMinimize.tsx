import React, { useRef } from 'react';

const FloatingMinimize: React.FC<{
  setMaximized: () => void;
  pos: { x: number; y: number };
  setPos: (pos: { x: number; y: number }) => void;
}> = ({ setMaximized, pos, setPos }) => {
  const dragging = useRef(false);
  const offsetY = useRef(0);

  // 是否触发了拖动
  const isDragging = useRef(false);

  // 鼠标按下，准备拖动
  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    dragging.current = true;
    // 由于 click 的触发时间晚于 onMouseUp 所以不能在 onMouseDown 里设置 isDragging
    // 虽然已经触发了 onMouseDown，但还不能算是拖动
    isDragging.current = false;
    offsetY.current = e.clientY - pos.y;
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    e.stopPropagation();
    e.preventDefault();
  };

  // 拖动中
  const onMouseMove = (e: MouseEvent) => {
    if (!dragging.current) return;
    // 触发了拖动
    isDragging.current = true;
    let newY = e.clientY - offsetY.current;
    // 限制在窗口内
    const minY = 0;
    const maxY = window.innerHeight - 38; // 38为组件高度
    if (newY < minY) newY = minY;
    if (newY > maxY) newY = maxY;
    setPos({ ...pos, y: newY });
  };

  // 拖动结束
  const onMouseUp = () => {
    dragging.current = false;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  };

  return (
    <div
      title="SCWC 数据选择爬取 (点击展开)"
      style={{
        zIndex: 2147483647,
        position: 'fixed',
        top: pos.y,
        left: -16,
        width: 36,
        height: 42,
        cursor: 'pointer',
        backgroundColor: 'rgb(35, 39, 46)',
        color: 'rgb(204, 204, 204)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 4,
        userSelect: 'none',
        boxShadow: '0 0 12px rgba(0,0,0,0.12)',
        border: '1px solid #eee6',
      }}
      onClick={() => {
        // 点击时如果没有拖动过，则展开
        if (!isDragging.current) setMaximized();
      }}
      onMouseDown={onMouseDown}
    >
      <span
        translate="no"
        style={{
          fontSize: 10,
          display: 'inline-block',
          transform: 'rotate(-90deg) translateY(8px)',
          transformOrigin: '50% 50%',
        }}
      >
        SCWC
      </span>
    </div>
  );
};

export default FloatingMinimize;
