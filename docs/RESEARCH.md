# 产品设计与调研依据

调研日期：2026-10-08。查看了下列仓库、产品说明、官方组件示例和终端文档；实际检查了 Vibe Kanban 任务卡片及 shadcn Sidebar 官方截图。借鉴信息架构与交互方式，没有复制其他管理平台的业务实现；Agent 品牌图标使用 Lobe Icons 的 MIT 授权静态素材。

| 参考                                                                                                                                               | 对本项目的启发                                                 | 本次采用                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------- |
| [Vibe Kanban](https://github.com/BloopAI/vibe-kanban)、[产品界面](https://www.vibekanban.com/)                                                     | 任务有明确状态，计划、运行和复核阶段需要不同信息密度           | 首页活动卡片 + 最近记录列表；筛选、状态标识和详情入口                |
| [Opcode](https://github.com/winfunc/opcode)                                                                                                        | 项目与会话是本地 CLI 的自然组织单位，用量应按项目和 Agent 查看 | 目录分组、首条用户消息作为标题、历史继续、用量导出                   |
| [Nexus](https://github.com/zenithblue-oss/nexus)                                                                                                   | 统一入口需要兼容多个终端 Agent，桌面端可使用 Tauri             | 内置适配器、自定义程序、真实系统 PTY                                 |
| [Agent Deck](https://github.com/jayhf/agent-deck)                                                                                                  | 多会话场景需要清楚区分当前关注的任务和终端会话                 | 项目导航、状态概览、交互终端与会话恢复入口                           |
| [Mission Control](https://github.com/builderz-labs/mission-control/blob/main/README.md)                                                            | 任务派发、执行记录和结果检查应独立表达                         | 超级 Agent 父子任务，保存计划和检查消息，失败/等待状态不自动算成功   |
| [shadcn Sidebar](https://ui.shadcn.com/docs/components/sidebar)                                                                                    | 分组侧栏、克制的选中态、工具栏和主体职责清晰                   | 左侧图标栏 + 项目栏；标准 Button、Tabs、Dialog、Sheet、Select 等组件 |
| [xterm.js](https://xtermjs.org/docs/guides/using-addons/) 与 [portable-pty](https://docs.rs/portable-pty/latest/portable_pty/trait.MasterPty.html) | 终端应承接原生交互，而非用文本框模拟                           | 字节流读取、终端输入、尺寸同步、进程退出与输出回放                   |

## 信息组织

首页先回答“哪些任务需要我操作”，再展示进行中的任务。卡片只展示名称、Agent、状态、项目、消息预览和用量；会话 ID、退出码、模型、路径放入详情侧面板。历史列表按项目折叠，不将大量对话铺成卡片。

任务详情参照常见聊天产品：消息在居中的阅读列排列，用户消息使用浅色背景，Agent 回复直接呈现 Markdown。工具执行记录默认折叠；底部保留后续输入。原始日志是独立标签页。超级 Agent 的子任务也使用相同详情页面。

UI 使用 shadcn/ui 的主题 token、操作系统界面字体（macOS 使用 SF / PingFang，Windows 使用 Segoe UI / Microsoft YaHei）、Lucide 图标。自定义 CSS 限于主题、页面尺寸与 Markdown 排版。交互动画采用 Motion 的短距离过渡并遵循系统减少动画偏好。

## 执行模型

1. 内置 Agent：按能力适配结构化事件或文本输出，提供聊天详情、退出状态及已上报用量；会话恢复按程序能力开放，详见 [支持范围](AGENT-SUPPORT.md)。
2. 自定义程序：参数数组 + Prompt，兼容标准输出与既有 JSONL 事件。
3. 交互终端：承接原生 CLI 的权限审批和交互，不推测每条终端命令的语义状态。
4. 超级 Agent：将用户目标交给配置的模型生成有界计划，依次执行本机 Agent，最后核对输出。不是无限自主循环，也不通过自动关闭全部权限来绕过阻塞。

CLI 接口依据本机安装版本的 `--help`，以及 [Claude Headless 文档](https://code.claude.com/docs/en/headless)、[Qwen Headless 文档](https://qwenlm.github.io/qwen-code-docs/zh/users/features/headless/)。历史格式按本机实际 JSONL schema 适配，并由脱敏的合成 fixture 验证。

## 后续扩展

| 优先级 | 需求                          | 前置工作                                                       |
| ------ | ----------------------------- | -------------------------------------------------------------- |
| P1     | 原生审批协议适配              | 为不同 CLI 分别建立双向控制通道，避免根据自然语言猜测审批状态  |
| P1     | Git worktree 隔离与 Diff 审查 | 项目 Git 状态、分支生命周期、冲突处理、合并前预览              |
| P1     | 逐请求用量账本                | 为会话去重的每条用量事件建立时间索引，处理缓存与服务商定价     |
| P2     | 定时任务与并发调度            | 持久任务队列、并发上限、目录写入冲突、失败退避                 |
| P2     | 完整插件 SDK / MCP 接口       | 能力声明、版本协商、权限范围、事件契约；与 UI 插件运行环境分离 |
| P2     | 数据存储升级与备份            | JSON 元数据迁移到 SQLite，日志保留策略和增量全文索引           |

这些扩展未出现在界面中作为不可用占位按钮。当前版本优先完成本地任务、聊天详情、历史管理、真实终端和有界编排的闭环。

## 2026-10-08：视觉与首次使用流程改版

这轮将界面基础色从偏蓝的灰白调整为低饱和中性灰，保持白色内容区、浅灰侧栏、深灰主要操作。状态色仅用于运行、等待和异常等真实状态。配色是本项目的主题 token，并非声称提取了参考产品的精确色值。

| 参考                                                                                 | 观察                                                                   | 本项目落实                                                                             |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [Linear 2024 UI 改版](https://linear.app/now/how-we-redesigned-the-linear-ui)        | 统一侧栏、页头、面板的对齐和层级；以黑白关系探索表面颜色               | 去掉蓝色全局底色、蓝色选中态和卡片浮起阴影；统一白色主区、浅灰侧栏、系统字体和紧凑标题 |
| [Linear 2026 UI 改版](https://linear.app/now/behind-the-latest-design-refresh)       | 降低辅助导航的视觉重量，减少图标背景与不必要的边界；底色向低饱和灰调整 | 删除重复的机器人图标背景和每张卡片的“查看详情”；首页移除大数字概览卡；状态颜色缩到图标 |
| [VS Code Activity Bar](https://code.visualstudio.com/api/ux-guidelines/activity-bar) | 主导航入口对应一组相关视图，并使用清晰名称                             | 图标栏区分工作台、自动化、Agent、插件；底部独立设置；次级导航随分区变化                |
| [VS Code Walkthroughs](https://code.visualstudio.com/api/ux-guidelines/walkthroughs) | 引导步骤少，每步提供明确操作                                           | 可跳过并可重新打开的使用指南：检查 Agent、选择项目、启动任务；另设已有对话入口         |
| [Notion Sidebar](https://www.notion.com/help/navigate-with-the-sidebar)              | 按用途分组导航，项目内容通过可折叠区域组织                             | 工作台导航与项目列表分区；项目可收起，配置页面不再铺出项目列表                         |
| [Raycast Settings](https://manual.raycast.com/settings)                              | 将扩展和配置放在明确的管理区域                                         | 管理页使用分区表单；按本次用户要求，Agent 和插件独立于设置，设置仅保留偏好与 API       |

阅读了以上官方说明，并查看 Linear 官方浅色/深色主题对比图。采用它们的信息组织原则，继续复用已有 shadcn/ui 和 Lucide，不复制品牌样式。

当前任务页：紧凑状态标签、等待操作优先、按需打开筛选、卡片/列表切换；最近历史最多展示五条，其余进入历史页。历史页保留项目分组、搜索、归档和恢复。

新建任务页：默认只显示项目、Agent、任务内容和执行权限。名称、模型、延后启动收进“更多设置”；自定义命令和交互终端收进带说明的运行方式菜单。自动派发先说明用途并检查 LLM 配置。插件开发示例按需展开。

验证覆盖：首次引导与记忆、分区导航、状态筛选、历史归档/恢复、聊天详情、普通任务/自定义命令/交互终端的提交契约，以及 LLM 未配置时禁止自动派发。当前环境未授予桌面 UI 自动化权限，因此未完成原生窗口截图验收。

## 对话执行记录与多 Agent 支持

| 参考                                                                                                                                           | 采用的交互                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [assistant-ui ToolFallback](https://www.assistant-ui.com/elements/tool-fallback) 与 [工具文档](https://www.assistant-ui.com/docs/tools)        | 工具调用使用紧凑可折叠步骤；默认显示动作、目标及状态，展开后显示输入和结果 |
| [AI Elements Tool](https://elements.ai-sdk.dev/components/tool) 与 [Chain of Thought](https://elements.ai-sdk.dev/components/chain-of-thought) | 显式区分执行中、已完成和失败；思考摘要与正文分开，原始事件收进二级展开区   |
| [OpenCode Agents](https://opencode.ai/docs/agents/)                                                                                            | 主会话与子 Agent 可分别查看，并能返回父会话                                |
| [Claude Subagents](https://code.claude.com/docs/en/sub-agents)                                                                                 | 子 Agent 保留自己的会话、名称与记录，不混入父会话正文                      |
| [Lobe Icons](https://github.com/lobehub/lobe-icons)                                                                                            | 使用官方开源图标库区分 Agent，许可保存在 public/agents/LICENSE             |

继续复用 shadcn 的 Button、Tabs、Badge、Tooltip 和原生 disclosure，不引入第二套 UI 基础组件。对话先显示可读结果，命令、文件编辑、计划、搜索和委派记录按类型展开；只有用户主动打开“原始事件”时显示 JSON。工具通过调用 ID 配对，支持并行调用结果乱序返回；流式文字在工具步骤边界内合并。

父会话列表默认收起已有父记录的子 Agent，避免历史首页被内部工作线程占满。详情保留子会话卡片、专用标签及返回父会话入口。导入子 Agent 的状态仍显示“历史会话”，不根据文件时间猜测运行状态。Claude 共用父 session ID 的子记录按 agent ID 独立计量。

本次新增程序的命令和流式事件依据官方文档与源码，具体能力、边界及链接见 [Agent 支持范围](AGENT-SUPPORT.md)。新增四个 CLI 未在本机安装，测试采用合成协议事件及真实子进程，不声称完成了对这些 CLI 的真实模型调用。

## 2026-10-09：对话阅读层级与界面偏好

这轮参考了 [assistant-ui Tool group](https://www.assistant-ui.com/elements/tool-group)、[Chat panel](https://www.assistant-ui.com/elements/chat-panel)、[Subagent list](https://www.assistant-ui.com/elements/subagent-list) 和 [AI Elements Conversation](https://elements.ai-sdk.dev/components/conversation) 的官方页面与组件示例。

- 对话正文作为唯一常驻主视图；移除第二排日志 / 子任务导航与常驻用量。
- 同一轮回复只显示一次 Agent 名称；连续工具和运行记录合并为可展开的执行摘要，摘要保留失败数和正在执行的动作。
- 长用户消息可折叠；上翻后提供“回到最新”，加载旧消息时保留阅读位置。
- 子 Agent、原始日志、Token 与管理操作统一放入右侧详情面板；子会话保留返回父会话入口。
- 底部按状态提供继续输入、启动、停止或重新配置；无法续聊时不再显示禁用的大输入框。

界面设置遵循 [shadcn 主题变量](https://ui.shadcn.com/docs/theming)，使用现有 next-themes 管理浅色、深色及系统主题变化。主题色使用 Tailwind 调色板，仅覆盖主要操作与焦点变量；默认保持中性底色。另可调整对话字号。偏好保存在本地，终端、通知、状态及单色品牌图标同步适配深色。

本轮用户明确要求由其查看界面，因此停止窗口预览与视觉验收。


## 2026-10-09：命令折叠、API 导航与主题修正

- [assistant-ui Terminal block](https://www.assistant-ui.com/elements/terminal-block) 将命令、目录、真实退出状态与输出分层；[AI Elements Terminal](https://elements.ai-sdk.dev/components/terminal) 提供状态和复制操作。本项目保持外层执行过程展开规则，命令内部默认收起，摘要限于单行，完整内容按需查看；失败状态可见但不自动展开长日志。
- Claude Code API 配置移至 Agent 程序分区的独立页面，程序卡片保留链接入口；从新建任务进入管理页、配置页后可返回草稿。
- 任务 tab 激活后，面包屑和导航分区从当前任务推导，不沿用之前打开的设置页或项目筛选。
- 依照 [shadcn Chart 的主题示例](https://ui.shadcn.com/docs/components/chart)，Recharts 坐标文字、网格、悬浮提示、图例和数据系列接入已有主题变量，避免默认白色提示框与深色文字在 dark 模式下冲突。

只进行代码构建和回归测试，窗口外观按用户要求留给用户查看。


## 项目文件、Monaco 与执行终端

参考 [VS Code 界面结构](https://code.visualstudio.com/docs/editing/getting-started/userinterface) 的 Explorer 与编辑器标签、[Cursor Agents Window](https://cursor.com/docs/agent/agents-window) 的任务与审阅入口、[Cline Checkpoints](https://github.com/cline/cline/blob/main/docs/core-workflows/checkpoints.mdx) 的 Compare 工作流。采用明确的“文件 / 改动”次级导航：文件树复用现有侧栏，不增加第四个常驻栏；任务、文件、差异共用标签栏。完整工作区改动与任务记录涉及的文件分开标注，不假设所有改动均由 Agent 产生；此次未实现 Cline 的影子仓库或检查点恢复。

代码编辑采用 [Monaco React](https://github.com/suren-atoyan/monaco-react)，依照所安装 Monaco 的 ESM exports 配置本地 Worker、差异编辑器与主题。只读 Git 查询不执行 diff 驱动或 fsmonitor hook；读取数量、文件大小与 Git 进程设有上限。文件保存检查内容版本并以同目录临时文件替换，避免覆盖已检测到的并发修改。

执行记录继续参考 [assistant-ui Terminal block](https://www.assistant-ui.com/elements/terminal-block) 和 [AI Elements Tool](https://elements.ai-sdk.dev/components/tool)。利用 Acorn 静态解析 Agent 的 JS 包装调用，提取命令、工作目录和独立工具参数；不 eval、不猜测动态参数，包装代码折叠为原始调用。命令输出去掉可识别的运行包装头，原始事件仍保留。

终端采用 [xterm.js](https://xtermjs.org/docs/api/terminal/classes/terminal/) 与真实 PTY，只替换任务详情的内容区域。延迟加载和错误边界局部化，终端尺寸约束在详情面板内；无输出、加载失败、进程退出均显示对应状态。实际启动原任务 Agent 的原生 TUI，使用其会话恢复参数；未执行付费模型调用，也未按用户明确要求打开窗口做视觉验收。

## 导航与侧栏整理（2026-10-09）

下表的取舍是针对 OiAgent 工作流的设计判断；来源是各产品的官方界面与交互说明。

| 参考 | 适合借鉴 | 在 OiAgent 中的代价 / 取舍 | 本次落实 |
| --- | --- | --- | --- |
| [VS Code 布局](https://code.visualstudio.com/docs/editing/getting-started/userinterface)、[最近使用顺序](https://code.visualstudio.com/updates/v1_31#_closing-order-of-editor-tabs) | 工具栏、侧栏、编辑区职责明确；关闭当前编辑器回到最近使用的编辑器 | 完整 IDE 的多侧栏、多面板会增加任务管理的学习成本 | 保留单侧栏，任务与文件共享 MRU；关闭后台标签不切走当前内容；最后一个标签返回此前页面及项目筛选 |
| [Cursor Agents Window](https://cursor.com/docs/agent/agents-window) | 对话、文件编辑、改动审阅在同一工作区完成 | 更多运行环境、Agent 与视图入口容易争抢空间 | 管理页与工作区分层，从 Agent / 插件 / 设置返回工作台时恢复原任务、文件或列表；保留任务 Tab 与文件 Tab |
| [JetBrains Tool Windows](https://www.jetbrains.com/help/idea/tool-windows.html)、[Editor Tabs](https://www.jetbrains.com/help/idea/settings-editor-tabs.html) | 工具按场景出现，编辑区保持明确焦点；关闭标签后的目标有独立规则 | 隐藏工具会降低首次使用时的可发现性 | 管理页侧栏只保留相关导航，去掉重复说明与无关新建入口；项目文件区保留带文字的返回入口 |

侧栏默认 256 px，整个应用共用同一宽度，不随页面、项目、文件切换改变。拖动边缘可调至 208–420 px，窗口较窄时为主体保留空间；支持方向键调整、双击复位，宽度存入本机偏好。页面切换只保留轻微淡入，避免纵向位移。最左侧图标统一为 20 px、点击区域 40 px。状态栏只在同步或读取异常时显示右侧文字。

关闭有未保存修改的文件时，先处理保存 / 放弃 / 取消；只有实际关闭后才改变活动 Tab 和访问历史。关闭 Tab 不停止任务或 PTY 进程。

### 文件编辑事件与上下文菜单

- [Cline ChatRow 源码](https://github.com/cline/cline/blob/main/apps/vscode/webview-ui/src/components/chat/ChatRow.tsx)：编辑、新增和删除有明确文件入口，内容可以折叠。OiAgent 将文件入口保留在紧凑卡片中，多文件分别显示；调用参数继续收起。
- 文件卡片接入现有 Monaco 文件 / Git 差异标签。这里的“查看改动”是当前工作区相对最近提交的差异，可能包含用户及其他任务的修改，不伪装成单次事件快照。项目外路径禁用打开入口。
- [VS Code 上下文菜单规范](https://code.visualstudio.com/api/ux-guidelines/context-menus)：仅显示当前对象相关操作，相近操作分组。相比把所有功能塞进一个菜单，这种方式更易扫描，但仍需在卡片和工具栏保留常用入口。
- 使用现有 shadcn/Radix Context Menu（同一套主题、焦点管理和边缘避让）。任务列表提供打开 / 复制，标签提供关闭 / 批量关闭，文件提供打开 / 工作区差异 / 路径复制，消息提供整条或选中文本复制。右键后台标签不改变当前标签；批量关闭复用未保存文件保护。Monaco 和 TUI 不被全局菜单接管。

### OiAgent 标志

- [Cursor 品牌规范](https://cursor.com/brand)：区分界面标志与应用图标，提供不同背景版本。借鉴其简洁的轮廓和分场景资产，不使用其立方体图案。
- [Mistral 品牌规范](https://mistral.ai/brand/)：紧凑符号、独立图标、单色版本和留白规范。OiAgent 采用单色而非其渐变或像素形象。
- [VS Code 品牌规范](https://code.visualstudio.com/brand)：普通标志与应用图标区分，背景对比不足时使用反白。OiAgent 界面通过 alpha mask 跟随主题文字色，桌面版本使用素色底板。

最终采用开放的圆角 O 环与右上圆点融合为 i 的单色符号。圆点与环呼应 Agent 和工作区，不堆叠机器人、星芒或网络节点。图像由 imagegen 根据专门的几何构图生成，参考品牌图案没有作为 OiAgent 素材使用。界面只使用符号加现有字体的 OiAgent 名称，不引入装饰字体、渐变或动画。PNG 源稿保留在仓库，平台图标由 Tauri CLI 生成。

## 2026-10-09：MCP 与 Skills 管理

- [VS Code MCP 管理](https://code.visualstudio.com/docs/agent-customization/mcp-servers)：采用独立管理入口及用户/项目作用范围。优点是配置上下文明确；直接照搬设置 JSON 对首次使用不友好，所以 OiAgent 提供命令、逐行参数、远程地址表单，认证和其他原生字段放在高级配置中。
- [Claude Code MCP](https://code.claude.com/docs/en/mcp)、[Codex MCP](https://developers.openai.com/codex/mcp)、[OpenCode MCP](https://opencode.ai/docs/mcp-servers/)、[Gemini MCP](https://geminicli.com/docs/tools/mcp-server/)：使用各 CLI 的原生配置格式，不另外存一份无法生效的通用配置。Codex 使用 TOML；OpenCode 使用 `mcp`，其余适配程序使用 `mcpServers`。Claude 用户级 `.claude.json` 和项目级 `.mcp.json` 分开管理。
- [Codex Skills](https://developers.openai.com/codex/skills)、[Gemini Skills](https://geminicli.com/docs/cli/skills/)、[Qwen Skills](https://qwenlm.github.io/qwen-code-docs/en/users/features/skills/)、[OpenCode Skills](https://opencode.ai/docs/skills/)：展示 SKILL.md 名称和用途，支持导入完整目录、新建、编辑和移出加载目录。Codex 主目录采用 `.agents/skills`，兼容读取旧 `.codex/skills`。
- 保存前检查原文件指纹，检测外部修改；保存使用临时文件和替换，配置原文备份。TOML 保留无关配置及其注释；JSONC 保存为格式化 JSON，原注释保留在备份。配置管理不会执行 MCP 或 Skill 脚本。
- 暂未适配 Goose/Aider/自定义程序的原生配置，界面明确说明，不伪装成已生效。导入拒绝符号链接、特殊文件和过大资源包。

## 2026-10-09：局域网设备与任务

- 用户选择另一台安装 OiAgent 的电脑作为控制端。[VS Code Remote SSH](https://code.visualstudio.com/docs/remote/ssh) 与 [Zed Remote Development](https://zed.dev/docs/remote-development) 将执行设备作为工作上下文，并持续显示连接状态；优点是本机与远程资源不易混淆。但完整远程 IDE 引入安装服务器、终端和文件系统访问，本轮只接入任务生命周期，不开放任意文件/终端 RPC。
- [Tailscale 设备审批](https://tailscale.com/docs/features/access-control/device-management/device-approval) 提供显式批准和撤销的设计依据。OiAgent 将“共享本机”“连接其他电脑”“允许访问本机的设备”分组；主页面只保留开关、共享范围、配对入口和设备状态，端口放进高级设置。
- 安全默认：启动时关闭；只绑定选中的 RFC1918 / IPv6 ULA 网卡；TLS 自签名证书通过一次性邀请传递，客户端仅信任这份证书、检查地址、不跟随重定向、不使用系统代理，不忽略证书错误。配对码 5 分钟有效、单次使用，本机审批后才发放高熵令牌。
- 服务端只存令牌哈希；客户端使用系统凭据存储（macOS Keychain、Windows Credential Manager、Linux Secret Service）。配对、速率、请求大小和并发均有限制，浏览器 Origin 请求被拒绝。设备权限随每次请求验证，关闭共享会中止监听并使旧连接失效。
- 远程任务只允许显式共享的项目、内置 Agent 和受限权限选项，拒绝自定义命令、额外参数、环境变量、指定 API 凭据及外部会话恢复。设备只能查看/操作自己创建的任务，不能枚举本机原有历史。共享项目限制任务工作目录，不代表 OS 沙箱；实际工具能力仍由 Agent 的本机配置决定。
- 已接受的任务在断线、关闭共享、撤销设备后继续执行，可由本机停止。控制端保留本次打开期间的离线记录；任务在执行设备持久化。远程文件编辑、原生 TUI 及超级 Agent 调度不在此接口范围内。
- 自动化覆盖配对未审批/重放/错误票据、任务授权范围、撤销、任意 RPC 拒绝、错误 TLS 证书和远程启动参数清理。证书握手使用本机回环测试，没有调用真实 Agent 或收费 API；未进行两台物理电脑的实机联调，也未验证 Windows/Linux 构建。
- macOS 打包加入 `NSLocalNetworkUsageDescription`，依照 [Apple 本地网络隐私说明](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy) 和 [Tauri 原生配置合并方式](https://v2.tauri.app/distribute/macos-application-bundle/)。系统网络权限仍由用户在实际连接时决定。

## 2026-10-09：模板、Prompt 优化与就地新建

- [VS Code Prompt Files](https://code.visualstudio.com/docs/agent-customization/prompt-files)：借鉴“可复用提示 + 显式调用 + 参数填写”。优点是重复工作更快；纯文本文件的发现与编辑门槛较高，因此 OiAgent 用输入框旁的模板库，先预览再插入，支持分类、搜索和自定义变量。该页面注明 Agent Host 已转向 Skills；这里借鉴交互，不宣称兼容 VS Code 原生配置。
- [Claude 提示词最佳实践](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)：优化围绕目标、范围、约束和预期结果，保留原意，避免自动扩大任务。原文与建议分开，可编辑、确认替换和撤销；无 API 时直接进入配置并保留任务草稿。模型建议仍可能出错，由用户决定是否使用。
- [Zed Parallel Agents](https://zed.dev/docs/ai/parallel-agents)：借鉴项目内新建线程及独立标签。优点是无需反复选项目，但容易混淆“继续旧任务”和“新任务”；OiAgent 新建只继承项目、设备、Agent，不继承上一任务内容、会话、参数或放宽的权限。
- 模板只保存 Prompt；全局模板可跨设备任务复用。优化请求始终由控制端配置的 LLM 执行，不把 API 凭据传到执行设备。

### 标志细化

保留已认可的 24px 导航图标。品牌标志由同一轮廓派生为细线条 SVG（1.65 笔画、1.25 圆点半径），替换粗重的旧位图；桌面图标使用素色圆角底板。SVG 是后续编辑源稿，Tauri CLI 统一生成 PNG、ICO、ICNS 和 favicon，避免应用与界面图标不同步。

## 2026-10-09：全局返回

参考 [VS Code 位置导航](https://code.visualstudio.com/docs/editing/editingevolved#_quick-file-navigation) 与 [JetBrains 导航历史](https://www.jetbrains.com/help/idea/navigating-through-the-source-code.html)，新增按访问顺序返回的全局入口，放在最左侧图标栏顶部，提示显示在右侧。首次打开不显示，没有更早可访问位置时隐藏。页面、项目筛选、任务与文件标签共用访问记录，关闭标签后的最近访问逻辑保持独立；已关闭标签跳过，不重新打开。任务状态更新和输入草稿不新增访问记录，返回动作本身也不入栈。新建任务草稿仅在内存保留，返回后恢复，历史最多保留 100 个位置。

### 切换动效

沿用 [Motion useAnimate](https://motion.dev/docs/react-use-animate) 和 [减少动态效果支持](https://motion.dev/docs/react-use-reduced-motion)：工作区位置改变时，用 180ms 淡入及 4px 位移过渡，连续切换会停止上一次动画；内容更新和输入不会触发。动画作用于稳定容器，不重建任务详情或终端。返回按钮以高度、间距和透明度一起展开/收起，使下方图标平滑让位；收起即移出键盘与辅助技术交互范围。系统启用减少动态效果时直接切换。

## 2026-10-09：配置持久化与系统文件入口

- LLM 配置复用项目已依赖的 [keyring 系统凭据库](https://docs.rs/keyring/3.6.3/keyring/)，API 地址、模型和密钥作为一个凭据写入，避免保存中断造成不同服务的配置混用。重启后的首次读取放在后台工作线程；返回前端的状态只含地址、模型和是否存在密钥。测试使用独立 MockCredential，不访问开发者的真实凭据库。
- Skill 编辑复用文件工作区和 Monaco，保存仍走原生 Skill 校验、指纹比较及备份流程；使用普通文本文件的未保存保护和外部修改比较。列表恢复 Agent、范围及 Skills 标签，新建只填写名称与用途，正文进入文件标签编辑。
- 系统打开使用 [Tauri 官方 Opener](https://v2.tauri.app/plugin/opener/)，前端只提交项目目录、相对路径及 open/reveal 操作。后端复用文件路径校验，拒绝越界、符号链接和缺失文件；不开放 URL、指定外部程序或任意 Shell 执行接口。关闭插件自动接管网页链接功能，系统打开仅由明确的菜单操作触发。
- 使用指南参考 [VS Code 欢迎页实现](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/welcomeGettingStarted/browser/gettingStarted.ts) 的 Start、Recent、Walkthroughs 分区及简短操作入口。OiAgent 保留现有布局，使用“开始”“历史记录”“配置与扩展”“任务状态说明”，按钮直接描述操作，去掉“找回”“探索”等引导式措辞。


## 2026-10-09：README 信息结构

本次参考各项目仓库中的 README，借鉴文档组织方式，正文按 OiAgent 的实际功能编写：

- [Zed](https://github.com/zed-industries/zed/blob/main/README.md)：项目定位简短，安装与开发入口直接可见。
- [VS Code](https://github.com/microsoft/vscode/blob/main/README.md)：首页保留项目概览，详细开发说明链接到专门文档。
- [Cline](https://github.com/cline/cline/blob/main/README.md)：顶部品牌与导航集中，按使用场景介绍功能。
- [CC Switch](https://github.com/farion1231/cc-switch/blob/main/README.md)：用能力表说明工具差异，将快速开始与完整手册分开。
- [AionUi](https://github.com/iOfficeAI/AionUi/blob/main/readme.md)：为多 Agent 工作区提供清楚的功能分组和下载入口。

OiAgent 首页采用品牌标志、功能概览、Agent 兼容表、快速开始和折叠问答。原有操作与实现细节迁入 [使用手册](USAGE.md)。未添加虚构截图、性能数字、发布状态或许可证徽章；安装说明保留当前平台验证范围。


## 2026-10-09：临时项目、指令文件、关于页与项目网站

- [VS Code 未命名工作区](https://code.visualstudio.com/docs/editing/workspaces/workspaces)和 [IntelliJ Scratch files](https://www.jetbrains.com/help/idea/scratches.html)：借鉴先开始工作、再决定是否保留的操作方式。OiAgent 使用独立工作目录，结束后保留，归档 7 天后启动时清理；保留与删除有明确入口。
- [VS Code 关于对话接口](https://github.com/microsoft/vscode/blob/main/src/vs/platform/dialogs/common/dialogs.ts)和 [IntelliJ 帮助入口](https://www.jetbrains.com/help/idea/getting-help.html)：关于页聚焦安装版本、复制诊断信息、文档与反馈，不展示框架清单或宣传语。
- 指令文件按原生 CLI 的范围和名称适配，依据 [Codex AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)、[Claude Code memory](https://code.claude.com/docs/en/memory)、[Qwen memory](https://qwenlm.github.io/qwen-code-docs/en/users/features/memory/)、[Gemini GEMINI.md](https://geminicli.com/docs/cli/gemini-md/)和 [OpenCode rules](https://opencode.ai/docs/rules/)。选择 Agent 与作用范围后进入文件编辑器，保留备份与冲突检查，不自动同步到运行中的模型。
- 网站参考 [Zed](https://zed.dev/)的产品与文档分工，以及 [Starlight](https://starlight.astro.build/)的侧栏、搜索和主题组件。首页使用项目标志、简短用途、任务场景与文档入口，不使用虚构截图或性能宣传。
- 静态部署按照 [Astro GitHub Pages](https://docs.astro.build/en/guides/deploy/github/)配置独立构建、仓库子路径、静态产物和部署工作流。审批文档明确当前只有等待状态识别与原生 TUI 处理，没有统一 GUI 审批卡片。

### 独立网站第二版

- [Linear](https://linear.app/)：首页先展示工作界面，再分区说明用途。本项目采用可切换的任务、对话和文件示例，明确标注示意内容；不使用虚构用户数、评价或性能数据。
- [Zed](https://zed.dev/)：产品界面承担主要展示，下载和项目入口保持直接。OiAgent 首页删除原先的功能对照表和大 Logo 展示，保留工作区、Agent 列表和文档入口。
- [Cursor Docs](https://cursor.com/docs)：增加文档概览，把首次使用、日常操作与配置分开；详细文档保留左侧分类和右侧章节目录。
- [Starlight 组件替换](https://starlight.astro.build/guides/overriding-components/)：通过正式扩展点替换首页、页头与页脚。搜索、主题、移动导航、Tabs、Steps、Aside、LinkCard 和代码高亮继续使用组件库；样式通过主题变量和必要的布局调整统一。

网站保留灰白与暗色两套主题，正文采用系统字体。选中状态与 hover 分开处理；示例标签支持键盘切换，动效遵循系统的减少动态效果设置。

### Claude Code API 配置与检测

- [cc-switch 添加供应商](https://github.com/farion1231/cc-switch/blob/main/docs/user-manual/zh/2-providers/2.1-add.md) 与 [模型获取实现](https://github.com/farion1231/cc-switch/blob/main/src-tauri/src/services/model_fetch.rs)：服务字段和模型映射分区，远端模型列表与手动填写并存。OiAgent 使用独立编辑页，不自动覆盖模型映射。
- [Anthropic Models API](https://platform.claude.com/docs/en/api/models/list)：按 `data`、`has_more`、`last_id` 读取分页，提供超时、数量和响应大小限制；列表加载失败不阻止手动配置。
- [Claude Code 模型配置](https://code.claude.com/docs/en/model-config)：Fable 映射写入任务环境的 `ANTHROPIC_DEFAULT_FABLE_MODEL`，与其他三个模型别名一致。连接测试解析已配置别名后发送短 Messages 请求，不硬编码某个“最新”模型。

连接测试与模型列表请求不写入任务记录，不返回密钥，也不回显上游错误正文。保存的密钥只在地址和鉴权方式仍匹配时用于请求，HTTP 仅允许本机回环地址，重定向不自动跟随。验证使用本地模拟服务，不调用用户的真实 API。


### TODO List

- [Things 默认列表](https://culturedcode.com/things/support/articles/4001304/)：借鉴未完成计划与完成归档分离，以及列表内按项目整理的方式。本次不增加日历、周期任务或看板。
- [Todoist 任务详情](https://www.todoist.com/help/todoist/features/use-the-task-view-to-manage-tasks-in-todoist-eDeRDO0C)：名称留在列表，备注与项目放在展开的编辑区，减少常驻字段。
- [Microsoft To Do 添加与编辑](https://support.microsoft.com/en-us/todo/create-edit-delete-and-restore-tasks)：回车快速添加、直接勾选完成、恢复未完成；重要标记用于排序和筛选。

OiAgent 在每条未完成计划旁提供「创建任务」，带入名称、备注与项目目录，仍需用户确认 Agent 和执行权限。已有草稿时明确选择追加或替换，计划完成状态由用户控制。清单独立按需读取，原子写入并检查版本，不纳入任务历史扫描。


### 计划编辑页与子计划

参考 [Todoist 子任务](https://www.todoist.com/help/todoist/features/use-sub-tasks-in-todoist-kMamDo) 的层级列表、折叠和独立详情。OiAgent 将编辑表单移到独立页面，支持根计划与四级嵌套；编辑页可改变父计划，前后端拒绝循环关系、缺失父节点与超深层级。

父计划显示直接子计划完成数；过滤时保留祖先作为上下文。完成父计划可一并完成后代，操作前确认；恢复子计划会恢复祖先，完成所有子计划仍需手动确认父计划。删除仅移除选中的计划，子计划上移一级。每份编辑草稿使用独立的导航标识，返回和关闭标签跳过已保存、已放弃的编辑页。后台只修改其他计划时更新草稿版本；同一计划冲突仍要求明确重新载入。

### 可恢复的工作流与人工确认

本次阅读了以下官方产品页面及文档：

- [Dify Workflow Studio](https://www.dify.ai/workflows)：步骤类型、控制流与运行观察分层。OiAgent 采用工作流库、独立步骤编辑页和运行详情；文件操作按顺序执行，避免同项目并行修改相互覆盖。
- [Dify Human Input](https://docs.dify.ai/en/cloud/use-dify/nodes/human-input)：确认与补充说明作为工作流步骤。OiAgent 在运行页提供确认、拒绝和补充输入，不把等待超时当作同意。
- [n8n Executions](https://docs.n8n.io/workflows/executions/all-executions/)：工作流定义与运行记录分开，运行保留自己的计划快照。OiAgent 删除定义不会删除已有记录，失败步骤重试保留之前成功结果。
- [LangGraph Persistence](https://docs.langchain.com/oss/python/langgraph/persistence)：在执行边界保存状态。OiAgent 在启动子进程前记录尝试和任务 ID，重启后等待用户决定，不自动重放执行结果不明确的步骤。

采用紧凑的步骤列表与右侧配置区，避免在当前桌面布局中再嵌入复杂画布。支持 Agent、人工确认、LLM 检查三类步骤，检查失败可按用户指定上限返工。当前不实现定时器、任意条件分支或多项目并行调度。文档内的 Dify 截图请求返回 403，结构参考来自可访问的产品页面和官方说明；未据此声称复刻了截图布局。

### 计划生成与结果检查的 Prompt

参考 [LangGraph Workflows and Agents](https://docs.langchain.com/oss/python/langgraph/workflows-agents) 中的任务串联和评估后修订，以及 [Claude Prompting Best Practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices) 中明确目标、约束与输出格式的建议。

计划生成明确当前执行器的能力：顺序执行、共享项目、三种步骤、有限的前序结果摘要。未知项目事实先调查，需用户决定的事项单列人工确认；实际测试由 Agent 执行，LLM 检查只评价报告中的证据。生成结果经过类型、Agent 可用性与权限校验，并清除模型覆盖、API 配置和自动返工设置，再交给用户编辑。检查 Prompt 区分任务要求和不可信输出；证据不足时说明缺少什么，不凭退出码判定成功，也不追加原目标之外的要求。

### 计划拖动与固定页面标签

参考 [Todoist 子任务](https://www.todoist.com/help/todoist/features/use-sub-tasks-in-todoist-kMamDo) 的拖动手柄、层级调整，以及筛选或自动排序下限制拖动的做法；结合 [VS Code 界面说明](https://code.visualstudio.com/docs/editing/getting-started/userinterface) 中标签和导航分区的方式。

OiAgent 使用三种可预览落点：同级之前、同级之后和子计划；独立区域用于移回顶层。拖动保留整个子树，前后端均校验循环与深度，落下后才保存。使用 dnd-kit 的 PointerSensor 与 KeyboardSensor，手柄以外仍可正常点击和滚动。返回按钮移至顶部，标签栏固定保留功能页入口，不参与文件和任务的批量关闭。

### 项目置顶与归档批量操作

参考 [Slack 星标对话](https://slack.com/help/articles/201331016-Star-channels-and-direct-messages) 将常用项目保留在侧栏顶部，以及 [shadcn/ui Data Table](https://ui.shadcn.com/docs/components/base/data-table) 的行选择、选择计数和批量操作。

OiAgent 在项目与会话列表的悬停区提供置顶和颜色按钮，避免常驻文字挤占名称空间。项目不归档；会话归档后可在独立列表多选恢复或删除。切换筛选时清空选择，删除前显示目标和保留范围。


### 图工作流（2026-10）

| 参考 | 采用的做法 | 在 OiAgent 中的取舍 |
| --- | --- | --- |
| [Dify Workflow Studio](https://www.dify.ai/workflows) | 连接画布、选中节点后配置、分开观察运行结果 | 节点只显示名称、Agent、权限或状态；内容及高级参数放右侧，不堆进卡片。 |
| [n8n Flow Logic](https://docs.n8n.io/flow-logic/) | 显式分支、汇合及可见执行关系 | 支持“是 / 否”出口与等待全部前置路径的汇合；不用数组顺序暗示依赖。 |
| [LangGraph Workflows](https://docs.langchain.com/oss/python/langgraph/workflows-agents) | 并行、路由、评估后修订 | 只读 CLI 并行，项目写入在单次运行中互斥；返工限制到独立前置 Agent，避免其他路径使用过期结果。 |
| [React Flow](https://reactflow.dev/api-reference/react-flow)、[Handle](https://reactflow.dev/api-reference/components/handle) | 成熟的连线、拖动、缩放和节点交互 | 使用库内画布及控件，结合现有 shadcn、Agent 图标、主题变量；提供下拉连线入口，不强制精细拖动。 |

以上是设计取舍，并非复刻这些产品的完整能力。图仅支持 DAG，条件使用已配置 LLM 判断证据；不支持任意代码条件、定时触发、跨设备节点或无限循环。原有顺序计划仅在编辑时迁移，正在使用的旧运行保持原执行器。

性能方面，画布模块延迟加载；拖动仅更新草稿，不写磁盘。执行器每次处理状态变化时保存检查点，普通轮询不写盘、不发送状态事件。一个协调线程管理节点状态，CLI 子进程与 LLM 请求并行；用量写入也使用同一把锁，避免覆盖运行记录。未变化的运行版本不触发重绘，拖动坐标在松手后写回表单。前序结果仅收集已连接的祖先摘要。最多 24 个节点、4 个活动节点，画布渲染使用稳定组件类型。

此节替代前面顺序工作流版本的“不提供分支”限制及列表编辑方案。
