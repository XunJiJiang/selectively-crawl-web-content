import { requireValue } from '../../../shared/workbench-protocol.ts';
import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'lit';
import { bookmarkList } from './ui.ts';
import type { WorkbenchStore } from './store.ts';
const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach((fn) => fn());
  document.body.replaceChildren();
  vi.useRealTimers();
});
it('shows edge insertion lines and highlights then expands a centered folder drop', async () => {
  vi.useFakeTimers();
  const store = {
    preferences: {
      values: {
        bookmarkFolders: [
          { id: 'a', name: 'A' },
          { id: 'b', name: 'B' },
        ],
      },
    },
    bookmarks: [],
  } as unknown as WorkbenchStore;
  const action = vi.fn(),
    container = document.createElement('div');
  document.body.append(container);
  render(bookmarkList(store, action, '', true), container);
  const source = container.querySelectorAll('details')[0],
    target = container.querySelectorAll('details')[1];
  target.open = false;
  vi.spyOn(requireValue(target.querySelector('summary')), 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 100, 40),
  );
  const transfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
  const fire = (node: Element, type: string, y = 0) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { dataTransfer: transfer, clientY: y, relatedTarget: null });
    node.dispatchEvent(event);
  };
  fire(source, 'dragstart');
  cleanup.push(() => fire(source, 'dragend'));
  fire(target, 'dragover', 2);
  expect(target.dataset.drop).toBe('before');
  fire(target, 'dragover', 38);
  expect(target.dataset.drop).toBe('after');
  fire(target, 'dragover', 20);
  expect(target.dataset.drop).toBe('inside');
  expect(target.open).toBe(false);
  await vi.advanceTimersByTimeAsync(650);
  expect(target.open).toBe(true);
  fire(target, 'drop', 20);
  expect(action).toHaveBeenCalledWith('moveBookmark', {
    source: 'folder:a',
    target: 'folder:b',
    position: 'inside',
  });
  expect(target.dataset.drop).toBeUndefined();
});
it('renders nested folders and mixed bookmark ordering, preventing drops into descendants', () => {
  const store = {
    preferences: {
      values: {
        bookmarkFolders: [
          { id: 'a', name: 'A' },
          { id: 'b', name: 'B', parentId: 'a' },
        ],
        bookmarkOrder: ['bookmark:p', 'folder:b'],
      },
    },
    bookmarks: [{ id: 'p', folderId: 'a', originalTitle: 'P', url: '/p' }],
  } as unknown as WorkbenchStore;
  const action = vi.fn(),
    container = document.createElement('div');
  document.body.append(container);
  render(bookmarkList(store, action), container);
  const source = requireValue(container.querySelector('details')),
    children = requireValue(source.querySelector('.bookmark-children'));
  expect(children.firstElementChild?.getAttribute('data-bookmark-key')).toBe('bookmark:p');
  const target = requireValue(children.querySelector('details'));
  source.dispatchEvent(new Event('dragstart', { bubbles: true }));
  cleanup.push(() => source.dispatchEvent(new Event('dragend', { bubbles: true })));
  target.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));
  expect(target.getAttribute('data-drop')).toBeNull();
  target.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
  expect(action).not.toHaveBeenCalled();
});
