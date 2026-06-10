# GitHub Release 自动发布与应用内更新

Spark Agent 桌面端现在使用 `electron-builder + electron-updater + GitHub Releases` 作为发布与更新源。

## 发布流程

1. 合并代码到 `master`
2. 只有 [apps/desktop/package.json](/Users/zhangyang/spark_ai_project/Spark-Agent/apps/desktop/package.json) 被改动时，workflow 才会触发
3. Workflow 会对比本次 push 前后的 `version`，只有版本号真的变化才继续发布
4. Workflow 自动创建 `v<version>` tag（如果还不存在）
5. `electron-builder` 为 macOS、Windows、Linux 打包并上传到对应 GitHub Release
6. Release 中的更新元数据由 `electron-builder` 自动生成，应用内通过 `electron-updater` 检查、下载并安装

## 当前仓库配置

- 发布源配置在 [apps/desktop/electron-builder.yml](/Users/zhangyang/spark_ai_project/Spark-Agent/apps/desktop/electron-builder.yml)
- 自动发布 workflow 在 [publish-desktop-release.yml](/Users/zhangyang/spark_ai_project/Spark-Agent/.github/workflows/publish-desktop-release.yml)
- 应用内更新服务在 [UpdateService.ts](/Users/zhangyang/spark_ai_project/Spark-Agent/apps/desktop/src/main/services/UpdateService.ts)
- Playwright 相关 JS 包不再走整包 `asarUnpack`，避免 pnpm 硬链接目录在 `electron-builder` 打包阶段触发重复 link 的 `EEXIST`

## 使用要求

- 每次希望发布新版本时，需要先更新 `apps/desktop/package.json` 里的 `version`
- GitHub Actions 需要仓库 `contents: write` 权限来创建 tag 和 release
- 若要用于正式分发，建议配置签名相关 secrets：
  - `CSC_LINK`
  - `CSC_KEY_PASSWORD`
  - `APPLE_ID`
  - `APPLE_APP_SPECIFIC_PASSWORD`
  - `APPLE_TEAM_ID`
  - `WIN_CSC_LINK`
  - `WIN_CSC_KEY_PASSWORD`

## 更新通道

- `stable` 通道读取正式 release
- `beta` 通道允许读取 prerelease；如果后续要发 beta，只需要把发布流程改为 prerelease 即可
