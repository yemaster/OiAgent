<p align="center">
  <img src="public/brand/oiagent-app.svg" width="96" height="96" alt="OiAgent" />
</p>

<h1 align="center">OiAgent</h1>

<p align="center">
  管理本机 Agent、项目与任务的桌面应用
</p>

<p align="center">
  Codex · Claude Code · Qwen Code · Gemini CLI · OpenCode · Aider · Goose
</p>

<p align="center">
  <a href="#快速开始">快速开始</a> ·
  <a href="docs/USAGE.md">使用手册</a> ·
  <a href="https://oiagent.yemaster.cn/">官方网站</a> ·
  <a href="docs/AGENT-SUPPORT.md">Agent 支持范围</a> ·
  <a href="https://github.com/yemaster/OiAgent/releases">Releases</a> ·
  <a href="https://github.com/yemaster/OiAgent/issues">反馈问题</a>
</p>

---

OiAgent 用于启动和管理本机的编程 Agent。它会检测已安装的程序，按项目目录整理历史对话，提供任务列表、对话、终端和文件编辑。

同一个任务可以在不同轮次切换 Agent，例如先用 Codex 执行，再交给 Claude Code 继续。多个任务通过标签切换，列表显示各任务的状态和最新输出。

应用基于 Tauri 2、React 和 Rust，使用系统 WebView。Agent 需要自行安装和登录。

## 功能

| 模块 | 功能 |
| --- | --- |
| **任务与历史** | 按项目、Agent、设备和状态筛选任务，查看最新输出；搜索、归档、恢复和导出历史对话。 |
| **TODO List** | 管理父子计划，按项目筛选、折叠查看和标记完成；将未完成计划一键填入新建任务。 |
| **对话与终端** | 阅读 Markdown 回复、命令执行和文件修改记录，查看子 Agent；需要原生交互时切换到 CLI 的 TUI。 |
| **临时项目** | 无需指定目录即可启动任务；保留结果继续使用，或在归档保留期后清理文件。 |
| **文件与改动** | 浏览项目文件树，在 Monaco 中编辑代码、查看 Git 差异；从执行记录直接打开文件。 |
| **多标签工作区** | 通过标签管理任务和文件，保留草稿与阅读位置；从当前项目继续新建任务，或返回之前的页面。 |
| **Agent 与扩展** | 自动发现常用 Agent，添加自定义程序；管理 Claude Code API 配置、指令文件、MCP、Skills 和命令型插件。 |
| **模板与自动化** | 用带变量的模板编写任务，通过 LLM 优化 Prompt，或由超级 Agent 拆分目标、派发任务并检查结果。 |
| **局域网与用量** | 配对另一台运行 OiAgent 的电脑，在授权项目中执行任务；按项目和 Agent 查看 Token 用量并导出 CSV。 |

### 任务与对话

任务详情按轮次显示对话和执行记录。命令、输出及子 Agent 调用可以展开查看；点击文件修改卡片可以打开编辑器或比较工作区差异，也可以查看原始日志。

终端模式使用 **xterm.js + 系统 PTY**，运行对应 Agent 的原生 TUI。切换后项目侧栏和标签栏保持可用，键盘、鼠标和滚动交给终端处理。

运行中发送的消息进入队列，本轮成功结束后依次执行；失败、停止或等待操作时暂停队列。每轮都可以更换 Agent；OiAgent 保留同一个任务的记录，并向接手的 Agent 提供近期上下文。不同 Agent 的原生会话分别管理。

### 项目与文件

历史会话按项目目录归类，最近使用的项目排在前面。任务和文件共用标签栏，关闭任务标签不会停止任务。

Monaco 编辑器支持语法高亮、保存快捷键和未保存提示。Agent 修改了正在打开的文件时，编辑器会检测磁盘变化；遇到未保存的编辑，先比较差异再保存。文件和目录也可以在系统文件管理器中显示，或使用默认程序打开。

### 配置与扩展

- **Claude Code API**：保存多套 Base URL、API Key 和模型映射，支持获取模型列表、测试连接及 Fable 映射；在新建任务或追加消息时选择。
- **指令文件**：按用户或项目编辑 `AGENTS.md`、`CLAUDE.md` 等文件；保存前检查磁盘版本，避免覆盖外部修改。
- **MCP 与 Skills**：按 Agent 和用户／项目范围管理；Skill 直接在文件标签中编辑，保存时校验并备份。
- **任务模板**：按分类管理常用 Prompt，使用 `{{变量名}}` 填写项目要求；优化建议确认后才替换原文。
- **超级 Agent**：通过配置的 LLM 生成计划，依次派发给本机 Agent，收集结果并复核；失败或等待操作时暂停派发。
- **命令型插件**：用 JSON manifest 添加其他 CLI，执行记录保存在任务历史中。

## Agent 支持范围

以下程序均支持安装检测、任务启动和运行记录保存。已有历史、工具事件和会话恢复的支持程度有所不同。

| Agent | 执行记录 | 导入已有历史 | 继续会话 |
| --- | --- | --- | --- |
| Codex | 结构化工具步骤 | 支持，含子 Agent | 原生主会话 |
| Claude Code | 结构化工具步骤 | 支持，含子 Agent | 原生主会话 |
| Qwen Code | 结构化工具步骤 | 支持，含子 Agent | 原生主会话 |
| Gemini CLI | 结构化工具步骤 | 暂不支持 | OiAgent 启动的会话 |
| OpenCode | 结构化工具步骤 | 暂不支持 | OiAgent 启动的会话 |
| Aider / Goose | 文本输出 | 暂不支持 | 文本上下文接续 |
| 自定义程序 / 插件 | 文本或兼容事件 | 取决于适配 | 由启动参数配置 |

OiAgent 不会自动安装或登录这些程序。权限选项跟随各 Agent 的能力，包括 Claude Code Auto Mode；实际可用性由本机 CLI、模型和组织设置决定。各程序的协议、权限和用量说明见 [Agent 支持范围](docs/AGENT-SUPPORT.md)。

## 快速开始

### 安装与启动

已发布的安装包见 [GitHub Releases](https://github.com/yemaster/OiAgent/releases)。如暂无对应平台的产物，可以从源码运行。

开发环境需要 **Node.js 22.12+、Rust stable**，以及 [Tauri 2 对应平台的系统依赖](https://v2.tauri.app/start/prerequisites/)。先安装并登录至少一个需要使用的 Agent CLI，然后执行：

```sh
git clone https://github.com/yemaster/OiAgent.git
cd OiAgent
npm ci
npm run desktop
```

当前已在 macOS 完成本机构建。仓库提供 Windows x64、Linux x64、macOS Apple Silicon / Intel 的自动发布工作流，其他平台仍需实机验证。当前构建未配置正式代码签名与 Apple 公证，详见 [发布说明](docs/RELEASING.md)。

### 创建第一个任务

1. 打开 **Agent 程序**，确认程序已被发现。未发现时，可以手动添加可执行文件。
2. 点击 **新建任务**，选择已有目录或 **临时项目**，选择 Agent，输入要完成的工作。权限默认采用只读或计划模式，可按需调整。
3. 启动后，在 **当前任务** 查看进度；点击任务进入对话详情，从侧栏打开项目文件。

已有的 Codex、Claude Code 和 Qwen Code 历史会在后台导入。首次扫描可能需要一些时间，之后只解析新增或变化的记录。

普通任务使用 CLI 的登录配置。Prompt 优化和超级 Agent 需要在「设置偏好 → LLM API」配置兼容 Chat Completions 的服务；Claude Code 多 API 配置位于「Agent 程序 → Claude Code API 配置」，使用 Anthropic Messages 协议。

<details>
<summary>在浏览器中预览界面</summary>

```sh
npm run dev
```

访问 `http://127.0.0.1:1420`。浏览器模式使用标明的演示数据，不读取本机历史、不启动程序，也不调用 LLM。完整功能需要桌面版。

</details>

## 独立网站

项目首页和使用文档位于 `website/`，采用 Astro + Starlight，与桌面应用分别构建。GitHub Pages 工作流位于 `.github/workflows/pages.yml`，本地预览和部署步骤见 [网站说明](website/README.md)。

## 数据与权限

任务索引、日志和模板保存在本机，实际数据目录可在设置中查看。导入历史时，归档和重命名只修改 OiAgent 的索引，不改写 Agent 的原始记录。

LLM API 配置、Claude Code API 密钥和局域网配对令牌使用系统凭据库保存：macOS Keychain、Windows Credential Manager、Linux Secret Service。重启后自动读取保存的 LLM 配置。凭据库不可用时提示错误，不会改为明文保存。

调用 Agent 时，数据仍按该 Agent 的配置发送给模型服务。Prompt 优化仅发送当前输入；超级 Agent 会将目标和子任务输出发送到你配置的 LLM API。

局域网共享默认关闭，两端都需要安装 OiAgent。连接使用 TLS 和证书校验，配对需要执行端确认；仅开放指定项目、Agent 和受限任务接口。远程 TUI、文件编辑及配置管理暂不开放。具体配对步骤见 [局域网连接](docs/USAGE.md#局域网连接)。

## 常见问题

<details>
<summary>任务需要审批时怎么办？</summary>

目前支持显示「等待操作」，尚未提供统一的「允许／拒绝」审批卡片。需要交互时使用 Agent 原生 TUI。切换终端会停止当前无头进程并尝试恢复会话，不保证保留原先的待审批调用，详见 [权限说明](docs/USAGE.md#权限与状态语义)。

</details>

<details>
<summary>切换 Agent 后，会保留完整上下文吗？</summary>

OiAgent 保留任务历史，但交接给其他 Agent 的是有长度限制的近期对话和工具记录，不会迁移模型内部状态。各 Agent 和 API 配置保留各自的原生会话 ID。Aider、Goose 和自定义程序通过文本上下文接续。

</details>

<details>
<summary>对话模式和终端模式能实时同步吗？</summary>

已绑定原生会话的 Codex、Claude Code 和 Qwen Code 可以从原生日志增量同步，实际延迟取决于 CLI 写入日志的时间。其他 Agent 和没有会话 ID 的终端暂不支持结构化同步。

切换到 TUI 不是直接附着到现有无头进程：OiAgent 会先停止当前进程，再在新的 PTY 中恢复原生会话；没有会话 ID 时新开会话。终端运行期间请在终端中输入，聊天消息队列暂不执行。

</details>

<details>
<summary>文件改动和 Token 统计如何计算？</summary>

「改动」展示整个项目相对 Git HEAD 的工作区差异，不将所有变更归因于当前任务。当前没有逐块接受／回退或自动 Git 提交功能。

Token 只统计 Agent 上报的数据，未上报时明确标注；统计按会话去重，不等同于服务商账单，也不估算未知价格下的费用。

</details>

<details>
<summary>关闭标签或退出应用后，任务会继续吗？</summary>

关闭标签不会停止任务。退出应用会停止由 OiAgent 管理的运行进程；异常退出后，下次启动将其标记为中断，不自动重放。已保存的历史可以继续，终端进程不会跨应用重启保活。

</details>

## 开发与构建

前端使用 React、TypeScript、shadcn/ui 和 Motion；Rust 负责程序发现、进程与 PTY 管理、历史解析、本机文件和局域网连接。Monaco 及语言 Worker 本地打包、按需加载。

```sh
npm run lint
npm test
npm run build
npm run test:rust
```

在 macOS 打包桌面应用：

```sh
npm run desktop:build
```

产物位于 `src-tauri/target/release/bundle/macos/OiAgent.app`。跨平台安装包由版本 tag 触发 GitHub Actions 构建，配置与产物格式见 [发布文档](docs/RELEASING.md)。

| 目录 | 内容 |
| --- | --- |
| `src/pages/` | 任务、历史、Agent 和设置页面 |
| `src/components/` | 工作区、对话、终端、文件编辑及基础组件 |
| `src/lib/` | 类型、状态与原生调用 |
| `src-tauri/src/` | Rust 后端与 Agent 适配 |
| `tests/` | 前端测试 |
| `docs/` | 使用说明、兼容范围、扩展协议与设计依据 |

问题反馈请提交到 [Issues](https://github.com/yemaster/OiAgent/issues)，附上系统版本、Agent 版本和复现步骤。提交日志前请移除密钥及私有项目内容。代码修改可以通过 Pull Request 提交。

## 文档与致谢

- [使用手册](docs/USAGE.md)：页面入口、快捷键、配置、文件编辑和局域网连接。
- [Agent 支持范围](docs/AGENT-SUPPORT.md)：各程序的协议、权限、历史与会话接续能力。
- [插件文档](docs/PLUGINS.md)：通过 manifest 接入命令型扩展。
- [发布文档](docs/RELEASING.md)：版本 tag、GitHub Actions 和各平台安装包。
- [设计依据](docs/RESEARCH.md)：参考项目、交互取舍与后续方向。

感谢 [Tauri](https://tauri.app/)、[shadcn/ui](https://ui.shadcn.com/)、[Monaco Editor](https://microsoft.github.io/monaco-editor/) 和 [xterm.js](https://xtermjs.org/) 等项目提供的基础工具。Agent 品牌图标来自 [Lobe Icons](https://github.com/lobehub/lobe-icons)，授权见 [图标说明](public/agents/README.md)。OiAgent 是独立项目，与所接入的 Agent 厂商无隶属关系。
