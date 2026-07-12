# ADR-001: API Key 与敏感凭证存储策略

- **状态**: 已接受 (Accepted)
- **日期**: 2026-05-26
- **决策者**: 子涵-架构师
- **关联任务**: P0-01, P0-04

---

## 背景

Spark Agent 需要代表用户存储多个 AI Provider 的 API Key（Anthropic、OpenAI、DeepSeek 等）。这些凭证一旦泄露，攻击者可以消耗用户的 API 配额或访问用户数据。

## 决策

**使用操作系统原生安全存储保存所有敏感凭据；macOS 将凭据集中到单个 Keychain vault，SQLite 只存引用和非敏感运行状态。**

### 实现方案

| 操作系统 | 存储机制 | Node.js 访问方式 |
|---------|----------|-----------------|
| macOS   | Keychain Services | `keytar` (N-API 原生模块) |
| Windows | Windows Credential Manager | `keytar` (N-API 原生模块) |
| Linux   | libsecret / KWallet | `keytar` (N-API 原生模块) |

### 数据流

```
用户输入 API Key
      ↓
macOS: keytar.setPassword(service, "credential-vault-v1", vaultJson)
Windows/Linux: keytar.setPassword(service, account, key)
      ↓
OS Keychain 加密存储
      ↓
返回 Keychain 引用 ID（如 "anthropic-default"）
      ↓
SQLite provider_profiles.keychain_ref = "anthropic-default"
```

读取时：
```
macOS: 读取一次 credential-vault-v1 → 在主进程内存中按 ref 解析
Windows/Linux: keytar.getPassword(service, account) → 返回明文 Key（仅在内存中使用）
```

### macOS Keychain 授权弹窗控制

macOS 会在应用读取 Keychain 项时校验访问方身份。开发包、签名、运行路径频繁变化时，系统可能反复弹出“允许访问钥匙串”的密码框。

为降低用户干扰：

- 安装版首次读取前必须由应用主动解释：平台不保存用户 API Key、密钥仅存在本机安全存储，并提示用户在系统窗口选择“始终允许”。
- 用户拒绝或系统安全存储暂时不可用时，启动预读降级为凭据不可用并记录日志，不得阻断 Spark 账号登录；用户可稍后在使用相关 Provider 时重新授权。
- macOS 的 Provider、平台模型和连接器敏感值集中存入一个 `credential-vault-v1` 条目；启动时一次读取并缓存，避免按 Provider 重复弹窗。
- 旧版独立 Keychain 条目在启动预读时迁入 vault；迁移完成后不再读取旧条目。
- Windows Credential Manager 对单条凭据大小有限制，继续保持每个 ref 一个条目；Windows 正常读取不会出现 macOS 式逐条密码授权窗口。
- `base-url`、平台用户 ID、待支付恢复状态等非敏感字段保存在 SQLite `app_settings`，不占用 Keychain 条目。
- SQLite 的 `provider_profiles.keystore_ref` 仍只保存引用，不保存 API Key 明文。
- Cloud Auth 登录态保留 `safeStorage` 加密备份；启动时优先读取加密备份，备份缺失时再访问 Keychain，用于减少应用启动阶段的钥匙串授权请求。

### keytar 的原生模块处理

`keytar` 是 N-API 原生模块，每次升级 Electron 版本后需要重新编译。

**必须在 `apps/desktop/package.json` 中配置**：

```json
{
  "scripts": {
    "postinstall": "electron-rebuild -f -w keytar"
  }
}
```

CI 流水线中需要：
1. 安装 `python`、`build-essential`（Linux）或 Xcode Command Line Tools（macOS）
2. 在 `pnpm install` 之后执行 `electron-rebuild`

## 被拒绝的方案

### 方案 A：将敏感值加密存储在 SQLite
- 需要自实现加密，密钥管理本身又是个鸡生蛋问题
- 不如 OS Keychain 安全
- **拒绝理由**：引入额外复杂度，安全性不如 OS 原生方案

### 方案 B：存储在 `.env` 文件
- 开发者可能不小心提交 `.gitignore` 漏掉的文件
- 不适合多 Provider、多 Profile 的动态管理场景
- **拒绝理由**：对最终用户不友好，且存在安全风险

### 方案 C：内存中存储（不持久化）
- 每次启动都需要重新输入
- **拒绝理由**：用户体验不可接受

## 约束

- `packages/shared/src/keystore/index.ts` 是 Provider/连接器凭据唯一合法的 keytar 调用入口，其他模块不得绕过 vault 直接增加条目
- 所有包含 API Key 的字段在日志、错误信息中必须做掩码处理（只显示前4位）
- `.gitignore` 必须排除 `.env`、`*.key`、`secrets.json` 等敏感文件

## 后续

- P0-04 中的 `packages/shared/src/keystore.ts` 实现此接口
- P1-09 的 Provider 配置 UI 通过 IPC 调用 keystore，不直接接触 API Key 明文
