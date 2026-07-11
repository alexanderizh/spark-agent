# Spark 平台模型订阅

> 状态: 实施中 | 最后核对: 2026-07-12

Spark 平台模型以受管 `ProviderProfile` 接入现有 Provider 体系，与用户自行配置的第三方 Provider 并存，不自动成为默认模型。用户可在对话中自主选择是否使用平台模型。

## 当前实现

- 桌面主进程通过 spark-edugen 的 `/api/v1/platform-model/bootstrap` 获取当前 Spark 用户对应的 NewAPI 影子账户凭据。
- NewAPI 密码只由 spark-edugen 强制加密托管；桌面端仅在主进程短时使用，不长期保存密码。
- NewAPI management access token、模型 API Key 和 base URL 按 Spark userId 隔离存入系统 Keychain。
- management access token 被另一设备覆盖时，仅把平台 Dashboard 标为会话冲突；Spark 登录和第三方 Provider 不退出。用户可主动选择“在本机继续”。
- 登录、注册和恢复登录态后会后台初始化官方 Provider；切换账号时先清理旧账号的官方凭据和 Provider。
- 模型 API Key 按固定令牌名查找并恢复完整 Key，不先删后建。明确 401/403 才恢复；429、配额、网络和 5xx 不轮换 Key。
- 统一 CredentialResolver 已接入 Host/团队对话、记忆嵌入与抽取、Agent 图片/多媒体、Canvas 文本/多媒体及 worktree 命名入口。
- 账号中心支持套餐购买与续费；支付入口仅保留 NewAPI 自带的支付宝、微信支付，并支持重启后恢复到账轮询、额度、最近消耗、对话额度兑换码和订阅兑换码。
- 受管 Provider 在主进程禁止编辑、删除、Key 回显及导入导出覆盖，渲染端显示“平台官方”徽章。
- 受管 Provider 现在以 `anthropic` 类型落库，官方文本模型默认锁定 `claude-sdk` 适配器；不再按 Codex OpenAI `wire_api=chat` 生成配置。
- 受管 Provider 的 Anthropic `apiEndpoint` 保存平台根地址，由 Claude SDK 拼接 `/v1/messages`；平台刷新会自动修复旧版误存的 `/v1` 后缀。
- 对话模型选择器使用 Spark 官方品牌图标展示受管 Provider；当官方模型可用时，其模型分组稳定置顶，其他供应商保持原有顺序。
- 受管 Provider 允许用户在本机选择启用模型及默认模型；偏好只写入本机 Provider 配置，不修改 NewAPI 账号、令牌模型白名单、地址或 API Key。平台模型清单刷新时会过滤已下架项并保留仍有效的本机选择。
- 钱包与最近消耗读取 NewAPI `/api/status` 的 `quota_per_unit`、`quota_display_type` 和对应汇率，按 NewAPI 控制台相同口径展示，不直接暴露内部额度点数。
- 平台官方卡片使用 Spark 平台原始品牌图，图像容器固定白底。
- 普通发送和队列发送在启动前凭据失败时会持久化 `agent_error` 终态，不产生未处理 Promise rejection，也不盲目重跑可能有副作用的整轮任务。

## 支付与兑换

NewAPI 的服务端 callback 地址不是每单可配置的桌面 deep link。当前支付宝/微信支付采用 NewAPI EPay 返回的签名字段生成一次性 POST 表单并在系统浏览器提交；NewAPI 接收支付回调，Agent 有限轮询订阅状态并提供手动刷新兜底，不修改 NewAPI 前端。

- NewAPI 原生兑换码：`POST /api/user/topup`，增加对话钱包额度。
- Spark 订阅兑换码：edu-server 使用数据库行锁、发放租约和远端订阅 ID 对账后调用 NewAPI 管理员绑定接口。并发请求不重复 bind；远端成功、本地写回前崩溃时，同一码重试会先对账再落账。

浏览器支付的待确认套餐和发起时间按 Spark userId 存入主进程 Keychain。账号中心重新打开或应用重启后，bootstrap 会恢复有限轮询；余额支付成功或订阅到账后清除待确认状态。

## 模型类型边界

当前平台官方 Provider 只承载文本对话模型。本机启用/禁用只是 Provider 与模型选择器的显示偏好，不把视频模型伪装成对话模型。后续接入图片、语音或视频时，应基于服务端可靠的能力元数据分别生成受管媒体 Provider，并复用现有异步任务、轮询和产物回写链路。

## 凭据恢复与多设备

- NewAPI 推理 API Key 可被多设备共同使用；Dashboard management access token 保持单活。
- 旧设备的 management token 失效但推理 Key 仍有效时，对话继续，套餐管理显示冲突提示。
- 推理 Key 丢失或被远端明确拒绝时，桌面端通过现有 management token 单飞恢复；若同时发生 Dashboard 冲突，不自动抢占，提示用户“在本机继续”。
- NewAPI 登录密码被外部修改或账户曾被禁用时，spark-edugen 可由当前用户或管理员重建稳定派生密码并重新启用，桌面端随后重试一次登录。

## 生产上线前置项

- 生产 NewAPI 套餐、支付合规声明和商户配置。
- `/api/subscription/self`、`/api/log/self` 在生产实例上的最终字段格式。
- EPay 网关签名 POST form 已由主进程生成并交给系统浏览器提交；生产环境需验证真实商户签名、浏览器提交和到账轮询。
- 配置 `NEWAPI_BASE_URL`、`NEWAPI_ADMIN_USERNAME`、`NEWAPI_ADMIN_PASSWORD`、`NEWAPI_BINDING_ENCRYPTION_KEY`，并由生产 Compose 的 migration gate 先执行 SQL 再启动 edu-server。管理员 access token 由 edu-server 使用账号密码登录后自动获取并在失效时刷新，不作为部署环境变量。

以上是环境与商户配置验收，不再是代码路径缺失；未完成真实生产 NewAPI 联调前，本文状态保持“实施中”。
