import { useState, useEffect } from 'react';
import FloatingWindow from './layouts/FloatingWindow';
import TopButtons from './components/TopButtons';
import ItemFormAndCrawl from './components/ItemFormAndCrawl';
import { saveToStorage, loadFromStorage } from './hooks/useFloatingWindow';
import { useElementSelect } from './hooks/useElementSelect';
import { getSelector, getElementBySelector, highlightElement, isExcludedElement } from './hooks/useCrawlLogic';
import { scwcLog, scwcWarn, scwcError } from './utils/console';

// Item类型加prefix
export interface Item {
  selector: string;
  label: string;
  prefix?: string;
}

function App() {
  // 业务状态
  const [expanded, setExpanded] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selectedEl, setSelectedEl] = useState<Element | null>(null);
  const [items, setItems] = useState<Item[]>(loadFromStorage());
  // undoStack 结构：从初始选中到当前选中，依次为 selector
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [descInput, setDescInput] = useState('');
  const [prefixInput, setPrefixInput] = useState('');
  // 选中元素hover
  const hoverEl = useElementSelect(selecting, selectedEl && !selecting ? selectedEl : undefined);

  // 在 selecting=true 时折叠，选中后不自动恢复
  useEffect(() => {
    if (selecting) {
      setExpanded(false);
    }
  }, [selecting]);

  // 选择元素逻辑
  useEffect(() => {
    if (!selecting) return;
    const onClick = (e: MouseEvent) => {
      e.preventDefault();
      // 只允许选中未被排除的元素
      if (hoverEl && !isExcludedElement(hoverEl)) {
        e.stopPropagation();
        setSelecting(false);
        setSelectedEl(hoverEl);
        setExpanded(true); // 选中后自动展开
        setUndoStack([getSelector(hoverEl!)]); // 初始化栈
      }
      document.removeEventListener('click', onClick, true);
    };
    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('click', onClick, true);
    };
  }, [selecting, hoverEl]);

  useEffect(() => {
    if (hoverEl && selecting) highlightElement(hoverEl);
  }, [hoverEl, selecting]);

  // 持久化
  useEffect(() => {
    saveToStorage(items);
  }, [items]);

  // 统一抓取处理函数
  const handleCrawl = async () => {
    if (!items.length) {
      scwcWarn('表单为空，将不会发送抓取请求');
      return;
    }
    const result: { label: string; value: string }[] = [];
    const failed: number[] = [];
    for (let i = 0; i < items.length; ++i) {
      const { selector, label, prefix = '' } = items[i];
      const el = getElementBySelector(selector);
      if (!el) {
        failed.push(i);
        continue;
      }
      // 收集所有片段
      const fragments: string[] = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
      let node;
      while ((node = walker.nextNode())) {
        const text = node.textContent?.trim();
        if (text) fragments.push(prefix + text);
      }
      const value = fragments.join(' ').trim();
      result.push({ label, value });
    }
    if (failed.length) {
      scwcLog('未获取到的元素索引:', failed);
      return;
    }
    try {
      const port = (import.meta.env.PORT || '3100').replace(/[^\d]/g, '') || '3100';
      const res = await fetch(`http://localhost:${port}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          site: window.location.href,
          data: result,
        }),
      });
      const data = await res.json();
      if (data && data.success === false) {
        scwcWarn('抓取失败', data.message);
      } else {
        scwcLog('抓取成功');
      }
    } catch (e) {
      scwcError('抓取:', '上传失败', (e as Error).message ?? '', e);
    }
  };

  return (
    <FloatingWindow expanded={expanded}>
      <TopButtons
        expanded={expanded}
        canSelect={!selecting && (!expanded || (expanded && !selectedEl))}
        canCollapse={expanded}
        canParent={!!(selectedEl && selectedEl.parentElement)}
        canUndo={undoStack.length > 1}
        canConfirm={!!selectedEl}
        canCancel={!!selectedEl}
        itemsLength={items.length}
        selecting={selecting}
        onSelect={() => setSelecting(true)}
        onStopSelect={() => setSelecting(false)}
        onCollapse={() => {
          setExpanded(false);
          setSelectedEl(null);
          setDescInput('');
          setPrefixInput('');
          setUndoStack([]);
        }}
        onParent={() => {
          if (selectedEl && selectedEl.parentElement) {
            const parent = selectedEl.parentElement;
            const parentSelector = getSelector(parent);
            setSelectedEl(parent);
            setUndoStack(stack => stack.concat(parentSelector));
            highlightElement(parent);
          }
        }}
        onUndo={() => {
          if (undoStack.length > 1) {
            setUndoStack(stack => {
              const newStack = stack.slice(0, -1);
              const sel = getElementBySelector(newStack[newStack.length - 1]);
              setSelectedEl(sel);
              highlightElement(sel);
              return newStack;
            });
          }
        }}
        onConfirm={() => {
          if (!selectedEl) return;
          setItems([
            ...items,
            { selector: getSelector(selectedEl), label: descInput || '<null>', prefix: prefixInput },
          ]);
          setSelectedEl(null);
          setDescInput('');
          setPrefixInput('');
          setUndoStack([]);
        }}
        onCancel={() => {
          setSelectedEl(null);
          setDescInput('');
          setPrefixInput('');
          setUndoStack([]);
        }}
        onExpand={() => setExpanded(true)}
        onCrawl={handleCrawl}
      />
      <ItemFormAndCrawl
        expanded={expanded}
        items={items}
        setItems={setItems}
        selectedEl={selectedEl}
        descInput={descInput}
        setDescInput={setDescInput}
        prefixInput={prefixInput}
        setPrefixInput={setPrefixInput}
        onItemHover={selector => {
          // 有选中项时禁止高亮其它项
          if (selectedEl) return;
          const el = getElementBySelector(selector);
          if (el) {
            highlightElement(el);
          } else {
            scwcWarn('元素不存在', selector);
          }
        }}
        onDelete={idx => {
          const newItems = [...items];
          newItems.splice(idx, 1);
          setItems(newItems);
        }}
        onDragStart={idx => e => {
          e.dataTransfer.setData('idx', String(idx));
        }}
        onDrop={idx => e => {
          const from = Number(e.dataTransfer.getData('idx'));
          if (from === idx) return;
          const newItems = [...items];
          const [moved] = newItems.splice(from, 1);
          newItems.splice(idx, 0, moved);
          setItems(newItems);
        }}
        onDescInputChange={e => setDescInput(e.target.value)}
        onPrefixInputChange={e => setPrefixInput(e.target.value)}
        onCrawl={handleCrawl}
      />
    </FloatingWindow>
  );
}

export default App;
