# template 项目地图

> 更新日期：2026-10-06。源码为最终事实。

插件开发模板：生命周期、命令、各类控件、页面 API 与资源描述示例。

- package.json 与 index.ts 是加载入口；默认采用独立 Node 子进程和第二版契约，无需 runtime.mode 或 apiVersion 显式标记。
- 入口使用 satisfies SCWC.IPluginHandler；public API 上下文为 context.request，资源返回 file/response 描述。命令、控件、抓取和生命周期函数留在插件宿主内。
- 保留原有 enabled、link-with、commandName 与业务存储路径；禁用项不会自动启用。runtime 可仅覆盖超时。
- 核心承载 HTTP、鉴权、静态资源、Range 和真实 WebSocket；插件不能额外监听端口。
- 修改需遵循仓库 docs/skills/scwc-plugin-development/SKILL.md，核心协议见 projects/server/plugin/process/README.md。

- 复制模板后按实际目录修改页面资源路径。资源必须返回 file/response 描述，不能调用 Express res。示例资源返回 404，替换为真实文件前由插件校验参数与票据。

验证：根目录运行 npx tsc -b tsconfig.json --pretty false；projects/server/plugin/process/installed-plugins.test.ts 以原生 Node 类型擦除在临时目录逐个启动/卸载入口，并验证 ASMR 登录、媒体票据等接口。HTTP/流式回归在 process.test.ts，重试与缓存回归在 utils/axios.test.ts。测试不触发真实网页抓取或写入既有用户媒体库。
