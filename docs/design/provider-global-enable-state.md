# Provider 全局启用状态

> 状态: 已落地 | 最后核对: 2026-07-30

## 目标

模型管理页允许按 Provider 开启或关闭全局可用状态。关闭只停用渠道，不删除配置、凭据、模型清单或历史会话绑定；重新开启后原配置继续可用。

## 数据与接口

- `provider_profiles.enabled` 是唯一持久化来源。
- `ProviderProfile.enabled` 将状态返回给管理页。
- `provider:update` 的 TypeScript 接口和运行时 Zod Schema 都必须接受并保留 `enabled`，避免 IPC 校验时静默剥离状态字段；成功后广播 `stream:config:changed` 的 Provider 更新事件。
- `provider:list` 默认只返回已启用项；模型管理页显式传 `includeDisabled: true`，以便展示并重新开启停用项。

## 可用性边界

禁用 Provider 后：

- 会话、Agent、团队成员和自动路由不能再发起该 Provider 的模型调用；旧绑定在执行时会明确报 Provider 已禁用。
- 画布文本模型、画布多媒体能力与模型清单不再返回该 Provider。
- `spark_media` 路由、旧图片生成兜底、Embedding 与记忆抽取均排除该 Provider。
- 所有监听配置变化事件的渲染窗口会重新读取模型列表；管理页同时主动刷新当前卡片状态。

平台受管 Provider 允许本机停用。目录刷新会保留用户在凭据可用状态下做出的停用选择；仅在此前因退出登录进入 `unavailable` 状态、随后重新登录时恢复启用。
