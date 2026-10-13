# SparkWork 移动端（微信小程序）

> 状态: 实施中 | 最后核对: 2026-10-13

SparkWork 桌面端的移动伴侣小程序。需求来源：scene#58「小程序」。

核心能力：

- **账号登录同步** — 与桌面端、edu-web 共用同一 edu-server 账号体系（`/api/v1/auth/*`）
- **桌面端会话/信息管理** — 查看账号同步状态、同步历史、通过同步记录识别的桌面端设备
- **双向互通** — 桌面端与移动端登录同一账户后，7 类数据（自定义命令/提示词/长期记忆/助手/工作流/外观/提示词库）经服务端双向流转；移动端实时呈现同步态势

## 快速开始

```bash
# 1. 安装开发依赖（typings）
pnpm install --filter @spark/mobile
#    注：本机沙箱可能拦 pnpm 符号链接，可降级在 apps/mobile 下
#    npm install --no-save --no-package-lock miniprogram-api-typings@^3.12.3

# 2. 构建
pnpm --filter @spark/mobile build
#    本地/测试环境：SPARK_EDUGEN_BASE_URL=http://192.168.x.x:7001 pnpm --filter @spark/mobile build

# 3. 用微信开发者工具打开 apps/mobile/ 目录
#    - AppID 选「测试号」或填入自有小程序 AppID（project.config.json 的 appid 字段）
#    - 工具会自动识别 miniprogramRoot=dist/，详情-本地设置勾选「不校验合法域名」
#      （开发期直连 http(s) 服务端；上线前在 mp 后台配置 request 合法域名）
```

常用命令：

| 命令                                    | 说明                                                         |
| --------------------------------------- | ------------------------------------------------------------ |
| `pnpm --filter @spark/mobile dev`       | watch 模式（tsc --watch + 静态资产变更拷贝）                 |
| `pnpm --filter @spark/mobile build`     | 构建 + dist 产物完整性校验                                   |
| `pnpm --filter @spark/mobile typecheck` | 纯类型检查                                                   |
| `pnpm --filter @spark/mobile smoke`     | 请求层冒烟测试（mock wx + 本地 HTTP，10 条断言，需先 build） |
| `pnpm --filter @spark/mobile icons`     | 重新生成 tabBar 图标（依赖根 node_modules 的 sharp）         |

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
    │   └── sync.ts          # desktop-sync 状态与历史
    ├── store/auth.ts        # 全局登录态（storage 持久化 + 事件订阅）
    ├── utils/               # storage / format / auth-guard
    ├── components/captcha-image/    # 验证码图片（SVG data-URI → 本地文件降级）
    └── pages/
        ├── entry/           # 启动分流（有 token → 工作台，否则 → 登录）
        ├── login/           # 登录/注册（密码 / 邮箱验证码 / 短信三种模式）
        ├── home/            # 工作台：用户卡 + 同步状态 + 最近记录 + 同步类别
        ├── sync/            # 同步中心：状态详情 + 分页历史 + 类别清单
        ├── devices/         # 设备：当前设备 + 同步记录聚合的桌面端设备
        ├── profile/         # 我的：头像/昵称、改密入口、退出
        └── password/        # 修改密码（短信验证码链路）
```

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
