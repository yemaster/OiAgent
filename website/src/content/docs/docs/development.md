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

产物位于 `src-tauri/target/release/bundle/macos/OiAgent.app`。推送版本 tag 可触发 Windows、Linux 和 macOS 的构建，全部成功后发布到 GitHub Releases。签名和工作流细节见[发布文档](https://github.com/yemaster/OiAgent/blob/main/docs/RELEASING.md)。

## 文档网站

网站在 `website/` 中独立维护，不调用桌面应用的原生接口，也不作为桌面应用的一部分打包。

```sh
cd website
npm ci
npm run dev
```

默认访问 `http://localhost:4321/OiAgent/`。构建后的文件位于 `website/dist/`：

```sh
npm run build
npm run check:links
```

GitHub Pages 使用 `.github/workflows/pages.yml`。仓库管理员需在 **Settings → Pages → Build and deployment** 中选择 **GitHub Actions**；随后推送网站修改即可触发构建部署。详细说明见 [website/README.md](https://github.com/yemaster/OiAgent/blob/main/website/README.md)。
