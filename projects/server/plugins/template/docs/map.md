# template 项目地图

> 更新日期：2026-10-28。源码为最终事实。

插件开发模板：生命周期、命令、各类控件，以及 Vite + Lit 的页面状态、请求保护、任务与可控制通知验证页。

- package.json 与 index.ts 是加载入口；默认采用独立 Node 子进程和第二版契约，无需 runtime.mode 或 apiVersion 显式标记。
- 入口使用 satisfies SCWC.IPluginHandler；public API 上下文为 context.request，资源返回 file/response 描述。命令、控件、抓取和生命周期函数留在插件宿主内。
- 保留原有 enabled、link-with、commandName 与业务存储路径；禁用项不会自动启用。runtime 可仅覆盖超时。
- 核心承载 HTTP、鉴权、静态资源、Range 和真实 WebSocket；插件不能额外监听端口。
- 修改需遵循仓库 docs/skills/scwc-plugin-development/SKILL.md，核心协议见 projects/server/plugin/process/README.md。

- `index.ts` 保留原有抓取、命令、脚本控件与旧 API 示例；onLoad 将公开 workbench 工厂交给 `validation.ts`，onUnload 关闭探针定时器并清理反馈对象。后端按当前类型声明接入，不依赖技能中的旧接口描述。
- `validation.ts` 提供延时只读 API、固定 SVG、真实 Socket 通道和内存事件环；延时上限 180 秒，package.runtime 请求截止为 240 秒。原请求被浏览器中止后，插件后端仍可能执行到结束；run/attempt 用于识别重发，不作取消证明。
- `feedback-demo.ts` 是前后端共用的公开控制接口示例：自定义任务状态、阶段、进度、内容与日志；通知进度、内容、4 按钮替换、可见查询、已读与主动关闭。函数留在创建侧，不跨进程传函数。
- `web/main.ts` 只用核心注入的 scwcutils；本地心跳通过 lifecycle 暂停/恢复，状态可序列化。没有后台网络轮询；控制对象快照按需查询。运行任务会保护活动，测试空闲前需结束任务与默认 Socket。
- 页面采用 Light DOM，以符合当前 ManagedResources 对 document 中 src/href 的观察范围；资源 URL 必须实际绑定元素才开始加载。固定探针 SVG 没有敏感信息，其他真实资源仍须自行验证授权票据。
- `vite.config.ts` 复用 @scwc/vite-plugin，按实际目录名生成 base，源码为 web/index.html，入口指向 web/dist/index.html。前端自带 web/tsconfig.json；不复制核心组件/SDK 运行时代码。忽略构建产物，源码部署缺 HTML 时自动构建；已有 HTML 须显式重建后刷新。
- `tests/integration.test.mjs` 通过真实 Node 子进程、核心 HTTP/SQLite/Socket 与 SDK/Lit 产物验证边界；唯一环境 hook 隔离真实 .env，临时数据库仅落 tests/.tmp-* 并清理。JSDOM 的资源 load 事件只验证 DOM 释放，像素/真实图片和工作台完整节能调度不在其证明范围。

验证命令与逐项判定见 `../README.md`。最小自动检查为模板后端/前端独立 tsc、核心插件构建器和 node --test tests/integration.test.mjs；HTTP 测试需要回环监听权限。任务按钮/窗口、通知 4px 加载条、完整空闲倒计时与隐藏活动保护需在核心 UI 手工验收，不能用测试夹具声称已完成视觉或真实计时验证。本次按用户要求暂不维护 AOCI。
