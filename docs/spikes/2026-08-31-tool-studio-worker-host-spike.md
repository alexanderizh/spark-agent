# Tool Studio Worker Host 安全与打包 Spike

> 状态: 已落地 | 最后核对: 2026-08-31

## 1. 结论

P1 可以复用 SparkWork 已随应用分发的独立 Node Runtime。当前允许开放明确标记为 `trusted-local`、由用户自己编写或逐字审查的 TypeScript 工具；**仍不能把它描述为可安全执行来源不明或恶意代码的完整沙箱**。

已验证的基础能力：

- 独立 Node 进程，不复用 Electron 可执行文件；
- 结构化 IPC、进程级超时终止与崩溃隔离可行；
- Node Permission Model 可默认拒绝文件、子进程、Worker、原生 Addon 与 WASI；
- `--max-old-space-size` 可限制 V8 heap，异常退出不会拖垮宿主；
- macOS 安装包内 Runtime 已独立签名，打包脚本在 Windows 也会签名并校验发布者。

阻断项：Node 22.14.0 的 Permission Model **没有网络权限边界**。实测启用 `--permission` 后，用户代码仍能使用 `fetch()` 直连 HTTP。仅删除 `fetch`、拦截 `node:net`、使用 ESM loader、`vm` 或 monkey-patch 都不能作为不可信代码的安全边界。

因此不可信代码模式的开放门槛仍是：为 Runner 增加平台级默认断网，并让外部网络、文件写入等能力只能经过宿主 Broker。在此前提完成前，Developer Mode 仅运行 `trusted-local` 代码：独立进程、默认拒绝文件/子进程/Worker/Addon/WASI，不注入 Keychain 和宿主环境；外部能力只允许通过声明白名单后的 `sdk.tools.call` 组合受管工具。此边界限制爆炸半径，但不取代用户对源码可信度的判断。

## 2. 实测环境

| 项目         | 观察结果                                                               |
| ------------ | ---------------------------------------------------------------------- |
| Runtime      | `/Applications/Spark Agent.app/Contents/Resources/runtime/node/node`   |
| Node 版本    | `v22.14.0`，与仓库 `.nvmrc` / `.node-version` 一致                     |
| Runtime 大小 | 107,987,872 bytes                                                      |
| SHA-256      | `1c50d6a19031be2a245217369406caec70900cb8c5f96d0596eaed4db70b7b21`     |
| macOS 签名   | Developer ID Application，Team ID `CCUUJZC28D`，Hardened Runtime，有效 |
| 执行日期     | 2026-08-31，macOS arm64                                                |

哈希仅记录本机已安装构建的事实，不是发布锁文件。Windows 与 Linux 本轮只核对打包代码和单测，未在对应系统实机运行。

## 3. 安全能力验证

### 3.1 已通过

| 验证项          | 方式                                    | 结果                                 |
| --------------- | --------------------------------------- | ------------------------------------ |
| 独立进程        | 使用 `SPARK_STANDALONE_NODE` 启动子进程 | 通过，PID 与宿主独立                 |
| 结构化 IPC      | stdin 输入 JSON，stdout 返回 JSON       | 通过，输入 `{a:2,b:5}` 得到 `sum:7`  |
| 文件默认拒绝    | `node --permission` 读取 `/etc/hosts`   | `ERR_ACCESS_DENIED / FileSystemRead` |
| 子进程默认拒绝  | `spawnSync()`                           | `ERR_ACCESS_DENIED / ChildProcess`   |
| Worker 默认拒绝 | `new Worker()`                          | `ERR_ACCESS_DENIED / WorkerThreads`  |
| 超时隔离        | 宿主终止无限定时器子进程                | 子进程收到 `SIGTERM`，宿主存活       |
| 崩溃隔离        | Runner `process.exit(73)`               | 仅子进程退出，宿主存活               |
| heap 上限       | `--max-old-space-size=16`               | V8 实际最小 heap limit 为 64 MiB     |
| 内存异常隔离    | 16 MiB 参数下持续分配                   | 子进程 `SIGABRT`，宿主存活           |

生产实现不能只依赖 V8 heap 参数：Buffer、原生模块和进程开销不全部计入 heap。还需要操作系统级内存配额或可信 Host 的 RSS 监控、软终止和硬终止。

### 3.2 未通过：网络默认拒绝

验证方式：宿主在 `127.0.0.1` 启动临时 HTTP 服务，Runner 使用：

```text
node --permission -e 'fetch("http://127.0.0.1:<port>") ...'
```

结果：请求成功并读取到响应正文。这证明 Node Permission Model 不能承担 Tool Studio 的网络隔离。

不可接受的替代方案：

- 仅覆盖 `globalThis.fetch`；
- 仅用 loader 禁止 `node:net` / `node:http`；
- 在同一进程用 `node:vm` 执行；
- 依赖工具声明或代码审查约束网络访问。

这些方案都不是针对恶意或被供应链污染代码的可靠边界。

## 4. 推荐的生产架构边界

```text
Electron Main
  └─ Trusted Worker Host（协议、生命周期、审计）
       └─ One Runner per tool/version（不可信 TypeScript 构建产物）
            ├─ OS 级默认断网
            ├─ Node --permission：仅只读版本快照
            ├─ 禁止 child / worker / addon / WASI
            ├─ V8 heap + OS/RSS 内存限制
            └─ 所有网络/写文件/密钥访问 → Broker capability
```

边界要求：

1. Main、Renderer、Agent Runtime 永不加载第三方代码。
2. Runner 身份由父进程 PID 与启动时绑定的 tool/version 决定，不信任子进程上报的身份。
3. 每个发布版本使用不可变快照目录；Runner 只读该目录，开发目录不能成为线上依赖。
4. 网络默认拒绝。HTTP 只能提交结构化请求给 Broker，由 Broker 做域名白名单、SSRF、重定向、响应上限、超时、密钥注入和审计。
5. 文件默认拒绝。确需写入时只开放每次调用的临时目录，交付产物由 Broker 显式接收。
6. 不向 Runner 注入 Provider API Key、系统环境变量或完整宿主环境；环境变量使用最小白名单。
7. IPC 设置帧大小、请求 ID、版本号、超时和背压；日志与协议通道分离。
8. 崩溃、超时、OOM 或协议错误只标记当前调用失败，不停用会话，也不切换稳定版本。

### 4.1 平台级断网候选

生产前需分别做真机 spike 并形成统一 Broker 契约：

- macOS：受 App Sandbox 约束的独立 Helper / XPC 进程，Runner 不带网络 entitlement；
- Windows：AppContainer 或等价受限 Token + Job Object，默认无网络能力；
- Linux：namespace/seccomp/cgroup 组合，默认隔离网络 namespace。

若无法在三平台提供可验证的默认断网，优先改为 WASI/受限解释器等能力导入模型，不应降级为“普通 Node 子进程 + 代码约定”。

## 5. IPC 与生命周期建议

Host 与 Main 使用有长度上限的结构化帧；Runner 每次启动只绑定一个工具版本。最小协议：

```ts
type HostRequest = {
  protocolVersion: 1
  requestId: string
  toolId: string
  version: number
  input: unknown
  deadlineMs: number
  capabilities: string[]
}

type HostResponse =
  | { requestId: string; status: 'ok'; output: unknown; metrics: RuntimeMetrics }
  | { requestId: string; status: 'error'; code: string; message: string }
```

建议状态机：`starting → ready → running → stopping → stopped`，异常终态为 `crashed / timed_out / oom / protocol_error`。Host 先发软终止，短宽限后硬终止；应用退出时统一回收全部子进程。

热重载只替换开发 Runner。发布时构建、校验并复制不可变快照，再原子更新稳定版本指针；构建或启动失败继续保留旧稳定 Runner。

## 6. 打包链路核对

已存在的正确基础：

- `apps/desktop/scripts/package-standalone-node.js` 将独立 Node 复制到 `Resources/runtime/node/node`，明确拒绝把 Electron 当 Node；
- `StandaloneNodeRuntime.ts` 在打包环境只接受应用 Resources 内的固定路径，忽略外部环境覆盖；
- `after-pack.js` 在 Windows 对 Runtime 做 Authenticode 签名和发布者/时间戳校验；
- macOS 已安装产物的 Node 具有独立 Developer ID 签名并通过 `codesign --verify --strict`；
- Electron 的 RunAsNode fuse 被关闭，Worker Host 不依赖 `ELECTRON_RUN_AS_NODE`。

P1 开发前必须补齐：

1. 为每个受支持 platform/arch 固定 Node 版本、来源和 SHA-256，不再只复制构建机 `process.execPath` 后即视为可信。
2. after-pack 校验 Runtime `--version` 与锁文件一致，并运行 permission/IPC smoke。
3. 发布 CI 对 macOS、Windows、Linux 分别验证路径、签名/哈希、可执行权限和最小启动。
4. 安装包升级后验证 Runtime 与 Worker Host 协议版本兼容；不兼容时拒绝启用代码工具，不回退系统 Node。
5. Worker Host 与版本快照必须位于真实文件系统，不从 `app.asar` 内由外部 Node 读取。

## 7. P1 开发门禁

满足以下条件后才允许把“编写 TypeScript”从说明态切到可执行态：

- [ ] 三平台默认断网真机验证通过；
- [ ] 网络和文件写入只能通过 Broker，权限可即时撤销；
- [ ] Runtime 供应链锁、签名/哈希和 after-pack smoke 完成；
- [ ] IPC 帧上限、Schema、超时、背压和日志隔离完成；
- [ ] heap + OS/RSS 资源限制完成；
- [ ] 崩溃、超时、OOM、协议污染不会阻断会话；
- [ ] 发布快照不可变，草稿热重载不污染稳定版本；
- [ ] macOS / Windows / Linux 真机验收完成。

在这些门禁完成前，本 spike 的状态“已落地”只表示风险已验证并形成决策，不表示 P1 Worker Host 功能已经交付。
