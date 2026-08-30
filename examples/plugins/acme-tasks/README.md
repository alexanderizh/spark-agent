# Acme Tasks 插件开发示例

这个示例展示最终的插件包形态：`plugin.json` 声明运行时，`runtime/index.ts` 使用
`@spark/plugin-sdk` 定义 descriptor 和工具，Skill 只负责流程编排。

当前仓库已经可以对这个包执行 manifest 校验和本地导入检查；第三方 `worker` 的实际启动
仍被插件管理器标记为不可用，直到隔离 Worker Host 完成签名校验、资源限制和 JSON-RPC
边界。这个门禁是刻意保留的，避免把第三方 JavaScript 直接加载到 Electron Main/Renderer。

发布前必须由打包工具用最终归档内容替换 `execution.packageSha256`，并生成签名、SBOM 和
可复现构建元数据；示例中的全零摘要仅用于开发 fixture，不能用于市场发布。
