# Computer Use 全桌面委托修复审查

## 结论

通过。MCP `start_task` 在未提供 `targetWindowId` 时不再把任务永久绑定到启动瞬间的前台窗口，可由 Native Backend 跟随前台窗口跨应用执行。调用方显式提供 `targetWindowId` 时仍保持精确单窗口绑定。

## 根因与改动范围

- 根因：Agent Controller 无条件把启动时前台应用写入 `allowedApps`，并调用 `bindSessionTarget`，导致 Backend 永远使用 `requireExactTarget`，跨应用观察在入口被截断。
- 修复：默认任务登记启动时可见应用作为低摩擦初始身份集合，但不建立目标绑定；显式目标任务继续只登记并绑定所选窗口。
- 工具契约：`start_task` 描述明确默认跨应用，避免模型在用户未要求时自行传入 `targetWindowId`。
- 未修改：Native Host 签名/hash/协议验证、系统隐私权限、stale-frame 校验、用户接管、显式窗口隔离和不可逆动作边界。

## 三遍复核

1. 源码调用链：确认 MCP Controller 是唯一无条件绑定入口；Renderer IPC 原本已采用可选绑定；Backend 未绑定分支优先选择当前 focused window。
2. 自动化回归：Computer Use 与 IPC 共 40 个测试文件、277 项测试通过，新增默认跨应用与显式绑定回归。
3. 最终差异：`git diff --check` 与 Prettier 通过，改动仅限 Computer Use Controller/Bridge/测试及本计划文档；未触碰并行 Canvas 改动。

## 验证限制

全量 desktop typecheck 被并行 Canvas 工作树缺少 `canvasMinimapGeometry` 模块阻断；错误不涉及本次文件。本次聚焦测试与完整 Computer Use 回归均通过，仍需在并行 Canvas 改动收口后补跑全量 typecheck。
