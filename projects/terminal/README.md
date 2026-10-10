# SCWC 多窗口终端

从仓库根启动（Node.js 24+）：

```sh
bun run dev:server
bun run prod:server
# 直接启动终端，不进行 Web 构建准备
bun run dev:terminal
```

setup.ts 负责构建准备并启动本工程；终端通过本地 IPC 启动核心并负责重启。直接运行 `node projects/server/index.ts --mode=dev` 仍使用普通逐行命令输入。

`bun run build:core` 生成同时包含核心与终端的独立可执行文件，构建需要 Node >= 25.5。在部署目录直接运行 `./scwc` 默认打开多窗口终端，`./scwc --no-terminal` 才直接启动核心；旧 `--terminal` 用法仍可用。Windows 对应 `scwc.exe` / `scwc.exe --no-terminal`。终端拉起核心子进程时显式禁用终端模式；插件宿主和独立页面构建仍走各自入口。可执行文件读取同目录 .env，业务插件与终端插件分别放入 plugins 与 terminal/plugins。

## 使用

默认有输出窗口和 cmd1，输出窗口不能关闭。标签尾部数字是当前标签序号，命令参数使用这个序号；内部使用持久化的固定 UUID，关闭并新建窗口不会继承旧日志。

- 命令窗口在最后一段输出的下一行显示高亮 `>` 和光标，直接输入命令。上下键选择本窗历史，末项保留当前草稿；全局命令也有独立历史和草稿。
- 命令草稿为空时按 : 进入全局命令，已有内容时冒号按普通字符输入。全局命令完成后可再次输入 :，保留当前输出继续执行；Esc 关闭会话并丢弃临时输出。全局命令草稿为空时 Backspace 也可退出，命令内部的 next 输入不受此规则影响。
- 空输入时 Tab / Shift+Tab 切换窗口，已有输入时用于命令补全。第一次越界停留，600ms 内同向再次输入才循环。
- 点击标签切换；标签栏箭头或空输入时左右键按一个标签滚动，已有输入时左右键移动光标；标签栏滚轮按字符列滚动。
- 输出区滚轮或 PageUp / PageDown 查看历史；输出窗口和全局输出模式的上下键滚动。查看历史时新增日志保持锚点，回到底部后自动跟随。
- Shift+左右选中，Ctrl/Cmd+左右按空格分词跳转，Alt/Option+左右跳到头尾；组合 Shift 可跳转选中。鼠标拖动选择输出或输入，Ctrl/Cmd+C 优先复制并清除选区，宽字素覆盖半格也计入。Cmd 需要宿主终端传递按键。
- 没有选区时，等待 next 的 Ctrl+C 取消输入并返回错误元组；有草稿时清空草稿，其余情况请求取消当前任务或退出。
- 生命周期确认使用 :y / :n 加 Enter，插件冲突使用提示中的选项加 Enter。选项输入自动带有不可删除的冒号，只需输入选项字母；错误答案重试，Esc 取消。自定义插件标识与命令内部的 next 使用普通输入。确认期间停用其他命令。

底栏按输出、候选或提示的实际行数展开，包含状态/输入行在内最多占终端高度的一半，超出内容可滚动。只有左侧当前状态块的背景随模式变化，其余底栏背景固定。命令窗口的候选由终端根据核心发现清单和普通终端插件命令统一筛选；scwc 终端插件负责注册全局命令。

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

核心提供 `plugin build-web <插件目录名>`，可在任一命令窗口使用内置 Vite 重建页面，日志/任务归该窗口，`:cancel` 可取消。此命令不重载后端，成功后刷新页面；未激活插件修复后使用 `:r` 重启核心。缺少页面的 Vite 插件会在 onLoad 前自动构建，已有完整页面直接加载。

正常终端自动启用颜色，核心和两类插件继承主终端的颜色能力。信息标签为蓝色、警告为黄色、错误为红色；插件自定义 ANSI 颜色及对象格式化颜色会保留，自动折行与缩放保留颜色。重定向输出和 TERM=dumb 默认关闭颜色；设置 NO_COLOR 或 FORCE_COLOR=0 可以关闭，FORCE_COLOR=1/2/3 分别强制启用基础色、256 色和真彩色。

执行中可以等待下一步输入。提示和输入草稿归发起调用的窗口，空输入时 Tab 或点击标签可以切到另一窗口执行命令；等待期间 Enter 提交内容，空行和冒号也是有效字符串。非 TTY 时当前窗口等待的下一行优先作为回复（包括冒号开头的内容），管道输入会依次等待命令及提示，不把回复误执行为命令。输入流关闭时 `next` 返回 `closed` 错误元组。成功完成只恢复窗口状态，不追加 `[succeeded] 命令`；失败、取消或中断仍显示状态。

## 配置与恢复

| 配置                     | 默认值                                                        |
| ------------------------ | ------------------------------------------------------------- |
| SCWC_TERMINAL_STATE_FILE | 配置目录下 data/terminal/state.json                           |
| SCWC_TERMINAL_PERSIST    | true；false 停用持久化                                        |
| SCWC_CMD_PLUGIN_DIR      | 源码：projects/terminal/plugins；可执行文件：terminal/plugins |

相对配置路径以 .env 配置目录为基准。每秒保存脏快照，退出时立即保存；使用原子替换、上一份备份及文件锁。损坏主文件会留存副本并尝试恢复备份。快照记录输出、窗口 ID/顺序/活动窗口、滚动锚点、输入草稿、命令历史，以及插件自定义标识和添加前缀/不添加前缀/放弃加载的裁决；不保存确认动作或运行模式。停用持久化也会停用插件裁决保存。

启动后把上次 running/background/cancelling 标记为中断，保留输出，恢复到浏览模式，不重放命令或主动忙状态。SIGKILL/断电只能恢复最近成功保存的快照。每窗最多 10,000 行或 10 MiB，最多 128 个窗口。

## 核心业务插件的 logger 与 TaskReporter

主命令/子命令保持前四个参数，在第五个参数提供调用上下文。旧回调可以忽略它，实际调用和公开签名均要求提供上下文。

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

onLoad 保存的 logger 在业务调用异步链中自动采用当前调用身份，帮助旧插件把命令日志送回原窗口；调用结束后的独立工作仍应使用命令参数中的固定 logger。日志按顺序排队，常规突发输出不再按每秒条数或 8000 字符静默丢弃。极端过载超过队列限制时会显示截断提示，窗口历史仍受配置上限约束。

核心命令和插件命令均可使用 `context.next`：

```ts
async execute(logger, options, unusedArgs, originArgs, context) {
  const [error, name] = await context.next('请输入名称', String);
  if (error) {
    logger.info(error.code, error.message);
    return;
  }
  const [countError, count] = await context.next('请输入数量', Number);
  if (countError) return;
  logger.info(name, count);
}
```

返回类型为 `[SCWC.InvocationInputError, undefined] | [undefined, T]`；省略类型默认 String。支持 String（保留空白）、Number（有限数值）、Boolean（true/false、yes/no、y/n、1/0）、BigInt（整数）、Date（可解析日期）。错误类名称为 `InvocationInputError`，code 为 cancelled、closed、unavailable、busy 或 invalid-type；`next` 返回错误元组，不抛出输入错误。格式无效会提示重输。同一调用只能有一个等待，不同窗口互不影响；等待计入任务忙状态，用户输入时间不占插件执行超时。`:cancel`、重启和宿主断开会结束等待；直接运行核心时 SIGINT 在等待输入期间只取消当前输入。

busy 为“函数未结束 OR setBusy(true) 未解除 OR begin 任务未 end”。返回的 Promise 会自动等待；未返回/未 await 的后台工作必须在函数返回前登记。函数返回不会清除主动忙状态；setBusy(false) 只清除本作用域的布尔标记，不结束 begin 句柄，也不清除另一调用或进程级任务。整体结束后不能再 begin 或设为忙，重复 end 无影响。多个并行后台任务应各自使用 begin/end。

## 终端命令插件

每个子目录包含 package.json（main、enabled、type: module）和导出 onLoad 的入口，使用独立宿主进程。复制 [template](plugins/template/index.ts) 并在 package.json 中将 enabled 改为 true。公共接口见 [plugin-env.d.ts](plugins/plugin-env.d.ts)，使用全局命名空间 `SCWCTerminal`。每个插件自行配置 tsconfig 引入声明，两个插件提供了配置示例；声明自包含，可以与插件一同复制到外部目录。

入口导出的插件对象可声明 `id: '简短标识'`，省略时使用目录名。标识用于区分插件，也作为需要添加前缀时的命令命名空间；最多 64 个字符，不能包含空白、冒号、路径分隔符或控制字符。

onLoad 接收 coreCommands（核心发现清单）、registerCommand、进程级 tasks、logger、signal；execute 接收 args、固定 windowId/executionId、调用级 tasks、signal、next、logger、write 和 invokeCore。next 的类型和错误元组同核心命令。write 使用当前调用的固定窗口，invokeCore 的子执行共用窗口并保持父任务忙状态直到子执行整体结束，子命令也可等待输入。子执行不能直接调用 exit/restart。

命令省略 scope 时进入普通命令窗口，scope: 'global' 时进入临时全局底栏。scwc 是独立默认插件，始终先加载；源码模式从仓库固定目录读取，打包模式内嵌在宿主中。它把核心系统命令按原名注册为全局命令，包括 help；exit/restart 由终端生命周期处理。

先比较插件标识，再比较命令。标识冲突时，:a 保留第一个并自定义第二个，:b 保留第二个并自定义第一个，:c 两个都自定义，:d 卸载第一个，:e 卸载第二个。自定义标识会检查现有占用和本次待提交的另一个标识；保留的插件继续参与后续标识比较，三个以上插件使用同一标识时也逐对处理。

命令冲突以插件为单位，每次列出该插件与内置命令或另一个插件之间的全部冲突命令。与终端内建或核心服务命令冲突时，:a 给该插件的全部命令加标识前缀，:b 放弃整个插件。两个插件之间冲突时，:a 给提示中的第二个插件全部命令加前缀，:b 保留第一个完整插件，:c 保留第二个完整插件。已加前缀的插件退出原始命令名比较，放弃的插件卸载并移出所有后续比较。如果某个插件原先有冲突，但其他插件先添加前缀或卸载使冲突解除，仍会询问 :a 添加前缀 / :b 不添加前缀。

自定义标识和命令裁决随终端状态保存，重启无需重复回答；插件目录、入口、声明标识或注册命令名称/作用域变化时重新裁决。后注册的核心命令会重新检查未加前缀的插件，不能因为曾选择不添加前缀而跳过新冲突。新插件全部裁决完成后才发布命令，不自动代选。

因此 scwc 选择添加前缀后，以 :scwc:server info、:scwc:plugin ps 等形式执行。终端自己的 :help 保留，核心帮助同样加前缀，使用 :scwc:help。自定义 scwc 标识时，将上述 scwc 替换为所选标识。

宿主、加载器及测试位于 terminal/plugin，plugins 目录只保留插件目录和对外类型。tsconfig.terminal.json 仍引入核心 SCWC 声明，是因为宿主复用的共享 SDK 间接引用核心进程协议类型；终端插件自己的 SCWCTerminal 声明无需该依赖。

加载/卸载有截止时间；强制停止清理宿主进程树。目录插件变更后重启终端生效，不提供热重载。进程隔离用于稳定性，插件仍拥有 Node 的文件和网络能力。

## 验证

```sh
bun run test --run projects/terminal/model.test.ts projects/terminal/storage.test.ts projects/server/common/tasks.test.ts
bun run build:core
bun run test:core-executable
```

最后一项使用临时部署、独立 Redis 和测试插件；需 redis-server 和 Python 3。非 Windows 上还运行真实 PTY 的全屏、鼠标、输入、确认、resize 和退出恢复验证。当前已在 macOS 验证；Windows/Linux 的终端编码与显示仍需在对应平台人工验收。

## 动态命令提示与核心插件管理

命令窗口与全局命令均支持动态补全。输入发生变化后，终端向拥有该命令的服务发送完整 `command` 与 UTF-16 `cursor`；返回 `from`、`to` 替换范围和 `items`（`name`、`insertText`、可选 `description`）。终端不限制命令层级，当前核心注册表提供主命令和二级子命令，子命令说明来自插件注册配置。Tab / Shift+Tab 预览，空格或 Enter 接受；在行中补全时保留后面的参数。新的输入、光标位置、窗口或服务命令清单使旧响应失效。

终端插件可在注册命令时提供 `complete(request)` 异步回调，返回同样的补全结果。`onLoad` 的 `completeCore(request)` 可查询挂载核心的最新提示；内置 scwc 插件通过这个接口转发系统命令提示，冲突前缀由加载器转换。提示请求不执行命令，也不创建业务任务。

核心命令窗口可执行 `plugin enable <插件目录名>`、`plugin disable <插件目录名>`、`plugin reload <插件目录名>`。全局底栏通过 scwc 插件执行对应命令；采用默认冲突前缀时，例如 `:scwc:plugin reload <插件目录名>`。`plugin ls` 输出目录标识供命令使用。enable/disable 原子写回插件 `package.json` 的 `enabled`，核心重启后保留；启用失败不会保存成功的启用状态。重载只作用于已加载插件，卸载旧宿主时传入 `isRestart=true`，禁用时传入 `false`。插件命令、API、资源路由、WebSocket 通道和连接随卸载移除，重载使用新宿主和新的 safeId。
