import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
const base = process.env.PAGES_BASE ?? "/OiAgent";
export default defineConfig({
  site: process.env.PAGES_SITE || "https://yemaster.github.io",
  base,
  output: "static",
  trailingSlash: "always",
  integrations: [
    starlight({
      title: "OiAgent",
      description: "OiAgent 使用文档：管理 Agent、项目、任务与历史对话。",
      defaultLocale: "root",
      locales: { root: { label: "简体中文", lang: "zh-CN" } },
      logo: { src: "./public/oiagent.svg" },
      favicon: "/favicon.png",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/yemaster/OiAgent",
        },
      ],
      editLink: {
        baseUrl: "https://github.com/yemaster/OiAgent/edit/main/website/",
      },
      customCss: ["./src/styles/theme.css"],
      sidebar: [
        {
          label: "开始使用",
          items: [
            { label: "安装与首次使用", slug: "docs/getting-started" },
            { label: "Agent 支持范围", slug: "docs/agents" },
          ],
        },
        {
          label: "日常使用",
          items: [
            { label: "任务与历史", slug: "docs/tasks" },
            { label: "终端与审批", slug: "docs/terminal" },
            { label: "文件与改动", slug: "docs/files" },
            { label: "临时项目", slug: "docs/temporary-projects" },
            { label: "模板与自动化", slug: "docs/automation" },
          ],
        },
        {
          label: "配置",
          items: [
            { label: "API 与密钥", slug: "docs/api" },
            { label: "指令文件", slug: "docs/instructions" },
            { label: "MCP、Skills 与插件", slug: "docs/extensions" },
            { label: "局域网连接", slug: "docs/lan" },
          ],
        },
        {
          label: "参考",
          items: [
            { label: "数据与常见问题", slug: "docs/reference" },
            { label: "开发与发布", slug: "docs/development" },
          ],
        },
      ],
    }),
  ],
});
