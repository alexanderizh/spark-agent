# Spark Agent 服务端子项目设计

> 日期：2026-06-08
> 状态：已确认，待实现

## 1. 概述

为 Spark Agent 桌面应用开发一个基于 Node.js + Midway.js 的服务端子项目，实现用户认证、数据同步（云端备份）功能。

### 同步范围

| 数据 | 是否同步 | 备注 |
|------|---------|------|
| 用户账号（登录/注册/信息） | ✅ | 服务端原生功能 |
| App Settings | ✅ | 分类键值对同步 |
| Agents | ✅ | 不含 skill 文件本身，仅同步配置 |
| Workflows | ✅ | 同步 graph 配置 |
| Providers | ❌ | 本地敏感数据，不同步 |
| Scheduled Tasks | ❌ | 本地执行，不同步 |
| Sessions / Events | ❌ | 体量大，暂不同步 |
| Skills | ❌ | 含本地文件，暂不同步 |

## 2. 技术选型

| 组件 | 选择 |
|------|------|
| 框架 | Midway.js 3 |
| ORM | TypeORM |
| 数据库 | PostgreSQL |
| 缓存 | Redis（JWT 黑名单 + WebSocket） |
| 认证 | JWT + 四种策略 |
| API | REST + WebSocket |
| 部署 | Docker Compose |
| 项目位置 | `apps/server`（monorepo 内） |

## 3. 认证设计

四种登录方式：

1. **邮箱 + 密码**：注册时发送验证邮件，登录返回 JWT
2. **手机号 + 短信验证码**：调用阿里云 SMS API，验证码存 Redis（5 分钟过期）
3. **微信扫码登录**：OAuth 2.0 流程，用户扫码后回调换取 access_token 再换取 JWT
4. **GitHub OAuth**：标准 OAuth 2.0 授权码流程

统一策略接口：`AuthStrategy.authenticate(credentials) => UserPayload`，由 `AuthService` 调度。

JWT Token 策略：
- Access Token：15 分钟有效期
- Refresh Token：7 天有效期，存 Redis
- 登出时将 Token 加入 Redis 黑名单

## 4. 数据模型（PostgreSQL Entities）

### 4.1 User

```
users
├── id              UUID PK
├── email           VARCHAR UNIQUE (nullable)
├── phone           VARCHAR UNIQUE (nullable)
├── password_hash   VARCHAR (nullable, 第三方登录无密码)
├── nickname        VARCHAR
├── avatar_url      VARCHAR
├── github_id       VARCHAR UNIQUE (nullable)
├── wechat_openid   VARCHAR UNIQUE (nullable)
├── wechat_unionid  VARCHAR UNIQUE (nullable)
├── status          ENUM(active, disabled)
├── created_at      TIMESTAMP
└── updated_at      TIMESTAMP
```

### 4.2 SyncRecord（通用同步记录）

```
sync_records
├── id              UUID PK
├── user_id         UUID FK → users
├── entity_type     ENUM(agent, workflow, app_setting)
├── entity_id       VARCHAR (本地实体 ID)
├── action          ENUM(create, update, delete)
├── payload         JSONB (变更数据)
├── version         INTEGER (乐观锁版本号)
├── synced_at       TIMESTAMP
└── created_at      TIMESTAMP
```

### 4.3 SyncEntity（各实体表的影子）

同步的每种实体（agents、workflows、app_settings）在服务端各有独立表，结构镜像本地 SQLite 表，额外增加 `user_id` 和 `version` 字段：

- `cloud_agents` — 镜像 `agents` 表 + user_id + version
- `cloud_workflows` — 镜像 `workflows` 表 + user_id + version
- `cloud_app_settings` — 镜像 `app_settings` 表 + user_id + version

## 5. 同步策略（本地优先，云端备份）

### 同步流程

```
客户端                                服务端
  │                                    │
  ├── PUSH（上传本地变更）──────────────►│
  │   POST /sync/push                  │
  │   { entityType, entityId,          │
  │     action, payload, version }     │
  │                                    ├── 校验 version，冲突则返回冲突
  │   ◄───────────── 200 或 409 ───────┤
  │                                    │
  ├── PULL（拉取云端变更）──────────────►│
  │   GET /sync/pull?since=timestamp   │
  │                                    │
  │   ◄──── [{entity, action, data}] ──┤
  │                                    │
  └── WebSocket 实时通知 ──────────────►│
      (另一端修改时推送变更通知)          │
```

### 冲突解决

- **乐观锁**：每个同步实体有 `version` 字段，PUSH 时携带本地 version
- **冲突时**：服务端返回 409 + 当前云端数据，客户端选择：
  - 覆盖云端（以本地为准）
  - 保留云端（以云端为准）
  - 手动合并

## 6. API 设计

### 6.1 认证接口

```
POST   /api/auth/register          # 邮箱注册
POST   /api/auth/login             # 邮箱/手机号登录
POST   /api/auth/sms/send          # 发送短信验证码
POST   /api/auth/oauth/github      # GitHub OAuth 回调
POST   /api/auth/oauth/wechat      # 微信扫码回调
POST   /api/auth/refresh           # 刷新 Token
POST   /api/auth/logout            # 登出
```

### 6.2 用户接口

```
GET    /api/user/profile            # 获取用户信息
PUT    /api/user/profile            # 更新用户信息
PUT    /api/user/password           # 修改密码
```

### 6.3 同步接口

```
POST   /api/sync/push              # 上传本地变更
GET    /api/sync/pull               # 拉取云端变更
GET    /api/sync/status             # 获取同步状态
DELETE /api/sync/conflict/:id       # 解决冲突
```

### 6.4 WebSocket

```
WS /ws/sync?token=xxx              # 实时同步通知频道
  → 事件: sync.change / sync.conflict / sync.complete
```

## 7. 项目结构

```
apps/server/
├── src/
│   ├── configuration.ts          # Midway 入口配置
│   ├── app.ts                    # 应用生命周期
│   ├── entity/                   # TypeORM 实体
│   │   ├── user.entity.ts
│   │   ├── cloud-agent.entity.ts
│   │   ├── cloud-workflow.entity.ts
│   │   ├── cloud-app-setting.entity.ts
│   │   └── sync-record.entity.ts
│   ├── controller/
│   │   ├── auth.controller.ts
│   │   ├── user.controller.ts
│   │   ├── sync.controller.ts
│   │   └── ws-sync.controller.ts
│   ├── service/
│   │   ├── auth/
│   │   │   ├── auth.service.ts
│   │   │   ├── email.strategy.ts
│   │   │   ├── phone.strategy.ts
│   │   │   ├── wechat.strategy.ts
│   │   │   └── github.strategy.ts
│   │   ├── user.service.ts
│   │   ├── sync.service.ts
│   │   └── sync-conflict.service.ts
│   ├── dto/
│   │   ├── auth.dto.ts
│   │   ├── user.dto.ts
│   │   └── sync.dto.ts
│   ├── middleware/
│   │   ├── jwt.middleware.ts
│   │   └── error.middleware.ts
│   └── config/
│       ├── config.default.ts
│       ├── config.prod.ts
│       └── config.local.ts
├── docker-compose.yml
├── Dockerfile
├── package.json
└── tsconfig.json
```

## 8. Docker Compose

```yaml
services:
  postgres:
    image: postgres:16-alpine
    ports: ["5432:5432"]
    environment:
      POSTGRES_DB: spark_agent
      POSTGRES_USER: spark
      POSTGRES_PASSWORD: spark_dev
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
```

## 9. 实现阶段（分步）

### Phase 1：项目骨架 + 数据库
- 初始化 Midway 项目 `apps/server`
- 配置 TypeORM + PostgreSQL 连接
- 创建所有 Entity 和 migration
- Docker Compose 拉起 PG + Redis

### Phase 2：认证系统
- 邮箱 + 密码注册/登录
- JWT 签发/刷新/黑名单
- 鉴权中间件
- 手机号 + 短信验证码

### Phase 3：OAuth 登录
- GitHub OAuth
- 微信扫码登录

### Phase 4：用户管理
- 用户信息 CRUD
- 密码修改

### Phase 5：数据同步
- Push/Pull API
- 乐观锁 + 冲突检测
- WebSocket 实时通知

### Phase 6：客户端对接
- 桌面端集成同步模块
- 登录 UI
