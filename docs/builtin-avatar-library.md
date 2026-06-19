# 内置头像库

Spark Agent 在桌面端内置一组 PNG 头像，用于离线默认头像和 Agent / 团队的可选风格化头像。

## 范围

- 未登录用户：使用 `user-default` 作为本地兜底头像。已登录用户头像仍以云端保存的数据为准。
- Agent：支持上传头像、选择内置头像；如果两者都没有设置，使用固定的 `agent-default`。
- 团队：支持上传头像、选择内置头像；如果两者都没有设置，使用固定的 `team-default`。
- 平台管理 Agent：可使用 `platform-manager` 专用内置头像。

## 资产与索引

头像资产位于：

`apps/desktop/src/renderer/assets/builtin-avatars/`

当前分类：

- `default`：用户、Agent、团队、平台管理等固定默认头像。
- `animal`：小动物漫画头像。
- `person`：人物和工作角色头像。
- `guofeng`：国风主题头像。

渲染端通过 `apps/desktop/src/renderer/design/builtinAvatars.ts` 使用 `import.meta.glob` 建立 PNG 索引，并导出默认头像 ID、头像列表、ID 校验和资源解析函数。

## 配置格式

内置头像使用现有 `SparkAvatarConfig` 的 builtin 形态：

```ts
{ kind: 'builtin', id: 'agent-default' }
```

上传头像继续使用 `upload`，外部 URL 和历史 DiceBear 配置仍保留兼容解析。旧的 `{ kind: 'builtin', id: 'guest' }` 会映射到 `user-default`。

## 默认策略

默认头像是固定兜底，不再由名称动态生成：

- 用户未登录兜底：`user-default`
- Agent 兜底：`agent-default`
- 团队兜底：`team-default`

头像选择器中的“内置头像”按钮展示完整头像库供用户切换；需要恢复兜底头像的场景可继续展示“默认头像”按钮，Agent 管理页仅保留“内置头像”和“上传”。
