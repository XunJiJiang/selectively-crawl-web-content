import { PERSISTENT_DATA_KEY, POS_KEY, MINIMIZED_KEY, PLUGIN_EXPANDED_KEY } from './common.ts';

/** 更新本地存储的数据格式 */
export default function updateLocalStorage() {
  const result = updateLocalStorageFormat_0_to_2_0_0_1();
  if (result === 'error') {
    console.error(
      '0 -> 2.0.0-1 更新本地存储数据格式时发生错误, 请手动清除 localStorage 中的相关数据',
    );
    return;
  }
  // 其他更新逻辑可以在这里添加
}

type UpdateResult = 'next' | 'error';

/** 0 -> 2.0.0-1 */
function updateLocalStorageFormat_0_to_2_0_0_1(): UpdateResult {
  const persistentData = localStorage.getItem(PERSISTENT_DATA_KEY);
  if (persistentData) {
    try {
      const parsedData = JSON.parse(persistentData);
      if (
        typeof parsedData === 'object' &&
        parsedData !== null &&
        'version' in parsedData &&
        typeof parsedData.version === 'string'
      ) {
        // 如果 PERSISTENT_DATA_KEY 已经存在, 则不需要更新
        return 'next';
      }
    } catch (error) {
      console.error(
        '解析 PERSISTENT_DATA_KEY 时发生错误: ' +
          (error instanceof Error ? error.message : String(error)),
      );
      return 'error';
    }
  }

  // 在 2.0.0 之前的版本中, 悬浮窗位置和最小化状态是直接存储在 localStorage 中的, 而不是存储在 PERSISTENT_DATA_KEY 中
  const pos = localStorage.getItem(POS_KEY) as { x: number; y: number } | null;
  const minimized = localStorage.getItem(MINIMIZED_KEY) as 'true' | 'false' | null;
  const pluginExpanded = localStorage.getItem(PLUGIN_EXPANDED_KEY) as 'true' | 'false' | null;

  if (pos || minimized || pluginExpanded) {
    const persistentData = {
      version: '2.0.0-1',
      window: {
        ...(pos ? { pos } : {}),
        ...(minimized !== null ? { minimized: minimized === 'true' } : { minimized: true }),
      },
      plugin: {
        ...(pluginExpanded !== null
          ? { expanded: pluginExpanded === 'true' }
          : { expanded: false }),
        activeTab: '',
      },
    };
    localStorage.setItem(PERSISTENT_DATA_KEY, JSON.stringify(persistentData));
    localStorage.removeItem(POS_KEY);
    localStorage.removeItem(MINIMIZED_KEY);
    localStorage.removeItem(PLUGIN_EXPANDED_KEY);
  }
  return 'next';
}
