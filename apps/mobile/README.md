# SparkWork 移动端（微信小程序）

> 状态: 实施中 | 最后核对: 2026-10-16

SparkWork 桌面端的移动伴侣小程序。需求来源：scene#58「小程序」。

核心能力：

- **账号登录同步** — 与桌面端、edu-web 使用同一 Spark 平台账号（认证接口：`/api/v1/auth/*`）
- **桌面端会话/信息管理** — 查看账号同步状态、同步历史、通过同步记录识别的桌面端设备
- **双向互通** — 桌面端与移动端登录同一账户后，7 类数据（自定义命令/提示词/长期记忆/助手/工作流/外观/提示词库）经服务端双向流转；移动端实时呈现同步态势
- **远程会话（MobileBridge）** — **云端中继是唯一传输**（局域网直连已移除：体验版强制 https/wss + 域名白名单，真机不可用）：小程序与桌面端都只连接 Spark 平台服务，登录同一 Spark 平台账号即可**接续已有会话或新建远程会话**，实时显示思考内容与 assistant 增量回复、工具调用和运行状态，可中途停止；多台电脑按**电脑 → 项目 → 会话**逐层浏览，项目和会话始终绑定当前电脑；**授信设备**可列表 / 实时在线 / 吊销管理

## 快速开始

```bash
# 1. 安装开发依赖（typings）
pnpm install --filter @spark/mobile
#    注：本机沙箱可能拦 pnpm 符号链接，可降级在 apps/mobile 下
#    npm install --no-save --no-package-lock miniprogram-api-typings@^3.12.3

# 2. 构建
pnpm --filter @spark/mobile build
#    本地/测试环境：SPARK_EDUGEN_BASE_URL=http://192.168.x.x:7001 pnpm --filter @spark/mobile build

# 3. 用微信开发者工具导入 apps/mobile/ 目录
#    - project.config.json 使用已登记的小程序 AppID；请确认当前开发者账号有该项目权限
#      （不能用无权或虚构的 AppID，否则 IDE 会报 AppID 错误）
#    - 工具会识别 miniprogramRoot=dist/；urlCheck 已在 project.config.json 置 false
#      （开发期不校验合法域名；上线前在 mp 后台配置 request 合法域名）
```

## 白屏 / 编译失败排查

| 现象                              | 先看这里                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------- |
| 模拟器全白、无内容                | 1) `appid` 是否为当前账号有权限的真实 AppID；2) 开发者工具底部「控制台」红字 |
| 停在「SparkWork / 正在进入…」不跳 | 启动页已内置 3s 超时兜底，会把 `errMsg` 直接显示在页面上                     |
| 改了 wxml/wxss 但模拟器没变       | `build.mjs --watch` 是否还在跑（会打印 `static assets re-copied`）           |
| 某个页面白屏                      | `pnpm smoke:boot` —— mock 小程序运行时逐个 require 页面，抓加载期异常        |

顺序化自检：

```bash
pnpm --filter @spark/mobile build        # 构建 + 产物完整性
pnpm --filter @spark/mobile smoke:boot   # 启动链路（app.js + 全部页面 + 组件）
pnpm --filter @spark/mobile smoke        # 请求层 10 条断言
pnpm --filter @spark/mobile smoke:relay  # 云端中继端到端 21 条断言（真 RelayHub + 真 bridge/relay）
```

## 远程会话的通路（云端中继，唯一传输）

| 通路         | 怎么走                                                                     | 什么时候用                                                                                  |
| ------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **云端中继** | 小程序 ──wss──> Spark 平台服务 <──wss── 桌面端，服务端按 `userId` 配对转发 | 唯一通路。不需要同一 Wi-Fi、不需要电脑有公网 IP 或开端口，只要两端都登录同一 Spark 平台账号 |

> 局域网直连已整体移除（体验版强制 https/wss + 域名白名单，真机不可用）。

### 云端中继的链路

```
小程序 api/relay.ts ──wss /ws/bridge/client?token=<JWT>──┐
                                                          ├─ edu-server RelayHub（按 userId 配对）
桌面端 MobileBridgeRelayClient ──wss /ws/bridge/desktop──┘
```

- **鉴权**：小程序与桌面端分别使用 Spark 平台账号 JWT 建立 WSS；桌面端在连接后首帧提交授信设备凭据，服务端只保存设备密钥哈希，并在授权通过后才注册连接。
  设备密钥不放在 URL 或 HTTP 请求头中；拒绝授权的连接不会进入中继路由。
- **调用**：帧是 `{ t:'req', id, m: HTTP method, p: path, b: body, d?: deviceId }`，桌面端用一对内存里的
  req/res 直接喂给既有 HTTP 处理器 → **所有既有接口（含附件上传、语音转写、定时任务、斜杠命令）零改动可用**。
- **多电脑**：同一 Spark 平台账号可有多台授信桌面端同时在线。小程序从电脑顶层选择后，req/sub 帧携带 `d=<deviceId>` 定向到该电脑；服务端下发的 event 帧带 `d=<来源设备>`，
  订阅按 `(deviceId, sessionId)` 维度隔离，两台电脑上同名 id 的会话不会串流。
- **事件流**：小程序 `sub`（携带 d）→ 服务端转发 `sub` → 桌面端按事件序号读取 500ms 内的新事件 → `event` 回推（带来源 d）。
  assistant 回复与 `agent_thinking` 思考内容均按真实 delta 增量展示；中继重连时事件会按 ID 去重，避免重复拼接。桌面端重连后会恢复订阅。
- **设备列表**：`welcome` / `presence` 帧携带完整 `devices` 列表（deviceId/label/version/online/lastSeenAt）
  - 兼容旧版的 `desktop` 单桌面投影；小程序在内存维护设备快照并支持订阅通知（顶层电脑选择 / 授信设备页实时刷新）。
- **离线**：桌面端不在线时返回 `503 DESKTOP_OFFLINE`，小程序转成中文提示
  「电脑端没连上云端中继：请在桌面端…确认云端中继已开启」。挂起的调用在桌面端掉线时**立即失败**，不会干等到超时。
- **在线状态**：Redis `bridge:relay:desktop:<userId>`（TTL 120s），跨实例可见；Redis 不可用时退化为本进程可见。

### 开关位置

- 小程序：登录即可用（无开关、无地址配置）；「我的 → 远程会话」查看中继连接与电脑在线状态，
  「授信设备」入口进入设备管理页。
- 桌面端：设置 → 生态 → 移动端桥接 → 云端中继（开关 / 连接状态 / 服务地址）。

### 常见故障

| 现象                                     | 原因与处理                                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 「电脑端没连上云端中继」                 | 桌面端「设置 → 生态 → 移动端桥接 → 云端中继」没开，或电脑没联网；开开关后看状态变「已连接」                  |
| 一直「未连接」且提示未登录               | 桌面端没登录 Spark 平台账号；登录后最多等 30s 自动连上                                                       |
| 能连上但会话列表空                       | 两端不是同一账号                                                                                             |
| 桌面端提示「此设备已被吊销」             | 该电脑的设备身份在小程序端被吊销。确认是本人操作后，在桌面端该设置页点「重新授信」（生成全新设备身份并重连） |
| 桌面端提示「设备密钥校验失败（4401）」   | 本机设备身份数据异常。桌面端「重新授信」即可                                                                 |
| 桌面端提示「授信设备数已达上限（4429）」 | 账号下 active 设备超过 20 台。去小程序「远程会话 → 授信设备」吊销不用的设备                                  |
| 上传大图很慢                             | 附件 base64 走 WS，过大的图建议先压缩（已知限制，后续可改走服务端 HTTP 中转）                                |

### 授信设备管理（账号隔离 + 设备信任）

云端中继按**登录账号硬隔离**：每条连接经 JWT 鉴权绑定 userId，调用转发、事件扇出、在线广播、应答匹配都只发生在同一账号内；跨账号请求无处可去。

桌面端接入需要**双因子**：账号 JWT（身份）+ `deviceSecret`（授信设备凭据，服务端只存 SHA-256 哈希）：

- **首次连接即授信**：桌面端本地生成 `deviceId + secret`，连接 edu-server 时自动注册为授信设备（前提是已通过账号鉴权）
- **吊销不可逆**：小程序「远程会话 → 授信设备」中吊销后，该设备在线连接立即断开（close 4403）、deviceId 永久拒绝重连；被吊销的电脑需在桌面端「设置 → 移动端桥接」点**重新授信**（生成全新设备身份）
- **隐私边界（零留存）**：中继纯转发，会话数据只在内存中转（应答或超时后立即释放）；Redis 仅存在线状态元数据；DB 设备表只存 deviceId/secret 哈希/展示名/时间戳，**不含任何会话内容**
- 单账号 active 设备上限 20 台

**⚠️ 部署顺序（强制）**：桌面端必须**先于** edu-server 升级到带设备凭据的版本——服务端一旦启用握手验证，不带 `secret` 的旧桌面端会被 4400 拒绝。服务端部署后跑 `e2e:relay`（含 4400/4403 拒绝断言）确认。

### 生产部署与验证（2026-10-15 已上线）

链路：`小程序 wss → 1Panel openresty(443, root.conf 已透传 Upgrade) → edu-web nginx(38080, /ws/ → edu-server:7002, read_timeout 24h) → edu-server RelayHub`。
**nginx 两层均为既有配置，`/ws/bridge/*` 落在现成 `/ws/` location 内，无需任何改动**（已实测握手验证）。

部署步骤：`spark-edugen` 仓库 `bash build-script/build-edu-server.sh`（构建 + 推 TCR）→ 服务器 `/root/spark-tool-prod` 下 `sudo ./deploy.sh upgrade edu-server` → 看容器日志出现 `[WS] 已挂载通道: … /ws/bridge/desktop, /ws/bridge/client` 即新镜像生效。

生产链路端到端验证（真实公网双 WS 连接，24 条断言，含 d 定向 / devices / presence）：

```bash
# token 在服务器容器内签发（JWT_SECRET 不出服务器）：
# sudo docker exec prod-edu-server node -e \
#   "console.log(require('jsonwebtoken').sign({sub:'e2e-relay-test'}, process.env.JWT_SECRET, {expiresIn:'15m'}))"
TOKEN=<上一步输出> pnpm --filter @spark/mobile e2e:relay
```

小程序后台域名白名单（mp.weixin.qq.com → 开发 → 开发设置 → 服务器域名）：request/uploadFile/downloadFile 三栏加 `https://www.yiqibyte.com`，**socket 合法域名栏加 `wss://www.yiqibyte.com`**（与 request 是两栏，体验版强制校验）。

常用命令：

| 命令                                      | 说明                                                                          |
| ----------------------------------------- | ----------------------------------------------------------------------------- |
| `pnpm --filter @spark/mobile dev`         | watch 模式（tsc --watch + 静态资产变更拷贝）                                  |
| `pnpm --filter @spark/mobile build`       | 构建 + dist 产物完整性校验                                                    |
| `pnpm --filter @spark/mobile typecheck`   | 纯类型检查                                                                    |
| `pnpm --filter @spark/mobile smoke`       | 请求层冒烟测试（mock wx + 本地 HTTP，10 条断言，需先 build）                  |
| `pnpm --filter @spark/mobile smoke:boot`  | 启动冒烟（mock 运行时逐页 require，抓白屏类加载期异常，需先 build）           |
| `pnpm --filter @spark/mobile smoke:relay` | 云端中继端到端冒烟（真实 edu-server RelayHub + 真实 bridge/relay，21 条断言） |
| `pnpm --filter @spark/mobile e2e:relay`   | 生产链路端到端验证（真实公网 wss 双端连接，24 条断言，需 TOKEN）              |
| `pnpm --filter @spark/mobile icons`       | 重新生成 tabBar 图标（依赖根 node_modules 的 sharp）                          |

## 技术选型

**原生小程序 + TypeScript**，不引入 Taro/uni-app：

- 零运行时依赖，`tsc` 编译 CommonJS 后由小程序运行时直接执行
- 不触碰 monorepo 根 lockfile 的 react 版本决议（Taro 的 React 版本与根 `react: 19.2.8` pin 有冲突风险）
- `wx.request` 手写请求层，行为对齐桌面端 `EduServerClient`

```
apps/mobile/
├── project.config.json     # 微信开发者工具工程配置（miniprogramRoot=dist/）
├── scripts/
│   ├── build.mjs           # tsc 编译 + 静态资产拷贝 + config.json 生成
│   ├── verify-dist.mjs     # dist 产物完整性校验
│   └── gen-tabbar-icons.mjs# tabBar 图标生成（sharp，一次性维护脚本）
└── src/
    ├── app.ts / app.json / app.wxss   # 入口、路由与 tabBar、全局设计令牌
    ├── config.ts / config.json        # 服务端地址（构建期可被 SPARK_EDUGEN_BASE_URL 覆盖）
    ├── types/index.ts                 # 协议类型最小子集（镜像 packages/protocol，不引 zod）
    ├── api/
    │   ├── request.ts       # 统一请求：Bearer token / 401 自动刷新重试 / 业务码处理
    │   ├── auth.ts          # 登录注册、验证码、me、头像、改密
    │   ├── sync.ts          # desktop-sync 状态与历史
    │   ├── bridge-error.ts  # 桥接错误分类（中继语义 reason + 中文提示）
    │   ├── relay.ts         # 云端中继传输（唯一）：req/sub 带 d 定向、presence 设备快照、授信设备 REST
    │   └── bridge.ts        # MobileBridge 门面：会话 / 回合 / 跟流（全部可带 deviceId 定向）
    ├── store/auth.ts        # 全局登录态（storage 持久化 + 事件订阅）
    ├── utils/
    │   ├── storage.ts / format.ts / auth-guard.ts
    │   └── chat-reducer.ts  # 事件时间线归约（delta 按 segmentId 拼接）
    ├── components/captcha-image/    # 验证码图片（SVG data-URI → 本地文件降级）
    └── pages/
        ├── entry/           # 启动分流（有 token → 工作台，否则 → 登录）
        ├── login/           # 登录/注册（密码 / 邮箱验证码 / 短信三种模式）
        ├── home/            # 远程会话顶层：先选电脑，再浏览该电脑的项目/会话
        ├── sync/            # 同步中心：状态详情 + 分页历史 + 类别清单
        ├── devices/         # 设备：当前设备 + 同步记录聚合的桌面端设备
        ├── project-sessions/# 固定电脑下的会话列表 + 新建（从顶层电脑选择进入）
        ├── bridge-devices/  # 授信设备：列表 / 实时在线 / 吊销（行内二次确认）
        ├── chat/            # 远程对话：历史回放 + 增量跟流 + 发送 / 停止（deviceId 定向）
        ├── profile/         # 我的：头像/昵称、远程会话状态、授信设备入口、退出
        └── password/        # 修改密码（短信验证码链路）
```

## 远程会话（MobileBridge，云端中继）

小程序与桌面端都只出网连接 Spark 平台服务，服务端按 `userId` 把调用转发给本人名下的桌面端：
登录同一 Spark 平台账号即授权（无需配对、无需填地址），桌面端以「授信设备」身份连中继。

```
小程序 ──wss /ws/bridge/client──▶ edu-server RelayHub ◀──wss /ws/bridge/desktop── 桌面端
调用   req（可带 d=<deviceId> 定向；缺省 = 主桌面端）→ res
事件流 sub（可带 d）→ event（带来源 d；按 (deviceId, sessionId) 隔离）
```

**多电脑层级（电脑 → 项目 → 聊天）**：电脑选择位于远程会话顶层，数据源为授信设备 REST 列表 + WS presence；
选择持久化到本地，进入项目后电脑上下文固定，项目列表、会话列表和聊天历史都只向该电脑读取。
项目会话页不提供横向换电脑入口；要切换时返回电脑顶层重新选择，避免把一台电脑的项目 ID 带到另一台。
未归属会话显示在虚拟「未归属项目」中；从该层新建会话时不写入项目 ID。
主项目会话列表包含归属该项目的 worktree 会话，和项目列表中的会话计数保持一致。
进入聊天页时路由携带 deviceId，聊天页的历史、发送、取消、事件订阅等全部定向到同一台电脑。

**主页快捷新建**：电脑顶层底部提供新会话输入框。配置入口集中打开半屏面板，选择电脑、该电脑的项目、模型渠道/模型与推理强度；切换电脑后会重新读取该电脑自己的项目和模型目录。发送首条消息时按顺序创建会话、应用显式配置并定向提交回合，随后进入带有同一 `deviceId` 的聊天页。若提交结果未确认，再次点击会打开已有会话检查，不会自动重复提交。

**聊天历史分页**：首屏和向上翻页都按完整对话轮次读取（每页 12 轮、事件数为软上限），
服务端游标指向原始事件；若某页没有可显示的移动端事件，会继续向前查找，不会把它误报成空历史或「没有更早消息」。

| 端点（经中继转发到桌面端）      | 说明                                   |
| ------------------------------- | -------------------------------------- |
| `GET /v1/health`                | 探活                                   |
| `GET /v1/sessions`              | 会话列表（含最近一条用户消息预览）     |
| `POST /v1/sessions`             | 新建远程会话（可带 title / projectId） |
| `GET /v1/sessions/:id/messages` | 历史事件 + `running` 标志              |
| `POST /v1/sessions/:id/turns`   | 提交回合（接续对话即走这条）           |
| `POST /v1/sessions/:id/cancel`  | 取消当前回合                           |
| `sub` / `unsub` 帧              | 增量事件流订阅（可带 d 定向）          |

**授信设备管理 REST**（走 request.ts，带账号 JWT，直达 edu-server）：

| 端点                                            | 说明                                                   |
| ----------------------------------------------- | ------------------------------------------------------ |
| `GET /api/v1/mobile-bridge/devices`             | 授信设备列表（含离线；吊销后不再返回）                 |
| `POST /api/v1/mobile-bridge/devices/:id/revoke` | 吊销（不可逆；在线连接立即断开，同 deviceId 永久拒绝） |

事件类型：`user_message` / `assistant_message`（`mode=delta|complete`）/ `agent_thinking`（真实思考增量）/ `tool_call` /
`tool_result` / `agent_status` / `agent_error`。端上用 `utils/chat-reducer.ts` 归约成
时间线（`assistant_message` 的 delta 按 `segmentId` 拼接，`isFinal` 封口）。

协议定义在 `packages/protocol/src/mobile-bridge.ts`，桌面端实现
`apps/desktop/src/main/services/MobileBridgeService.ts`。

### 联调步骤

1. 桌面端：设置 → 生态 → 移动端桥接 → 打开「云端中继」，登录同一 Spark 平台账号
2. 小程序：登录同一 Spark 平台账号 → 在远程会话顶层选择电脑（首次连接即授信）
3. 进入所选电脑的项目，再进入项目会话；要切换电脑时返回顶层选择
4. 无授信设备时页面显示引导：在电脑端登录同一账号并开启云端中继
5. 桌面端冒烟：`pnpm --filter @spark/desktop smoke:mobile-bridge`

### 连不上时的自查

加载失败时，小程序会把**具体原因 + 建议**直接显示在页面上：

| 页面提示                     | 含义与处理                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| 电脑端没连上云端中继         | 桌面端「云端中继」没开或电脑没联网；开开关后等状态变「已连接」                        |
| 该电脑离线                   | 所选电脑不在线；到该电脑桌面端开启远程会话（云端中继）                                |
| 小程序未允许访问平台服务域名 | 开发期在开发者工具「详情 → 本地设置」勾「不校验合法域名」；正式版需配 mp 后台合法域名 |
| 账号鉴权失败                 | 两端必须登录同一 Spark 平台账号；本机重新登录                                         |

错误分类见 `src/api/bridge-error.ts` 的 `BridgeError` / `describeBridgeError`
（reason：NETWORK / TIMEOUT / AUTH / DISABLED / DESKTOP_OFFLINE / SERVER / UNKNOWN）。

## 服务端接口（edu-server，与桌面端同源）

Base URL 默认 `https://www.yiqibyte.com`（与桌面端 `defaultBaseUrl` 一致），前缀 `/api/v1`：

| 端点                                                                   | 用途                                     |
| ---------------------------------------------------------------------- | ---------------------------------------- |
| `POST /auth/login`                                                     | 密码登录（需图片验证码）/ 邮箱验证码登录 |
| `POST /auth/login-sms`                                                 | 短信验证码登录                           |
| `POST /auth/register`                                                  | 注册                                     |
| `POST /auth/refresh`                                                   | refreshToken 续期（401 自动重试）        |
| `POST /auth/logout`                                                    | 退出登录                                 |
| `GET/PUT /me`                                                          | 用户信息查询 / 更新昵称                  |
| `POST /me/avatar`                                                      | 头像上传（multipart）                    |
| `POST /auth/send-change-password-sms` + `/auth/change-password-by-sms` | 短信改密                                 |
| `GET /desktop-sync/status`                                             | 同步余量状态                             |
| `GET /desktop-sync/history`                                            | 同步历史（分页）                         |

edu-server 源码在 `spark-edugen/edu-server`（`auth.controller.ts` / `desktop-sync.controller.ts`）。

## 设计约定

- 设计令牌与桌面端一致：中性灰、无渐变、主色 `#3b82f6`、圆角 4/6/8/12/16
  （见 `app.wxss`，对应桌面端 `styles.css`；**不用 CSS 变量**，规避低版本基础库兼容问题）
- 单位统一 rpx；登录守卫：tab 页 `onShow` 调 `ensureAuthenticated()`
- 401 统一走 `store/auth` 的 session-expired：清态 + 跳登录页

## 已知边界（v1）

- **同步执行是桌面端职责**：`/desktop-sync/execute` 需要 local-first 全量数据（本地 SQLite），移动端 v1 只呈现同步态势（status/history），不执行同步
- **登录会话管理依赖服务端接口**：`user_sessions` 表已存在，但尚无公开 list/revoke 接口；设备页目前用同步记录的 `deviceLabel` 聚合识别桌面端设备
- **图片验证码**为 SVG data URI，`<image>` 组件在部分端不渲染，已做「写本地文件」降级；若个别机型仍失败，需服务端增加 PNG 变体
- **tabBar 图标**为仓库内静态 PNG（81×81），由 `scripts/gen-tabbar-icons.mjs` 生成
