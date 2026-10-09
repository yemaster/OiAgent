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

点击「添加 API」进入配置页面，填写名称、Base URL、API Key 和鉴权方式。编辑已有配置也使用同一个页面，切换页面后返回可继续填写。

默认模型和 Haiku / Sonnet / Opus / Fable 映射都可以手动输入。点击「获取模型列表」后，可搜索服务返回的模型并填入对应字段；不会覆盖已填写的模型。列表接口不可用时仍可手动保存。

在「连接测试」中选择具体模型，或已填写映射的模型别名，再点击测试。测试会发送一条简短 Anthropic Messages 请求，可能产生少量用量；列表页也提供测试入口。模型列表可用不代表所有模型都能调用，测试结果以所选模型为准。

保存后，在新建任务或发送后续消息时选择这套 API 配置。

服务须兼容 Anthropic Messages。OiAgent 不转换 API 协议，配置通过任务子进程环境传入，不改写 Claude 的全局配置。已有 Claude 原生设置如果覆盖相同环境变量，需要自行处理冲突。Fable 使用 `ANTHROPIC_DEFAULT_FABLE_MODEL`，本机 CLI 也需要支持该别名。

远程 API 使用 HTTPS，本机服务允许 HTTP。Base URL 可包含网关路径前缀，模型列表与测试分别访问其下的 `v1/models` 和 `v1/messages`；地址已以 `/v1` 结尾时不会重复拼接。测试不跟随重定向。修改服务地址或鉴权方式后，需要重新填写密钥，不会将旧密钥发送给新地址。

## LLM API

使用兼容 Chat Completions 的服务。Base URL 包含服务商 API 前缀，例如 `https://provider.example/v1`，再填写模型 ID 和密钥。

远程服务须使用 HTTPS，localhost 允许 HTTP。连接测试会向所配置服务发送一条简短请求。

## 保存与移除

LLM 配置和密钥使用 AES-256-GCM 加密保存在应用数据目录的 `secrets/llm.enc`，重启后自动读取，不访问系统钥匙串。加密密钥位于 `secrets/llm.key`，备份时需一并保留。相同 LLM API 地址下留空 Key 会保留旧密钥；更换地址不会自动携带原密钥。点击「移除配置」可以删除保存的配置。

从使用钥匙串的旧版本更新后，需重新填写并保存一次 LLM API Key。旧钥匙串记录不会自动读取或移除。

Claude Code API 密钥仍保存在系统凭据库：macOS Keychain、Windows Credential Manager 或 Linux Secret Service。凭据库不可用时会报错。

任务的高级环境变量是另一项功能，仅保存在本次应用内存中；不要将它与 API Key 的持久保存混淆。
