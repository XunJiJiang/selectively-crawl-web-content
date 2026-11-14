# Web Utils

在插件的web页面注册 window.scwcutils.

插件 TypeScript 项目纳入 `projects/webutils/lib.d.ts` 后，`window.scwcutils` 提供完整类型提示。

## 可暴露的核心 Web 配置

`coreConfig` 是按通道订阅的只读接口，与插件自身的 `config` 配置存储分开。当前仅公开 `theme`；通道名与回调值根据 `CoreWebConfigValues` 对应推导，未公开的键不能注册。相关类型也从 `scwc:shared/frontend` 导出。

```ts
const sdk = window.scwcutils;
// 可在 ready 前注册；独立浏览器页面没有承载它的核心 Web。
const unsubscribe = sdk.host.capabilities.coreConfig
  ? sdk.coreConfig.subscribe('theme', (theme) => {
      // 本例主动选择跟随；SDK 本身不修改插件的 DOM、CSS 或 data-theme。
      document.documentElement.dataset.theme = theme.mode;
      for (const [name, value] of Object.entries(theme.tokens)) {
        document.documentElement.style.setProperty(name, value);
      }
    })
  : () => {};

// 组件断开或不再跟随时注销。
unsubscribe();
```

连接后首次回调收到当前快照，随后只通知该通道的变化。多个监听器共用一次通道注册，各自独立注销，最后一个注销时停止宿主推送；文档销毁时全部释放，连接重建后自动重新注册。过期的初始响应不会覆盖较新的变化。无需订阅的插件可继续使用自身样式。

`theme.preference` 是设置中的选择（包括 `system`）；`theme.mode` 是核心 Web 实际生效的样式（跟随系统时已解析）。已知标识 `dark-2026`、`light-2026` 有字面量补全，其他非空样式标识也原样交付，供未来样式扩展。`tokens` 是只读的公开语义变量：`--surface-0`、`--surface-1`、`--text-primary`、`--text-secondary`、`--border-default`、`--accent-primary`、`--font-sans`。快照不可修改；插件自行决定如何映射未知样式及是否应用变量。

原独立的 `theme.mode/tokens/onChange` 接口已由 `coreConfig.subscribe('theme', callback)` 统一替代；welcome 不再主动下发样式配置。独立打开插件页时 `host.capabilities.coreConfig` 为 false，直接订阅会抛出不支持错误，插件应使用自身默认样式。
