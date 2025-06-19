/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useRef, useState, useEffect, useCallback } from 'react';
import FloatingMinimize from './FloationMinimize';

interface FloatingWindowProps {
  expanded: boolean;
  onPosChange?: (pos: { x: number; y: number }) => void;
  onExpandedChange?: (expanded: boolean) => void;
  children: React.ReactNode;
}

const INIT_POS = { x: 40, y: 120 };
const POS_KEY = 'scw-floating-pos';
// const EXPANDED_KEY = 'scw-floating-expanded';
const MINIMIZED_KEY = 'scw-floating-minimized';

const FloatingWindow: React.FC<FloatingWindowProps> = ({ expanded, onPosChange, /*onExpandedChange,*/ children }) => {
  // 加载初始位置
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

  // 加载是否最小化,
  const [minimized, setMinimized] = useState(() => {
    const saved = localStorage.getItem(MINIMIZED_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        /* ignore */
      }
    }
    return false;
  });

  useEffect(() => {
    localStorage.setItem(POS_KEY, JSON.stringify(pos));
    if (typeof onPosChange === 'function') onPosChange(pos);
  }, [pos, onPosChange]);
  useEffect(() => {
    localStorage.setItem(MINIMIZED_KEY, JSON.stringify(minimized));
  }, [minimized]);

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

  // 复用拖动边界检测逻辑
  const checkAndAdjustPos = useCallback(() => {
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const width = expanded ? 320 : 150;
    const height = expanded ? 180 : 56;
    const maxWidth = 420;
    const maxHeight = expanded ? winH * 0.7 : 56;
    let w = expanded ? Math.min(maxWidth, Math.max(width, 320)) : 150;
    let h = expanded ? Math.min(maxHeight, Math.max(height, 180)) : 56;
    if (typeof w === 'string') w = parseInt(w);
    if (typeof h === 'string') h = parseInt(h);
    let x = pos.x;
    let y = pos.y;
    x = Math.max(0, Math.min(x, winW - w));
    y = Math.max(0, Math.min(y, winH - h));
    if (x !== pos.x || y !== pos.y) setPos({ x, y });
  }, [pos, expanded]);
  // 窗口resize防抖监听
  useEffect(() => {
    let timer: any;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        checkAndAdjustPos();
      }, 200);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      clearTimeout(timer);
    };
  }, [pos, expanded, checkAndAdjustPos]);

  return minimized ? (
    <FloatingMinimize setMaximized={() => setMinimized(false)} pos={pos} setPos={setPos}></FloatingMinimize>
  ) : (
    <div
      id="selective-crawl-floating-content"
      className="scw-floating-window"
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        zIndex: 2147483647,
        width: expanded ? 320 : 150,
        height: expanded ? 'auto' : 56,
        background: '#23272e',
        border: '1px solid #eee6',
        borderRadius: 4,
        boxShadow: '0 0 12px rgba(0,0,0,0.12)',
        padding: 0,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
      }}
    >
      {/* 拖动栏 */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          boxSizing: 'border-box',
          height: 24,
          cursor: 'move',
          background: '#181a20',
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
        <div
          style={{
            position: 'absolute',
            width: 18,
            height: 18,
            top: 3,
            right: 3,
            cursor: 'pointer',
            overflow: 'hidden',
          }}
          onClick={() => setMinimized(true)}
        >
          <svg
            style={{
              width: '100%',
              height: '100%',
            }}
          >
            <rect x="4.5" y="7" width="8" height="0.9" rx="0.35" fill="#888" />
          </svg>
        </div>
      </div>
      {/* 悬浮窗内容 */}
      <div>{children}</div>
    </div>
  );
};

export default FloatingWindow;
