# 终端插件模板

复制本目录到 projects/terminal/plugins 下的另一个目录，在 package.json 中设置 enabled: true，然后重启终端。

`later` 启动一秒的后台任务并立即返回；句柄保持窗口忙碌，结束或取消时释放。logger、tasks、signal 均归属于本次调用，保存后用于异步回调不会串到另一窗口。

插件接口使用全局命名空间 `SCWCTerminal`，例如 `satisfies SCWCTerminal.Plugin`。本目录的 `tsconfig.json` 通过 include 引入 `../plugin-env.d.ts`。放入自定义插件目录后，可以一同携带这个独立声明文件，或将 include 改为现有声明文件的绝对路径；无需携带终端的宿主、加载器或核心服务插件类型。
