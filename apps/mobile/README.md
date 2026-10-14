# SparkWork 移动端（微信小程序）

> 状态: 实施中 | 最后核对: 2026-10-13

SparkWork 桌面端的移动伴侣小程序。需求来源：scene#58「小程序」。

核心能力：

- **账号登录同步** — 与桌面端、edu-web 共用同一 edu-server 账号体系（`/api/v1/auth/*`）
- **桌面端会话/信息管理** — 查看账号同步状态、同步历史、通过同步记录识别的桌面端设备
- **双向互通** — 桌面端与移动端登录同一账户后，7 类数据（自定义命令/提示词/长期记忆/助手/工作流/外观/提示词库）经服务端双向流转；移动端实时呈现同步态势
- **远程会话（MobileBridge）** — 直连桌面端，**接续已有会话或新建远程会话**，实时跟流 assistant 增量回复、工具调用与运行状态，可中途停止

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
#    - project.config.json 的 appid 为 touristappid（测试号，无需登录即可编译模拟器）；
#      要真机预览/上传时，在工具「详情 → 基本信息」里换成自有 AppID
#    - 工具会识别 miniprogramRoot=dist/；urlCheck 已在 project.config.json 置 false
#      （开发期不校验合法域名；上线前在 mp 后台配置 request 合法域名）
```

## 白屏 / 编译失败排查

| 现象                              | 先看这里                                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| 模拟器全白、无内容                | 1) `appid` 是否是无权/伪造的 AppID（换 `touristappid`）；2) 开发者工具底部「控制台」红字 |
| 停在「SparkWork / 正在进入…」不跳 | 启动页已内置 3s 超时兜底，会把 `errMsg` 直接显示在页面上                                 |
| 改了 wxml/wxss 但模拟器没变       | `build.mjs --watch` 是否还在跑（会打印 `static assets re-copied`）                       |
| 某个页面白屏                      | `pnpm smoke:boot` —— mock 小程序运行时逐个 require 页面，抓加载期异常                    |

顺序化自检：

```bash
pnpm --filter @spark/mobile build        # 构建 + 产物完整性
pnpm --filter @spark/mobile smoke:boot   # 启动链路（app.js + 全部页面 + 组件）
pnpm --filter @spark/mobile smoke        # 请求层 10 条断言
```

常用命令：

| 命令                                     | 说明                                                                |
| ---------------------------------------- | ------------------------------------------------------------------- |
| `pnpm --filter @spark/mobile dev`        | watch 模式（tsc --watch + 静态资产变更拷贝）                        |
| `pnpm --filter @spark/mobile build`      | 构建 + dist 产物完整性校验                                          |
| `pnpm --filter @spark/mobile typecheck`  | 纯类型检查                                                          |
| `pnpm --filter @spark/mobile smoke`      | 请求层冒烟测试（mock wx + 本地 HTTP，10 条断言，需先 build）        |
| `pnpm --filter @spark/mobile smoke:boot` | 启动冒烟（mock 运行时逐页 require，抓白屏类加载期异常，需先 build） |
| `pnpm --filter @spark/mobile icons`      | 重新生成 tabBar 图标（依赖根 node_modules 的 sharp）                |

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
    │   └── bridge.ts        # MobileBridge：配对 / 会话 / 回合 / WebSocket 跟流
    ├── store/auth.ts        # 全局登录态（storage 持久化 + 事件订阅）
    ├── utils/
    │   ├── storage.ts / format.ts / auth-guard.ts
    │   └── chat-reducer.ts  # 事件时间线归约（delta 按 segmentId 拼接）
    ├── components/captcha-image/    # 验证码图片（SVG data-URI → 本地文件降级）
    └── pages/
        ├── entry/           # 启动分流（有 token → 工作台，否则 → 登录）
        ├── login/           # 登录/注册（密码 / 邮箱验证码 / 短信三种模式）
        ├── home/            # 工作台：用户卡 + 同步状态 + 最近记录 + 同步类别
        ├── sync/            # 同步中心：状态详情 + 分页历史 + 类别清单
        ├── devices/         # 设备：当前设备 + 同步记录聚合的桌面端设备
        ├── sessions/        # 远程会话：桌面端会话列表 + 新建（需先配对）
        ├── chat/            # 远程对话：历史回放 + WS 增量 + 发送 / 停止
        ├── profile/         # 我的：头像/昵称、改密入口、退出
        └── password/        # 修改密码（短信验证码链路）
```

## 远程会话（MobileBridge）

小程序不经服务端中转，**直连桌面端**：桌面端在局域网监听 HTTP + WebSocket，
小程序用 edu-server 账号 token 换「设备令牌」，之后所有会话读写都带该令牌。
桌面端入口：**设置 → 生态 → 移动端桥接**（开关 / 端口 / 地址 / 已配对设备吊销）。

```
小程序 ──POST /v1/pair（账号 token）──▶ 桌面端 ──设备令牌──▶ 小程序（持久化）
小程序 ──GET  /v1/sessions────────────▶ 桌面端   会话列表（可选「+ 新建」）
小程序 ──GET  /v1/sessions/:id/messages▶ 桌面端  全量历史（events + running）
小程序 ──POST /v1/sessions/:id/turns──▶ 桌面端   提交一回合（返回 turnId）
小程序 ──WS   /v1/stream?sessionId=…──▶ 桌面端   按 seq 增量推送事件
```

| 端点                            | 说明                                                    |
| ------------------------------- | ------------------------------------------------------- |
| `POST /v1/pair`                 | 账号 token 换设备令牌；同账号即授权，返回桌面端名与版本 |
| `GET /v1/health`                | 探活（配对前判断桌面端是否可达）                        |
| `GET /v1/sessions`              | 会话列表（含最近一条用户消息预览）                      |
| `POST /v1/sessions`             | 新建远程会话（可带 title）                              |
| `GET /v1/sessions/:id/messages` | 历史事件（≤400 条）+ `running` 标志                     |
| `POST /v1/sessions/:id/turns`   | 提交回合（接续对话即走这条）                            |
| `POST /v1/sessions/:id/cancel`  | 取消当前回合                                            |
| `WS /v1/stream`                 | 增量事件流；25s 一次 ping 保活                          |

事件类型：`user_message` / `assistant_message`（`mode=delta|complete`）/ `tool_call` /
`tool_result` / `agent_status` / `agent_error`。端上用 `utils/chat-reducer.ts` 归约成
时间线（`assistant_message` 的 delta 按 `segmentId` 拼接，`isFinal` 封口）。

协议定义在 `packages/protocol/src/mobile-bridge.ts`，桌面端实现
`apps/desktop/src/main/services/MobileBridgeService.ts`（含最小 WebSocket 服务端）。

### 联调步骤

1. 桌面端：设置 → 生态 → 移动端桥接 → 打开开关，页面会显示「局域网访问地址」和一张**二维码**
2. 小程序：工作台 → 远程会话 → **「扫码连接（推荐）」** → 扫桌面端二维码 → 自动填入地址并配对
   （也可「手动填写地址」，形如 `http://192.168.1.20:3721`）
3. 配对需与桌面端登录**同一 edu-server 账号**；配对成功后进列表，点任一会话即可**接续对话**，右上角「＋ 新建」创建远程会话
4. 手机与电脑需在同一 Wi-Fi；跨网段/公网要自行做反向代理并放行 WebSocket 升级
5. 桌面端冒烟：`pnpm --filter @spark/desktop smoke:mobile-bridge`（15 条断言，含 WS 握手与增量推送）

### 连不上时的自查

配对/加载失败时，小程序会把**具体原因 + 建议**直接显示在页面上，不再只弹一句「配对失败」：

| 页面提示                  | 含义与处理                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------- |
| 连接桌面端超时 / 无法连接 | 不在同一 Wi-Fi、桌面端桥接未开、端口被防火墙拦截                                      |
| 小程序未允许访问该域名    | 开发期在开发者工具「详情 → 本地设置」勾「不校验合法域名」；正式版需配 mp 后台合法域名 |
| 桌面端桥接未开启          | 到桌面端「设置 → 生态 → 移动端桥接」打开开关                                          |
| 账号不一致 / 令牌失效     | 两端必须登录同一 edu-server 账号；重新配对即可                                        |

错误分类见 `src/api/bridge.ts` 的 `BridgeError` / `describeBridgeError`。

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
