# SCWC 多窗口终端

从仓库根启动（Node.js 24+）：

```sh
bun run dev:server
bun run prod:server
# 直接启动终端，不进行 Web 构建准备
bun run dev:terminal
```

setup.ts 负责构建准备并启动本工程；终端通过本地 IPC 启动核心并负责重启。直接运行 `node projects/server/index.ts --mode=dev` 仍使用普通逐行命令输入。

`bun run build:core` 生成同时包含核心与终端的独立可执行文件，构建需要 Node >= 25.5。在部署目录使用 `./scwc --terminal` 打开终端，`./scwc` 直接启动核心。Windows 使用 scwc.exe。可执行文件读取同目录 .env，业务插件与终端插件分别放入 plugins 与 terminal/plugins。

## 使用

默认有输出窗口和 cmd1，输出窗口不能关闭。标签尾部数字是当前标签序号，命令参数使用这个序号；内部使用持久化的固定 UUID，关闭并新建窗口不会继承旧日志。

- 浏览时按 Enter 或 i 编辑当前命令窗口，上下键选择本窗命令历史，左右键移动光标。
- Esc 返回浏览并保留草稿；浏览时按 : 进入全局命令。命令参数中的冒号按普通字符处理。
- Tab / Shift+Tab 切换窗口。第一次越界停留，600ms 内同向再次输入才循环。
- 点击标签切换；标签栏箭头/浏览时左右键按一个标签滚动；标签栏滚轮按字符列滚动。
- 输出区滚轮及浏览/全局输入中的上下键查看历史。查看历史时新增日志不会跳到末尾；滚到底部后自动跟随。
- Shift+左右选择输入文本，需要终端提供可识别的按键编码。输入模式的 Ctrl+C 清除草稿，浏览模式的 Ctrl+C 请求取消当前任务或退出。
- 确认输入 :y 加 Enter 接受；:n 加 Enter、Esc 或其他无关按键取消。确认期间停用其他操作。

| 全局命令                      | 用途                                   |
| ----------------------------- | -------------------------------------- |
| :q                            | 退出；存在任务时确认                   |
| :r / :restart                 | 重启核心，保留终端窗口、日志与历史     |
| :new                          | 创建命令窗口                           |
| :s N / :switch N              | 切换到标签序号 N                       |
| :w                            | 关闭当前命令窗口                       |
| :c N / :close N               | 关闭指定命令窗口                       |
| :run N 命令                   | 执行；已有任务时确认并先取消旧任务     |
| :cancel [N]                   | 取消当前或指定窗口任务                 |
| :clear [output\|history\|all] | 清除当前窗口输出、历史或两者；默认输出 |
| :help                         | 查看全局命令与已注册的核心/终端命令    |

每窗只运行一个顶层命令；不同窗口可并行运行。函数返回但仍有主动后台任务时，窗口继续显示命令标题与动画。协作取消失败时，会另行确认是否停止整个插件宿主，这会影响该插件其他任务。强停后依赖该插件的新命令不会执行，先 :r 再提交。核心意外退出时，中断相关执行，最多退避重试三次，仍可通过 :r 手动重启或 :q 退出。

非 TTY / TERM=dumb 使用逐行交互，全局命令仍可用；输入 :s N 选择窗口，普通命令进入对应命令窗口。

## 配置与恢复

| 配置                     | 默认值                                                        |
| ------------------------ | ------------------------------------------------------------- |
| SCWC_TERMINAL_STATE_FILE | 配置目录下 data/terminal/state.json                           |
| SCWC_TERMINAL_PERSIST    | true；false 停用持久化                                        |
| SCWC_CMD_PLUGIN_DIR      | 源码：projects/terminal/plugins；可执行文件：terminal/plugins |

相对配置路径以 .env 配置目录为基准。每秒保存脏快照，退出时立即保存；使用原子替换、上一份备份及文件锁。损坏主文件会留存副本并尝试恢复备份。快照记录输出、窗口 ID/顺序/活动窗口、滚动锚点、输入草稿与命令历史；不保存确认动作或运行模式。

启动后把上次 running/background/cancelling 标记为中断，保留输出，恢复到浏览模式，不重放命令或主动忙状态。SIGKILL/断电只能恢复最近成功保存的快照。每窗最多 10,000 行或 10 MiB，最多 128 个窗口。

## 核心业务插件的 logger 与 TaskReporter

主命令/子命令保持前四个参数，在第五个参数提供调用上下文。旧代码可以忽略它。为了兼容旧代码构造的上下文，公开类型中的新增属性为可选；当前核心在真实调用中始终注入。

```ts
execute(logger, options, unusedArgs, originArgs, context) {
  if (!context) throw new Error('此命令需要支持调用上下文的核心');
  const handle = context.tasks.begin('后台处理');
  void work(context.signal)
    .then(() => logger.info('完成', logger.windowId, logger.executionId))
    .catch((error) => logger.error(error))
    .finally(() => handle.end());
}
```

logger 的只读 windowId/executionId 固定到本次调用。异步回调继续使用这个 logger 即可，不能复用上次命令的 logger。onLoad 的 logger 归输出窗口，onLoad 的 context.tasks 是进程级报告；业务调用中的 context.tasks 是调用级报告。API/资源 context 同时提供 tasks、signal、logger；抓取/控件/WebSocket 回调也获得 tasks 与 signal。

busy 为“函数未结束 OR setBusy(true) 未解除 OR begin 任务未 end”。返回的 Promise 会自动等待；未返回/未 await 的后台工作必须在函数返回前登记。函数返回不会清除主动忙状态；setBusy(false) 只清除本作用域的布尔标记，不结束 begin 句柄，也不清除另一调用或进程级任务。整体结束后不能再 begin 或设为忙，重复 end 无影响。多个并行后台任务应各自使用 begin/end。

## 终端命令插件

每个子目录包含 package.json（main、enabled、type: module）和导出 onLoad 的入口，使用独立宿主进程。复制 [template](plugins/template/index.ts) 并在 package.json 中将 enabled 改为 true。接口见 [types.ts](plugins/types.ts)。

onLoad 接收 registerCommand、进程级 tasks、logger、signal；execute 接收 args、固定 windowId/executionId、调用级 tasks、signal、logger、write 和 invokeCore。write 使用当前调用的固定窗口，invokeCore 的子执行共用窗口并保持父任务忙状态直到子执行整体结束。子执行不能直接调用 exit/restart。

名称冲突时使用目录 ID 前缀。核心命令后注册产生冲突时也会重命名终端命令并提示。系统全局命令不能被覆盖。加载/卸载有截止时间；强制停止清理宿主进程树。目录插件变更后重启终端生效，不提供热重载。进程隔离用于稳定性，插件仍拥有 Node 的文件和网络能力。

## 验证

```sh
bun run test --run projects/terminal/model.test.ts projects/terminal/storage.test.ts projects/server/common/tasks.test.ts
bun run build:core
bun run test:core-executable
```

最后一项使用临时部署、独立 Redis 和测试插件；需 redis-server 和 Python 3。非 Windows 上还运行真实 PTY 的全屏、鼠标、输入、确认、resize 和退出恢复验证。当前已在 macOS 验证；Windows/Linux 的终端编码与显示仍需在对应平台人工验收。
