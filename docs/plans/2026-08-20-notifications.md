# 消息通知功能（铃铛 + 快捷面板 + 即时弹窗 + 消息中心）

> 状态: 已落地 | 最后核对: 2026-08-20

## 背景

对接 edu-server（spark-edugen/edu-server）的「站内信通知」与「平台公告」：admin 侧新增的消息在桌面应用中展示。UI 设计稿已于 2026-08-20 前经用户确认（含扁平化卡片风格要求），本文档为实施落盘。

## 范围（已确认的设计）

| #   | 组件         | 说明                                                                                                   |
| --- | ------------ | ------------------------------------------------------------------------------------------------------ |
| 1   | 侧栏铃铛     | 菜单栏底部、用户头像与设置按钮之间；复用 28×28 按钮样式与 `Icons.Bell`；红色数字徽标，>99 显示 99+     |
| 2   | 快捷面板     | 点铃铛弹出（antd Popover，click / topLeft，与用户菜单一致）；最新 8 条 + 「全部已读」+「查看全部」入口 |
| 3   | 即时弹窗     | 复用现有 toast 体系；未读数增加时触发；单条带「查看 / 忽略」，多条合并防刷屏                           |
| 4   | 消息中心弹窗 | 全部 / 未读 Tab；平台公告置顶横幅；条目内联展开正文（XSS 净化）；分页加载；空态                        |

扁平化要求（用户明确反馈）：卡片不用边框，用 `--bg-sunken` 底色拉开层次，hover 加深底色、不加阴影/描边。

## 服务端契约（edu-server，/api/v1，已探查确认）

**站内信**（需 Bearer JWT，`@AuthRequired`；复用应用既有 AuthService/EduServerClient，共享 401 自动续期）：

- `GET /notifications/?page&pageSize` → `data: { list, total }`；条目 `{id, notificationId, title, content(富文本HTML), metadata, isRead, readAt, createdAt}`；**id 是 notification_recipients.id（收件记录 id）**
- `GET /notifications/unread-count` → `data: { count }`
- `PATCH /notifications/:id/read`（:id = 收件记录 id，幂等）→ `{code:0}`
- `POST /notifications/read-all` → `{code:0}`
- 响应包装 `{code, message, data}`，code=0 成功；无按已读过滤参数 → 未读 Tab 前端过滤

**平台公告**（`@Public()` 免登录）：

- `GET /platform-announcements/active` → `data: Announcement[]`（纯数组）；条目 `{id, content(纯文本≤500，无标题), status, startTime, endTime, createdAt, updatedAt}`；active + 时间窗过滤，startTime 升序；无已读概念 → 客户端本地记「已见」

**无实时推送** → 主进程 60s 轮询；未读数增加/新公告 → `stream:notification:changed` 事件带增量（toast）。

## 架构

```
protocol   通知/公告 schema + invoke 通道 + notification:changed 事件
desktop 主进程
           NotificationService：
             - HTTP 客户端（公告免鉴权；站内信带 Bearer JWT）
             - 60s 轮询（未读数 + 公告列表），变化时广播事件
             - 公告「已见」本地状态；凭据（token/密码）走 keystore；服务器地址走应用设置
           typedIpcHandle 注册全部通道；app ready 启动 / quit 停止
desktop 渲染层
           components/notifications/（独立目录，App.tsx 已 2200+ 行不再膨胀）：
             - NotificationBell（铃铛 + 徽标 + 快捷面板）
             - NotificationCenterModal（消息中心）
             - toast 联动 + 通知设置入口
           App.tsx 仅一处插入 <NotificationBell />
```

## 关键决策

- **登录态复用**：应用已有 AuthService + EduServerClient（对接同一 edu-server，baseUrl 内置 https://spark.yiqibyte.com/），通知轮询直接复用该 client（新增 `getEduClient()` 访问器，共享 401 续期模块级单飞锁）——无需为通知做任何登录/服务器配置 UI。
- **未登录也可用**：公告免登录始终轮询；未登录时铃铛面板/消息中心展示公告 + 登录引导，不展示站内信。
- **防刷屏基线**：首启/登录态切换的第一轮轮询为基线（只记录不提醒）；之后新未读/新公告才触发 toast；toast 增量由主进程按「已见集合」（settings 持久化，cap 300）去重。
- **已读语义**：站内信在服务端（PATCH read / read-all）；公告「已见」在客户端（打开消息中心时标记）。
- **XSS**：站内信正文为服务端富文本 HTML，渲染前经 DOMPurify 白名单净化（文本级标签 + 链接强制 \_blank/noopener；禁 script/style/img/iframe 等）——本功能唯一新增依赖 dompurify（~7KB gz，安全必需，无替代现成方案）。
- **文件规模**：UI 全部独立文件（notifications/ 目录 6 个文件）；App.tsx 只加 1 个 import + 1 行挂载。

## 里程碑（完成情况）

1. ✅ protocol：schema + 通道 + 测试（11 例）
2. ✅ 主进程：NotificationService + IPC 注册 + 轮询测试（18 例）
3. ✅ 渲染层：铃铛 / 快捷面板 / 消息中心 / toast 联动 / i18n（中英）
4. ✅ 验证：typecheck 全绿 + notification-format 聚焦测试 14 例（XSS 净化/合并排序/相对时间）+ 渲染层整包构建通过
5. ⏳ 合并 master（--no-ff）

## 风险与待确认

- ~~edu-server 部署地址需用户在设置里配置~~ 已解决：复用 AuthService 登录配置（baseUrl 默认内置，与登录共享用户自定义值）。
- 主进程轮询失败的静默降级（离线/服务器不可达时铃铛保留最后状态，toast 不刷屏）。
- edu-server 若后续增加实时推送（SSE/WebSocket），可平滑替换轮询——渲染层只消费快照事件，无需改动。
