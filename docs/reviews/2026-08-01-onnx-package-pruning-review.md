# ONNX 安装包精准裁剪验证记录

最后复核：2026-08-02

## 结论

第一阶段 ONNX 安装包裁剪已在 macOS arm64 真实 unpacked 产物上验证通过：

- `onnxruntime-web` 未进入最终 `app.asar`；
- `onnxruntime-node` 只保留 `darwin/arm64`；
- `app.asar` 可由 `@electron/asar.extractAll()` 完整解包，不存在已删除文件仍残留在 ASAR header
  的失效条目；
- 从解包目录可加载 Transformers `pipeline`、`RawImage` 和 ONNX Runtime 1.24.3；
- 深度模型权重仍维持首次使用时从 Spark artifact repository 下载，本轮没有修改模型安装逻辑。

Computer Use 的 Native Host、独立 Node Runtime、Playwright MCP 和相关运行逻辑不在本轮范围内，
现有打包、签名和 handshake 流程保持不变。

## 变更内容

1. electron-builder `files` 排除 `node_modules/onnxruntime-web/**`。
2. `beforePack` 在 electron-builder 创建 ASAR 前，把异平台 Native 排除项追加到已规范化
   FileSet 的 `filter`；不能把排除字符串直接追加到 `config.files` 顶层，否则构建器会生成隐含
   `**/*` 的第二个 matcher，把整个桌面项目重新收进 ASAR。
3. `afterPack` 裁剪器继续作为安全兜底，仅保留当前 `platform/arch`。
4. 独立产物门禁同时检查 ASAR header、Web Runtime 和 unpacked Native Runtime 范围。

## 真实产物

目标：macOS 27.0.0、arm64、Electron 43.2.0、桌面版本 0.9.6。

### 最终 ONNX 文件

```text
35,746,544  app.asar.unpacked/node_modules/onnxruntime-node/bin/napi-v6/darwin/arm64/libonnxruntime.1.24.3.dylib
   282,896  app.asar.unpacked/node_modules/onnxruntime-node/bin/napi-v6/darwin/arm64/onnxruntime_binding.node
```

没有 `linux`、`win32` 或其他架构目录。

### 体积

| 项目 | 修复前 | 修复后 | 变化 |
|---|---:|---:|---:|
| `app.asar` | 410,821,620 B | 300,403,286 B | -110,418,334 B |
| `app.asar.unpacked` | 约 375 MiB | 约 324 MiB | 约 -51 MiB |
| `.app` 总体积 | 未记录 | 约 981 MiB | — |

曾构建过 352,482,777 B 的 DMG，但旧方案在 `afterPack` 删除文件后留下失效 ASAR header，因此
该数字不能作为可发布结果。最终方案本轮使用 `electron-builder --dir` 验证，新的 DMG 体积需要在
完成 Office 与深度 Runtime 远程化后统一重测，避免重复发布中间产物。

## 验证命令

```bash
pnpm --filter @spark/desktop native:verify
pnpm --filter @spark/desktop build:unpack
pnpm --dir apps/desktop exec electron-builder --dir -c.mac.identity=null
node apps/desktop/scripts/verify-packaged-onnx-runtime.js \
  --resources "apps/desktop/dist/mac-arm64/Spark Agent.app/Contents/Resources" \
  --platform darwin \
  --arch arm64
```

门禁输出：

```json
{"target":"darwin/arm64","foreignEntries":[],"webRuntimePresent":false}
```

定向测试：

- `after-pack.test.ts`：31 项通过；
- `verify-packaged-onnx-runtime.test.ts`：4 项通过；
- Native ABI 验证通过：`better-sqlite3`、`keytar`、`node-pty` 均可由 Electron 43 加载。

## 待发布平台验证

- macOS x64 需要在 Intel runner 上确认只保留 `darwin/x64`；
- Windows x64 需要在 Windows runner 上确认只保留 `win32/x64`；
- 两个平台的相同门禁应在 release workflow 中执行，失败时阻止安装器发布。

GitNexus MCP 在当前会话未暴露，按项目降级规则使用直接调用点检索、定向测试、真实打包产物和
`git diff` 完成影响范围与变更范围核对。
