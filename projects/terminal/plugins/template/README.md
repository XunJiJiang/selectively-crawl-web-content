# 终端插件模板

复制本目录到 projects/terminal/plugins 下的另一个目录，在 package.json 中设置 enabled: true，然后重启终端。

`later` 启动一秒的后台任务并立即返回；句柄保持窗口忙碌，结束或取消时释放。logger、tasks、signal 均归属于本次调用，保存后用于异步回调不会串到另一窗口。

实际插件放在自定义目录时，可以调整入口中的 type import 路径用于编辑器类型检查；原生 Node 运行时会删除 type import。
