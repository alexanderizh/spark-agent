# 子应用平台运行时能力

> 状态: 实施中 | 最后核对: 2026-08-22

## 目标

SparkWork 子应用是平台的一等内部应用，不是被第三方权限模型裁剪的外部插件。子应用可以读取和组合平台已经配置的 Provider、模型、API Key、Token、Agent、Skill、Plugin、MCP、Session 以及其他现有能力，自己完成 AI 聊天机器人或更复杂的应用编排。

`manifest.permissions` 保留用于旧版本兼容，但可信内部子应用运行时不再依赖它裁剪能力。现有 Electron 上下文隔离和 iframe 生命周期仍然保留，作为运行时实现边界；它们不改变子应用对平台能力的产品定位。

## 原始 IPC 面

bootstrap SDK 暴露以下接口：

```ts
// 调用任意已注册的 Spark IPC channel。
const providers = await sparkApp.ipc.invoke('provider:list', {})
const apiKey = await sparkApp.ipc.invoke('provider:get-api-key', {
  id: providers.profiles[0].id,
})

// 订阅任意 stream channel；取消函数本身返回 Promise。
const unsubscribe = await sparkApp.ipc.on('stream:session:agent-event', (event, channel) => {
  console.log(channel, event)
})
await unsubscribe()
```

`sparkApp.platform.ipc`、`sparkApp.platform.invoke` 和 `sparkApp.platform.on` 是同一能力面的别名，便于应用按“平台 SDK”组织代码。

## AI 应用示例

子应用可以自行选择任意平台配置并组织会话：

```ts
const [{ profiles }, { agents }, { skills }, { servers }] = await Promise.all([
  sparkApp.ipc.invoke('provider:list', {}),
  sparkApp.ipc.invoke('agent:list', {}),
  sparkApp.ipc.invoke('skill:list', {}),
  sparkApp.ipc.invoke('mcp:list', {}),
])

const { sessionId } = await sparkApp.ipc.invoke('session:create', {
  providerProfileId: profiles[0].id,
  agentId: agents[0]?.id,
})

const unsubscribe = await sparkApp.ipc.on('stream:session:agent-event', (event) => {
  if (event.sessionId === sessionId) renderAgentEvent(event)
})

await sparkApp.ipc.invoke('session:submit-turn', {
  sessionId,
  message: '请使用当前平台可用的模型、技能和 MCP 工具完成任务。',
  providerProfileId: profiles[0].id,
  agentId: agents[0]?.id,
  skillIds: skills.map((skill) => skill.id),
})
```

子应用可直接调用已有 IPC，例如 `provider:get-api-key` 获取配置的密钥，调用 Provider API；也可以直接调用 MCP、Plugin Runtime、Skill 执行和媒体/浏览器相关 channel。IPC 请求仍由主进程现有 schema 和 handler 校验，子应用不会绕过现有业务实现去伪造协议。

## 生命周期

- 每个子应用实例拥有独立的 postMessage request/response 通道和 stream 订阅集合。
- 子应用卸载时，宿主自动取消该实例创建的全部 stream 订阅。
- `ipc.invoke` 的 channel 必须是调用类 channel，`ipc.on` 的 channel 必须是 `stream:` channel。
- 运行时能力通过 `runtime.getInfo().trusted` 和 `platform.trusted` 可探测。
- 旧版 bootstrap 不认识 `ipc` 时仍可使用已有能力域；新版宿主保留 legacy permissions 行为，便于单元测试和旧运行时兼容。
