# Snapshot Vault 加密存储与预览设计

> 状态: 已落地 | 最后核对: 2026-07-28

本文记录 CU-01 已落地的应用快照密文格式、存储事务、清理顺序和预览边界。后续 CU-04 应用快照采集、CU-07 验收证据以及远程脱敏预览必须复用本实现，不得向 Renderer 暴露路径或建立第二套明文缓存。

## 1. 模块与边界

- `packages/storage/migrations/063_computer_use_and_snapshot_vault.sql`：Computer Use、快照元数据、密文 blob 引用计数与数据库约束。
- `packages/storage/src/repositories/application-snapshot.repository.ts`：快照与 blob 的同事务写入、删除、保留期查询和零引用记录抢占。
- `apps/desktop/src/main/services/computer-use/SnapshotVault.ts`：密文格式、AES-GCM、原子文件写入、认证解密和文件清理。
- `SnapshotVaultKeyProvider.ts`：通过 `@spark/shared/keystore` 读写安装级密钥；不得直接调用 keytar。
- `SnapshotVaultMaintenance.ts`：TTL 快照和孤儿 blob 的周期清理。
- `SnapshotProtocol.ts`：按 snapshot ID 解密并返回安全图片响应。
- `registerApplicationSnapshotIpc.ts`：快照元数据读取、会话列表、保留期、删除和受信捕获服务装配边界。
- `NativeApplicationSnapshotCaptureService.ts`：从受信 Host 选择唯一前台窗口，复核 PNG digest/尺寸，生成预览，并在 Vault 补偿边界内注册 image/preview。

SQLite 只保存元数据、摘要、opaque storage key 和引用计数。用户主动应用快照的原图/预览只以 Vault 密文存在磁盘；Computer execution-before 原图仅保留在有界内存，execution-after 只持久化敏感区域已覆盖的短期缩略图，不持久化 AX/UIA 全文或原始执行截图。

## 2. 密钥与加密格式

安装级密钥为随机 32 字节，keystore ref 为 `snapshot-vault-installation-key-v1`，序列化为标准 Base64。已有密钥长度或编码异常时 fail-closed，不覆盖损坏密钥。

每个 blob 使用独立随机 12 字节 nonce 和 AES-256-GCM。AAD 使用确定性 JSON，绑定：

```text
domain = spark.snapshot-vault
formatVersion = 1
blobId
kind = image | text | preview
```

因此，密文不能被替换到另一个 blob ID 或内容类型下。磁盘格式为：

```text
offset  size  content
0       7     ASCII magic "SPKSVLT"
7       1     format version = 1
8       12    GCM nonce
20      16    GCM authentication tag
36      N     ciphertext
```

读取时依次校验 storage key、密文 SHA-256、magic、version、GCM tag/AAD 和明文 SHA-256。任何认证失败统一返回 `Snapshot blob authentication failed`，不泄漏是 key、路径、摘要还是密文损坏。

## 3. 文件与路径安全

- blob 文件名由 24 字节随机数生成，格式固定为 48 位小写十六进制加 `.svb`。
- 数据库 `storage_key` 禁止路径分隔符和 `..`；Vault 再次执行严格正则校验。
- Vault 目录权限为 `0700`，临时和最终密文文件为 `0600`。
- 写入流程为同目录独占临时文件、写入、fsync、关闭、原子 rename。
- 普通日志不得记录根目录、storage key、明文、AX 文本、密钥或底层加密异常。

## 4. 数据库与文件事务

文件系统和 SQLite 无法共享原子事务，因此采用可补偿顺序：

1. Vault 原子写入新密文。
2. `ApplicationSnapshotRepository.createWithBlobs()` 在单个 SQLite 事务中写入 blob 元数据和 snapshot。
3. 数据库事务失败时，`writeManyRegistered()` 删除本次 image/text/preview 全部新密文并重新抛出原错误；单 blob 可使用 `writeRegistered()`。
4. snapshot 插入触发器增加所有 blob 引用；snapshot 删除和父 session/computer session 级联删除触发器减少引用。

Repository 在提交前强制 image/text/preview 引用对应 blob kind，`image_sha256` 必须等于 image blob 的明文摘要，并拒绝本次事务中注册但没有被 snapshot 引用的 blob。`computer_run` 必须绑定 computer session；快照的 session/turn 必须与该 computer session 完全一致，且创建后不可改写归属。

回收必须先通过 `deleteBlobRecordIfUnreferenced()` 在数据库事务中删除仍为零引用的记录，成功后才删除文件。若数据库抢占失败，文件保持不变；若数据库抢占成功但删文件失败，只会形成可重试的磁盘孤儿，不会破坏有效引用。

显式 IPC 删除先删除 snapshot 元数据以触发引用计数，再逐个抢占返回的零引用 blob 记录，只有抢占成功者才删除对应 Vault 文件。不存在或已删除的 snapshot 返回 `deleted=false`；元数据损坏时 fail-closed，不能向 Renderer 返回部分解析对象。文件删除异常不会泄漏 storage key 或根目录，遗留密文由孤儿清理任务重试。

## 5. 保留期与后台维护

保留模式为 `session`、`computer_run`、`ttl`、`manual`：

- `session` 与 `computer_run` 通过外键级联删除快照并降低引用。
- `ttl` 由维护任务按 `expires_at` 分批删除。
- `manual` 只由显式删除触发。

维护任务启动后立即执行，之后每 6 小时执行；重叠运行合并为同一个 Promise。每批最多处理 200 条 TTL/零引用记录。数据库没有记录的 `.svb` 文件需超过 24 小时宽限期后才删除，避免与正在进行的文件写入或数据库提交竞态。

## 6. 预览协议

唯一合法 URL 为：

```text
spark-snapshot://snapshot/<encoded-snapshot-id>/preview?cap=<base64url-capability>
```

`SnapshotPreviewCapability` 使用 256-bit 随机 bearer，默认有效期 5 分钟，并同时绑定 snapshot、session 和 turn。协议拒绝任意路径、blob ID、PID、区域、fragment、非规范 query、缺失/过期/错配 capability；这些鉴权失败统一返回 404，且发生在读取 Repository 或解密 Vault 之前。通过鉴权后，处理器再验证 snapshot 未删除且 preview/image blob 确实属于该 snapshot，然后调用 Vault 解密。MIME 根据解密后图片签名识别，仅允许 PNG、JPEG、WebP 和 GIF；未知内容返回 415。

`app-snapshot:get`、`list-for-session`、`capture-frontmost` 和保留期更新每次返回时签发新的短期 capability；删除 snapshot 或清理 session 时立即撤销关联 grant。历史会话中的预览令牌过期后，Renderer 只允许通过受治理的 `app-snapshot:get` 续签一次，续签后的图片仍失败时不得无限重试。

响应包含 `X-Content-Type-Options: nosniff`、`Cache-Control: private, no-store`、`Cross-Origin-Resource-Policy: same-origin` 和限制型 CSP，不返回磁盘路径，也不复用 `safe-file://` 的路径白名单或 CORS 信任模型。

## 7. 应用快照 IPC 边界

协议声明的 7 个 `app-snapshot:*` 通道已经全部真实注册。IPC 默认只接受主应用顶层 Renderer：`sender.webContents` 必须等于主窗口且 `senderFrame` 必须等于 `mainFrame`，子 frame、开发工具、辅助窗口和伪造 sender 全部拒绝。在通过父应用/Host 同签名主体、Host 固定 identifier、最终签名字节 hash、manifest 和握手验证后，生产装配会提供 Screen Recording/Accessibility 权限请求与 `visible_only` 前台唯一窗口捕获；原始 PNG 和缩略图均先加密，再在同一补偿边界内写入 Repository。无受信 Host、多焦点、权限不足、PNG 尺寸/digest 不符或请求 `app_exposed` 但无 AX 时 fail-closed，不制造占位图片或降级文本。

捕获前阻断密码管理器、系统登录/凭据/授权进程等敏感应用。捕获后必须重新枚举窗口，并复核唯一前台窗口的 window ID、app ID、PID、bundle/executable/signing identity；焦点或进程漂移时在落库前拒绝。

## 8. 后续开发约束

- CU-04 后续 AX/脱敏路径必须继续先写 Vault，再以 `writeManyRegistered()` 在同一补偿边界内注册 image/text/preview 元数据；不得绕过已落地的可视快照服务另建明文路径。
- Accessibility 文本使用 `kind=text`，不得进入 SQLite、普通日志或临时明文文件。
- Renderer 只能获得 snapshot ID 和预览 URL；不能获得 storage key、blob ID 或根目录。
- 需要增加格式版本时，新增显式 reader/migration，不得静默改变 version 1 的布局或 AAD。
- 远程预览必须在解密后完成脱敏和缩放，并使用独立授权响应；不能直接代理本地预览协议。
