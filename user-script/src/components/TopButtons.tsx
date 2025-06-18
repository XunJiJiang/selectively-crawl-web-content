import React from 'react';

interface TopButtonsProps {
  expanded: boolean;
  canSelect: boolean;
  canCollapse: boolean;
  canParent: boolean;
  canUndo: boolean;
  canConfirm: boolean;
  canCancel: boolean; // 新增
  itemsLength: number;
  selecting?: boolean;
  onSelect: () => void;
  onStopSelect?: () => void;
  onCollapse: () => void;
  onParent: () => void;
  onUndo: () => void;
  onConfirm: () => void;
  onCancel: () => void; // 新增
  onExpand: () => void;
}

const TopButtons: React.FC<TopButtonsProps> = ({
  expanded,
  canSelect,
  canCollapse,
  canParent,
  canUndo,
  canConfirm,
  canCancel,
  // itemsLength,
  selecting,
  onSelect,
  onStopSelect,
  onCollapse,
  onParent,
  onUndo,
  onConfirm,
  onCancel,
  onExpand,
}) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      borderBottom: expanded ? '1px solid #eee' : 'none',
      background: 'transparent',
      padding: !expanded ? '0 4px' : 0,
      width: !expanded ? 100 : undefined,
      height: !expanded ? 32 : undefined,
      flexWrap: 'nowrap',
    }}
  >
    {!expanded ? (
      // 缩小时只显示“选择”和“展开”两个按钮，均分宽度
      <>
        <button
          className="scw-drag-ignore"
          style={{
            flex: 1,
            minWidth: 0,
            height: 24,
            fontSize: 11,
            marginRight: 2,
            padding: '4px 0',
            textAlign: 'center',
            whiteSpace: 'nowrap',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            color: '#ccc',
            border: 'none',
            outline: 'none',
            boxShadow: 'none',
            transition: 'background 0.2s',
            borderRadius: 4,
          }}
          disabled={!canSelect}
          onClick={onSelect}
          title="选择元素"
          onMouseOver={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.18)')}
          onMouseOut={e => (e.currentTarget.style.background = 'transparent')}
        >
          选择
        </button>
        <button
          className="scw-drag-ignore"
          style={{
            flex: 1,
            minWidth: 0,
            height: 24,
            fontSize: 11,
            marginLeft: 2,
            padding: '4px 0',
            textAlign: 'center',
            whiteSpace: 'nowrap',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            color: '#ccc',
            border: 'none',
            outline: 'none',
            boxShadow: 'none',
            transition: 'background 0.2s',
            borderRadius: 4,
          }}
          onClick={onExpand}
          title="展开"
          onMouseOver={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.18)')}
          onMouseOut={e => (e.currentTarget.style.background = 'transparent')}
        >
          展开
        </button>
      </>
    ) : (
      // 展开时原有按钮布局
      <>
        {selecting ? (
          <button
            className="scw-drag-ignore"
            style={{
              flex: 1,
              margin: '4px 4px',
              height: 24,
              fontSize: 11,
              padding: '4px 0',
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              color: '#ccc',
              border: 'none',
              outline: 'none',
              boxShadow: 'none',
              transition: 'background 0.2s',
              borderRadius: 4,
            }}
            onClick={onStopSelect}
            title="停止选择"
            onMouseOver={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.18)')}
            onMouseOut={e => (e.currentTarget.style.background = 'transparent')}
          >
            停止选择
          </button>
        ) : (
          <button
            className="scw-drag-ignore"
            style={{
              flex: 1,
              margin: '4px 4px',
              height: 24,
              fontSize: 11,
              padding: '4px 0',
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              color: '#ccc',
              border: 'none',
              outline: 'none',
              boxShadow: 'none',
              transition: 'background 0.2s',
              borderRadius: 4,
            }}
            disabled={!canSelect}
            onClick={onSelect}
            title="选择元素"
            onMouseOver={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.18)')}
            onMouseOut={e => (e.currentTarget.style.background = 'transparent')}
          >
            选择
          </button>
        )}
        <button
          className="scw-drag-ignore"
          style={{
            flex: 1,
            margin: '4px 4px',
            height: 24,
            fontSize: 11,
            padding: '4px 0',
            whiteSpace: 'nowrap',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            color: '#ccc',
            border: 'none',
            outline: 'none',
            boxShadow: 'none',
            transition: 'background 0.2s',
            borderRadius: 4,
          }}
          disabled={!canCollapse}
          onClick={onCollapse}
          title="折叠"
          onMouseOver={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.18)')}
          onMouseOut={e => (e.currentTarget.style.background = 'transparent')}
        >
          折叠
        </button>
        <button
          className="scw-drag-ignore"
          style={{
            flex: 1,
            margin: '4px 4px',
            height: 24,
            fontSize: 11,
            padding: '4px 0',
            whiteSpace: 'nowrap',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            color: '#ccc',
            border: 'none',
            outline: 'none',
            boxShadow: 'none',
            transition: 'background 0.2s',
            borderRadius: 4,
          }}
          disabled={!canParent}
          onClick={onParent}
          title="父元素"
          onMouseOver={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.18)')}
          onMouseOut={e => (e.currentTarget.style.background = 'transparent')}
        >
          父
        </button>
        <button
          className="scw-drag-ignore"
          style={{
            flex: 1,
            margin: '4px 4px',
            height: 24,
            fontSize: 11,
            padding: '4px 0',
            whiteSpace: 'nowrap',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            color: '#ccc',
            border: 'none',
            outline: 'none',
            boxShadow: 'none',
            transition: 'background 0.2s',
            borderRadius: 4,
          }}
          disabled={!canUndo}
          onClick={onUndo}
          title="撤回"
          onMouseOver={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.18)')}
          onMouseOut={e => (e.currentTarget.style.background = 'transparent')}
        >
          撤回
        </button>
        <button
          className="scw-drag-ignore"
          style={{
            flex: 1,
            margin: '4px 4px',
            height: 24,
            fontSize: 11,
            padding: '4px 0',
            whiteSpace: 'nowrap',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            color: '#ccc',
            border: 'none',
            outline: 'none',
            boxShadow: 'none',
            transition: 'background 0.2s',
            borderRadius: 4,
          }}
          disabled={!canConfirm}
          onClick={onConfirm}
          title="确认"
          onMouseOver={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.18)')}
          onMouseOut={e => (e.currentTarget.style.background = 'transparent')}
        >
          确认
        </button>
        <button
          className="scw-drag-ignore"
          style={{
            flex: 1,
            margin: '4px 4px',
            height: 24,
            fontSize: 11,
            padding: '4px 0',
            whiteSpace: 'nowrap',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            color: '#ccc',
            border: 'none',
            outline: 'none',
            boxShadow: 'none',
            transition: 'background 0.2s',
            borderRadius: 4,
          }}
          disabled={!canCancel}
          onClick={onCancel}
          title="取消"
          onMouseOver={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.18)')}
          onMouseOut={e => (e.currentTarget.style.background = 'transparent')}
        >
          取消
        </button>
      </>
    )}
  </div>
);

export default TopButtons;
