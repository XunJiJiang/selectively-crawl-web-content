import './PluginWindow.css';

import { useEffect, useState, useCallback, useContext } from 'react';
import configContext from '../context/config';
import { scwcWarn } from '../utils/console';
import { useNotification } from '../hooks/useNotification';

/**
 * 后端需要实现的接口
 * - 获取插件配置: /api/plugin/config
 * - 发送插件事件: /api/plugin/toggle
 */

type PluginItem = SCWC.PluginItem;

type PluginConfig = {
  id: string;
  title: string;
  description: string;
  controls: PluginItem[];
};

type PluginWindowProps = {
  openPluginWindow: boolean;
  getCrawlData: () => { result: SCWC.DataItem[]; failed: string[] };
};

// const WINDOW_WIDTH = 400;
// const WINDOW_HEIGHT = 500;

const PluginWindow: React.FC<PluginWindowProps> = ({ openPluginWindow, getCrawlData }) => {
  const [plugins, setPlugins] = useState<PluginConfig[] | null>(null);
  const [activeTab, setActiveTab] = useState<string>('');
  const [activePlugin, setActivePlugin] = useState<PluginConfig | null>(null);

  const config = useContext(configContext);

  const notify = useNotification();

  const fetchPluginConfig = useCallback(async () => {
    const res = await fetch(`${config.api.host}:${config.api.port.replace(/[^\d]/g, '')}/api/plugin/config`);
    if (!res.ok) throw new Error('Failed to fetch plugin config');
    const data = (await res.json()) as {
      code: number;
      message: string;
      data: PluginConfig[];
    };
    if (data.code >= 400 && data.code < 600) {
      throw new Error(data.message ?? 'Error fetching plugin config');
    } else if (data.code === 200) {
      return data.data;
    } else {
      throw new Error('Unexpected response code(' + data.code + ') from server: ' + data.message);
    }
  }, [config]);

  useEffect(() => {
    if (!openPluginWindow) return;
    if (plugins === null) {
      fetchPluginConfig()
        .then(setPlugins)
        .catch(e => {
          console.error('Failed to load plugin configs:', e);
        });
    }
  }, [openPluginWindow, plugins, fetchPluginConfig]);

  useEffect(() => {
    if (plugins && plugins.length === 1) {
      setActiveTab(plugins[0].id);
      setActivePlugin(plugins[0]);
    }
  }, [plugins]);

  const sendPluginClick = useCallback(
    async (pluginId: string, channel: string) => {
      const { result, failed } = getCrawlData();

      if (failed.length > 0) {
        scwcWarn('无法发送请求，存在未获取到的元素索引:', failed);
        return;
      }

      const res = await fetch(`${config.api.host}:${config.api.port.replace(/[^\d]/g, '')}/api/plugin/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'click',
          channel,
          id: pluginId,
          context: {
            data: result,
            site: window.location.href,
          },
        }),
      });

      if (!res.ok) {
        scwcWarn(`插件请求失败: ${res.status} ${res.statusText}`);
        return;
      } else {
        const data = (await res.json()) as {
          code: number;
          message: string;
          data: {
            type: 'notification';
            data: {
              type: 'error' | 'success' | 'warn' | 'info';
              message: string;
            };
          };
        };

        if (data.code >= 400 && data.code < 600) {
          scwcWarn('插件请求错误: ' + data.message);
          return;
        } else if (data.code === 200) {
          if (data.data.type === 'notification') {
            const notifyFunc = notify[data.data.data.type as 'info' | 'success' | 'warn' | 'error'];
            notifyFunc({
              title: `插件 ${pluginId} 的处理结果`,
              description: data.data.data.message,
              placement: 'bottomRight',
            });
          }
        } else {
          scwcWarn(`插件请求失败: ${res.status} ${res.statusText}`);
          return;
        }
      }
    },
    [getCrawlData, config, notify],
  );

  const handleButtonClick = useCallback(
    (pluginId: string, channel: string) => {
      sendPluginClick(pluginId, channel);
    },
    [sendPluginClick],
  );

  return (
    <div
      className="SCWC-plugin-window"
      style={{
        display: openPluginWindow ? 'flex' : 'none',
        // width: WINDOW_WIDTH,
        // height: WINDOW_HEIGHT,
      }}
    >
      {/* Tabs */}
      <div className="SCWC-plugin-window-tabs" style={{ display: 'flex', borderBottom: '1px solid #eee' }}>
        {plugins?.map(plugin => (
          <div
            key={plugin.id}
            className="SCWC-plugin-window-tab"
            style={{
              padding: '8px 16px',
              cursor: 'pointer',
              borderBottom: activeTab === plugin.id ? '2px solid #1890ff' : 'none',
            }}
            data-active={activeTab === plugin.id}
            onClick={() => {
              setActiveTab(plugin.id);
              setActivePlugin(plugin);
            }}
          >
            {plugin.title}
          </div>
        ))}
      </div>
      {/* Plugin Content */}
      <div className="SCWC-plugin-window-content" style={{ flex: 1, padding: 16, overflow: 'auto' }}>
        {activeTab && activePlugin ? (
          activePlugin.controls.map((control, idx) =>
            control.type === 'button' ? (
              <button
                className="SCWC-plugin-window-content-item SCWC-plugin-window-content-item-button"
                key={idx}
                style={{ marginRight: 8, marginBottom: 8 }}
                onClick={() => handleButtonClick(activeTab, control.channel)}
              >
                {control.label}
              </button>
            ) : (
              <div key={idx} style={{ color: '#888', marginBottom: 8 }}>
                {/* TODO */}
                不支持的控件类型: {control.type}
              </div>
            ),
          )
        ) : (
          <div style={{ color: '#888' }}>{plugins === null ? '加载中...' : '请选择左侧标签'}</div>
        )}
      </div>
    </div>
  );
};

export default PluginWindow;
