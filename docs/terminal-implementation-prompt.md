# Web 终端实现提示词

## 任务概述

修改 Web 工作台底部面板中的终端部分，使其命令页面部分的样式和内部逻辑与 `projects/terminal` 的设计保持一致。输出页面和右侧终端标签列表保持当前的 Web UI 设计。

部分无法在 `projects/terminal` 中实现的功能，需要在 Web 端实现，下面会详细说明。

## 核心设计要求

### 1. 命令输入区域（需要复刻）

**多行输入编辑器：**

- 支持多行命令输入，类似 projects/terminal 的多行编辑器
- 最小高度 40px，最大高度 50vh（视口高度的一半）
- 使用等宽字体（`var(--font-mono)`）
- 背景色为 `var(--surface-0)`
- 无边框，聚焦时不显示轮廓线

**命令提示行：**

- 显示 `>` 提示符，使用强调色 `var(--accent-primary)`
- 提示符采用粗体（`font-weight: var(--font-semibold)`）
- 提示行固定在输入区域顶部，不可编辑

**动态命令补全：**

- Tab 键触发补全候选列表
- 候选列表最大高度 200px，超出可滚动
- 当前选中项使用 `var(--surface-3)` 背景和 `var(--accent-primary)` 文字颜色
- 每个补全项显示命令名称和描述（如果有）
- 使用上下方向键选择，Enter 确认，Esc 取消

**输入状态栏：**

- 高度 24px，背景色 `var(--surface-1)`
- 显示当前输入模式、行列位置等状态信息
- 字体大小 `var(--text-xs)`，颜色 `var(--text-tertiary)`

### 2. 命令输出区域（需要复刻）

**顶部置顶命令：**

- 当前正在执行的命令固定显示在输出区域顶部
- 使用粘性定位（`position: sticky; top: 0`）
- 背景色 `var(--surface-2)`，底部边框
- 显示 `>` 提示符和命令文本
- 命令过长时使用省略号

**输出行类型：**

- `prompt`: 命令提示符，使用强调色
- `command`: 用户输入的命令回显
- `output`: 普通输出，灰色文字
- `error`: 错误输出，红色
- `warning`: 警告输出，黄色
- `info`: 信息输出，蓝色
- `success`: 成功输出，绿色

**历史记录还原：**

- 重启后恢复的命令在行尾显示 "还原的历史记录" 标签
- 标签样式：小字号、灰色文字、浅色背景、圆角边框

**ANSI 颜色支持：**

- 保留插件输出的 ANSI 颜色代码
- 自动折行时保持颜色连续性

**滚动监听：**

`projects/terminal` 中的滚动事件无法准确判断滚动速度，而在 Web 中可以更细致地监听滚动事件和滚动距离，从而实现更平滑的滚动体验和更准确的滚动位置记录。滚动时依旧以一行为单位进行滚动，但可以根据滚动速度动态调整滚动步长，避免快速滚动时出现迟滞感。

### 3. 右侧终端列表（保持现有设计）

**不需要修改右侧终端列表的以下部分：**

- 列表宽度 200px（默认），可调节 160-320px
- 终端项高度 48px
- 显示终端名称、状态点、未读计数
- 选中项左侧 2px 宽的强调色指示器
- 悬停时显示操作按钮

### 4. 输出页面（保持现有设计）

**不需要修改输出页面的以下部分：**

- 输出工具栏（32px 高度）
- 日志级别筛选按钮
- 时间戳、级别标签、输出文本的三列布局

## 技术实现细节

### CSS 类名约定

```
.terminal-view                      // 终端视图容器
.terminal-main                      // 主内容区
.terminal-output                    // 输出区域
.terminal-output-line               // 输出行
  [data-type="prompt|command|output|error|warning|info|success"]
.terminal-pinned-command            // 置顶命令
.terminal-restored-indicator        // 历史记录还原标签

.terminal-input-area                // 输入区域容器
.terminal-input-prompt-line         // 提示行
.terminal-input-prompt              // 提示符
.terminal-input-editor              // 多行编辑器
.terminal-completion-list           // 补全列表
.terminal-completion-item           // 补全项
  [data-selected="true"]
.terminal-input-status              // 状态栏
.terminal-multiline-indicator       // 多行指示器
```

### 键盘交互

**命令输入模式：**

- Enter: 提交命令（Shift+Enter 换行）
- Tab: 触发补全（连续两次 Tab 显示所有候选）
- 上/下: 浏览命令历史（无输入时）或在补全列表中导航（有候选时）
- Esc: 取消补全或清空输入
- Ctrl+C: 取消当前任务或清空输入

**输出浏览模式：**

- 滚轮或 PageUp/PageDown: 滚动输出历史
- Home/End: 跳到输出开头/结尾

### 状态管理

**窗口状态：**

```typescript
interface TerminalWindow {
  id: string;                  // 窗口唯一标识
  kind: 'output' | 'command';  // 窗口类型
  commandNumber?: number;       // 命令编号（cmdN）
  defaultTitle: string;         // 默认标题
  task?: {
    executionId: string;
    mainCommand: string;
    status: 'running' | 'background' | 'cancelling';
  };
  output: OutputLine[];         // 输出缓冲
  scrollAnchor: number;         // 滚动位置
  history: string[];            // 命令历史
  historyCursor: number;        // 历史游标
  draft: string;                // 当前草稿
  historyDraft: string;         // 浏览历史前的草稿
}
```

**输出行结构：**

```typescript
interface OutputLine {
  type: 'prompt' | 'command' | 'output' | 'error' | 'warning' | 'info' | 'success';
  text: string;
  timestamp?: number;
  executionId?: string;
  restored?: boolean;  // 是否为恢复的历史记录
}
```

### 与后端通信

**WebSocket 消息：**

- `terminal.output`: 接收输出行
- `terminal.command.started`: 命令开始执行
- `terminal.command.finished`: 命令执行完成
- `terminal.completion.request`: 请求命令补全
- `terminal.completion.response`: 补全结果

**HTTP API：**

- `POST /api/terminal/execute`: 执行命令
- `POST /api/terminal/cancel`: 取消任务
- `GET /api/terminal/history`: 获取命令历史

## 参考文档

1. **终端设计方案**: `docs/终端设计方案.md`
   - 完整的终端设计契约
   - 窗口模型、输入模式、全局命令
   - 任务状态、取消流程

2. **Web UI 详细设计**: `docs/Web UI 详细设计.md`
   - 视觉系统、Token 定义
   - 底部面板布局规范
   - 响应式断点

3. **终端实现参考**: `projects/terminal/`
   - 实际运行的终端实现
   - 可以在本地运行 `bun run dev:server` 查看效果

## 实现优先级

### Phase 1: 基础命令输入

1. 实现多行输入编辑器
2. 添加命令提示符
3. 实现基本的命令提交

### Phase 2: 输出渲染

1. 实现输出行类型渲染
2. 添加顶部置顶命令
3. 支持 ANSI 颜色

### Phase 3: 交互增强

1. 实现命令历史浏览
2. 添加命令补全
3. 实现草稿保存与恢复

### Phase 4: 状态与持久化

1. 实现滚动锚点
2. 添加历史记录还原标签
3. 连接后端 WebSocket

## 不需要实现的功能

以下功能属于 `projects/terminal` 的 CLI 终端特有功能，Web 端不需要实现：

- IPC 进程通信
- TTY 原始模式
- 终端 resize 事件处理
- SIGINT/SIGKILL 信号处理
- 文件状态持久化（state.json）
- 多终端实例锁
- 插件宿主进程管理

## 验收标准

1. **视觉一致性**: 命令页面样式与 `projects/terminal` 运行效果一致
2. **功能完整性**: 多行输入、命令补全、历史浏览全部可用
3. **交互流畅性**: 键盘快捷键符合预期，无明显延迟
4. **状态正确性**: 切换窗口后草稿、历史游标正确保留
5. **兼容性**: 输出页面和右侧列表保持原设计不变

## 注意事项

1. 所有颜色、间距、字体必须使用 CSS 变量（Token 系统）
2. 支持深色和浅色主题自动切换
3. 确保 WCAG AA 级别的对比度
4. 移动端需要适配，输入区域占据更多垂直空间
5. 输出历史限制在 10,000 行或 10 MiB
6. 保持与现有 Web 工作台的布局和交互一致性
