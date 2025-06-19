import React from 'react';
import { clearHighlightForSelecting } from '../hooks/useCrawlLogic';

interface Item {
  selector: string;
  label: string;
  prefix?: string; // 新增字段
}

interface ItemFormAndCrawlProps {
  expanded: boolean;
  items: Item[];
  setItems: React.Dispatch<React.SetStateAction<Item[]>>;
  selectedEl: Element | null;
  descInput: string;
  setDescInput: (v: string) => void;
  prefixInput: string;
  setPrefixInput: (v: string) => void;
  onItemHover: (selector: string) => void;
  onDelete: (idx: number) => void;
  onDragStart: (idx: number) => (e: React.DragEvent) => void;
  onDrop: (idx: number) => (e: React.DragEvent) => void;
  onDescInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onPrefixInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onCrawl: () => void;
}

const ItemFormAndCrawl: React.FC<ItemFormAndCrawlProps> = ({
  expanded,
  items,
  setItems,
  selectedEl,
  descInput,
  // setDescInput,
  prefixInput,
  // setPrefixInput,
  onItemHover,
  onDelete,
  onDragStart,
  onDrop,
  onDescInputChange,
  onPrefixInputChange,
  onCrawl,
}) => (
  <>
    {/* 选中元素描述输入 */}
    {expanded && selectedEl ? (
      <div
        style={{
          padding: 6,
          borderBottom: '1px solid #222',
          background: 'transparent',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <label htmlFor="scw-desc-input" style={{ width: 35, fontSize: 11, color: '#ccc', marginRight: 8 }}>
          描述：
        </label>
        <input
          id="scw-desc-input"
          className="scw-drag-ignore"
          style={{
            height: 18,
            width: 108,
            fontSize: 11,
            color: '#ccc',
            background: 'transparent',
            border: '0.5px solid #888',
            borderRadius: 4,
            transition: 'border 0.2s',
            padding: '2px 8px',
          }}
          value={descInput}
          onChange={onDescInputChange}
          placeholder="如作者、标签、<null>"
        />
        <label htmlFor="scw-prefix-input" style={{ width: 35, fontSize: 11, color: '#ccc', margin: '0 8px' }}>
          前缀：
        </label>
        <input
          id="scw-prefix-input"
          className="scw-drag-ignore"
          style={{
            height: 18,
            width: 78,
            fontSize: 11,
            color: '#ccc',
            background: 'transparent',
            border: '0.5px solid #888',
            borderRadius: 4,
            transition: 'border 0.2s',
            padding: '2px 8px',
          }}
          value={prefixInput}
          onChange={onPrefixInputChange}
          placeholder="拼接在段文本前的内容"
        />
      </div>
    ) : null}
    {/* 表单区 */}
    {expanded ? (
      <div
        style={{
          // 移除flex，改为内容撑开
          overflowY: 'auto',
          overflowX: 'auto',
          maxHeight: 120,
          minHeight: 0,
          background: 'transparent',
          height: 'auto',
        }}
      >
        {items.length !== 0 ? (
          items.map((item, idx) => (
            <div
              draggable
              key={item.selector + idx}
              style={{
                display: 'flex',
                alignItems: 'center',
                borderBottom: '1px solid #222',
                padding: 4,
                cursor: 'pointer',
              }}
              onDrop={onDrop(idx)}
              onDragStart={e => {
                e.stopPropagation();
                onDragStart(idx)(e);
              }}
              onDragOver={e => e.preventDefault()}
            >
              <input
                id={`scw-item-input-${idx}`}
                className="scw-drag-ignore"
                style={{
                  height: 24,
                  flex: 1,
                  fontSize: 13,
                  color: '#ccc',
                  marginRight: 8,
                  padding: '2px 8px',
                  boxSizing: 'border-box',
                  background: 'transparent',
                  border: '0.5px solid #888',
                  borderRadius: 4,
                  transition: 'border 0.2s',
                }}
                value={item.label ?? ''}
                onChange={e => {
                  const newItems = [...items];
                  newItems[idx] = { ...newItems[idx], label: e.target.value };
                  setItems(newItems);
                }}
                onBlur={e => {
                  if (!e.target.value) {
                    const newItems = [...items];
                    newItems[idx] = { ...newItems[idx], label: '<null>' };
                    setItems(newItems);
                  }
                }}
                placeholder="输入标签或留空"
              />
              {/* 新增prefix输入框 */}
              <input
                id={`scw-item-prefix-${idx}`}
                className="scw-drag-ignore"
                style={{
                  height: 24,
                  width: 48,
                  minWidth: 32,
                  maxWidth: 64,
                  fontSize: 13,
                  color: '#ccc',
                  marginRight: 8,
                  padding: '2px 8px',
                  boxSizing: 'border-box',
                  background: 'transparent',
                  border: '0.5px solid #888',
                  borderRadius: 4,
                  transition: 'border 0.2s',
                }}
                value={item.prefix ?? ''}
                onChange={e => {
                  const newItems = [...items];
                  newItems[idx] = { ...newItems[idx], prefix: e.target.value };
                  setItems(newItems);
                }}
                placeholder="前缀"
                title="抓取时拼接在内容前"
              />
              <button
                className="scw-drag-ignore"
                style={{
                  background: 'transparent',
                  color: '#ff8888',
                  width: 45,
                  height: 24,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '0 8px',
                  border: 'none',
                  boxShadow: 'none',
                  transition: 'background 0.2s, color 0.2s',
                  borderRadius: 4,
                  fontSize: 11,
                }}
                onClick={() => onDelete(idx)}
                onMouseOver={e => {
                  e.currentTarget.style.background = 'rgba(255,0,0,0.08)';
                  e.currentTarget.style.color = '#ccc';
                }}
                onMouseOut={e => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = '#ff8888';
                }}
              >
                删除
              </button>
              <span
                style={{
                  width: 32,
                  minWidth: 32,
                  maxWidth: 32,
                  height: 24,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  color: '#888',
                  background: 'transparent',
                  borderRadius: 4,
                  marginRight: 4,
                  cursor: 'move',
                  flexShrink: 0,
                }}
                title={item.selector}
                onMouseEnter={() => onItemHover(item.selector)}
                onMouseLeave={() => {
                  // 有选中项时禁止清除高亮
                  if (selectedEl) return;
                  clearHighlightForSelecting();
                }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="4.5" y="5" width="8" height="0.9" rx="0.35" fill="#888" />
                  <rect x="4.5" y="8" width="8" height="0.9" rx="0.35" fill="#888" />
                  <rect x="4.5" y="11" width="8" height="0.9" rx="0.35" fill="#888" />
                </svg>
              </span>
            </div>
          ))
        ) : (
          <div
            style={{
              textAlign: 'center',
              color: '#888',
              fontSize: 10,
              height: 33,
            }}
          >
            <span style={{ color: '#888', display: 'block', textAlign: 'center', lineHeight: '33px' }}>
              暂无抓取项，添加后可在此处编辑
            </span>
          </div>
        )}
      </div>
    ) : null}
    {/* 抓取按钮 */}
    {expanded ? (
      <div style={{ padding: 4, borderTop: '1px solid #222', background: 'transparent', textAlign: 'right' }}>
        <button
          className="scw-drag-ignore"
          style={{
            background: 'transparent',
            color: '#ccc',
            border: 'none',
            boxShadow: 'none',
            height: 24,
            width: 45,
            padding: 0,
            borderRadius: 4,
            transition: 'background 0.2s',
            fontSize: 11,
          }}
          onMouseOver={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.18)')}
          onMouseOut={e => (e.currentTarget.style.background = 'transparent')}
          onClick={onCrawl}
        >
          抓取
        </button>
      </div>
    ) : null}
  </>
);

export default ItemFormAndCrawl;
