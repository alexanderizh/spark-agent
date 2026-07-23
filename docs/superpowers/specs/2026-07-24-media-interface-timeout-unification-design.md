# 多媒体接口超时统一设计

> 状态: 已落地 | 最后核对: 2026-07-24

## 背景

Provider 模型配置页当前把超时保存为 `mediaDefaults.polling.timeoutMs`，并显示为“轮询超时 ms”。该值只被异步任务的轮询阶段读取；同步图片生成、图片编辑、异步任务提交和结果下载仍由各 Adapter 使用硬编码超时。因此，即使用户给某个 Provider 配置了更长超时，同步接口仍可能提前中止。

本次改造把 Provider 级超时统一为“接口超时”。只要某个媒体 Provider 配置了该值，它的同步请求和异步任务链路都必须遵守，不再因 Adapter 或调用入口不同而使用无关的固定值。

## 目标

- 在 `ProviderMediaDefaults` 增加顶层 `timeoutMs`，作为 Provider 媒体操作的统一超时。
- 配置页把“轮询超时 ms”改为“接口超时 ms”，保存和回显顶层 `timeoutMs`。
- 同步请求、异步任务提交、轮询总时限、单次轮询请求和结果下载都读取统一超时。
- 无限画布的桌面 Adapter 链路与 `spark_media` MCP 链路保持一致。
- 自动兼容已有 `mediaDefaults.polling.timeoutMs` 数据，用户不需要重新配置。
- `polling.intervalMs` 继续只表示轮询间隔，不改变语义。

## 非目标

- 不新增“连接超时”“读取超时”“任务超时”等多个高级字段。
- 不改变 Provider API 协议、请求参数或结果提取逻辑。
- 不修改 Manifest 中 `invocation.polling.timeoutMs` 的模型级默认含义；它仍是未配置 Provider 超时时的异步任务默认值。

## 配置模型与兼容策略

`ProviderMediaDefaults` 新增：

```ts
interface ProviderMediaDefaults {
  timeoutMs?: number
  polling?: {
    intervalMs?: number
    timeoutMs?: number // 旧字段，仅用于兼容读取
  }
}
```

运行时超时优先级统一为：

1. `mediaDefaults.timeoutMs`
2. 旧数据 `mediaDefaults.polling.timeoutMs`
3. 当前能力 Manifest 的 `invocation.polling.timeoutMs`（仅异步任务具备）
4. Adapter 针对该操作原有的默认值

数据库迁移把 Provider Profile 中已有的 `mediaDefaults.polling.timeoutMs` 复制到 `mediaDefaults.timeoutMs`。迁移不删除旧字段，以兼容旧版本应用和可能仍读取旧字段的历史路径。新版本写入时只写顶层 `timeoutMs`；读取时继续支持旧字段回退。

## 运行时设计

### 统一解析器

在媒体运行时提供一个小型超时解析器，集中实现数值校验、兼容回退和默认值选择，避免各 Adapter 重复写优先级逻辑。解析器只接受正整数毫秒值，并遵守协议层已有的最大值限制。

### 同步请求

所有直接等待生成结果的请求使用统一超时，包括但不限于：

- 图片生成和图片编辑；
- 同步语音、音乐或视频接口；
- Template Adapter 的同步 invocation；
- 媒体产物下载请求。

未配置 Provider 超时时，各 Adapter 保留当前默认值，避免无关行为变化。

### 异步请求

统一超时覆盖异步任务的完整网络链路：

- 初始任务提交请求使用该超时；
- 轮询循环以该值作为总时限；
- 单次轮询 HTTP 请求不能超过当前任务剩余时限；
- 任务完成后的产物下载使用该超时。

轮询等待间隔仍读取 `polling.intervalMs`。轮询循环接近截止时间时，应把单次请求超时限制为剩余时间，避免总等待明显超过用户配置。

### 两条执行链路

桌面主进程中的 `MediaRouterService`/各媒体 Adapter 与 `spark_media` MCP 子进程存在独立实现。本次必须同时修改并共享相同的优先级规则，保证无限画布和普通 Agent 会话对同一 Provider 配置表现一致。

## 配置页

- 表单字段从轮询语义调整为通用接口超时语义。
- 输入框提示改为“接口超时 ms”。
- 加载配置时优先读取 `mediaDefaults.timeoutMs`，再回退旧 `polling.timeoutMs`。
- 保存配置时写入 `mediaDefaults.timeoutMs`。
- 图片、视频、语音及其他启用媒体能力的 Provider 都可配置该值，不再仅因模型类型是图片或视频才显示。

## 错误处理

- 同步或单次 HTTP 请求超时继续返回包含 method、脱敏 URL 和实际超时毫秒数的错误。
- 异步轮询总时限耗尽继续返回 `task_timeout`，错误中的毫秒数必须是解析后的统一超时。
- 非法或缺失配置不得生成 `NaN`、零或负数定时器；应回退到下一优先级。

## 测试策略

采用 TDD 增加以下回归覆盖：

1. 协议 schema 接受顶层 `timeoutMs`，并拒绝越界值。
2. 数据迁移把旧 `polling.timeoutMs` 复制到新字段，已有新字段时不覆盖。
3. Provider 配置页正确回显旧值，保存新字段，并显示“接口超时 ms”。
4. OpenAI 官方同步图片编辑使用 Provider 配置值，而不是固定 `180000ms`。
5. 至少覆盖一个专用同步 Adapter、一个异步 Adapter 和 Template Adapter。
6. 轮询总时限和单次请求使用统一值，并受剩余时间约束。
7. `spark_media` MCP 的同步与异步路径遵守同一配置优先级。
8. 未配置统一超时时，现有 Adapter 默认值保持不变。

## 文档与索引

实施完成后更新相关多媒体设计文档的状态和最后核对日期，并记录新旧字段的兼容规则。该改动横跨协议、存储、配置页、运行时 Adapter 和 MCP，完成验证后运行 GitNexus 索引更新与变更范围核对；若 GitNexus 不可用，则按项目降级规则使用直接调用点检索、测试和 `git diff` 核对。
