---
name: Forge
description: 绿意实验室：先聚焦创作入口，再进入专业、精确的聊天与预览工作台。
colors:
  ink: "#27312d"
  muted: "#89938e"
  line: "#e7eae6"
  accent: "#567e64"
  canvas: "#f4f5f1"
  text-secondary: "#54624e"
  text-muted: "#65715f"
  text-error: "#9a5e4c"
  page: "#f8f9f6"
  surface: "#ffffff"
  surface-soft: "#fbfcf9"
  surface-hover: "#f3f6ed"
  surface-success: "#edf3e7"
  surface-selected: "#eef3e8"
  surface-status: "#f1f5ed"
  surface-working: "#e5efde"
  surface-muted: "#eceee7"
  surface-device: "#f5f6f2"
  surface-error: "#fff9f6"
  surface-error-icon: "#faebe3"
  brand-surface: "#263c31"
  brand-label: "#d1e7c9"
  brand-punctuation: "#73976c"
  send: "#4f7256"
  send-hover: "#3e6345"
  send-label: "#f0f5ea"
  disabled-surface: "#e9eee1"
  disabled-label: "#aab49e"
  danger-action: "#8d4838"
  danger-hover: "#753b2f"
  control-label: "#65715f"
  selected-label: "#5a6e50"
  text-working: "#42694e"
  icon-agent: "#67846a"
  icon-muted: "#a1a99e"
  icon-empty: "#79916a"
  icon-success: "#709363"
  icon-working: "#537c5e"
  status-dot: "#83a57a"
  line-control: "#dce4d6"
  line-subtle: "#edf0e8"
  line-workspace: "#dde3da"
  line-progress: "#e6ecde"
  line-success: "#d6e2c7"
  line-error: "#ecd5ce"
  line-preview: "#dfe4d8"
  line-focus: "#8da583"
  scrollbar: "#dfe5db"
  browser-dot-neutral: "#e5e9dd"
  browser-dot-close: "#e8dbd0"
  browser-dot-minimize: "#e8e4cc"
  browser-dot-maximize: "#d8e4cb"
  browser-address-ring: "#a5b195"
typography:
  brand:
    fontFamily: Public Sans, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif
    fontSize: 1.75rem
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: Public Sans, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif
    fontSize: 1.75rem
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.02em"
  entry-headline:
    fontFamily: Public Sans, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif
    fontSize: clamp(1.5rem, 3.3vw, 2rem)
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  headline-compact:
    fontFamily: Public Sans, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif
    fontSize: 1.5rem
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.02em"
  title:
    fontFamily: Public Sans, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif
    fontSize: 1.25rem
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.02em"
  panel-label:
    fontFamily: Public Sans, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif
    fontSize: 1rem
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: Public Sans, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.6
  conversation:
    fontFamily: Public Sans, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.6
  input:
    fontFamily: Public Sans, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.6
  control:
    fontFamily: Public Sans, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif
    fontSize: 0.875rem
    fontWeight: 500
    lineHeight: 1.4
  metadata:
    fontFamily: Public Sans, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif
    fontSize: 0.75rem
    fontWeight: 400
    lineHeight: 1.5
rounded:
  control: 4px
  chip: 5px
  secondary: 6px
  send: 7px
  card: 8px
  composer: 9px
  preview: 10px
  workspace: 12px
  empty-state: 19px
spacing:
  control: 8px
  related: 12px
  section: 16px
  panel: 24px
  region: 32px
components:
  button-send:
    backgroundColor: "{colors.send}"
    textColor: "{colors.send-label}"
    rounded: "{rounded.send}"
    size: 32px
  button-send-hover:
    backgroundColor: "{colors.send-hover}"
  button-send-disabled:
    backgroundColor: "{colors.disabled-surface}"
    textColor: "{colors.disabled-label}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.secondary}"
    padding: 6px 9px
    typography: "{typography.control}"
  button-secondary-hover:
    backgroundColor: "{colors.surface-success}"
  button-icon:
    backgroundColor: transparent
    textColor: "{colors.control-label}"
    rounded: "{rounded.control}"
    padding: 4px
  button-icon-hover:
    backgroundColor: "{colors.surface-hover}"
  button-suggestion:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.chip}"
    padding: 4px 6px
    typography: "{typography.control}"
  button-suggestion-hover:
    backgroundColor: "{colors.surface-hover}"
  input-composer:
    backgroundColor: transparent
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.composer}"
    padding: 12px
    typography: "{typography.input}"
  nav-device:
    backgroundColor: "{colors.surface-device}"
    rounded: "{rounded.secondary}"
    padding: 4px
  nav-device-selected:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.selected-label}"
    rounded: "{rounded.control}"
    padding: 4px 8px
    typography: "{typography.control}"
  chip-status:
    backgroundColor: "{colors.surface-status}"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.control}"
    padding: 3px 5px
  version-history:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.text-secondary}"
    typography: "{typography.control}"
    height: 44px
  card-progress:
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: 16px
  frame-preview:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.preview}"
  button-start:
    backgroundColor: "{colors.send}"
    textColor: "{colors.send-label}"
    rounded: "{rounded.send}"
    typography: "{typography.control}"
    size: 44px
  button-example:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.card}"
    typography: "{typography.control}"
    padding: 12px
---

# Design System: Forge

## Overview

**Creative North Star: "绿意实验室"**

Forge 的现有界面是一间专业、精确的数字实验室：首次进入时，用户通过居中宽输入框与具象示例开始创作；提交后进入聊天与预览并列的工作台，再通过下一轮输入推进应用。安静的底色承托鲜明的输入入口，生成结果与实际状态成为工作阶段的视觉重心。

苔绿标记动作、焦点与工作状态，深绿墨承载主要文字，雾白和纯白区分环境与操作面。层次主要由底色和细边框建立；预览框、输入区与选中控件保留轻阴影，输入焦点使用清楚的苔绿轮廓。组件的共同特征是克制、精确、状态清晰。

**Key Characteristics:**

- 绿灰色环境、白色操作面与低强度绿色强调。
- 首次创作聚焦输入；提交后聊天与预览并列，窄屏按面板切换。
- 紧凑的无衬线排版和细线图标。
- 以边框和色阶建立结构，以轻阴影补充层次。
- 明确区分等待、进行中、完成、禁用与错误。

本文件记录当前实现；描述用语与首次创作／工作台结构方案由用户确认。规范值集中在 `src/app/design-tokens.css`，组件与响应式样式位于 `src/app/globals.css`，结构和状态来源是 `src/components/app-builder.tsx`，字体及主要尺寸已与运行页面核对（2026-10-10）。适用范围为 Forge 宿主工作区；生成应用的 iframe 内容不继承这份视觉规范。文档采用 [DESIGN.md 格式](https://raw.githubusercontent.com/google-labs-code/design.md/main/docs/spec.md)，前置 YAML 中的值为规范值。

## Colors

配色以苔绿和带绿倾向的中性色为主体，错误状态使用局部暖色。下文的名称对应前置 YAML 中的颜色键。

### Primary

- **苔绿**（`accent`）：键盘焦点轮廓的统一颜色。
- **动作苔绿**（`send`、`send-hover`、`send-label`）：发送按钮的默认、悬停和图标颜色。保留实际按钮颜色与焦点色的差别。
- **选中绿与工具绿**（`selected-label`、`control-label`）：设备切换的选中文字与工具按钮；状态标签另有更浅的绿色配对。

### Neutral

- **深绿墨**（`ink`）：全局文字和主要标题。
- **雾白**（`page`）：页面环境底色。
- **浅灰绿画布**（`canvas`）：预览区域底色。
- **操作白**（`surface`）：聊天面板、工具栏和预览框。
- **雾灰分隔线**（`line`）：页头、面板和区域分隔。
- **进度雾白与浅绿边线**（`surface-soft`、`line-progress`）：生成步骤容器。
- **禁用灰绿**（`disabled-surface`、`disabled-label`）：不能提交时的发送按钮。

### Semantic States

所有颜色集中定义在根语义变量中：表面、悬停、选中、工作、失败、边线、动作、工具图标和浏览器框各有稳定角色。阴影同样使用统一变量。工具图标使用 control-label，与辅助文字同一可读色阶；不以浅色图标暗示可用操作。

- **暖陶错误色**（`text-error`、`surface-error`、`line-error`）：生成失败提示。预览运行错误保留源码中相近的独立暖色配对。
- 正文绿墨（text-secondary）与辅助绿墨（text-muted）统一文字角色；保留图标及状态表面的现有局部色值。

**The State Pairing Rule.** 状态由文字、图标、底色和可用性共同表达；保留实际状态配对，不把颜色作为唯一提示。

## Typography

**Body Font:** Public Sans。宿主通过 next/font/local 加载项目内的拉丁可变字体；中文依次回退到 Segoe UI、苹方、Hiragino Sans GB、微软雅黑及通用无衬线。字体来自 [Google Fonts 的 Public Sans 源文件](https://github.com/google/fonts/tree/main/ofl/publicsans)，许可证保存在 src/app/fonts/OFL.txt。

**Character:** 一套无衬线字体承担宿主的全部文字角色，延续专业、精确的气质。真实的 400、500、600、700 字重分别服务正文、操作、标题和品牌；正文保持正常字距，标题使用轻微负字距与平衡换行。

### Hierarchy

| 角色 | 字号（默认根字号 16px） | 字重与行高 |
| --- | --- | --- |
| Brand / Headline | 1.75rem / 28px | 品牌 700 / 1；主标题 600 / 1.3 |
| Entry headline | clamp(1.5rem, 3.3vw, 2rem) / 24–32px | 首次创作标题，700 / 1.25；用户在 Live 接受标题层级方案 |
| Compact headline | 1.5rem / 24px | 窄屏品牌与主标题；标题 600 / 1.3 |
| Title | 1.25rem / 20px | 预览空状态标题，600 / 1.3 |
| Panel label | 1rem / 16px | 面板标题，600 / 1.4 |
| Body / Conversation / Input | 1rem / 16px | 说明、聊天、输入和错误正文，400 / 1.6 |
| Control | 0.875rem / 14px | 操作与步骤标签，500 / 1.4；作者和进度标题用 600 |
| Metadata | 0.75rem / 12px | 状态、版本和辅助说明 |

字号全部由语义 token 提供，并以 rem 响应默认文字大小和浏览器缩放。聊天、进度与输入不再因宽度跨过断点而缩小。开始页说明自然换行；聊天正文保留用户换行，最大 70ch，同时受聊天窄栏实际宽度约束。短空状态说明最大 44ch；不通过缩小字号追求固定行长。

正文和输入采用 text-secondary，辅助说明采用 text-muted；在现有浅色表面上保持至少 4.5:1 的文字对比度。输入长度与版本数字使用等宽数字特性。输入提示、状态行和窄屏工具栏可以换行，不把必要说明缩到 7–9px。

### Font delivery

仅加载一个 26,832 字节的 WOFF2 拉丁可变字体，覆盖实际使用的 400–700 字重，不加载未使用的斜体或扩展子集。字体随项目自托管，使用预加载与 swap；Next.js 生成度量匹配的回退字体，中文使用本机字体。运行与生产构建不依赖远程字体服务。

**The Role Continuity Rule.** 用固定角色、真实字重与留白区分层级；正文和操作在不同设备上保持相同语义尺度，辅助信息也必须可读。
## Layout

工作区外壳居中，最大宽度（1680px），高度使用（100dvh）。常规窗口按可用视口分配高度；极短窗口保留（560px）的最小工作空间并允许页面滚动。桌面横向留白为 `clamp(16px, 2.5vw, 40px)`；页头高（64px）。手机工作区标题的默认上下留白（20px）；桌面工作阶段保留可访问主标题，移除可见的重复口号，面板工具栏最小高度（56px），内容必要时换行。

桌面为左侧弹性定限聊天与右侧可伸展预览：列宽 `clamp(320px, 29vw, 440px) / minmax(0, 1fr)`。同一面板内的工具栏、聊天内容、输入区和版本条使用一致的横向内边距，默认为（24px），中窄窗口为（16px）。聊天内容与生成状态通过（16px）的组间距分隔；消息作者与正文、建议按钮与输入框使用更紧凑的（8px）间距。

首次创作使用最大 720px 的居中操作区，层叠品牌符号、主标题和说明连接宽输入框；三个已有示例用清晰的线条小图表达类别，排在输入与提示下方。点击示例只填入原有提示词并聚焦。首次提交后才出现聊天、步骤和预览，移除重复的欢迎信息。生成期间展开实际步骤；完成或失败后以可展开的步骤记录保留详情。输入区固定在聊天面板底部，消息和进度在内部滚动。自动追随只滚动聊天容器；用户向上阅读时暂停追随，提交新需求时恢复。

### Responsive behavior

| 条件 | 已实现的布局变化 |
| --- | --- |
| 宽度 ≥ 1440px | 聊天列连续变化，最大（440px）；文字角色使用统一字号。 |
| 宽度 ≤ 1100px | 面板横向内边距及预览画布留白降至（16px）；聊天列最低（320px）。 |
| 宽度 ≤ 800px | 首次创作单列、示例纵向排列；工作阶段单面板，通过 Agent Chat / Preview 切换；页头高（56px）；外壳横向留白至少（12px），并处理四边安全区域；输入保持统一的 16px 正文角色。 |
| 宽度 ≤ 430px | 画布留白降至（12px）；继续收起头像与辅助信息；预览工具栏空间不足时自然换行。 |
| 高度 ≤ 700px | 标题上下留白为（12px）；短桌面窗口的工作台至少（34rem）高，空间不足时使用页面纵向滚动。 |
| 手机工作阶段 | 项目操作默认收进原生 Project controls 折叠区，可展开选择、重载、删除和创建项目；工作台高度为 `max(36rem, 100dvh - 16rem)`，聊天至少（12rem）高，页面按内容纵向滚动。运行错误提示出现时，预览画布至少（18rem）高，工作台随内容增高，避免展开技术详情压缩预览。首次创作默认展开项目操作。 |
| 触摸指针或宽度 ≤ 800px | 按钮、输入、选择与 summary 的最小命中区为（44px × 44px）；覆盖创建、删除、恢复、返回最新和步骤详情。 |

Desktop 预览框填充画布可用宽度，最大宽度（1120px），弹性高度最低（240px）；Mobile 保留（375px × 667px）的目标尺寸，宽度仍受容器限制，高度不被压缩，画布负责滚动。框内浏览器栏高（34px）。预览画布使用浅灰绿纯色背景，以（16px）间隔连接预览框和底部说明，不放重复的画布标题。

布局间距以（4px）为基础，按角色使用前置 YAML 中的（8、12、16、24、32px）步长；已有局部颜色、圆角和图标尺寸延续各自用途。长名称截断且可查看完整标题；版本列表纵向滚动，状态行允许换行，正文和错误说明允许断行。

**The Shared Workspace Rule.** 保留聊天、输入和预览的明确分工；窄屏通过面板切换维持任务连续性。

## Elevation & Depth

层次主要来自雾白环境、白色操作面、浅绿画布和一像素边线。阴影只补充轻微的容器分离与选中反馈，不承担主要结构。

### Shadow Vocabulary

- **工作区环境阴影**：`0 6px 24px #26352c04`。
- **预览框双层阴影**：`0 8px 30px #39412d09, 0 2px 6px #39412d05`。
- **输入区环境阴影**：`0 2px 7px #23332903`。
- **输入焦点**：2px 苔绿轮廓、3px 外偏移，不叠加阴影光圈。
- **设备选中阴影**：`0 1px 3px #38452e0b`。
- **移动面板选中阴影**：`0 1px 3px #39472b08`。

**The Tonal Structure Rule.** 先延续底色和细边框，再使用现有轻阴影表达承托或选中状态。

## Shapes

矩形容器使用温和圆角，尺寸越大通常越舒展：小控件、标签、卡片、输入区、预览框与外层工作区各有前置 YAML 中的圆角角色。边框普遍为（一像素）实线；圆形用于头像、状态点和进度步骤图标。

聊天中的用户消息保留左上角直角、其余三角（9px）的轮廓；助手消息直接排在内容区。预览空状态图标块为（64px × 64px）、圆角（19px）。品牌标识和首次创作的层叠标记沿用 10px 圆角与深绿底色。

## Components

### Project management

桌面与手机的工作阶段均使用原生 Project controls 折叠区，默认关闭；首次创作展开项目操作，桌面首次创作隐藏折叠标题。用户可自行展开，调整窗口尺寸保留其选择。默认 Untitled project 在页头、项目列表与删除确认中附创建时间（含秒），已有记录无需改名；用户指定名称按原样显示。删除确认使用原生 dialog，默认焦点为 Cancel，Escape 可取消；明确列出项目名和永久删除的范围，失败时保留项目及重试机会。

### Buttons

克制、精确，尺寸与所在工具区域匹配；桌面发送与重载为（32px），触摸与窄屏操作采用（44px）的点击高度。

- **开始创作**：`button-start` 使用相同的发送状态配色，显示 Start building 与右箭头，44px 高；空输入禁用。
- **示例入口**：`button-example` 使用已有卡片圆角、12px 内边距与清晰的线条小图，桌面三列、窄屏单列。
- **发送**：使用 `button-send`，居中向上箭头；悬停采用对应变体；空输入或生成期间使用禁用配色，生成期间显示旋转图标。
- **New project**：使用 `button-secondary`，细边框与文字搭配小型加号；生成期间禁用并降低不透明度（0.45）。操作文字统一采用（14px）；窄屏不再缩小字号。
- **工具按钮**：使用 `button-icon`，透明底、轻悬停色；重载预览未就绪时禁用，不透明度（0.35）。
- **建议按钮**：使用 `button-suggestion`，（14px）操作字号、细边框；三列排列，标签独占一行，按钮文字必要时换行，点击填入输入框。
- **Focus**：按钮和链接的键盘焦点使用（2px）苔绿轮廓，外偏移（4px）。
- **Motion**：按钮的背景、文字色和透明度变化为（0.15s），默认 `ease`；没有统一的按下位移动画。

### Input fields

提示输入区使用 `input-composer`。外层细边框包围无边框的多行文本框，正文与发送按钮形成一个操作单元。获得内部焦点时改变外层边线并增加 2px 苔绿轮廓；文本框自身不重复绘制轮廓。文本框最小高度（56px），不允许手动拖动改高。

首次创作输入旁说明生成单页离线浏览器应用，项目代码会保存，预览运行数据在重载后重置；通过 aria-describedby 连接输入与帮助文字。预览底部保留数据重置说明，移动设备也可直接读取。

输入长度上限（4000）及当前计数在下方展示。Enter 提交，Shift+Enter 换行，输入法组合期间不提交；生成期间禁用输入。保留隐藏的可访问标签和发送按钮的可访问名称。

### Navigation

设备切换使用 `nav-device` 和 `nav-device-selected`：浅灰绿轨道包围两个按钮，选中项为白底、深绿文字和轻阴影，状态通过 `aria-pressed` 表达。

移动端的 Agent Chat / Preview 切换延续相同的分段选择语言，但有自己的尺寸：轨道内边距（4px），按钮内边距（8px）、最小高度（44px）、字号（14px）、圆角（5px）。两种切换分别控制预览尺寸和当前工作面板。

### Chips and status

- **Agent 状态**：`chip-status` 展示 Ready、Working、Restoring、Loading、Error 或 Preview error；进行中使用明确的绿色外观；生成失败与预览失败都采用暖色文字。代码保存后先显示 Loading，iframe 实际运行后才显示 Ready。手机的 Preview 切换项同步显示运行错误，预览面板明确说明可先 Reload；持续失败时在 Agent Chat 描述问题，有历史记录时也可在 Version History 预览早期版本。技术异常放在可展开的 Technical details 中，不作为主提示。
- **版本历史**：原生 details/summary 展开保存记录；Preview 按钮使用 `aria-pressed` 标记当前选择，Latest 与 Previewing 用文字区分。历史预览不改变已保存代码；Restore 将历史代码另存为新版本，Return to latest 返回最新预览。历史模式禁用编辑，恢复与预览失败都有明确状态和重试入口。
- **小状态点**：与文字共同使用；保留局部色值与当前尺寸。

### Cards and lists

生成进度使用 `card-progress`，头部说明与步骤列表分开；初始视图不显示进度卡；生成期间展开步骤，完成与失败后收起为可展开记录。预览运行失败时，进度标题改为 Preview could not run，聊天状态同步为 Preview error，不能用生成完成冒充可运行成功。步骤分别使用等待、进行中、完成、失败的图标和文字；进行中有旋转图标及 `aria-current="step"`。进度容器保留 `aria-busy` 和隐藏状态说明，聊天消息保留实时播报语义。

开始页用居中的品牌层叠标记与宽输入建立一个重心，示例小图只表示类别，不伪装成已生成成果。版本列表和聊天内容独立处理长内容。

### Preview

`frame-preview` 是工作区的主要承托对象：圆角白色容器、浏览器栏、双层轻阴影与 iframe；纯色浅灰绿背景留在外部画布。切换设备时宽度过渡为（0.25s），不替换生成内容。没有生成内容时使用居中的图标、标题和说明。

生成失败和预览运行错误分别显示自己的暖色提示与重试／重载操作；更新失败保留上一份可用预览。宿主的按钮、卡片和字体规范不强制施加给 iframe 内的生成应用。

### State transitions

首次提交使工作台以 180ms 的短淡入／8px 位移出现；步骤完成提供 180ms 勾选反馈。已有 iframe 不随面板切换、设备切换或失败状态重建。首次切换将焦点移到工作区主标题，新建后回到输入框；键盘顺序与屏幕阅读顺序均为输入、提交、提示、示例。

### Idea-to-app completion

完成卡将一次成功生成收束为一个小型界面印记：苔绿窗口描线与指针在 700ms 内出现，使用自然减速曲线；作品标题与版本立即可见，不等待动画结束。印记只在最新预览实际运行且没有生成或运行错误时出现。完成卡不提供跳转操作；用户通过既有 Preview 面板查看作品。

描线只用于本次提交成功的版本；打开保存项目、历史预览、Restore、Reload 均保留静态反馈。减少动态效果时直接展示完成的矢量图，不播放描线。示例选中后采用浅苔绿背景与深绿说明，Use idea 改为 Added to prompt；用户修改提示后恢复普通外观。此反馈复用既有进度卡，不添加弹窗、声音或新依赖。

### Responsive generation field

创作入口的品牌标记由一组苔绿等高线承托：聚焦输入、选择示例及需求长度改变时，轮廓短暂汇聚；生成期间按真实阶段改变形态，完成或失败后淡出，让出预览。效果只承托宿主，不进入生成应用的 iframe，也不表示预计完成百分比。

绘制优先使用 Worker 与 OffscreenCanvas；不可用或初始化失败时回退到主线程 Canvas，再保留静态矢量轮廓。首次可见时才初始化，页面隐藏、离开视口时暂停，卸载时释放线程与画布；静置时不持续绘制。桌面最多 15 条轮廓、128 个采样点，窄幅或触摸场景减为 9 条、80 个点，并限制绘制分辨率。创作入口的绘制区域为最大 440px 宽、128px 高，窄屏为 104px 高。

`prefers-reduced-motion` 初始开启时使用静态绘制、不创建 Worker；偏好在运行中改变也立即停止连续动画。完成与失败淡出为 700ms，减少动态效果时直接切换。效果不响应点击、不参与键盘顺序，屏幕阅读器忽略该装饰层；所有阶段和错误仍由现有文字说明。

### Reduced motion

当用户请求减少动态效果时，优先采用组件的静态替代：生成场停止连续绘制，完成印记直接显示完整矢量图，工作台与步骤不播放进入动画。现有全局（0.01ms）规则只作为其余动画和过渡的兜底，滚动行为设为 `auto`；工作与加载状态仍由文字说明。

## Do's and Don'ts

### Do:

- 延续苔绿、深绿墨与雾白的角色关系，按组件采用当前状态配对。
- 使用同一字体栈与语义字号；正文 16px、操作 14px、辅助信息 12px，不因窄屏而缩小。
- 以背景、细边框和轻阴影组织工作区层次。
- 保留按钮焦点、可访问名称、选中状态和减少动态效果的行为。
- 在生成或修改失败时保留上一份可用预览及明确的恢复操作。

### Don't:

- 不把宿主工作区的颜色、字体或组件样式注入生成应用。
- 不把历史预览当作代码恢复；Restore 必须另存为新版本并保留已有记录。
- 不把局部辅助色、圆角和内边距强行归并为源码中不存在的统一尺度。
- 不把颜色用作唯一的生成状态或错误提示。
- 不添加未实现的产品能力、虚假生成进度或成功声明。

## 设计系统交付与维护

- `src/app/design-tokens.css` 是宿主颜色、字号、间距、阴影和常用圆角的实现入口，`globals.css` 引入并使用它。数值保留已确认的视觉效果。
- 常用圆角映射为 `--radius-control`（4px）、`--radius-secondary`（6px）、`--radius-card`（8px）；发送按钮、预览等局部形状继续沿用上文独立尺度。
- `DESIGN.md` 与 `.impeccable/design.json` 随项目版本管理；引擎、Live 会话和截图仍为本地辅助资料。
- 修改规范后运行 `npm run check:design`，核对颜色、间距、圆角、变量引用和组件示例；新增布局仍需浏览器验收。
- iframe 内生成应用不继承宿主 token。不要将其源码强制改为 Forge 的外观。
