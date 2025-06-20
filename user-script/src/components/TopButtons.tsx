import React from 'react';

interface TopButtonsProps {
  expanded: boolean;
  canSelect: boolean;
  canCollapse: boolean;
  canParent: boolean;
  canUndo: boolean;
  canConfirm: boolean;
  canCancel: boolean;
  itemsLength: number;
  selecting?: boolean;
  onSelect: () => void;
  onStopSelect?: () => void;
  onCollapse: () => void;
  onParent: () => void;
  onUndo: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  onExpand: () => void;
  onCrawl: () => void;
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
  onCrawl,
}) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      borderBottom: expanded ? '1px solid #eee6' : 'none',
      background: 'transparent',
      padding: !expanded ? '0 4px' : 0,
      width: !expanded ? 142 : undefined,
      height: !expanded ? 32 : undefined,
      flexWrap: 'nowrap',
    }}
  >
    {!expanded ? (
      // 缩小时显示“选择”、“抓取”、“展开”三个按钮，均分宽度
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
            cursor: canSelect || selecting ? 'pointer' : 'not-allowed',
          }}
          disabled={!canSelect && !selecting}
          onClick={selecting ? onStopSelect : onSelect}
          title={selecting ? '取消选择' : '选择元素'}
          onMouseOver={e =>
            !canSelect && !selecting ? 'transparent' : (e.currentTarget.style.background = 'rgba(255,255,255,0.18)')
          }
          onMouseOut={e => (e.currentTarget.style.background = 'transparent')}
        >
          {selecting ? '取消' : '选择'}
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
            cursor: 'pointer',
          }}
          onClick={onExpand}
          title="展开窗口"
          onMouseOver={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.18)')}
          onMouseOut={e => (e.currentTarget.style.background = 'transparent')}
        >
          展开
        </button>
        <button
          className="scw-drag-ignore"
          style={{
            flex: 1,
            minWidth: 0,
            height: 24,
            fontSize: 11,
            margin: '0 2px',
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
            cursor: 'pointer',
          }}
          onClick={onCrawl}
          title="想服务器发送抓取的内容"
          onMouseOver={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.18)')}
          onMouseOut={e => (e.currentTarget.style.background = 'transparent')}
        >
          抓取
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
              cursor: 'pointer',
            }}
            onClick={onStopSelect}
            title="取消选择"
            onMouseOver={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.18)')}
            onMouseOut={e => (e.currentTarget.style.background = 'transparent')}
          >
            取消选择
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
              cursor: canSelect ? 'pointer' : 'not-allowed',
            }}
            disabled={!canSelect}
            onClick={onSelect}
            title="选择元素"
            onMouseOver={e =>
              canSelect ? (e.currentTarget.style.background = 'rgba(255,255,255,0.18)') : 'transparent'
            }
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
            cursor: canCollapse ? 'pointer' : 'not-allowed',
          }}
          disabled={!canCollapse}
          onClick={onCollapse}
          title="折叠窗口"
          onMouseOver={e =>
            canCollapse ? (e.currentTarget.style.background = 'rgba(255,255,255,0.18)') : 'transparent'
          }
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
            cursor: canParent ? 'pointer' : 'not-allowed',
          }}
          disabled={!canParent}
          onClick={onParent}
          title="父元素"
          onMouseOver={e => (canParent ? (e.currentTarget.style.background = 'rgba(255,255,255,0.18)') : 'transparent')}
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
            cursor: canUndo ? 'pointer' : 'not-allowed',
          }}
          disabled={!canUndo}
          onClick={onUndo}
          title="撤回"
          onMouseOver={e => (canUndo ? (e.currentTarget.style.background = 'rgba(255,255,255,0.18)') : 'transparent')}
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
            cursor: canConfirm ? 'pointer' : 'not-allowed',
          }}
          disabled={!canConfirm}
          onClick={onConfirm}
          title="确认"
          onMouseOver={e =>
            canConfirm ? (e.currentTarget.style.background = 'rgba(255,255,255,0.18)') : 'transparent'
          }
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
            cursor: canCancel ? 'pointer' : 'not-allowed',
          }}
          disabled={!canCancel}
          onClick={onCancel}
          title="放弃选择的元素"
          onMouseOver={e => (canCancel ? (e.currentTarget.style.background = 'rgba(255,255,255,0.18)') : 'transparent')}
          onMouseOut={e => (e.currentTarget.style.background = 'transparent')}
        >
          放弃
        </button>
      </>
    )}
  </div>
);

export default TopButtons;
