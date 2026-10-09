---
title: API 与密钥
description: 区分 CLI 登录、Claude Code API 配置和 OiAgent 的 LLM API。
---

## 三种配置各管什么

| 配置 | 入口 | 用途 |
| --- | --- | --- |
| Agent 自身的登录 | 对应 CLI | 普通任务默认沿用。 |
| Claude Code API 配置 | Agent 程序 → Claude Code API 配置 | 为 Claude 任务选择不同的服务与模型。 |
| LLM API | 设置偏好 → LLM API | Prompt 优化与超级 Agent 的规划、复核。 |

## Claude Code 多 API

填写配置名称、Base URL、API Key、默认模型，以及需要的 Haiku / Sonnet / Opus 映射。新建任务或发送后续消息时选择配置。

服务须兼容 Anthropic Messages。OiAgent 不转换 API 协议，配置通过任务子进程环境传入，不改写 Claude 的全局配置。已有 Claude 原生设置如果覆盖相同环境变量，需要自行处理冲突。

## LLM API

使用兼容 Chat Completions 的服务。Base URL 包含服务商 API 前缀，例如 `https://provider.example/v1`，再填写模型 ID 和密钥。

远程服务须使用 HTTPS，localhost 允许 HTTP。连接测试会向所配置服务发送一条简短请求。

## 保存与移除

配置和密钥加密保存在系统凭据库，重启后自动读取。相同 LLM API 地址下留空 Key 会保留旧密钥；更换地址不会自动携带原密钥。点击「移除配置」可以删除保存的配置。

系统凭据库分别为 macOS Keychain、Windows Credential Manager 和 Linux Secret Service。凭据库不可用时会报错，不降级为明文存储。

任务的高级环境变量是另一项功能，仅保存在本次应用内存中；不要将它与 API Key 的持久保存混淆。
