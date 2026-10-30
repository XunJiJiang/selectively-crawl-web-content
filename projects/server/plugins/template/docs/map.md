# template 项目地图

> 更新日期：2026-10-30。源码为最终事实。

插件开发模板：生命周期、命令、用户脚本控件、Vite + Lit 页面、统一模板处理器、声明式 UI 与权威后端配置。

- package.json 与 index.ts 是加载入口；默认采用独立 Node 子进程和第二版契约，无需 runtime.mode 或 apiVersion 显式标记。
- 入口使用 satisfies SCWC.IPluginHandler；public API 上下文为 context.request，资源返回 file/response 描述。命令、控件、抓取和生命周期函数留在插件宿主内。
- 保留原有 enabled、link-with、commandName 与业务存储路径；禁用项不会自动启用。runtime 可仅覆盖超时。
- 核心承载 HTTP、鉴权、静态资源、Range 和真实 WebSocket；插件不能额外监听端口。
- 本次契约依据当前源码与 docs/模板插件完整最小接入实现提示词.md 核对；历史开发说明不能覆盖已删除接口。

- `index.ts` 保留抓取、命令、脚本控件及原有业务 API；导出 configuration。onLoad 保存配置订阅并注册声明式演示，onUnload 释放 UI、配置订阅、探针和反馈对象。
- `configuration.ts` 定义两个配置分组、七种控件、字符串默认值、异步 normalize/validate；提供限定 validation.note/memo 的显式业务 CRUD API。写入要求调用方提供已读 baseRevision，不自动补最新版本；onChange 与 subscribe 记录注明不同来源。
- `ui-content.ts` 提供 JSON 主侧栏、JSON/HTML 辅助页、三种格式状态 tooltip、完整菜单，以及可执行的核心处理器示例表。使用核心编译器允许的组件与样式，资源只指向挂载路径。HTML 的主题变量回退使用前置常量声明，规避当前编译器对 var() fallback Raw 节点的拒绝。
- `declarative-ui.ts` 是一个后端演示状态及句柄控制器。事务原子注册/注销三类贡献、静态挂载和处理器；run 用普通函数取得 this，watch 无定时轮询。参数/事件/上下文可观察；定向 setContent 只用核心绑定 instanceId。非法隐藏、跨域链和循环模板在隔离候选中拒绝，不把非法定义注册为线上初始内容。
- `assets/mark.svg` 与 `assets/nested/mark.svg` 分别演示单文件、目录根层和嵌套资源，经核心 cap 网关提供，不包含脚本或外部引用。
- `web/ui-demo.ts` 注册当前文档的事件处理器与只读 getter/watch；提供配置快照/三种订阅、后端业务写入口、UI 释放恢复、导航适配、搜索和 checkpoint 操作。页面状态不跨标签取数；脏配置草稿进入既有 lifecycle 序列化和关闭保护。
- `validation.ts` 提供延时只读 API、固定 SVG、真实 Socket 通道和内存事件环；延时上限 180 秒，package.runtime 请求截止为 240 秒。原请求被浏览器中止后，插件后端仍可能执行到结束；run/attempt 用于识别重发，不作取消证明。
- `feedback-demo.ts` 是前后端共用的公开控制接口示例：自定义任务状态、阶段、进度、内容与日志；通知进度、内容、4 按钮替换、可见查询、已读与主动关闭。函数留在创建侧，不跨进程传函数。
- `web/main.ts` 只用核心注入的 scwcutils；本地心跳通过 lifecycle 暂停/恢复，状态可序列化。没有后台网络轮询；控制对象快照按需查询。运行任务会保护活动，测试空闲前需结束任务与默认 Socket。
- 页面采用 Light DOM，以符合当前 ManagedResources 对 document 中 src/href 的观察范围；资源 URL 必须实际绑定元素才开始加载。固定探针 SVG 没有敏感信息，其他真实资源仍须自行验证授权票据。
- `vite.config.ts` 复用 @scwc/vite-plugin，按实际目录名生成 base，源码为 web/index.html，入口指向 web/dist/index.html。前端自带 web/tsconfig.json；不复制核心组件/SDK 运行时代码。忽略构建产物，源码部署缺 HTML 时自动构建；已有 HTML 须显式重建后刷新。
- `tests/integration.test.mjs` 通过真实 Node 子进程、核心 HTTP/SQLite/Socket 与 SDK/Lit 产物验证边界；唯一环境 hook 隔离真实 .env，临时数据库仅落 tests/.tmp-* 并清理。JSDOM 的资源 load 事件只验证 DOM 释放，像素/真实图片和工作台完整节能调度不在其证明范围。

验证命令与逐项判定见 `../README.md` 和 `coverage.md`。HTTP 测试需要回环监听权限；临时资源仅在 template/tests 下创建并清理。测试覆盖真实 UI HTTP/IPC、配置表单、来源处理器、监听释放和跨插件拒绝；JSDOM 仍不能证明像素、完整空闲计时或用户激活权限。AOCI 维护交接另存仓库 docs/AOCI2，不把本文当作正式索引。
