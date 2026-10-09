# 发布 OiAgent

参考 [Tauri 官方 GitHub 构建说明](https://v2.tauri.app/distribute/pipelines/github/)，工作流位于 `.github/workflows/release.yml`。

将提交推送到 GitHub 后，推送版本 tag 即可发布：

```sh
git tag v0.1.0
git push origin v0.1.0
```

支持 `v1.2.3` / `1.2.3`，以及 `v1.2.3-beta.1` 形式的预发布。带预发布标识的 tag 自动标记为 GitHub Pre-release；普通分支推送不会发布。tag 不能包含构建元数据 `+...`，以保持各平台安装包版本兼容。

CI 用 tag 同步临时检出目录中的 npm、Tauri、Cargo 版本和锁文件，不回写仓库。四个构建并行完成：

| 平台    | 架构          | 安装包              |
| ------- | ------------- | ------------------- |
| Windows | x64           | NSIS `.exe`、`.msi` |
| Linux   | x64           | `.deb`、`.AppImage` |
| macOS   | Apple Silicon | `.dmg`              |
| macOS   | Intel         | `.dmg`              |

本地配置默认只生成 macOS `.app`，CI 通过 `--bundles` 显式指定各平台安装包。图标从 SVG 重新生成。安装包先作为 Actions artifacts 保存 7 天；所有平台成功后，统一创建 Release 草稿、上传六个安装包，再自动公开。失败时不会发布不完整的新 Release，可重跑失败 job。重跑完整流程会更新同一 tag 的附件。

使用仓库自带 `GITHUB_TOKEN`，仅发布 job 具有 `contents: write` 权限，不需要个人访问令牌。仓库须启用 GitHub Actions；组织策略需要允许工作流写入 Releases。首次真实跨平台构建仍需推送 tag 后在 Actions 中确认。

当前不含付费代码签名证书和 Apple 公证。macOS 使用 ad-hoc 签名；Windows 未做 Authenticode 签名，因此系统可能提示来自未知发布者。如需正式签名发行，后续应配置对应证书与 Secrets。此工作流不配置应用内自动更新服务。
