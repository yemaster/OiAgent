---
title: 安装与首次使用
description: 安装 OiAgent，连接本机 Agent 并创建第一个任务。
---

## 安装应用

在 [GitHub Releases](https://github.com/yemaster/OiAgent/releases) 查找对应系统和架构的安装包。暂无对应产物时，可以从源码运行。

当前 macOS 已完成本机构建。Windows、Linux 和 macOS Intel / Apple Silicon 的自动构建已配置，其他平台仍需实机验证。当前构建未配置正式代码签名与 Apple 公证。

## 从源码运行

需要 Node.js 22.12+、Rust stable，以及 [Tauri 2 的系统依赖](https://v2.tauri.app/start/prerequisites/)。

```sh
git clone https://github.com/yemaster/OiAgent.git
cd OiAgent
npm ci
npm run desktop
```

只想预览界面时运行 `npm run dev`，访问 `http://127.0.0.1:1420`。浏览器使用演示数据；真实任务、文件、终端和配置管理需要桌面版。

## 创建第一个任务

1. 安装需要使用的 Agent CLI，并按它的说明完成登录。
2. 打开 **Agent 程序**，确认程序已被发现。未发现时重新扫描，或手动添加可执行文件。
3. 点击 **新建任务**，选择已有项目目录，或使用 **临时项目**。
4. 选择 Agent，填写任务内容和执行权限，然后启动。
5. 在 **当前任务** 中打开任务，查看回复、执行记录和状态。

默认权限为只读或计划模式。需要修改代码时，请选择对应的写入权限。

Codex、Claude Code、Qwen Code 的已有历史会在后台导入。首次索引可能较慢，之后只解析变化的记录。

## 接下来

- [任务与历史](../tasks/)：追加消息、继续会话和归档。
- [终端与审批](../terminal/)：在原生 TUI 中处理交互。
- [API 与密钥](../api/)：配置 Claude Code 服务、Prompt 优化和超级 Agent。
