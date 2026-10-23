# Web UI 详细设计

日期：2026-10-18。状态：视觉与尺寸规范。本文定义工作台的完整视觉系统、组件尺寸、响应式断点、深浅配色与侧栏变体，模仿 VS Code 的布局风格。配合[主设计文档](Web插件工作台设计方案.md)和[技术契约](Web插件工作台技术契约.md)实施。

---

## 1. 设计原则与视觉方向

### 1.1 核心理念

参考 VS Code 的 **Light 2026 / Dark 2026** 主题，建立品牌中立、高可读、强对比的界面系统：

- **深色优先**：默认深色主题，浅色主题作为平等选项
- **表面分层**：使用 5-7 级近黑表面，通过层次区分功能区
- **语义 token 系统**：所有颜色、间距、圆角使用 CSS 变量，便于主题切换与维护
- **可访问性**：WCAG AA 对比度标准，运行状态不只依赖颜色识别
- **流体排版**：使用 clamp() 实现自适应尺寸，从桌面到小屏平滑过渡

### 1.2 视觉与 VS Code 的对比

| 特征 | VS Code | SCWC 工作台 |
| ------ | --------- | ------------- |
| 配色基调 | 深色：#1E1E1E 主表面 | 深色：#0A0D12 ～ #1E2636 五级表面 |
| 浅色基调 | 浅色：#FFFFFF 背景 | 浅色：#FEFEFE ～ #E8EAED 五级表面 |
| 强调色 | 蓝色 #007ACC | 青色 #38BDF8（数据/工具领域） |
| 圆角 | 方正为主，部分 3px | 完全圆润：按钮 999px pill，卡片 12px |
| 布局网格 | Flex 为主 | CSS Grid 主框架，Flex 组件内部 |
| 字体栈 | Segoe UI 等系统字体 | 通过 token 引用，支持自定义 |

---

## 2. 设计 Token 系统

### 2.1 表面层级（Surfaces）

深色主题表面：

```css
:root[data-theme="dark-2026"] {
  /* 五级表面，从最深到最浅 */
  --surface-0: #05070C;  /* 3% 亮度，应用背景 */
  --surface-1: #0A0D12;  /* 5% 亮度，主侧栏、底部面板 */
  --surface-2: #0F131C;  /* 7% 亮度，标签栏、次要容器 */
  --surface-3: #161D2B;  /* 10% 亮度，悬停、分组头 */
  --surface-4: #1E2636;  /* 13% 亮度，激活态、输入框 */
  
  /* 提升表面（用于弹层、菜单） */
  --surface-elevated: #252D3F;
  --surface-overlay: rgba(0, 0, 0, 0.85);
}
```

浅色主题表面：

```css
:root[data-theme="light-2026"] {
  --surface-0: #FEFEFE;  /* 应用背景 */
  --surface-1: #F5F6F7;  /* 主侧栏、底部面板 */
  --surface-2: #ECEEF0;  /* 标签栏 */
  --surface-3: #E8EAED;  /* 悬停 */
  --surface-4: #DFE1E4;  /* 激活态 */
  
  --surface-elevated: #FFFFFF;
  --surface-overlay: rgba(255, 255, 255, 0.92);
}
```

### 2.2 文字层级（Typography）

```css
:root {
  /* 字体族 */
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, 
               "Helvetica Neue", Arial, sans-serif;
  --font-mono: "SF Mono", Monaco, "Cascadia Code", "Courier New", monospace;
  
  /* 流体字号 */
  --text-xs: clamp(0.6875rem, 0.65rem + 0.1875vw, 0.75rem);    /* 11-12px */
  --text-sm: clamp(0.8125rem, 0.775rem + 0.1875vw, 0.875rem);  /* 13-14px */
  --text-base: clamp(0.875rem, 0.825rem + 0.25vw, 1rem);       /* 14-16px */
  --text-md: clamp(1rem, 0.925rem + 0.375vw, 1.125rem);        /* 16-18px */
  --text-lg: clamp(1.125rem, 1rem + 0.625vw, 1.5rem);          /* 18-24px */
  
  /* 行高 */
  --leading-tight: 1.25;
  --leading-normal: 1.5;
  --leading-relaxed: 1.75;
  
  /* 字重 */
  --font-normal: 400;
  --font-medium: 500;
  --font-semibold: 600;
  
  /* 字间距 */
  --tracking-tight: -0.015em;  /* 大标题 */
  --tracking-normal: 0;
  --tracking-wide: 0.025em;    /* 小字 */
}
```

### 2.3 颜色语义（Semantic Colors）

深色主题：

```css
:root[data-theme="dark-2026"] {
  /* 文字 */
  --text-primary: rgba(255, 255, 255, 0.92);
  --text-secondary: rgba(255, 255, 255, 0.65);
  --text-tertiary: rgba(255, 255, 255, 0.45);
  --text-disabled: rgba(255, 255, 255, 0.28);
  --text-inverse: rgba(0, 0, 0, 0.87);
  
  /* 边界 */
  --border-subtle: rgba(255, 255, 255, 0.08);
  --border-default: rgba(255, 255, 255, 0.12);
  --border-strong: rgba(255, 255, 255, 0.18);
  --border-focus: var(--accent-primary);
  
  /* 强调色 - 数据/工具青色系 */
  --accent-primary: #38BDF8;      /* 主操作、链接、焦点 */
  --accent-hover: #7DD3FC;
  --accent-pressed: #0EA5E9;
  --accent-subtle: rgba(56, 189, 248, 0.15);
  
  /* 辅助色 - 翡翠绿 */
  --accent-secondary: #6EE7B7;
  --accent-secondary-subtle: rgba(110, 231, 183, 0.15);
  
  /* 状态色 */
  --status-success: #10B981;
  --status-success-bg: rgba(16, 185, 129, 0.15);
  --status-warning: #F59E0B;
  --status-warning-bg: rgba(245, 158, 11, 0.15);
  --status-error: #EF4444;
  --status-error-bg: rgba(239, 68, 68, 0.15);
  --status-info: #38BDF8;
  --status-info-bg: rgba(56, 189, 248, 0.15);
  
  /* 运行状态（用于插件状态指示） */
  --state-running: #10B981;
  --state-starting: #F59E0B;
  --state-stopped: #6B7280;
  --state-error: #EF4444;
  --state-building: #8B5CF6;
}
```

浅色主题：

```css
:root[data-theme="light-2026"] {
  /* 文字 */
  --text-primary: rgba(0, 0, 0, 0.87);
  --text-secondary: rgba(0, 0, 0, 0.60);
  --text-tertiary: rgba(0, 0, 0, 0.42);
  --text-disabled: rgba(0, 0, 0, 0.26);
  --text-inverse: rgba(255, 255, 255, 0.95);
  
  /* 边界 */
  --border-subtle: rgba(0, 0, 0, 0.06);
  --border-default: rgba(0, 0, 0, 0.10);
  --border-strong: rgba(0, 0, 0, 0.15);
  
  /* 强调色 */
  --accent-primary: #0284C7;
  --accent-hover: #0369A1;
  --accent-pressed: #075985;
  --accent-subtle: rgba(2, 132, 199, 0.10);
  
  /* 辅助色 */
  --accent-secondary: #059669;
  --accent-secondary-subtle: rgba(5, 150, 105, 0.10);
  
  /* 状态色 */
  --status-success: #059669;
  --status-success-bg: rgba(5, 150, 105, 0.10);
  --status-warning: #D97706;
  --status-warning-bg: rgba(217, 119, 6, 0.10);
  --status-error: #DC2626;
  --status-error-bg: rgba(220, 38, 38, 0.10);
  --status-info: #0284C7;
  --status-info-bg: rgba(2, 132, 199, 0.10);
}
```

### 2.4 间距系统（Spacing）

```css
:root {
  /* 8px 基准倍数系统 */
  --space-0: 0;
  --space-1: 0.25rem;   /* 4px */
  --space-2: 0.5rem;    /* 8px - 基准 */
  --space-3: 0.75rem;   /* 12px */
  --space-4: 1rem;      /* 16px */
  --space-5: 1.25rem;   /* 20px */
  --space-6: 1.5rem;    /* 24px */
  --space-8: 2rem;      /* 32px */
  --space-10: 2.5rem;   /* 40px */
  --space-12: 3rem;     /* 48px */
  --space-16: 4rem;     /* 64px */
  
  /* 语义间距 */
  --gap-tight: var(--space-2);
  --gap-normal: var(--space-4);
  --gap-relaxed: var(--space-6);
  
  --padding-xs: var(--space-2);
  --padding-sm: var(--space-3);
  --padding-md: var(--space-4);
  --padding-lg: var(--space-6);
}
```

### 2.5 圆角系统（Radius）

```css
:root {
  --radius-none: 0;
  --radius-sm: 0.25rem;    /* 4px - 输入框、小按钮 */
  --radius-md: 0.5rem;     /* 8px - 卡片 */
  --radius-lg: 0.75rem;    /* 12px - 面板、分组 */
  --radius-xl: 1rem;       /* 16px - 模态框 */
  --radius-full: 999px;    /* 完全圆润 - pill 按钮、状态点 */
}
```

### 2.6 阴影系统（Shadows）

```css
:root[data-theme="dark-2026"] {
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.5);
  --shadow-md: 0 4px 8px rgba(0, 0, 0, 0.4),
               0 2px 4px rgba(0, 0, 0, 0.3);
  --shadow-lg: 0 12px 24px rgba(0, 0, 0, 0.5),
               0 4px 8px rgba(0, 0, 0, 0.4);
  --shadow-xl: 0 24px 48px rgba(0, 0, 0, 0.6),
               0 8px 16px rgba(0, 0, 0, 0.5);
  
  /* 菜单与弹层 */
  --shadow-menu: var(--shadow-lg);
  --shadow-modal: var(--shadow-xl);
}

:root[data-theme="light-2026"] {
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.08);
  --shadow-md: 0 4px 8px rgba(0, 0, 0, 0.1),
               0 2px 4px rgba(0, 0, 0, 0.06);
  --shadow-lg: 0 12px 24px rgba(0, 0, 0, 0.12),
               0 4px 8px rgba(0, 0, 0, 0.08);
  --shadow-xl: 0 24px 48px rgba(0, 0, 0, 0.15),
               0 8px 16px rgba(0, 0, 0, 0.1);
  
  --shadow-menu: var(--shadow-lg);
  --shadow-modal: var(--shadow-xl);
}
```

### 2.7 动画与过渡（Motion）

```css
:root {
  /* 时长 */
  --duration-instant: 0ms;
  --duration-fast: 150ms;
  --duration-normal: 250ms;
  --duration-slow: 350ms;
  
  /* 缓动 */
  --ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-decelerate: cubic-bezier(0, 0, 0.2, 1);
  --ease-accelerate: cubic-bezier(0.4, 0, 1, 1);
  --ease-bounce: cubic-bezier(0.68, -0.55, 0.265, 1.55);
  
  /* 常用组合 */
  --transition-fast: var(--duration-fast) var(--ease-standard);
  --transition-normal: var(--duration-normal) var(--ease-standard);
  --transition-slow: var(--duration-slow) var(--ease-decelerate);
}

/* 尊重用户减少动画偏好 */
@media (prefers-reduced-motion: reduce) {
  :root {
    --duration-fast: 0ms;
    --duration-normal: 0ms;
    --duration-slow: 0ms;
  }
}
```

---

## 3. 布局尺寸与响应式

### 3.1 总体布局框架

```
┌─────────────────────────────────────────────────────────────┐
│ 顶栏 (Topbar) - 固定高度 40px                                 │
├──┬──────────────────────────────────────────────────────┬───┤
│活│ 主侧栏 (Main Sidebar)    │ 中心页面区 (Center)       │辅│
│动│                          │                          │助│
│栏│ 默认宽度 280px           │ 弹性填充                  │侧│
││  可调整 200-480px         │                          │栏│
│48│                          │ 标签栏 32px              │  │
│px│                          │ ─────────────────────── │28│
││  上部 60%                 │                          │0p│
││  ─────────────────        │                          │x │
││  下部 40%                 │                          │  │
│  │ (可调节分割)              │                          │  │
├──┴──────────────────────────┴──────────────────────────┴───┤
│ 底部面板 (Bottom Panel) - 默认高度 240px，可调 120-600px    │
│ 标签栏 32px + 内容区                                         │
├─────────────────────────────────────────────────────────────┤
│ 状态栏 (Status Bar) - 固定高度 24px                          │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 固定尺寸规范

| 区域 | 固定尺寸 | 说明 |
| ------ | ---------- | ------ |
| 顶栏高度 | 40px | 包含菜单、搜索、区域控制 |
| 状态栏高度 | 24px | 包含连接、插件、URL、通知 |
| 活动栏宽度 | 48px | 图标按钮统一 40×40px |
| 标签栏高度 | 32px | 中心、底部面板标签 |
| 终端列表宽度 | 200px（默认） | 多终端时显示，可调 160-320px |

### 3.3 可调节尺寸范围

| 区域 | 默认值 | 最小值 | 最大值 | 调整方式 |
| ------ | -------- | -------- | -------- | ---------- |
| 主侧栏宽度 | 280px | 200px | 480px | 拖动右侧边界 |
| 辅助侧栏宽度 | 280px | 240px | 480px | 拖动左侧边界 |
| 底部面板高度（停靠下方） | 240px | 120px | 600px | 拖动上边界 |
| 底部面板宽度（停靠左/右） | 360px | 280px | 640px | 拖动内侧边界 |
| 主侧栏内部分割比例 | 60:40 | 30:70 | 80:20 | 拖动分割线 |
| 中心分组分割比例 | 50:50 | 20:80 | 80:20 | 拖动分割线 |

### 3.4 响应式断点

#### 桌面模式（≥1280px 宽度）

完整七区布局，所有功能可见：

```css
@media (min-width: 1280px) {
  .workbench {
    grid-template-columns: 
      48px                          /* 活动栏 */
      minmax(200px, var(--main-sidebar-width)) /* 主侧栏 */
      1fr                           /* 中心 */
      minmax(240px, var(--aux-sidebar-width)); /* 辅助侧栏 */
    grid-template-rows:
      40px                          /* 顶栏 */
      1fr                           /* 内容区 */
      minmax(120px, var(--panel-height)) /* 底部面板 */
      24px;                         /* 状态栏 */
  }
}
```

#### 中等屏幕模式（1024px - 1279px）

- 辅助侧栏默认收起，通过按钮切换
- 底部面板高度限制在 200px-400px
- 主侧栏最大宽度限制为 360px

```css
@media (min-width: 1024px) and (max-width: 1279px) {
  .main-sidebar {
    max-width: 360px;
  }
  
  .auxiliary-sidebar {
    position: absolute;
    right: 0;
    top: 40px;
    bottom: calc(var(--panel-height) + 24px);
    transform: translateX(100%);
    transition: transform var(--transition-normal);
    box-shadow: var(--shadow-lg);
  }
  
  .auxiliary-sidebar[data-visible="true"] {
    transform: translateX(0);
  }
  
  .bottom-panel {
    max-height: 400px;
  }
}
```

#### 小屏模式（768px - 1023px）

- 主侧栏临时悬浮，不占据流式空间
- 一次只显示一个分组（提供分组切换器）
- 底部面板默认隐藏，打开时覆盖 50% 高度

```css
@media (min-width: 768px) and (max-width: 1023px) {
  .workbench {
    grid-template-columns: 48px 1fr;
  }
  
  .main-sidebar {
    position: absolute;
    left: 48px;
    top: 40px;
    bottom: 24px;
    width: 280px;
    transform: translateX(-100%);
    transition: transform var(--transition-normal);
    box-shadow: var(--shadow-lg);
    z-index: 100;
  }
  
  .main-sidebar[data-visible="true"] {
    transform: translateX(0);
  }
  
  /* 中心一次只显示一个分组 */
  .center-group:not(.active) {
    display: none;
  }
  
  .group-switcher {
    display: flex;
    height: 32px;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border-default);
  }
  
  .bottom-panel[data-visible="true"] {
    height: 50vh;
  }
}
```

#### 移动模式（<768px）

- 顶栏菜单全部收入"…"
- 搜索框可折叠
- 状态栏只显示关键信息（连接状态、通知）
- 终端输入区域占据更多垂直空间

```css
@media (max-width: 767px) {
  .topbar {
    grid-template-columns: auto 1fr auto;
  }
  
  .topbar-menu {
    /* 所有菜单收入一个按钮 */
  }
  
  .topbar-search {
    width: 32px;
    transition: width var(--transition-normal);
  }
  
  .topbar-search[data-expanded="true"] {
    width: 100%;
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    height: 40px;
    background: var(--surface-1);
    z-index: 200;
  }
  
  .status-bar {
    grid-template-columns: auto 1fr auto;
    /* 只显示：连接状态 | 弹性空间 | 通知 */
  }
  
  .terminal-input {
    min-height: 120px; /* 增加移动端输入高度 */
  }
}
```

### 3.5 最小窗口尺寸

| 模式 | 最小宽度 | 最小高度 | 功能保证 |
| ------ | ---------- | ---------- | ---------- |
| 可用 | 320px | 480px | 活动栏、单分组、搜索、状态栏 |
| 推荐 | 1024px | 600px | 七区完整布局、双分组并排 |
| 最佳 | 1440px | 900px | 多分组、辅助侧栏常开、大底部面板 |

小于最小尺寸时显示提示："当前窗口过小，部分功能可能不可用。建议窗口宽度≥1024px"

---

## 4. 区域详细设计

### 4.1 顶栏 (Topbar)

**尺寸**：

- 高度：40px（固定）
- 内边距：水平 12px，垂直 0
- 分为三栏：左侧菜单区 | 中间搜索区 | 右侧控制区

**左侧菜单区**：

```css
.topbar-menu-area {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  height: 100%;
}

.topbar-menu-item {
  height: 28px;
  padding: 0 var(--space-3);
  font-size: var(--text-sm);
  font-weight: var(--font-normal);
  color: var(--text-primary);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-fast);
}

.topbar-menu-item:hover {
  background: var(--surface-3);
}

.topbar-menu-item:active,
.topbar-menu-item[aria-expanded="true"] {
  background: var(--surface-4);
}

/* 溢出菜单按钮 */
.topbar-menu-overflow {
  width: 28px;
  height: 28px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
```

**渐进折叠逻辑**：

1. 初始状态（≥1280px）：显示全部 6 个菜单

   ```
   [页面] [视图] [布局] [插件] [工具] [帮助]
   ```

2. 空间不足时（~1150px）：末尾逐项进入溢出

   ```
   [页面] [视图] [布局] [插件] […]
   ```

3. 继续压缩（~1050px）：

   ```
   [页面] [视图] [布局] […]
   ```

4. 仅剩两项且仍需压缩（~950px）：全部收起

   ```
   […]
   ```

**中间搜索区**：

```css
.topbar-search {
  flex: 1;
  max-width: 600px;
  margin: 0 auto;
  position: relative;
}

.topbar-search-input {
  width: 100%;
  height: 28px;
  padding: 0 var(--space-3) 0 var(--space-8);
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-full);
  font-size: var(--text-sm);
  color: var(--text-primary);
  transition: background var(--transition-fast),
              border-color var(--transition-fast),
              box-shadow var(--transition-fast);
}

.topbar-search-input:hover {
  background: var(--surface-3);
  border-color: var(--border-default);
}

.topbar-search-input:focus {
  background: var(--surface-4);
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 2px var(--accent-subtle);
  outline: none;
}

.topbar-search-icon {
  position: absolute;
  left: var(--space-3);
  top: 50%;
  transform: translateY(-50%);
  width: 14px;
  height: 14px;
  color: var(--text-tertiary);
  pointer-events: none;
}

/* 搜索结果面板 */
.topbar-search-results {
  position: absolute;
  top: calc(100% + var(--space-2));
  left: 0;
  right: 0;
  max-height: 480px;
  background: var(--surface-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  overflow-y: auto;
  z-index: 1000;
}
```

**右侧控制区**：

```css
.topbar-controls {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.topbar-icon-button {
  width: 28px;
  height: 28px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background var(--transition-fast),
              color var(--transition-fast);
}

.topbar-icon-button:hover {
  background: var(--surface-3);
  color: var(--text-primary);
}

.topbar-icon-button:active {
  background: var(--surface-4);
}

/* 带徽标的通知按钮 */
.topbar-icon-button[data-badge]::after {
  content: attr(data-badge);
  position: absolute;
  top: 4px;
  right: 4px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  background: var(--status-error);
  color: var(--text-inverse);
  font-size: 10px;
  font-weight: var(--font-semibold);
  line-height: 14px;
  text-align: center;
  border-radius: var(--radius-full);
  box-shadow: 0 0 0 2px var(--surface-1);
}
```

### 4.2 活动栏 (Activity Bar)

**尺寸**：

- 宽度：48px（固定）
- 按钮尺寸：40×40px
- 内边距：上下 8px，水平 4px
- 按钮间距：4px

```css
.activity-bar {
  width: 48px;
  background: var(--surface-1);
  border-right: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--space-1) var(--space-1);
  gap: var(--space-1);
}

.activity-bar-item {
  width: 40px;
  height: 40px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  background: transparent;
  border: none;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  cursor: pointer;
  position: relative;
  transition: background var(--transition-fast),
              color var(--transition-fast);
}

.activity-bar-item:hover {
  background: var(--surface-3);
  color: var(--text-primary);
}

.activity-bar-item[aria-selected="true"] {
  background: var(--surface-4);
  color: var(--accent-primary);
}

/* 激活指示器 */
.activity-bar-item[aria-selected="true"]::before {
  content: '';
  position: absolute;
  left: 0;
  top: 8px;
  bottom: 8px;
  width: 2px;
  background: var(--accent-primary);
  border-radius: 0 2px 2px 0;
}

.activity-bar-icon {
  width: 20px;
  height: 20px;
}

.activity-bar-label {
  font-size: 9px;
  font-weight: var(--font-medium);
  letter-spacing: var(--tracking-wide);
  text-transform: uppercase;
}

/* 底部固定项（设置、快捷键） */
.activity-bar-bottom {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
```

### 4.3 主侧栏 (Main Sidebar)

**尺寸**：

- 默认宽度：280px
- 可调范围：200px - 480px
- 内部上下分割：默认 60:40
- 头部高度：36px
- 内边距：12px

```css
.main-sidebar {
  width: var(--main-sidebar-width, 280px);
  background: var(--surface-1);
  border-right: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  position: relative;
}

/* 调整手柄 */
.main-sidebar-resize-handle {
  position: absolute;
  right: -2px;
  top: 0;
  bottom: 0;
  width: 4px;
  cursor: col-resize;
  z-index: 10;
  transition: background var(--transition-fast);
}

.main-sidebar-resize-handle:hover,
.main-sidebar-resize-handle[data-dragging="true"] {
  background: var(--accent-primary);
}

/* 头部工具栏 */
.sidebar-header {
  height: 36px;
  padding: 0 var(--space-3);
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.sidebar-title {
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  color: var(--text-primary);
  letter-spacing: var(--tracking-tight);
}

.sidebar-actions {
  display: flex;
  gap: var(--space-1);
}

.sidebar-action-button {
  width: 24px;
  height: 24px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background var(--transition-fast),
              color var(--transition-fast);
}

.sidebar-action-button:hover {
  background: var(--surface-3);
  color: var(--text-primary);
}

/* 搜索框 */
.sidebar-search {
  padding: var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.sidebar-search-input {
  width: 100%;
  height: 28px;
  padding: 0 var(--space-3) 0 var(--space-7);
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  color: var(--text-primary);
  transition: background var(--transition-fast),
              border-color var(--transition-fast);
}

.sidebar-search-input:focus {
  background: var(--surface-4);
  border-color: var(--accent-primary);
  outline: none;
}

/* 内容区（可上下分割） */
.sidebar-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sidebar-section {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sidebar-section-header {
  height: 24px;
  padding: 0 var(--space-3);
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--surface-0);
  flex-shrink: 0;
}

.sidebar-section-title {
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: var(--tracking-wide);
}

.sidebar-section-body {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

/* 分割器 */
.sidebar-splitter {
  height: 4px;
  background: var(--surface-0);
  cursor: row-resize;
  position: relative;
  flex-shrink: 0;
  transition: background var(--transition-fast);
}

.sidebar-splitter:hover,
.sidebar-splitter[data-dragging="true"] {
  background: var(--accent-primary);
}

.sidebar-splitter::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 32px;
  height: 2px;
  background: var(--text-tertiary);
  border-radius: 1px;
}
```

**列表项样式**：

```css
.sidebar-list-item {
  height: 28px;
  padding: 0 var(--space-3) 0 var(--space-6);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--text-primary);
  font-size: var(--text-sm);
  cursor: pointer;
  position: relative;
  transition: background var(--transition-fast);
}

.sidebar-list-item:hover {
  background: var(--surface-2);
}

.sidebar-list-item[aria-selected="true"] {
  background: var(--surface-3);
}

.sidebar-list-item[aria-selected="true"]::before {
  content: '';
  position: absolute;
  left: 0;
  top: 4px;
  bottom: 4px;
  width: 2px;
  background: var(--accent-primary);
  border-radius: 0 2px 2px 0;
}

/* 嵌套项（树结构） */
.sidebar-list-item[aria-level="2"] {
  padding-left: calc(var(--space-6) + var(--space-4));
}

.sidebar-list-item[aria-level="3"] {
  padding-left: calc(var(--space-6) + var(--space-8));
}

.sidebar-list-item-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: var(--text-secondary);
}

.sidebar-list-item-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-list-item-badge {
  padding: 0 var(--space-2);
  height: 16px;
  background: var(--surface-4);
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: var(--font-semibold);
  line-height: 16px;
  border-radius: var(--radius-full);
}

.sidebar-list-item-actions {
  display: none;
  gap: var(--space-1);
}

.sidebar-list-item:hover .sidebar-list-item-actions {
  display: flex;
}

.sidebar-list-item-action {
  width: 20px;
  height: 20px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  cursor: pointer;
  transition: background var(--transition-fast),
              color var(--transition-fast);
}

.sidebar-list-item-action:hover {
  background: var(--surface-4);
  color: var(--text-primary);
}
```

### 4.4 中心页面区 (Center)

**标签栏尺寸**：

- 高度：32px
- 标签最小宽度：80px
- 标签最大宽度：240px
- 标签间距：0（紧密排列）
- 固定标签宽度：32px（只显示图标）

```css
.center-area {
  display: flex;
  flex-direction: column;
  background: var(--surface-0);
  overflow: hidden;
}

/* 标签栏 */
.tab-bar {
  height: 32px;
  display: flex;
  align-items: stretch;
  background: var(--surface-2);
  border-bottom: 1px solid var(--border-subtle);
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
  flex-shrink: 0;
}

/* 隐藏滚动条但保持可滚动 */
.tab-bar::-webkit-scrollbar {
  height: 2px;
}

.tab-bar::-webkit-scrollbar-thumb {
  background: var(--border-default);
  border-radius: 1px;
}

.tab-bar::-webkit-scrollbar-thumb:hover {
  background: var(--border-strong);
}

/* 标签项 */
.tab-item {
  min-width: 80px;
  max-width: 240px;
  flex: 0 1 auto;
  height: 100%;
  padding: 0 var(--space-3);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  background: transparent;
  border: none;
  border-right: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  cursor: pointer;
  position: relative;
  transition: background var(--transition-fast),
              color var(--transition-fast);
}

.tab-item:hover {
  background: var(--surface-3);
  color: var(--text-primary);
}

.tab-item[aria-selected="true"] {
  background: var(--surface-0);
  color: var(--text-primary);
}

/* 激活标签底部指示器 */
.tab-item[aria-selected="true"]::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  background: var(--accent-primary);
}

.tab-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.tab-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 状态指示器（未保存） */
.tab-dirty-indicator {
  width: 6px;
  height: 6px;
  background: var(--accent-primary);
  border-radius: var(--radius-full);
  flex-shrink: 0;
}

/* 加载/休眠指示器 */
.tab-state-indicator {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.tab-close-button {
  width: 16px;
  height: 16px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  opacity: 0;
  cursor: pointer;
  transition: opacity var(--transition-fast),
              background var(--transition-fast),
              color var(--transition-fast);
}

.tab-item:hover .tab-close-button {
  opacity: 1;
}

.tab-close-button:hover {
  background: var(--surface-4);
  color: var(--text-primary);
}

/* 固定标签（只显示图标） */
.tab-item[data-pinned="true"] {
  min-width: 32px;
  max-width: 32px;
  padding: 0;
  justify-content: center;
}

.tab-item[data-pinned="true"] .tab-label {
  display: none;
}

.tab-item[data-pinned="true"] .tab-close-button {
  display: none;
}

/* 标签栏操作区 */
.tab-bar-actions {
  display: flex;
  align-items: center;
  padding: 0 var(--space-2);
  gap: var(--space-1);
  background: var(--surface-2);
  border-left: 1px solid var(--border-subtle);
  flex-shrink: 0;
}
```

**内容区（分组与 iframe）**：

```css
.center-content {
  flex: 1;
  display: flex;
  overflow: hidden;
  position: relative;
}

/* 分组容器 */
.center-group {
  display: flex;
  flex-direction: column;
  background: var(--surface-0);
  overflow: hidden;
  position: relative;
}

/* 水平分割 */
.center-split-horizontal {
  display: flex;
  flex-direction: row;
  overflow: hidden;
}

/* 垂直分割 */
.center-split-vertical {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 分割器 */
.center-splitter-vertical {
  width: 4px;
  background: var(--surface-0);
  cursor: col-resize;
  position: relative;
  flex-shrink: 0;
  transition: background var(--transition-fast);
}

.center-splitter-horizontal {
  height: 4px;
  background: var(--surface-0);
  cursor: row-resize;
  position: relative;
  flex-shrink: 0;
  transition: background var(--transition-fast);
}

.center-splitter-vertical:hover,
.center-splitter-vertical[data-dragging="true"] {
  background: var(--accent-primary);
}

.center-splitter-horizontal:hover,
.center-splitter-horizontal[data-dragging="true"] {
  background: var(--accent-primary);
}

/* 分组头部（用于拖动和操作） */
.group-header {
  height: 28px;
  padding: 0 var(--space-3);
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--surface-1);
  border-bottom: 1px solid var(--border-subtle);
  cursor: move;
  flex-shrink: 0;
}

.group-header:hover {
  background: var(--surface-2);
}

.group-title {
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  color: var(--text-secondary);
}

.group-actions {
  display: flex;
  gap: var(--space-1);
}

/* 页面容器 */
.page-container {
  flex: 1;
  position: relative;
  overflow: hidden;
}

.page-frame {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: none;
  background: var(--surface-0);
}

/* 空状态 */
.empty-group {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-4);
  color: var(--text-tertiary);
}

.empty-group-icon {
  width: 64px;
  height: 64px;
  opacity: 0.5;
}

.empty-group-text {
  font-size: var(--text-md);
  text-align: center;
}

.empty-group-actions {
  display: flex;
  gap: var(--space-3);
}
```

### 4.5 辅助侧栏 (Auxiliary Sidebar)

**尺寸**：

- 默认宽度：280px
- 可调范围：240px - 480px
- 内边距：12px

```css
.auxiliary-sidebar {
  width: var(--aux-sidebar-width, 280px);
  background: var(--surface-1);
  border-left: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

/* 调整手柄（左侧） */
.auxiliary-sidebar-resize-handle {
  position: absolute;
  left: -2px;
  top: 0;
  bottom: 0;
  width: 4px;
  cursor: col-resize;
  z-index: 10;
  transition: background var(--transition-fast);
}

.auxiliary-sidebar-resize-handle:hover,
.auxiliary-sidebar-resize-handle[data-dragging="true"] {
  background: var(--accent-primary);
}

/* 头部 */
.auxiliary-sidebar-header {
  padding: var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.auxiliary-sidebar-tab-id {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  margin-bottom: var(--space-1);
}

.auxiliary-sidebar-title {
  font-size: var(--text-md);
  font-weight: var(--font-semibold);
  color: var(--text-primary);
  margin-bottom: var(--space-1);
}

.auxiliary-sidebar-subtitle {
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

/* 标签式导航 */
.auxiliary-sidebar-tabs {
  display: flex;
  padding: 0 var(--space-3);
  gap: var(--space-1);
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.auxiliary-sidebar-tab {
  padding: var(--space-2) var(--space-3);
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  cursor: pointer;
  transition: color var(--transition-fast),
              border-color var(--transition-fast);
}

.auxiliary-sidebar-tab:hover {
  color: var(--text-primary);
}

.auxiliary-sidebar-tab[aria-selected="true"] {
  color: var(--accent-primary);
  border-bottom-color: var(--accent-primary);
}

/* 内容区 */
.auxiliary-sidebar-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: var(--space-3);
}

/* 属性组 */
.property-group {
  margin-bottom: var(--space-6);
}

.property-group:last-child {
  margin-bottom: 0;
}

.property-group-title {
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  color: var(--text-primary);
  margin-bottom: var(--space-3);
}

.property-row {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
  font-size: var(--text-sm);
}

.property-row:last-child {
  margin-bottom: 0;
}

.property-label {
  flex: 0 0 80px;
  color: var(--text-secondary);
}

.property-value {
  flex: 1;
  color: var(--text-primary);
  word-break: break-word;
}

/* 配置编辑器 */
.config-item {
  margin-bottom: var(--space-4);
  padding: var(--space-3);
  background: var(--surface-2);
  border-radius: var(--radius-md);
}

.config-item:last-child {
  margin-bottom: 0;
}

.config-item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-2);
}

.config-item-label {
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  color: var(--text-primary);
}

.config-item-description {
  font-size: var(--text-xs);
  color: var(--text-secondary);
  margin-bottom: var(--space-2);
}

.config-item-control {
  /* 输入框、选择器等表单控件样式 */
}

.config-item-actions {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-2);
}
```

### 4.6 底部面板 (Bottom Panel)

**尺寸**：

- 停靠下方时：
  - 默认高度：240px
  - 可调范围：120px - 600px
- 停靠左/右时：
  - 默认宽度：360px
  - 可调范围：280px - 640px
- 标签栏高度：32px
- 终端列表默认宽度：200px（多终端时显示）

```css
.bottom-panel {
  background: var(--surface-1);
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
}

/* 停靠下方 */
.bottom-panel[data-dock="bottom"] {
  height: var(--panel-height, 240px);
  border-top: 1px solid var(--border-subtle);
}

/* 停靠左侧 */
.bottom-panel[data-dock="left"] {
  width: var(--panel-width, 360px);
  border-right: 1px solid var(--border-subtle);
}

/* 停靠右侧 */
.bottom-panel[data-dock="right"] {
  width: var(--panel-width, 360px);
  border-left: 1px solid var(--border-subtle);
}

/* 调整手柄 */
.panel-resize-handle-top {
  position: absolute;
  left: 0;
  right: 0;
  top: -2px;
  height: 4px;
  cursor: row-resize;
  z-index: 10;
  transition: background var(--transition-fast);
}

.panel-resize-handle-left {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -2px;
  width: 4px;
  cursor: col-resize;
  z-index: 10;
  transition: background var(--transition-fast);
}

.panel-resize-handle-right {
  position: absolute;
  top: 0;
  bottom: 0;
  right: -2px;
  width: 4px;
  cursor: col-resize;
  z-index: 10;
  transition: background var(--transition-fast);
}

.panel-resize-handle-top:hover,
.panel-resize-handle-left:hover,
.panel-resize-handle-right:hover,
.panel-resize-handle-top[data-dragging="true"],
.panel-resize-handle-left[data-dragging="true"],
.panel-resize-handle-right[data-dragging="true"] {
  background: var(--accent-primary);
}

/* 标签栏 */
.panel-tab-bar {
  height: 32px;
  display: flex;
  align-items: stretch;
  background: var(--surface-2);
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.panel-tabs {
  display: flex;
  flex: 1;
}

.panel-tab {
  padding: 0 var(--space-4);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  background: transparent;
  border: none;
  border-right: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  cursor: pointer;
  transition: background var(--transition-fast),
              color var(--transition-fast);
}

.panel-tab:hover {
  background: var(--surface-3);
  color: var(--text-primary);
}

.panel-tab[aria-selected="true"] {
  background: var(--surface-1);
  color: var(--text-primary);
}

.panel-tab[aria-selected="true"]::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  background: var(--accent-primary);
}

/* 标签栏操作区 */
.panel-tab-bar-actions {
  display: flex;
  align-items: center;
  padding: 0 var(--space-2);
  gap: var(--space-1);
  border-left: 1px solid var(--border-subtle);
}

.panel-action-button {
  width: 24px;
  height: 24px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background var(--transition-fast),
              color var(--transition-fast);
}

.panel-action-button:hover {
  background: var(--surface-3);
  color: var(--text-primary);
}

.panel-action-button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* 内容区 */
.panel-content {
  flex: 1;
  display: flex;
  overflow: hidden;
}

/* 输出页 */
.output-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.output-toolbar {
  height: 32px;
  padding: 0 var(--space-3);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  background: var(--surface-2);
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.output-filter {
  display: flex;
  gap: var(--space-1);
}

.output-filter-button {
  height: 24px;
  padding: 0 var(--space-3);
  background: transparent;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  cursor: pointer;
  transition: background var(--transition-fast),
              border-color var(--transition-fast),
              color var(--transition-fast);
}

.output-filter-button:hover {
  background: var(--surface-3);
  border-color: var(--border-strong);
  color: var(--text-primary);
}

.output-filter-button[aria-pressed="true"] {
  background: var(--accent-subtle);
  border-color: var(--accent-primary);
  color: var(--accent-primary);
}

.output-content {
  flex: 1;
  padding: var(--space-3);
  overflow-y: auto;
  overflow-x: hidden;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  line-height: var(--leading-relaxed);
}

.output-line {
  display: flex;
  gap: var(--space-3);
  margin-bottom: 2px;
}

.output-line:hover {
  background: var(--surface-2);
}

.output-timestamp {
  flex-shrink: 0;
  color: var(--text-tertiary);
  user-select: none;
}

.output-level {
  flex-shrink: 0;
  width: 48px;
  font-weight: var(--font-semibold);
  text-transform: uppercase;
}

.output-level-info { color: var(--status-info); }
.output-level-warn { color: var(--status-warning); }
.output-level-error { color: var(--status-error); }
.output-level-success { color: var(--status-success); }

.output-text {
  flex: 1;
  color: var(--text-primary);
  word-break: break-word;
}

/* 终端页 */
.terminal-view {
  flex: 1;
  display: flex;
  overflow: hidden;
}

/* 终端内容区 */
.terminal-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 终端输出区 - 类似 VS Code 终端 */
.terminal-output {
  flex: 1;
  padding: var(--space-3);
  overflow-y: auto;
  overflow-x: hidden;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  background: var(--surface-0);
  position: relative;
}

/* 终端输出行 */
.terminal-output-line {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  margin-bottom: 2px;
  white-space: pre-wrap;
  word-break: break-word;
}

/* 命令提示符 */
.terminal-output-line[data-type="prompt"] {
  color: var(--accent-primary);
  font-weight: var(--font-semibold);
}

.terminal-output-line[data-type="prompt"]::before {
  content: '>';
  color: var(--accent-primary);
  margin-right: var(--space-1);
}

/* 命令输入回显（历史记录） */
.terminal-output-line[data-type="command"] {
  color: var(--text-primary);
}

/* 命令输出 */
.terminal-output-line[data-type="output"] {
  color: var(--text-secondary);
}

/* 错误输出 */
.terminal-output-line[data-type="error"] {
  color: var(--status-error);
}

/* 警告输出 */
.terminal-output-line[data-type="warning"] {
  color: var(--status-warning);
}

/* 信息输出 */
.terminal-output-line[data-type="info"] {
  color: var(--status-info);
}

/* 成功输出 */
.terminal-output-line[data-type="success"] {
  color: var(--status-success);
}

/* 顶部置顶命令 - 类似 projects/terminal */
.terminal-pinned-command {
  position: sticky;
  top: 0;
  z-index: 10;
  padding: var(--space-2) var(--space-3);
  background: var(--surface-2);
  border-bottom: 1px solid var(--border-default);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.terminal-pinned-command::before {
  content: '>';
  color: var(--accent-primary);
  font-weight: var(--font-semibold);
}

.terminal-pinned-command-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 还原的历史记录提示 */
.terminal-restored-indicator {
  display: inline-block;
  margin-left: var(--space-2);
  padding: 0 var(--space-2);
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  background: var(--surface-3);
  border-radius: var(--radius-sm);
}

/* 终端输入区域 - 多行输入设计 */
.terminal-input-area {
  flex-shrink: 0;
  border-top: 1px solid var(--border-subtle);
  background: var(--surface-0);
  display: flex;
  flex-direction: column;
  min-height: 40px;
  max-height: 50vh;
}

/* 命令提示行 */
.terminal-input-prompt-line {
  display: flex;
  align-items: center;
  padding: var(--space-2) var(--space-3);
  gap: var(--space-2);
  background: var(--surface-0);
  border-bottom: 1px solid var(--border-subtle);
}

.terminal-input-prompt {
  color: var(--accent-primary);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  user-select: none;
}

.terminal-input-prompt::after {
  content: '>';
  margin-left: var(--space-1);
}

/* 多行输入编辑器 */
.terminal-input-editor {
  flex: 1;
  min-height: 0;
  padding: var(--space-3);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  color: var(--text-primary);
  background: var(--surface-0);
  border: none;
  resize: none;
  overflow-y: auto;
  white-space: pre;
  word-break: normal;
}

.terminal-input-editor:focus {
  outline: none;
}

/* 命令补全候选列表 */
.terminal-completion-list {
  max-height: 200px;
  overflow-y: auto;
  background: var(--surface-1);
  border-top: 1px solid var(--border-default);
}

.terminal-completion-item {
  padding: var(--space-2) var(--space-3);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  cursor: pointer;
  transition: background var(--transition-fast);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
}

.terminal-completion-item:hover {
  background: var(--surface-2);
}

.terminal-completion-item[data-selected="true"] {
  background: var(--surface-3);
  color: var(--accent-primary);
}

.terminal-completion-item-name {
  flex: 1;
  color: var(--text-primary);
  font-weight: var(--font-medium);
}

.terminal-completion-item-description {
  flex: 0 0 auto;
  max-width: 50%;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 输入状态栏 */
.terminal-input-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-3);
  height: 24px;
  background: var(--surface-1);
  border-top: 1px solid var(--border-subtle);
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.terminal-input-status-left {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.terminal-input-status-right {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

/* 多行输入指示器 */
.terminal-multiline-indicator {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  color: var(--text-secondary);
}

.terminal-multiline-indicator-icon {
  width: 12px;
  height: 12px;
}

/* 终端列表（多终端时显示） */
.terminal-list {
  width: 200px;
  background: var(--surface-2);
  border-left: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  flex-shrink: 0;
}

.terminal-list-header {
  height: 32px;
  padding: 0 var(--space-3);
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.terminal-list-title {
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  color: var(--text-secondary);
  text-transform: uppercase;
}

.terminal-list-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

.terminal-list-item {
  height: 48px;
  padding: var(--space-2) var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  cursor: pointer;
  position: relative;
  transition: background var(--transition-fast);
}

.terminal-list-item:hover {
  background: var(--surface-3);
}

.terminal-list-item[aria-selected="true"] {
  background: var(--surface-1);
}

.terminal-list-item[aria-selected="true"]::before {
  content: '';
  position: absolute;
  left: 0;
  top: 8px;
  bottom: 8px;
  width: 2px;
  background: var(--accent-primary);
  border-radius: 0 2px 2px 0;
}

.terminal-list-item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.terminal-list-item-name {
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.terminal-list-item-actions {
  display: none;
  gap: var(--space-1);
}

.terminal-list-item:hover .terminal-list-item-actions {
  display: flex;
}

.terminal-list-item-status {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.terminal-list-item-state-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
}

.terminal-list-item-state-dot[data-state="idle"] {
  background: var(--text-tertiary);
}

.terminal-list-item-state-dot[data-state="running"] {
  background: var(--state-running);
  animation: pulse 2s ease-in-out infinite;
}

.terminal-list-item-state-dot[data-state="waiting"] {
  background: var(--status-warning);
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.terminal-list-item-unread {
  padding: 0 var(--space-2);
  height: 16px;
  background: var(--accent-primary);
  color: var(--text-inverse);
  font-size: 10px;
  font-weight: var(--font-semibold);
  line-height: 16px;
  border-radius: var(--radius-full);
}
```

### 4.7 状态栏 (Status Bar)

**尺寸**：

- 高度：24px（固定）
- 内边距：水平 8px
- 项目间距：8px
- 分隔符：1px 垂直线

```css
.status-bar {
  height: 24px;
  padding: 0 var(--space-2);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  background: var(--surface-2);
  border-top: 1px solid var(--border-subtle);
  font-size: var(--text-xs);
}

.status-bar-left {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.status-bar-center {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  overflow: hidden;
}

.status-bar-right {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.status-bar-item {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: 0 var(--space-2);
  height: 20px;
  color: var(--text-secondary);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-fast),
              color var(--transition-fast);
  white-space: nowrap;
}

.status-bar-item:hover {
  background: var(--surface-3);
  color: var(--text-primary);
}

.status-bar-item[data-active="true"] {
  color: var(--accent-primary);
}

.status-bar-item-icon {
  width: 12px;
  height: 12px;
}

.status-bar-separator {
  width: 1px;
  height: 14px;
  background: var(--border-default);
  flex-shrink: 0;
}

/* 连接状态 */
.status-connection {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.status-connection-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
}

.status-connection-dot[data-status="connected"] {
  background: var(--status-success);
}

.status-connection-dot[data-status="connecting"] {
  background: var(--status-warning);
  animation: pulse 2s ease-in-out infinite;
}

.status-connection-dot[data-status="disconnected"] {
  background: var(--status-error);
}

/* 浏览器操作区 */
.status-browser-controls {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.status-nav-button {
  width: 20px;
  height: 20px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background var(--transition-fast),
              color var(--transition-fast);
}

.status-nav-button:hover:not(:disabled) {
  background: var(--surface-3);
  color: var(--text-primary);
}

.status-nav-button:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

/* URL 输入框 */
.status-url-input {
  flex: 1;
  min-width: 200px;
  max-width: 600px;
  height: 20px;
  padding: 0 var(--space-2);
  background: var(--surface-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  font-family: var(--font-mono);
  color: var(--text-primary);
  transition: background var(--transition-fast),
              border-color var(--transition-fast);
}

.status-url-input:hover {
  background: var(--surface-4);
  border-color: var(--border-default);
}

.status-url-input:focus {
  background: var(--surface-0);
  border-color: var(--accent-primary);
  outline: none;
}

/* 通知按钮 */
.status-notification-button {
  position: relative;
}

.status-notification-button[data-count]::after {
  content: attr(data-count);
  position: absolute;
  top: 0;
  right: 0;
  min-width: 12px;
  height: 12px;
  padding: 0 2px;
  background: var(--status-error);
  color: var(--text-inverse);
  font-size: 9px;
  font-weight: var(--font-semibold);
  line-height: 12px;
  text-align: center;
  border-radius: var(--radius-full);
  box-shadow: 0 0 0 1px var(--surface-2);
}
```

---

## 5. 组件库

### 5.1 按钮 (Buttons)

```css
/* 基础按钮 */
.btn {
  height: 28px;
  padding: 0 var(--space-4);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  font-family: var(--font-sans);
  border: none;
  border-radius: var(--radius-full);
  cursor: pointer;
  transition: background var(--transition-fast),
              color var(--transition-fast),
              box-shadow var(--transition-fast);
  white-space: nowrap;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 主要按钮 */
.btn-primary {
  background: var(--accent-primary);
  color: var(--text-inverse);
}

.btn-primary:hover:not(:disabled) {
  background: var(--accent-hover);
}

.btn-primary:active:not(:disabled) {
  background: var(--accent-pressed);
}

.btn-primary:focus-visible {
  box-shadow: 0 0 0 2px var(--accent-subtle);
  outline: none;
}

/* 次要按钮 */
.btn-secondary {
  background: var(--surface-3);
  color: var(--text-primary);
  border: 1px solid var(--border-default);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--surface-4);
  border-color: var(--border-strong);
}

.btn-secondary:focus-visible {
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 1px var(--accent-primary);
  outline: none;
}

/* 幽灵按钮 */
.btn-ghost {
  background: transparent;
  color: var(--text-secondary);
}

.btn-ghost:hover:not(:disabled) {
  background: var(--surface-3);
  color: var(--text-primary);
}

/* 危险按钮 */
.btn-danger {
  background: var(--status-error);
  color: var(--text-inverse);
}

.btn-danger:hover:not(:disabled) {
  background: #DC2626;
}

/* 图标按钮 */
.btn-icon {
  width: 28px;
  height: 28px;
  padding: 0;
}

.btn-icon-sm {
  width: 24px;
  height: 24px;
}

.btn-icon-lg {
  width: 32px;
  height: 32px;
}

/* 按钮组 */
.btn-group {
  display: inline-flex;
  gap: var(--space-2);
}

.btn-group-compact {
  gap: 0;
}

.btn-group-compact .btn:not(:first-child) {
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
}

.btn-group-compact .btn:not(:last-child) {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
  border-right: 1px solid var(--border-subtle);
}
```

### 5.2 输入框 (Inputs)

```css
/* 文本输入 */
.input {
  height: 28px;
  padding: 0 var(--space-3);
  background: var(--surface-2);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  font-family: var(--font-sans);
  color: var(--text-primary);
  transition: background var(--transition-fast),
              border-color var(--transition-fast),
              box-shadow var(--transition-fast);
}

.input::placeholder {
  color: var(--text-tertiary);
}

.input:hover:not(:disabled) {
  background: var(--surface-3);
  border-color: var(--border-strong);
}

.input:focus {
  background: var(--surface-4);
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 2px var(--accent-subtle);
  outline: none;
}

.input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.input-error {
  border-color: var(--status-error);
}

.input-error:focus {
  box-shadow: 0 0 0 2px var(--status-error-bg);
}

/* 文本域 */
.textarea {
  min-height: 80px;
  padding: var(--space-2) var(--space-3);
  resize: vertical;
  line-height: var(--leading-normal);
}

/* 输入组 */
.input-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.input-label {
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  color: var(--text-primary);
}

.input-hint {
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.input-error-message {
  font-size: var(--text-xs);
  color: var(--status-error);
}

/* 搜索框 */
.input-search {
  padding-left: var(--space-8);
  background-image: url("data:image/svg+xml,..."); /* 搜索图标 */
  background-repeat: no-repeat;
  background-position: var(--space-3) center;
  background-size: 14px 14px;
}

/* 选择器 */
.select {
  height: 28px;
  padding: 0 var(--space-7) 0 var(--space-3);
  appearance: none;
  background: var(--surface-2);
  background-image: url("data:image/svg+xml,..."); /* 下拉箭头 */
  background-repeat: no-repeat;
  background-position: right var(--space-3) center;
  background-size: 12px 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  color: var(--text-primary);
  cursor: pointer;
  transition: background var(--transition-fast),
              border-color var(--transition-fast);
}

.select:hover:not(:disabled) {
  background-color: var(--surface-3);
  border-color: var(--border-strong);
}

.select:focus {
  background-color: var(--surface-4);
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 2px var(--accent-subtle);
  outline: none;
}

/* 复选框 */
.checkbox {
  width: 16px;
  height: 16px;
  appearance: none;
  background: var(--surface-2);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-fast),
              border-color var(--transition-fast);
}

.checkbox:hover:not(:disabled) {
  background: var(--surface-3);
  border-color: var(--border-strong);
}

.checkbox:checked {
  background: var(--accent-primary);
  border-color: var(--accent-primary);
  background-image: url("data:image/svg+xml,..."); /* 勾选标记 */
  background-repeat: no-repeat;
  background-position: center;
  background-size: 10px 10px;
}

.checkbox:focus-visible {
  box-shadow: 0 0 0 2px var(--accent-subtle);
  outline: none;
}

/* 开关 */
.switch {
  width: 36px;
  height: 20px;
  appearance: none;
  background: var(--surface-3);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
  cursor: pointer;
  position: relative;
  transition: background var(--transition-normal),
              border-color var(--transition-normal);
}

.switch::before {
  content: '';
  position: absolute;
  left: 2px;
  top: 2px;
  width: 14px;
  height: 14px;
  background: var(--text-inverse);
  border-radius: var(--radius-full);
  transition: transform var(--transition-normal);
}

.switch:checked {
  background: var(--accent-primary);
  border-color: var(--accent-primary);
}

.switch:checked::before {
  transform: translateX(16px);
}

.switch:focus-visible {
  box-shadow: 0 0 0 2px var(--accent-subtle);
  outline: none;
}
```

### 5.3 卡片 (Cards)

```css
.card {
  background: var(--surface-1);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  transition: box-shadow var(--transition-fast);
}

.card:hover {
  box-shadow: var(--shadow-md);
}

.card-interactive {
  cursor: pointer;
  transition: background var(--transition-fast),
              box-shadow var(--transition-fast);
}

.card-interactive:hover {
  background: var(--surface-2);
  box-shadow: var(--shadow-md);
}

.card-interactive:active {
  background: var(--surface-3);
}

.card-header {
  margin-bottom: var(--space-3);
}

.card-title {
  font-size: var(--text-md);
  font-weight: var(--font-semibold);
  color: var(--text-primary);
  margin-bottom: var(--space-1);
}

.card-subtitle {
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.card-body {
  font-size: var(--text-sm);
  color: var(--text-primary);
  line-height: var(--leading-relaxed);
}

.card-footer {
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px solid var(--border-subtle);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
```

### 5.4 徽标 (Badges)

```css
.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 18px;
  padding: 0 var(--space-2);
  font-size: 11px;
  font-weight: var(--font-semibold);
  line-height: 1;
  border-radius: var(--radius-full);
  white-space: nowrap;
}

.badge-default {
  background: var(--surface-4);
  color: var(--text-secondary);
}

.badge-primary {
  background: var(--accent-subtle);
  color: var(--accent-primary);
}

.badge-success {
  background: var(--status-success-bg);
  color: var(--status-success);
}

.badge-warning {
  background: var(--status-warning-bg);
  color: var(--status-warning);
}

.badge-error {
  background: var(--status-error-bg);
  color: var(--status-error);
}

.badge-dot {
  padding-left: var(--space-1);
  gap: var(--space-1);
}

.badge-dot::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: currentColor;
}
```

### 5.5 通知提示 (Toasts)

```css
.toast-container {
  position: fixed;
  bottom: var(--space-6);
  right: var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  z-index: 9999;
  pointer-events: none;
}

.toast {
  min-width: 320px;
  max-width: 480px;
  padding: var(--space-4);
  background: var(--surface-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  display: flex;
  gap: var(--space-3);
  pointer-events: auto;
  animation: toast-in var(--duration-normal) var(--ease-decelerate);
}

@keyframes toast-in {
  from {
    transform: translateY(100%);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.toast-icon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}

.toast-content {
  flex: 1;
}

.toast-title {
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  color: var(--text-primary);
  margin-bottom: var(--space-1);
}

.toast-message {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  line-height: var(--leading-normal);
}

.toast-close {
  width: 20px;
  height: 20px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  cursor: pointer;
  flex-shrink: 0;
  transition: background var(--transition-fast),
              color var(--transition-fast);
}

.toast-close:hover {
  background: var(--surface-3);
  color: var(--text-primary);
}

/* 类型变体 */
.toast-success .toast-icon { color: var(--status-success); }
.toast-warning .toast-icon { color: var(--status-warning); }
.toast-error .toast-icon { color: var(--status-error); }
.toast-info .toast-icon { color: var(--status-info); }
```

### 5.6 上下文菜单 (Context Menu)

```css
.context-menu-overlay {
  position: fixed;
  inset: 0;
  z-index: 8000;
}

.context-menu {
  position: fixed;
  min-width: 200px;
  max-width: 320px;
  max-height: 480px;
  background: var(--surface-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-menu);
  padding: var(--space-1);
  overflow-y: auto;
  z-index: 8001;
  animation: menu-in var(--duration-fast) var(--ease-decelerate);
}

@keyframes menu-in {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.context-menu-item {
  height: 28px;
  padding: 0 var(--space-3);
  display: flex;
  align-items: center;
  gap: var(--space-3);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: background var(--transition-fast);
  width: 100%;
  text-align: left;
}

.context-menu-item:hover:not(:disabled) {
  background: var(--surface-3);
}

.context-menu-item:disabled {
  color: var(--text-disabled);
  cursor: not-allowed;
}

.context-menu-item-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.context-menu-item-label {
  flex: 1;
}

.context-menu-item-shortcut {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  font-family: var(--font-mono);
}

.context-menu-item-submenu-arrow {
  width: 12px;
  height: 12px;
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.context-menu-separator {
  height: 1px;
  margin: var(--space-1) 0;
  background: var(--border-subtle);
}

.context-menu-header {
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: var(--tracking-wide);
}

/* 复选菜单项 */
.context-menu-item-checkbox {
  padding-left: var(--space-7);
  position: relative;
}

.context-menu-item-checkbox[aria-checked="true"]::before {
  content: '';
  position: absolute;
  left: var(--space-3);
  top: 50%;
  transform: translateY(-50%);
  width: 12px;
  height: 12px;
  background-image: url("data:image/svg+xml,..."); /* 勾选标记 */
  background-repeat: no-repeat;
  background-position: center;
  background-size: contain;
}
```

---

## 6. 侧栏位置变化设计

### 6.1 主/辅助侧栏互换

**默认布局（主侧栏在左）**：

```
活动栏(48px) | 主侧栏(280px) | 中心区 | 辅助侧栏(280px)
```

**交换后布局（主侧栏在右）**：

```
辅助侧栏(280px) | 中心区 | 主侧栏(280px) | 活动栏(48px)
```

**规则**：

- 主侧栏始终与活动栏相邻
- 活动栏始终在主侧栏的左侧（即使主侧栏在右）
- 辅助侧栏始终在对侧
- 布局切换时，所有内容（包括打开的页面、收藏、历史）保持不变

```css
.workbench[data-main-sidebar="left"] {
  grid-template-columns: 
    48px                           /* 活动栏 */
    var(--main-sidebar-width)      /* 主侧栏 */
    1fr                            /* 中心 */
    var(--aux-sidebar-width);      /* 辅助侧栏 */
}

.workbench[data-main-sidebar="right"] {
  grid-template-columns: 
    var(--aux-sidebar-width)       /* 辅助侧栏 */
    1fr                            /* 中心 */
    var(--main-sidebar-width)      /* 主侧栏 */
    48px;                          /* 活动栏 */
}

/* 活动栏指示器始终在主侧栏一侧 */
.workbench[data-main-sidebar="left"] .activity-bar-item[aria-selected="true"]::before {
  left: 0;
  border-radius: 0 2px 2px 0;
}

.workbench[data-main-sidebar="right"] .activity-bar-item[aria-selected="true"]::before {
  left: auto;
  right: 0;
  border-radius: 2px 0 0 2px;
}

/* 主侧栏调整手柄位置 */
.workbench[data-main-sidebar="left"] .main-sidebar-resize-handle {
  right: -2px;
}

.workbench[data-main-sidebar="right"] .main-sidebar-resize-handle {
  right: auto;
  left: -2px;
}
```

### 6.2 标签栏位置变化

**默认位置（上方）**：

```
┌──────────────────────┐
│ 标签栏 (32px)         │
├──────────────────────┤
│                      │
│ 页面内容区            │
│                      │
└──────────────────────┘
```

**其他位置**：

```css
/* 标签栏在下方 */
.center-group[data-tab-bar-position="bottom"] {
  flex-direction: column-reverse;
}

.center-group[data-tab-bar-position="bottom"] .tab-bar {
  border-bottom: none;
  border-top: 1px solid var(--border-subtle);
}

.center-group[data-tab-bar-position="bottom"] .tab-item[aria-selected="true"]::after {
  bottom: auto;
  top: 0;
}

/* 标签栏在左侧 */
.center-group[data-tab-bar-position="left"] {
  flex-direction: row;
}

.center-group[data-tab-bar-position="left"] .tab-bar {
  width: 48px;
  height: auto;
  flex-direction: column;
  border-bottom: none;
  border-right: 1px solid var(--border-subtle);
  overflow-y: auto;
  overflow-x: hidden;
}

.center-group[data-tab-bar-position="left"] .tab-item {
  width: 100%;
  min-width: 48px;
  max-width: 48px;
  height: 48px;
  flex-direction: column;
  padding: var(--space-2);
  border-right: none;
  border-bottom: 1px solid var(--border-subtle);
  writing-mode: horizontal-tb;
}

.center-group[data-tab-bar-position="left"] .tab-label {
  display: none; /* 只显示图标 */
}

.center-group[data-tab-bar-position="left"] .tab-item[aria-selected="true"]::after {
  bottom: 0;
  top: 0;
  left: 0;
  right: auto;
  width: 2px;
  height: auto;
}

/* 标签栏在右侧 */
.center-group[data-tab-bar-position="right"] {
  flex-direction: row-reverse;
}

.center-group[data-tab-bar-position="right"] .tab-bar {
  width: 48px;
  height: auto;
  flex-direction: column;
  border-bottom: none;
  border-left: 1px solid var(--border-subtle);
  overflow-y: auto;
  overflow-x: hidden;
}

.center-group[data-tab-bar-position="right"] .tab-item {
  width: 100%;
  min-width: 48px;
  max-width: 48px;
  height: 48px;
  flex-direction: column;
  padding: var(--space-2);
  border-right: none;
  border-bottom: 1px solid var(--border-subtle);
}

.center-group[data-tab-bar-position="right"] .tab-label {
  display: none;
}

.center-group[data-tab-bar-position="right"] .tab-item[aria-selected="true"]::after {
  bottom: 0;
  top: 0;
  left: auto;
  right: 0;
  width: 2px;
  height: auto;
}
```

### 6.3 底部面板停靠变化

**停靠下方（默认）**：

```css
.workbench[data-panel-dock="bottom"] .bottom-panel {
  grid-column: 1 / -1;
  grid-row: 3;
  height: var(--panel-height);
  border-top: 1px solid var(--border-subtle);
}
```

**停靠左侧**：

```css
.workbench[data-panel-dock="left"] {
  grid-template-columns: 
    var(--panel-width)             /* 底部面板（左侧）*/
    48px                           /* 活动栏 */
    var(--main-sidebar-width)      /* 主侧栏 */
    1fr                            /* 中心 */
    var(--aux-sidebar-width);      /* 辅助侧栏 */
}

.workbench[data-panel-dock="left"] .bottom-panel {
  grid-column: 1;
  grid-row: 2;
  width: var(--panel-width);
  border-top: none;
  border-right: 1px solid var(--border-subtle);
}

/* 终端列表在右侧 */
.workbench[data-panel-dock="left"] .terminal-list {
  border-left: none;
  border-right: 1px solid var(--border-subtle);
  order: -1; /* 放到左边 */
}
```

**停靠右侧**：

```css
.workbench[data-panel-dock="right"] {
  grid-template-columns: 
    48px                           /* 活动栏 */
    var(--main-sidebar-width)      /* 主侧栏 */
    1fr                            /* 中心 */
    var(--aux-sidebar-width)       /* 辅助侧栏 */
    var(--panel-width);            /* 底部面板（右侧）*/
}

.workbench[data-panel-dock="right"] .bottom-panel {
  grid-column: 5;
  grid-row: 2;
  width: var(--panel-width);
  border-top: none;
  border-left: 1px solid var(--border-subtle);
}

/* 终端列表在左侧 */
.workbench[data-panel-dock="right"] .terminal-list {
  border-left: 1px solid var(--border-subtle);
  border-right: none;
  order: -1;
}
```

---

## 7. 插件管理卡片设计

### 7.1 插件卡片布局

```css
.plugin-card {
  padding: var(--space-4);
  background: var(--surface-1);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  transition: box-shadow var(--transition-fast),
              background var(--transition-fast);
}

.plugin-card:hover {
  background: var(--surface-2);
  box-shadow: var(--shadow-md);
}

.plugin-card-header {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
}

.plugin-card-icon {
  width: 40px;
  height: 40px;
  background: var(--surface-3);
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.plugin-card-info {
  flex: 1;
  min-width: 0;
}

.plugin-card-title-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-1);
}

.plugin-card-title {
  font-size: var(--text-md);
  font-weight: var(--font-semibold);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plugin-card-favorite {
  width: 16px;
  height: 16px;
  color: var(--status-warning);
  flex-shrink: 0;
}

.plugin-card-meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.plugin-card-version,
.plugin-card-pid {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.plugin-card-description {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  line-height: var(--leading-normal);
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.plugin-card-status {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.plugin-status-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  height: 20px;
  padding: 0 var(--space-2);
  font-size: 11px;
  font-weight: var(--font-semibold);
  border-radius: var(--radius-full);
}

.plugin-status-badge-running {
  background: var(--status-success-bg);
  color: var(--status-success);
}

.plugin-status-badge-starting {
  background: var(--status-warning-bg);
  color: var(--status-warning);
}

.plugin-status-badge-stopped {
  background: var(--surface-4);
  color: var(--text-tertiary);
}

.plugin-status-badge-error {
  background: var(--status-error-bg);
  color: var(--status-error);
}

.plugin-status-badge-building {
  background: rgba(139, 92, 246, 0.15);
  color: #8B5CF6;
}

.plugin-status-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: currentColor;
}

.plugin-card-actions {
  display: flex;
  gap: var(--space-2);
}

.plugin-card-primary-action {
  flex: 1;
}

.plugin-card-menu-button {
  flex-shrink: 0;
}
```

### 7.2 插件列表视图

```css
.plugin-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: var(--space-4);
  padding: var(--space-4);
}

@media (max-width: 1023px) {
  .plugin-list {
    grid-template-columns: 1fr;
  }
}

.plugin-list-toolbar {
  height: 40px;
  padding: 0 var(--space-4);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
  background: var(--surface-1);
  position: sticky;
  top: 0;
  z-index: 10;
}

.plugin-list-filters {
  display: flex;
  gap: var(--space-2);
}

.plugin-list-sort {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.plugin-list-sort-label {
  font-size: var(--text-sm);
  color: var(--text-secondary);
}
```

---

## 8. 无障碍与键盘导航

### 8.1 焦点环

```css
:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}

.focus-within-only:focus-visible {
  outline: none;
}

.focus-within-only:focus-within {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}

/* 对于深色背景，使用更亮的焦点环 */
[data-theme="dark-2026"] :focus-visible {
  outline-color: var(--accent-hover);
}
```

### 8.2 跳过导航

```css
.skip-nav {
  position: fixed;
  top: -100px;
  left: var(--space-4);
  padding: var(--space-3) var(--space-4);
  background: var(--accent-primary);
  color: var(--text-inverse);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  border-radius: var(--radius-md);
  text-decoration: none;
  z-index: 10000;
  transition: top var(--transition-fast);
}

.skip-nav:focus {
  top: var(--space-4);
}
```

### 8.3 屏幕阅读器文本

```css
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}

.sr-only-focusable:focus,
.sr-only-focusable:active {
  position: static;
  width: auto;
  height: auto;
  overflow: visible;
  clip: auto;
  white-space: normal;
}
```

### 8.4 Roving Tabindex

```css
/* 列表容器 */
[role="list"][data-navigation="roving"] {
  /* 容器本身不可聚焦 */
  outline: none;
}

/* 列表项 */
[role="listitem"][tabindex="0"] {
  /* 当前可聚焦项 */
}

[role="listitem"][tabindex="-1"] {
  /* 其他项不在 tab 序列中 */
}

[role="listitem"][aria-selected="true"] {
  /* 选中状态视觉反馈 */
}
```

---

## 9. 动画与微交互

### 9.1 页面加载

```css
.page-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-0);
  z-index: 100;
}

.page-loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--border-default);
  border-top-color: var(--accent-primary);
  border-radius: var(--radius-full);
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.page-loading-text {
  margin-top: var(--space-4);
  font-size: var(--text-sm);
  color: var(--text-secondary);
}
```

### 9.2 骨架屏

```css
.skeleton {
  background: linear-gradient(
    90deg,
    var(--surface-2) 0%,
    var(--surface-3) 50%,
    var(--surface-2) 100%
  );
  background-size: 200% 100%;
  animation: skeleton-loading 1.5s ease-in-out infinite;
  border-radius: var(--radius-sm);
}

@keyframes skeleton-loading {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.skeleton-text {
  height: 1em;
  margin-bottom: var(--space-2);
}

.skeleton-text-last {
  width: 60%;
}

.skeleton-avatar {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-full);
}

.skeleton-card {
  height: 120px;
}
```

### 9.3 拖拽反馈

```css
.drag-preview {
  position: fixed;
  pointer-events: none;
  z-index: 9999;
  opacity: 0.8;
  transform: rotate(-2deg);
  box-shadow: var(--shadow-lg);
}

.drag-target-valid {
  outline: 2px dashed var(--accent-primary);
  outline-offset: 4px;
  background: var(--accent-subtle);
}

.drag-target-invalid {
  outline: 2px dashed var(--status-error);
  outline-offset: 4px;
  background: var(--status-error-bg);
  cursor: not-allowed;
}

.drag-insert-indicator {
  position: absolute;
  height: 2px;
  background: var(--accent-primary);
  box-shadow: 0 0 4px var(--accent-primary);
  pointer-events: none;
  z-index: 100;
}

.drag-insert-indicator::before,
.drag-insert-indicator::after {
  content: '';
  position: absolute;
  top: -3px;
  width: 8px;
  height: 8px;
  background: var(--accent-primary);
  border-radius: var(--radius-full);
}

.drag-insert-indicator::before {
  left: -4px;
}

.drag-insert-indicator::after {
  right: -4px;
}
```

---

## 10. 打印样式

```css
@media print {
  /* 隐藏不必要的 UI */
  .topbar,
  .activity-bar,
  .main-sidebar,
  .auxiliary-sidebar,
  .bottom-panel,
  .status-bar,
  .tab-bar,
  .btn,
  .context-menu {
    display: none !important;
  }
  
  /* 重置颜色为打印友好 */
  :root {
    --surface-0: #ffffff;
    --surface-1: #ffffff;
    --text-primary: #000000;
    --text-secondary: #666666;
    --border-default: #cccccc;
  }
  
  .center-area {
    position: static;
    width: 100%;
    height: auto;
  }
  
  /* 展开所有可折叠内容 */
  [aria-expanded="false"] {
    display: block !important;
    aria-expanded: true;
  }
  
  /* 移除阴影和圆角 */
  * {
    box-shadow: none !important;
    border-radius: 0 !important;
  }
  
  /* 确保链接可见 */
  a[href]::after {
    content: " (" attr(href) ")";
    font-size: 0.8em;
    color: #666666;
  }
}
```

---

## 11. 实施检查清单

### 11.1 视觉验收

| 项目 | 验收标准 |
| ------ | ---------- |
| 深色主题 | 表面层级清晰可辨，对比度符合 WCAG AA |
| 浅色主题 | 表面层级清晰可辨，对比度符合 WCAG AA |
| 跟随系统 | 根据操作系统主题自动切换，切换过渡平滑 |
| 强调色 | 青色主色在深浅主题下都有足够对比度 |
| 状态色 | 成功/警告/错误/信息四色在两种主题下都清晰 |
| 圆角 | 按钮完全圆润（pill），卡片/面板使用 12px 圆角 |
| 阴影 | 菜单/模态框阴影层次正确，不过度突出 |

### 11.2 布局验收

| 项目 | 验收标准 |
| ------ | ---------- |
| 七区布局 | 顶栏、活动栏、主侧栏、中心、辅助侧栏、底部面板、状态栏全部正确显示 |
| 主侧栏左右切换 | 活动栏始终跟随主侧栏，指示器方向正确 |
| 标签栏位置 | 上/下/左/右四个位置都可正确显示，激活指示器位置正确 |
| 底部面板停靠 | 下/左/右三个停靠位置都可正确显示，终端列表位置正确 |
| 分割调整 | 主侧栏、辅助侧栏、底部面板、中心分组都可拖动调整，有最小/最大限制 |
| 响应式 | 1280px+/1024-1279px/768-1023px/<768px 四个断点行为正确 |

### 11.3 组件验收

| 项目 | 验收标准 |
| ------ | ---------- |
| 按钮 | 主要/次要/幽灵/危险/图标五种变体，悬停/激活/禁用状态正确 |
| 输入框 | 普通/搜索/选择器/复选/开关，焦点环清晰可见 |
| 卡片 | 基础/可交互两种，悬停有阴影提升 |
| 徽标 | 默认/主要/成功/警告/错误五种，带点变体正确 |
| 通知提示 | 四种类型图标颜色正确，动画流畅，可关闭 |
| 上下文菜单 | 定位正确，溢出滚动，子菜单展开方向正确，复选项/分隔符/快捷键显示正确 |

### 11.4 交互验收

| 项目 | 验收标准 |
| ------ | ---------- |
| 键盘导航 | Tab 序列合理，焦点环清晰，Escape 关闭模态框/菜单 |
| 屏幕阅读器 | 所有交互元素有可访问名称，状态变化有 aria 属性更新 |
| Roving Tabindex | 列表内方向键导航，Enter/Space 选择 |
| 拖拽 | 标签拖拽有预览和插入指示器，跨组拖拽正确 |
| 加载状态 | 骨架屏/加载动画在适当时机显示，不闪烁 |
| 减少动画 | 尊重 prefers-reduced-motion，关键动画时长归零 |

### 11.5 浏览器兼容性

| 浏览器 | 最低版本 | 验收重点 |
| -------- | ---------- | ---------- |
| Chrome | 96+ | Grid 布局、自定义属性、容器查询 |
| Firefox | 94+ | Grid 布局、showPicker 降级 |
| Safari | 15+ | Grid 布局、焦点环、输入框样式 |
| Edge | 96+ | 同 Chrome |

---

## 12. 附录：Token 速查表

### 12.1 表面（深色主题）

```
--surface-0: #05070C  (3%)  应用背景
--surface-1: #0A0D12  (5%)  主侧栏、底部面板
--surface-2: #0F131C  (7%)  标签栏
--surface-3: #161D2B  (10%) 悬停
--surface-4: #1E2636  (13%) 激活态
--surface-elevated: #252D3F  弹层
--surface-overlay: rgba(0,0,0,0.85)  遮罩
```

### 12.2 文字

```
--text-primary: rgba(255,255,255,0.92)  主要文字
--text-secondary: rgba(255,255,255,0.65)  次要文字
--text-tertiary: rgba(255,255,255,0.45)  辅助文字
--text-disabled: rgba(255,255,255,0.28)  禁用文字
--text-inverse: rgba(0,0,0,0.87)  反色文字
```

### 12.3 强调色

```
--accent-primary: #38BDF8  主操作
--accent-hover: #7DD3FC  悬停
--accent-pressed: #0EA5E9  按下
--accent-subtle: rgba(56,189,248,0.15)  淡背景
--accent-secondary: #6EE7B7  辅助色
```

### 12.4 状态色

```
--status-success: #10B981  成功
--status-warning: #F59E0B  警告
--status-error: #EF4444  错误
--status-info: #38BDF8  信息
```

### 12.5 间距

```
--space-1: 4px
--space-2: 8px   (基准)
--space-3: 12px
--space-4: 16px
--space-5: 20px
--space-6: 24px
--space-8: 32px
--space-10: 40px
--space-12: 48px
--space-16: 64px
```

### 12.6 圆角

```
--radius-sm: 4px   输入框、小按钮
--radius-md: 8px   卡片
--radius-lg: 12px  面板、分组
--radius-xl: 16px  模态框
--radius-full: 999px  pill 按钮
```

### 12.7 阴影

```
--shadow-sm: 轻微提升
--shadow-md: 中度提升
--shadow-lg: 菜单
--shadow-xl: 模态框
```

---

## 文档版本

- **版本**：1.0
- **日期**：2026-10-18
- **作者**：SCWC 设计团队
- **状态**：待实施视觉规范
- **关联文档**：
  - [Web插件工作台设计方案](Web插件工作台设计方案.md)
  - [Web插件工作台技术契约](Web插件工作台技术契约.md)
  - [Web上下文菜单复用设计](Web上下文菜单复用设计.md)
