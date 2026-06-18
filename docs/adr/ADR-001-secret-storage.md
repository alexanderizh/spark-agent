# ADR-001: API Key 与敏感凭证存储策略

- **状态**: 已接受 (Accepted)
- **日期**: 2026-05-26
- **决策者**: 子涵-架构师
- **关联任务**: P0-01, P0-04

---

## 背景

Spark Agent 需要代表用户存储多个 AI Provider 的 API Key（Anthropic、OpenAI、DeepSeek 等）。这些凭证一旦泄露，攻击者可以消耗用户的 API 配额或访问用户数据。

## 决策

**使用操作系统原生 Keychain 存储所有 API Key，SQLite 中只存储 Keychain 引用 ID（非明文 Key）。**

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
keytar.setPassword(service, account, key)
      ↓
OS Keychain 加密存储
      ↓
返回 Keychain 引用 ID（如 "anthropic-default"）
      ↓
SQLite provider_profiles.keychain_ref = "anthropic-default"
```

读取时：
```
keytar.getPassword(service, account)  →  返回明文 Key（仅在内存中使用）
```

### macOS Keychain 授权弹窗控制

macOS 会在应用读取 Keychain 项时校验访问方身份。开发包、签名、运行路径频繁变化时，系统可能反复弹出“允许访问钥匙串”的密码框。

为降低用户干扰：

- Provider API Key 读取后会缓存在 Electron 主进程内存中；同一次应用运行期间，新会话、媒体能力解析、健康检查等重复读取不会再次访问 Keychain。
- Provider API Key 的持久化来源仍然是 OS Keychain，SQLite 只保存 `keystore_ref`。
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

### 方案 A：加密存储在 SQLite
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

- `packages/shared/src/keystore.ts` 是唯一合法的 keytar 调用入口，其他模块不得直接 import keytar
- 所有包含 API Key 的字段在日志、错误信息中必须做掩码处理（只显示前4位）
- `.gitignore` 必须排除 `.env`、`*.key`、`secrets.json` 等敏感文件

## 后续

- P0-04 中的 `packages/shared/src/keystore.ts` 实现此接口
- P1-09 的 Provider 配置 UI 通过 IPC 调用 keystore，不直接接触 API Key 明文
