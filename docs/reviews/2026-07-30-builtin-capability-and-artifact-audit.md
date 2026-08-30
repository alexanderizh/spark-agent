# 内置能力与 Artifact 仓库更新审计（2026-07-30）

## 本轮更新

| 范围                              | 原版本/状态                                   | 更新后                                                      |
| --------------------------------- | --------------------------------------------- | ----------------------------------------------------------- |
| Codex SDK                         | `0.144.5`                                     | `0.146.0`                                                   |
| Claude Agent SDK（含 8 个平台包） | `0.3.211`                                     | `0.3.220`                                                   |
| Anthropic SDK                     | `0.106.0`                                     | `0.115.0`                                                   |
| MCP SDK                           | `1.29.0`                                      | `1.30.0`                                                    |
| Playwright MCP                    | `0.0.78`，版本已最新但 packaged CLI 位于 ASAR | `0.0.78`，CLI 与匹配的 `playwright-core` 外置到真实资源目录 |
| `multi-search-engine`             | 旧 Bing/Baidu 解析与失效脚本引用              | `2.1.0`，统一调用 `spark_search` MCP                        |
| `spark-web-tool`                  | 声明旧 `WebSearch` / `WebFetch`               | `2.1.0`，统一调用 `spark_search` MCP                        |
| Claude API 内置技能               | 旧缓存内容                                    | 同步 Managed Agents 新资料并刷新 Claude 5 模型目录          |

联网搜索默认免密链调整为 Bing → DuckDuckGo → 百度。Bing 解析适配当前 HTML 与跳转链接；
百度反爬页会被识别为失败；keyed provider 异常会回退免密链，并通过 `warnings` 告知调用方。

## MinIO 审计

线上清单：
`https://minio.yiqibyte.com/spark-desktop/artifact-repository/v1/index.json`

- `updatedAt`: `2026-07-31`
- artifacts: 64
- skills: 33
- binary: 16
- runtime: 6
- python wheelhouse: 3
- voice: 5
- archive: 1

64 个对象均通过 HEAD 可达性与 `Content-Length` 核对；33 个技能归档进一步完成全量下载、
文件大小与 SHA-256 校验。可使用
`node scripts/audit-artifact-repository.mjs --verify-skills` 重复审计。

线上清单没有 `plugin` artifact 类型。桌面端 Claude 原生技能插件由
`AppSkillsManager` 根据已安装技能动态生成；外部连接器插件不由此 MinIO 清单分发。

## Codex 0.146.0 发布物

`pnpm artifacts:codex 0.146.0 <输出目录>` 已为以下目标生成归档：

- macOS arm64 / x64
- Linux arm64 / x64
- Windows arm64 / x64

六个归档均验证包含 `bin/codex`（Windows 为 `bin/codex.exe`）与
`codex-package.json`。SHA-256、体积和 manifest 条目记录在
`docs/release-manifests/codex-runtime-0.146.0.json`。

六个平台归档和更新后的 `index.json` 已于 2026-07-31 发布到 MinIO。发布前清单备份位于
`artifact-repository/v1/backups/index-2026-07-30T16-09-28-414Z.json`；线上同时保留
`0.144.5` 与 `0.146.0` 各六个平台条目。六个 `0.146.0` 对象已从公网资源地址完整下载，
文件大小与 SHA-256 均和仓库发布清单一致。

发布入口为
`pnpm artifacts:publish-codex <version> <artifact-dir>`。脚本使用环境变量读取凭据，
不会把账号密码写入仓库；重复发布相同版本时会校验并跳过一致对象，遇到同 ID 内容冲突则停止。
应优先配置 HTTPS endpoint；确需连接内网 HTTP MinIO 时，还必须显式设置
`RELEASE_MINIO_ALLOW_INSECURE_HTTP=1`。

## 未纳入本轮的依赖

`pnpm outdated -r` 仍报告 UI、编辑器、构建工具和数据库依赖的更新，包括 React、Vite、
Electron Toolkit、better-sqlite3、OpenAI JS SDK 等。这些更新不直接影响本轮内置联网搜索、
技能发现、Playwright MCP 或 Codex/Claude runtime，且部分为大版本，建议拆成独立升级批次
逐项做迁移和视觉/原生模块回归，不在本轮批量追最新版。
