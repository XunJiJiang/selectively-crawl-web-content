import './PluginWindow.css';

import { memo, useEffect, useState } from 'react';
import { type GetCrawlData, type PluginConfig, usePluginFetch } from '../hooks/usePluginFetch';

/*
 * 后端需要实现的接口
 * - 获取插件配置: /api/plugin/config
 * - 发送插件事件: /api/plugin/toggle
 */

type PluginWindowProps = {
  openPluginWindow: boolean;
  getCrawlData: GetCrawlData;
};

// const WINDOW_WIDTH = 400;
// const WINDOW_HEIGHT = 500;

const PluginWindow: React.FC<PluginWindowProps> = memo(({ openPluginWindow, getCrawlData }) => {
  const [activeTab, setActiveTab] = useState<string>('');
  const [activePlugin, setActivePlugin] = useState<PluginConfig | null>(null);

  const { plugins, setControlValue, getControlValue } = usePluginFetch(openPluginWindow, getCrawlData);

  useEffect(() => {
    if (plugins && plugins.length >= 1) {
      setActiveTab(plugins[0].id);
      setActivePlugin(plugins[0]);
    }
  }, [plugins]);

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
          activePlugin.controls.map((control, idx) => {
            switch (control.type) {
              case 'button':
                return (
                  <button
                    className="SCWC-plugin-window-content-item SCWC-plugin-window-content-item-button"
                    key={idx}
                    onClick={() => setControlValue(control, null)}
                  >
                    {control.label}
                  </button>
                );
              case 'toggle':
                return (
                  <div
                    className="SCWC-plugin-window-content-item SCWC-plugin-window-content-item-toggle"
                    key={idx}
                    style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}
                  >
                    <span style={{ marginRight: 8 }}>{control.label}</span>
                    <label className="SCWC-toggle-switch">
                      <input
                        type="checkbox"
                        checked={getControlValue(control) === true}
                        onChange={e => setControlValue(control, e.target.checked)}
                      />
                      <span className="SCWC-toggle-slider" />
                    </label>
                  </div>
                );
              case 'select':
                return (
                  <div
                    className="SCWC-plugin-window-content-item SCWC-plugin-window-content-item-select"
                    key={idx}
                    style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}
                  >
                    <span style={{ marginRight: 8 }}>{control.label}</span>
                    <select
                      id={control.channel}
                      name={control.channel}
                      value={getControlValue(control)?.toString()}
                      onChange={e => setControlValue(control, e.target.value)}
                      style={{ padding: 4 }}
                    >
                      <option value="" disabled>
                        请选择
                      </option>
                      {control.options?.options?.map((option, idx) => (
                        <option key={idx} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              case 'input:text':
                return (
                  <div
                    className="SCWC-plugin-window-content-item SCWC-plugin-window-content-item-input-text"
                    key={idx}
                    style={{ display: 'flex', flexDirection: 'column', marginBottom: 8 }}
                  >
                    <span style={{ marginBottom: 4 }}>{control.label}</span>
                    <input
                      type="text"
                      value={getControlValue(control)?.toString()}
                      onChange={e => (console.log(e), setControlValue(control, e.target.value))}
                      style={{ padding: 4 }}
                    />
                  </div>
                );
              case 'input:number':
                return (
                  <div
                    className="SCWC-plugin-window-content-item SCWC-plugin-window-content-item-input-number"
                    key={idx}
                    style={{ display: 'flex', flexDirection: 'column', marginBottom: 8 }}
                  >
                    <span style={{ marginBottom: 4 }}>{control.label}</span>
                    <input
                      type="number"
                      value={getControlValue(control)?.toString()}
                      onChange={e => (console.log(e), setControlValue(control, Number(e.target.value)))}
                      style={{ padding: 4 }}
                    />
                  </div>
                );
              case 'checkbox':
                return (
                  <div
                    className="SCWC-plugin-window-content-item SCWC-plugin-window-content-item-checkbox"
                    key={idx}
                    style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}
                  >
                    <label style={{ display: 'flex', alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        checked={getControlValue(control) === true}
                        onChange={e => setControlValue(control, e.target.checked)}
                        style={{ marginRight: 4 }}
                      />
                      {control.label}
                    </label>
                  </div>
                );
              default:
                return (
                  <div key={idx} style={{ color: '#888', marginBottom: 8 }}>
                    {/* TODO: 更多的类型支持 */}
                    不支持的控件类型: {control.type}
                  </div>
                );
            }
          })
        ) : (
          <div style={{ color: '#888' }}>
            {plugins === null ? '加载中...' : plugins.length === 0 ? '没有插件可用' : '请选择左侧标签'}
          </div>
        )}
      </div>
    </div>
  );
});

export default PluginWindow;
