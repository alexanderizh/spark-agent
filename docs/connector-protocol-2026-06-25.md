# 连接器协议 2026-06-25

> 状态: 实施中 | 最后核对: 2026-06-25

## 目标

连接器用于让 Spark Agent 连接第三方平台。用户完成平台认证后，Agent 可以在授权范围内使用平台能力，例如 GitHub 的仓库管理、拉取、提交、Issue / PR 操作，以及后续通过 MCP 工具桥接暴露给运行时。

## 协议边界

- **Connector Provider Manifest**：平台声明，包含协议版本、认证方式、端点和能力清单。
- **Connector Connection**：用户的一条实际连接，保存状态、账号摘要、授权范围和非敏感配置。
- **Secrets**：协议只记录 secret field 名称或 keystore 引用，绝不在连接器配置中保存明文密钥。
- **Capabilities**：统一描述平台能力，并标注所需 scope、风险等级和默认启用状态。
- **External Source**：外部对象映射回 Spark 本地对象时使用的来源标识。

## GitHub v1

首个落地连接器为 GitHub：

- 认证：GitHub OAuth 与 Fine-grained PAT 两种入口。
- 读能力：身份识别、仓库列表/同步、Issue 读取。
- 写能力：提交、分支、PR、Issue 写回默认关闭，需要用户显式启用。
- MCP 桥接：协议中预留 `mcp_tools` 能力，后续由运行时把授权能力注入对应 MCP 工具集。

## 业界方案对齐（2026-06-25 复核）

本轮按主流官方方案补齐连接器协议：

- **OAuth + PKCE**：桌面端默认推荐，避免把 client secret 暴露在 renderer，token 由主进程 keystore 保存。
- **Device Flow**：为 CLI、远程终端、无浏览器回调环境预留。
- **GitHub App Installation Token**：团队/组织生产集成优先，短期 installation token + 仓库级授权优于长期 PAT。
- **Fine-grained PAT**：保留为开发期、私有部署和手动验证入口，界面不持久化明文 token。
- **MCP OAuth 2.1**：远程 MCP 连接器应使用 OAuth 2.1 授权模型，并在协议层记录 token 存储、安全偏好与能力风险。

参考：

- GitHub OAuth Apps authorization flow: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
- GitHub fine-grained PAT permissions: https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens
- GitHub App installation access tokens: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token
- MCP Authorization: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization

## 已落地文件

- 协议类型与 GitHub manifest：`packages/protocol/src/connectors.ts`
- 入口导出：`packages/protocol/src/index.ts`
- 产品入口与 GitHub 连接器 UI：`apps/desktop/src/renderer/design/views/McpView.tsx`
