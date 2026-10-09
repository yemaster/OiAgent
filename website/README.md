# OiAgent 网站

独立的项目首页与使用文档，使用 Astro + Starlight 构建。与桌面应用分开安装、开发和打包，不调用 Tauri，也不读取本机 Agent 数据。

## 本地运行

需要 Node.js 22.12+。

```sh
cd website
npm ci
npm run dev
```

默认地址为 `http://localhost:4321/OiAgent/`。项目介绍在 `src/content/docs/index.mdx`，文档在 `src/content/docs/docs/`，导航在 `astro.config.mjs`。

```sh
npm run build
npm run check:links
npm run preview
```

`dist/` 是可直接部署的静态产物，包含页面、代码高亮、Pagefind 搜索索引和本地资源。搜索请在构建后的预览环境中使用。

## GitHub Pages

1. 将仓库推送到 GitHub。
2. 在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
3. 推送 `website/` 的修改到 `main`，或手动运行 **Documentation website** 工作流。
4. 部署成功后，访问工作流显示的网站地址。本仓库默认地址为 `https://yemaster.github.io/OiAgent/`。

工作流先构建并检查站内链接，然后上传 `website/dist/` 并部署。Pull Request 只构建检查，不发布。它不触发桌面安装包发布。

`PAGES_SITE` 控制站点域名，`PAGES_BASE` 控制仓库子路径。工作流从 Pages 配置读取这两项。本地默认分别为 `https://yemaster.github.io` 和 `/OiAgent`；根域部署时将 `PAGES_BASE` 设为空字符串。更改域名后重新构建，不要直接移动旧产物。

品牌资源复制自根目录的 `public/brand/` 与 `public/favicon.png`，更新品牌时同步这两个文件。
