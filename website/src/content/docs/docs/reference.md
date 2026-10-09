---
title: 数据与常见问题
description: 本地数据位置、用量口径和常见故障处理。
---

## 数据位置

实际目录显示在「设置偏好 → 通用设置」。macOS 默认为 `~/Library/Application Support/com.oiagent.desktop/`。

| 文件或目录 | 内容 |
| --- | --- |
| `state.json` | 项目、任务元数据、归档和重命名索引。 |
| `logs/` | 任务输出、归一化对话、PTY 记录。 |
| `history-index.json` | 历史增量解析缓存。 |
| `task-templates.json` | 用户任务模板。 |
| `temporary-projects/` | 应用分配的临时项目及已保留项目。 |
| `temporary-trash/` | 等待后台删除的临时文件。 |

API 密钥保存在系统凭据库，不在这些 JSON 文件中。日志可能包含 Agent 输出的项目内容，请按需要保管。

## 用量为什么显示「未上报」

OiAgent 只记录 Agent 实际上报的 Token。Aider、Goose 和部分终端任务没有可用统计时，会显示「未上报」，不会猜测数量。

累计会话用量按会话 ID 去重，缓存属于输入的一部分，不重复加到总量。趋势按会话最后活跃日期归组，不是逐请求的每日账单。

## 找不到 Agent

先在系统终端确认程序可以运行，再回到 Agent 页面扫描。仍未发现时，手动添加可执行文件。应用会检查 PATH、Homebrew、NVM 和常见用户安装目录，但不保证覆盖所有自定义安装方式。

## 任务一直等待操作

查看任务详情，确认是否遇到权限拒绝。需要原生审批时，切换到[终端模式](../terminal/)。当前没有统一 GUI 审批卡片。

## 历史没有立即出现

首次启动需要建立索引，应用先显示已保存的任务，再后台扫描。已支持导入的程序及范围见 [Agent 支持范围](../agents/)。

## 反馈问题

在应用的「关于」页面复制版本信息，附上系统、Agent 版本、复现步骤和错误内容。请通过 [GitHub Issues](https://github.com/yemaster/OiAgent/issues) 提交。分享日志前移除密钥、个人信息和私有项目内容。
