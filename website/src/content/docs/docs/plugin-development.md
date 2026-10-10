---
title: 应用插件开发
description: 注册页面、图标、命令和设置，使用 OiAgent 插件 API。
---

应用插件可以为 OiAgent 注册工具栏图标、页面标签、搜索命令和设置。插件逻辑运行在 Web Worker 中，通过 `oiagent` API 读写自己的数据，并用宿主组件构建界面。

协议版本：`schemaVersion: 2`，`apiVersion: 1`。CLI 接入仍使用独立的 [Agent 配置协议 v1](https://github.com/yemaster/OiAgent/blob/main/docs/AGENT_PLUGINS.md)。

## 运行示例

仓库的 `examples/plugins/project-notes` 是可直接安装的项目便笺插件。

1. 启动桌面版 OiAgent，打开「插件 → 从目录安装」。
2. 选择 `examples/plugins/project-notes`，核对插件信息和权限，确认安装。
3. 点击「启用」，再打开「项目便笺」，或点击左侧新增的便笺图标。
4. 输入内容，点击「保存便笺」。也可以点击「填写任务」，将内容带到新建任务页。

安装会把清单和脚本复制到应用数据目录。修改源码后，通过「插件操作 → 从目录更新」重新安装；更新会保留数据和兼容的设置，并将插件停用，重新启用后生效。安装本身不会运行脚本。

## 文件结构

```text
my-plugin/
├── oiagent.plugin.json
└── main.js
```

`main.js` 是单个普通 JavaScript 文件，可以由 TypeScript 或其他工具打包生成。不要输出 ESM `import`、CommonJS `require` 或额外运行时文件。入口可以位于子目录，例如 `dist/main.js`。

类型提示见仓库的 [`sdk/oiagent-plugin.d.ts`](https://github.com/yemaster/OiAgent/blob/main/sdk/oiagent-plugin.d.ts)，无需安装运行时 SDK。

## 插件清单

```json
{
  "schemaVersion": 2,
  "apiVersion": 1,
  "id": "example.notes",
  "name": "便笺",
  "version": "1.0.0",
  "description": "记录工作中的想法。",
  "main": "main.js",
  "permissions": ["workspace.read", "tasks.draft"],
  "contributes": {
    "views": [
      { "id": "notes", "title": "便笺", "icon": "notebook", "activityBar": true }
    ],
    "commands": [
      { "id": "open", "title": "打开便笺", "view": "notes" }
    ],
    "configuration": [
      { "id": "prefix", "title": "标题前缀", "type": "string", "default": "" }
    ]
  }
}
```

| 字段 | 规则 |
| --- | --- |
| `id` | 建议使用 `作者.插件名`。小写字母、数字、点和连字符，字母或数字开头，不含连续两个点，最长 100 字节。 |
| `name` / `version` | 必填。名称最长 100 字节，版本最长 40 字节。 |
| `main` | 插件目录内的 `.js` 相对路径；不允许向上访问或经过符号链接。 |
| `permissions` | 只填写实际用到的权限，见下表。 |
| `contributes.views` | 1–12 个页面。ID 在插件内唯一。每个页面作为独立标签打开。 |
| `contributes.commands` | 最多 32 个命令。出现在全局搜索中，选择后打开 `view` 指定的页面。 |
| `contributes.configuration` | 最多 32 项设置，类型为 `string` 或 `boolean`，必须有同类型的 `default`。 |

每个插件最多注册一个 `activityBar` 图标。其余页面从插件详情、侧边栏、搜索命令或 `views.open()` 打开。

可用图标：`puzzle`、`notebook`、`list`、`chart`、`code`、`terminal`、`folder`、`workflow`、`globe`、`layout`、`search`、`check`。它们使用应用的 Lucide 图标，自动适配主题；本版本不加载插件自己的 SVG 或图片。

## 生命周期

```js
oiagent.onOpen(async ({ viewId, settings, values }) => {
  const saved = await oiagent.storage.get();
  oiagent.ui.render({
    type: "stack",
    children: [
      { type: "textarea", id: "note", label: "便笺", value: values.note ?? saved.note ?? "" },
      { type: "button", text: "保存", action: "save", variant: "default" }
    ]
  });
});

oiagent.onAction(async ({ action, values }) => {
  if (action === "save") {
    await oiagent.storage.set({ note: values.note });
    await oiagent.notify("已保存");
  }
});
```

- 安装和启用只注册入口，不创建 Worker。
- 页面显示时加载入口并调用 `onOpen`。切到其他标签或功能页、关闭页面、停用或卸载插件时，终止 Worker；重新进入会再次调用 `onOpen`。
- 表单输入在当前标签存续期间保留，重新进入时通过 `values` 传入。关闭标签会丢弃未保存的表单输入。需要跨重启保存的数据应调用 `storage.set()`。
- 同一插件的不同页面分别拥有自己的表单和 Worker，共享插件设置与持久数据。当前只运行可见页面，不提供后台常驻插件。
- `onOpen` 中的 `settings` 已合并默认值。保存插件设置后，下次打开页面使用新设置。
- 项目上下文取第一次打开该页面时的项目和任务，随后切换标签不会改变它。关闭后从其他项目重新打开可更换上下文。远程任务不会把远程目录作为本机新任务目录。

不要依靠全局变量保存跨页面数据，也不要在加载脚本时直接发起任务操作。

## UI 组件

`oiagent.ui.render(tree)` 替换当前页面的组件树。宿主负责字体、颜色、间距、键盘操作和暗色主题。所有字符串按文本渲染，不解析 HTML，也不接受 CSS 或 DOM 事件代码。

| `type` | 内容 |
| --- | --- |
| `stack` | 垂直排列 `children`。 |
| `row` | 水平排列 `children`，空间不足时换行。 |
| `section` | 分区，支持 `text` 标题和 `children`。 |
| `heading` / `text` | 显示 `text`；普通文本保留换行。 |
| `code` / `badge` | 代码文本或次要状态标签，内容为 `text`。 |
| `input` / `textarea` | `id`、`label`，可选字符串 `value`。 |
| `checkbox` | `id`、`label`，可选布尔 `value`。 |
| `select` | `id`、`label`、`options: [{value, label}]`；选项值非空且唯一。 |
| `button` | `text`、`action`；`variant` 为 `default`、`outline` 或 `secondary`。 |
| `table` | `columns: string[]` 和 `rows: string[][]`。 |
| `separator` | 分隔线。 |

表单字段必须有唯一 `id`，支持字母开头的字母、数字、下划线、点和连字符。按钮和表单支持 `disabled`。

按钮触发 `onAction({ action, values })`。`values` 包含表单默认值和用户输入；读取输入不需要监听每次按键。`render()` 的字段默认值不会覆盖用户已输入的内容。

## API 与权限

以下异步 API 均返回 Promise。失败时 reject，可用 `try/catch` 处理；未捕获的按钮操作错误显示为提示，不关闭页面。

| API | 权限 | 行为 |
| --- | --- | --- |
| `workspace.getContext()` | `workspace.read` | 返回 `{project, taskId}`，未选择时为 `null`。 |
| `tasks.list()` | `tasks.read` | 返回最多 200 条任务摘要：ID、标题、项目、状态、Agent 类型、设备名称和用量。没有 Prompt、执行日志、启动参数或密钥。 |
| `tasks.createDraft({title?, prompt})` | `tasks.draft` | 打开新建任务页并填入文本。用户选择 Agent、权限并启动；已有未提交草稿时拒绝覆盖。 |
| `views.open(viewId)` | 无 | 打开本插件清单中注册的页面；不能打开其他插件的私有入口。 |
| `storage.get()` | 无 | 读取本插件数据对象。 |
| `storage.set(data)` | 无 | 替换本插件完整数据对象；不是增量合并。请等待保存完成。 |
| `notify(message)` | 无 | 显示带插件名称的普通通知，最长 300 字符。 |

同一页面中的保存请求按顺序执行。数据写入失败时保留上次成功保存的内容。插件被停用或版本发生变化后，旧页面的存储请求会被拒绝。

宿主 API 不提供 Shell、任意文件读写、Tauri invoke、LLM API Key 或自动启动任务。网络接口、动态脚本导入和子 Worker 也不属于当前 SDK。

## 限制与排错

| 项目 | 限制 |
| --- | --- |
| 清单 / 入口脚本 | 64 KB / 512 KB，UTF-8 普通文件。 |
| 持久数据 / 组件树 / 表单缓存 | 各 128 KB。 |
| 组件数量 / 嵌套 | 400 个 / 最多 12 层嵌套。 |
| 表格 / 下拉选项 | 200 行、12 列 / 100 个选项。 |
| 消息 / 在途 API 请求 | 每秒最多 120 条 / 最多 16 个。 |
| 初始化 | 20 秒内需要绘制页面。 |
| Worker 响应 | 心跳连续超过 15 秒未响应时停止。 |

界面更新按帧合并。切换页面时移除消息处理资源、定时器和 Worker，不把插件逻辑放进任务或编辑器的主线程。应用插件没有后台轮询工作区的权限。

出错时页面提供「重新加载」和「管理此插件」。安装失败会保留原插件；清单和脚本在预览之后被修改时，需要重新确认。卸载会删除插件自身的设置与数据，不删除项目和任务。

Worker 提供线程和生命周期隔离，不等于恶意代码安全沙箱。仅安装可信插件。本版没有插件市场、签名验证、任意 HTML Webview 或 Node.js 插件宿主。

## 设计依据

- [VS Code Contribution Points](https://code.visualstudio.com/api/references/contribution-points)：通过清单注册界面入口与设置。
- [VS Code Extension Host](https://code.visualstudio.com/api/advanced-topics/extension-host)：按需激活，在独立执行环境运行扩展。
- [VS Code Web Extensions](https://code.visualstudio.com/api/extension-guides/web-extensions)：Worker 运行时和受约束的宿主 API。
- [IntelliJ IDEA 插件管理](https://www.jetbrains.com/help/idea/managing-plugins.html)：区分安装、启停、更新和卸载。
