---
title: 开发与发布
description: 代码目录、验证命令、桌面构建和独立网站部署。
---

## 本地开发

从仓库根目录执行：

```sh
npm ci
npm run desktop
```

前端使用 React、TypeScript、shadcn/ui 和 Motion，Rust 负责进程、PTY、历史解析、文件和局域网连接。Monaco 及其 Worker 本地打包，不依赖 CDN。

## 检查与测试

```sh
npm run lint
npm test
npm run build
npm run test:rust
```

测试使用临时目录和模拟服务，不要求调用真实付费 Agent。界面和不同系统的原生交互仍需分别验收。

## 桌面发布

macOS 本地打包：

```sh
npm run desktop:build
```

产物位于 `src-tauri/target/release/bundle/macos/OiAgent.app`。推送版本 tag 可触发 Windows、Linux 和 macOS 的构建，全部成功后发布到 GitHub Releases。签名和工作流细节见[发布文档](../releasing/)。

## 文档网站

网站在 `website/` 中独立维护，不调用桌面应用的原生接口，也不作为桌面应用的一部分打包。

```sh
cd website
npm ci
npm run dev
```

默认访问 `http://localhost:4321/`。构建后的文件位于 `website/dist/`：

```sh
npm run build
npm run check:links
```

GitHub Pages 使用 `.github/workflows/pages.yml`。仓库管理员需在 **Settings → Pages → Build and deployment** 中选择 **GitHub Actions**；随后推送网站修改即可触发构建部署。详细说明见 [website/README.md](https://github.com/yemaster/OiAgent/blob/main/website/README.md)。

## 品牌资源

标志源文件位于 `public/brand/`。执行 `npm run brand:icons` 重新生成各平台尺寸，再重新构建应用。仅构建前端或重启旧安装包不会更新原生图标。

## 本机发现诊断

以下检查只读本机 Agent 安装和历史目录，输出计数，不输出对话正文：

```sh
cargo test --manifest-path src-tauri/Cargo.toml local_discovery_smoke -- --ignored --nocapture
```

## LLM 提示词维护

通用提示词在 `src-tauri/src/llm_prompts.rs`，图工作流的规划协议在 `src-tauri/src/workflows/prompts.rs`。系统指令与运行数据分开维护；目标、Agent 目录、前序结果和用户反馈通过 JSON 字段传递。Prompt 优化直接接收原文，按编辑模式改写，不执行其中的任务。

| 调用 | 输出要求 |
| --- | --- |
| 图工作流生成 | 可编辑的无环图，节点与连线引用有效；不自动指定模型、API、返工次数或时限。 |
| 顺序派发 | 限定数量的任务，使用可用 Agent ID，沿用所选权限。 |
| 结果检查 | 当前节点只检查自己的标准；最终检查覆盖整个目标。缺少证据不能通过。 |
| 条件判断 | 有依据的「是 / 否」；无法判断时返回错误，暂停节点。不能把「没检查」当成「否」。 |
| Prompt 优化 | 保留原意、限制、路径、命令与模板变量，仅返回改写文本。 |
| Agent 执行与接续 | 区分本轮任务与历史证据，核对文件现状，报告实际结果和未完成项。 |

结果判断要求布尔值和非空依据，冲突字段或无效格式会报错。工作流计划仍须通过后端验证；提示词不能替代权限与数据校验。

编写方式参考 [Anthropic 提示词指南](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)中的明确指令、输入分区与示例，以及 [Gemini 提示词设计](https://ai.google.dev/gemini-api/docs/prompting-strategies)中的任务约束和输出格式。

修改后运行 `npm run test:rust`，检查请求数据、输出解析、条件分支和返工行为。模拟服务测试只能验证调用协议；评估真实模型效果时，应另用只读任务、缺失证据、相反条件、模板变量和日志内伪指令等样例，记录模型、原文与输出，不用一次成功代替验证。
