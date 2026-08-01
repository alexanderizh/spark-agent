# ONNX 安装包精准裁剪验证记录

日期：2026-08-01

## 结论

第一阶段 ONNX 安装包裁剪已在 macOS arm64 真实 DMG 上验证通过：

- `onnxruntime-web` 未进入最终 `app.asar`；
- `onnxruntime-node` 只保留 `darwin/arm64`；
- 同版本本地 DMG 从 398,417,355 字节降到 352,482,777 字节；
- 减少 45,934,578 字节（45.93 MB，11.53%）；
- 深度模型权重仍维持首次使用时从 Spark artifact repository 下载，本轮没有修改模型安装逻辑。

Computer Use 的 Native Host、独立 Node Runtime、Playwright MCP 和相关运行逻辑不在本轮范围内，
现有打包、签名和 handshake 流程保持不变。

## 变更内容

1. electron-builder `files` 排除 `node_modules/onnxruntime-web/**`。
2. `afterPack` 在不重构平台分支的前提下调用独立 ONNX 裁剪器。
3. 裁剪器仅保留当前 `platform/arch` 下的 `onnxruntime-node/bin/napi-v6`。
4. 独立产物门禁同时检查 ASAR Web Runtime 和 unpacked Native Runtime 范围。

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
| macOS arm64 DMG | 398,417,355 B | 352,482,777 B | -45,934,578 B |
| `app.asar` | 410,821,620 B | 299,982,632 B | -110,838,988 B |
| `app.asar.unpacked` | 约 375 MiB | 322.52 MiB | 约 -52.5 MiB |

DMG 是签名后的本地开发产物。构建环境缺少 Apple 公证账号环境变量，因此 electron-builder 按
既有配置跳过 notarization；这不影响文件组成和体积比较，但该 DMG 不作为对外发布产物。

## 验证命令

```bash
pnpm --filter @spark/desktop native:verify
pnpm --filter @spark/desktop build:unpack
pnpm --dir apps/desktop exec electron-builder --mac --arm64
pnpm --filter @spark/desktop verify:packaged:onnx -- \
  --resources "dist/mac-arm64/Spark Agent.app/Contents/Resources" \
  --platform darwin \
  --arch arm64
```

门禁输出：

```json
{"target":"darwin/arm64","foreignEntries":[],"webRuntimePresent":false}
```

定向测试：

- `after-pack.test.ts`：23 项通过；
- `verify-packaged-onnx-runtime.test.ts`：3 项通过；
- desktop renderer/node TypeScript 检查通过；
- Native ABI 验证通过：`better-sqlite3`、`keytar`、`node-pty` 均可由 Electron 43 加载。

## 待发布平台验证

- macOS x64 需要在 Intel runner 上确认只保留 `darwin/x64`；
- Windows x64 需要在 Windows runner 上确认只保留 `win32/x64`；
- 两个平台的相同门禁应在 release workflow 中执行，失败时阻止安装器发布。

GitNexus MCP 在当前会话未暴露，按项目降级规则使用直接调用点检索、定向测试、真实打包产物和
`git diff` 完成影响范围与变更范围核对。
