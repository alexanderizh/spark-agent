# SparkWork 内置 Git Runtime 回退修复计划

> 状态: 待开发 | 最后核对: 2026-08-24

## 1. 结论

将 Git 视为桌面端基础运行时，按平台和架构把一套完整、可重定位的 Git runtime 随安装包交付。应用启动时先修复宿主 PATH，再按“显式开发覆盖 → 满足最低能力门槛的系统 Git → 内置 Git”解析可执行环境；内部功能和 `/git` 内置只读命令统一通过绝对可执行路径运行 Git，Agent 自由 shell 与内置终端通过子进程级环境构造器获得同一 runtime。任何 Git 专用环境变量都不写入全局 `process.env`。

这次修复不采用以下方案：

- 不只把单个 `git` / `git.exe` 复制进安装包。Git 的远程传输、模板、证书、OpenSSH 和子命令 helper 依赖完整目录结构。
- 不把核心 Git 做成首次使用时下载的可选能力。无网络、制品源不可用或首次启动时，分支检测和 Git 面板仍必须可用。
- 不仅修改会话分支检测和 Git 面板两处调用点。worktree、checkpoint、会话 worktree 状态和 `/git` 同样依赖 Git。
- 不引入 libgit2/isomorphic-git 作为第二套实现。现有能力已经依赖原生 Git 的 worktree、配置、credential helper 和命令语义，双实现会扩大兼容成本。
- 不在某条 Git 命令非零退出后自动换成另一套 Git 重放。尤其对 commit、pull、stash、discard 等写操作，这会产生重复执行风险。

## 2. 目标与非目标

### 2.1 目标

1. 用户电脑没有安装 Git 时，会话分支、代码面板 Git 状态和本地 Git 操作正常工作。
2. 系统 Git 可用时继续优先使用系统 Git，保留用户已有版本、配置、凭据 helper 和企业环境兼容性。
3. 所有应用内 Git 调用共享同一个运行时解析结果、执行入口、超时和错误模型。
4. 明确区分“Git runtime 不可用”“当前目录不是 Git 仓库”“Git 命令执行失败”。
5. 内置 runtime 在离线首次启动、安装路径含空格/中文以及受限 PATH 下仍可工作。
6. Git runtime 的来源、版本、完整性、签名、公证和许可证材料进入发布门禁。

### 2.2 非目标

- 不新增 Git 凭据管理 UI、SSH key 管理器或交互式终端认证流程。
- v1 不承诺内置 Git LFS、Git Credential Manager、自定义 remote helper 或用户 hook 依赖的外部工具；这些能力要么使用用户已有安装，要么精确报出缺失依赖，绝不静默绕过 hook/filter。
- 不改变用户的 `git pull` 默认策略，不附加 `--ff-only`、`--rebase` 等参数。
- 不修改用户全局或仓库级 Git 配置。
- 不把构建脚本中读取仓库 commit 的 Git 调用迁入桌面运行时；构建环境本身必须有 Git。
- 不在本轮重构 Git 面板视觉或扩展新的 Git 功能。

## 3. 已确认现状与影响范围

### 3.1 根因

- `ShellEnvironmentService` 只为 Node/npm 实现内置回退；Git 检测只依赖宿主 PATH。
- `electron-builder.yml` 和 `after-pack.js` 没有打包 Git runtime。
- Spark 自建制品清单当前没有 Git runtime 制品。
- `getWorkspaceGitStatus()` 通过会吞掉所有错误的 `tryGitStdout()` 判断仓库，`spawn git ENOENT` 最终被错误映射为 `isGitRepo: false`。
- Git 面板据此显示“当前项目不是 Git 仓库”，会话分支和 worktree 状态则静默为空。

### 3.2 直接与间接消费者

源码降级检索确认：运行时代码中至少有 35 个可直接匹配的 Git 子进程启动点，集中在 4 个文件；此外还有 `/git` 的 shell 执行路径。主要消费者如下：

| 消费者                         | 当前入口                                             | 受影响能力                                                    |
| ------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------- |
| Workspace Git 查询与写操作     | `workspace-git-status.ts`                            | 分支、tag、状态、diff、log、stage、stash、discard、push、pull |
| Workspace Git IPC              | `ipc/index.ts`                                       | 切分支、检出 tag、fetch、commit、创建分支、worktree 列表      |
| Worktree 服务                  | `git-worktree.service.ts`                            | 创建/移除 worktree、主仓库解析、基础分支和合并状态            |
| 会话 worktree 状态             | `session-worktree-state.ts`                          | 会话分支徽标和 worktree 状态同步                              |
| Workspace 服务与历史导入       | `workspace.service.ts`、`HistoryImportService.ts`    | worktree 创建、主仓库路径归一化                               |
| Checkpoint                     | `checkpoint-git.service.ts`、`session/checkpoint.ts` | checkpoint 可用性、快照、恢复和清理                           |
| `/git`、Agent shell 与内置终端 | `command-registry.ts`、shell/PTY 执行器              | `/git status/log/branch/stash list`、Agent 和用户自行执行 Git |
| 完整性设置                     | `ShellEnvironmentService.ts`、`SettingsView.tsx`     | Git 可用性、版本、来源和修复提示                              |

构建期的 `native-host-build-info.js` 只在 CI/打包阶段读取 commit，不属于桌面 runtime 迁移范围。

### 3.3 风险评级

整体风险为 **HIGH**：改动跨 desktop main、renderer、protocol、agent-runtime 和 release pipeline，且影响 commit、pull、stash、discard、checkpoint 等有状态操作。开发时必须按阶段提交和验证，禁止一次性替换后只跑单一 happy-path 测试。

当前工作树中 `workspace-git-status.ts`、其测试和 `ipc/index.ts` 正有其他并行改动。开始实现前必须先确认这些改动已合并或切到隔离 worktree；不得覆盖、stash 或混合暂存他人的变更。

## 4. 目标架构

```text
Spark Git runtime 制品（按平台/架构、SHA256、完整目录）
                    │
                    ▼
桌面发布流水线下载并校验 ──► resources/runtime/git/<完整前缀>
                    │
                    ▼
应用启动：修复 PATH ──► GitRuntimeService 解析并健康检查
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
内部 GitCommandService       受管 shell / PTY 子进程环境
绝对路径、结构化错误          PATH + 必要 runtime env，仅对子进程生效
        │
        ├─ Workspace Git IPC / Git 面板
        ├─ GitWorktreeService / SessionWorktreeStateService
        ├─ CheckpointGitService
        └─ /git 内置只读命令
```

### 4.1 Git runtime 制品

Git runtime 是发布输入，不是终端用户按需安装项。当前桌面发布 workflow 的唯一正式矩阵为：

- macOS arm64
- macOS x64
- Windows x64

当前 workflow 不发布 Linux，也不产出 Windows arm64 或 macOS universal 包。resolver 与打包脚本保持平台无关设计；未来任何正式 target 加入矩阵时，如果仓库锁文件中没有匹配的 runtime，release job 必须 fail closed，禁止退化成“依赖用户系统 Git”后继续发布。macOS 当前按 arm64/x64 分包，不处理 universal 内双 runtime 选择。

每个平台制品必须是完整可重定位前缀，至少包含：

- Git 主程序和 `libexec/git-core` helper；
- templates；
- HTTPS transport、TLS 依赖和 CA bundle；
- 该发行版正常工作所需的 shell/OpenSSH/动态库；
- 许可证、第三方声明及对应源码获取信息；
- runtime 元数据：Git 版本、平台、架构、入口相对路径、SHA256、大小和文件清单摘要。

建议制品标识使用 `runtime.git-<version>.<platform>-<arch>`。Windows 优先镜像并验证官方 MinGit 完整包；macOS/Linux 使用固定源码与依赖构建可重定位前缀。所有上游版本、补丁和构建参数必须固定，禁止发布时临时抓取“latest”。

在仓库中新增受版本控制的 runtime lock，固定每个正式 target 的 artifact id、版本、归档 SHA256、大小、入口路径、上游源码摘要和 SBOM 摘要。桌面 release job 通过 lock 精确选择制品，并要求远端 manifest 与 lock 完全一致，禁止按前缀或“latest”选择可执行代码。

制品供应链门禁包括：验证上游 Git tag/源码签名或官方发布签名；保存对应源码、补丁和可复现构建脚本；生成 SBOM 与构建 provenance；扫描 Git、OpenSSL/libcurl、OpenSSH 和 CA bundle 的已知高危漏洞；审计 macOS rpath/最低系统版本、Windows DLL/VC runtime 依赖、可执行位和符号链接；归档 SHA256 → 上传 → 公网完整 GET → 重新计算 SHA256 → staging manifest → 全仓审计 → 正式 manifest 替换 → 正式 manifest 回读。Git runtime 维护 owner、常规更新周期和高危漏洞修复 SLA 必须在 Phase 0 明确，不能只验证传输哈希。

### 4.2 Runtime 解析顺序

`GitRuntimeService` 在 `initializeShellEnvironment()` 修复 PATH 后、IPC 和 Session 服务开始工作前完成初始化：

1. `SPARK_GIT_EXECUTABLE`：仅用于开发、测试和诊断。设置后按严格覆盖处理；路径无效时直接报告配置错误，避免悄悄使用其他 Git 掩盖问题。
2. 系统 Git：从修复后的 PATH 解析绝对路径，检查最低版本、`--exec-path` 和关键 helper。最低版本在 Phase 0 根据当前实际使用的 `switch`、`restore`、`rev-parse --path-format` 等命令审计后固化为常量；仅 `which/where` 或 `git --version` 命中不算可用。macOS 遇到 `/usr/bin/git` 时先无副作用确认 Command Line Tools 可用，不能触发系统安装弹窗。
3. 内置 Git：从 repo-pinned runtime lock 和 `process.resourcesPath/runtime/git` 解析入口，验证版本、平台、架构、关键目录/helper 和轻量健康检查。完整 init/worktree/HTTPS 能力在制品及安装包 verifier 中验证，避免每次启动创建仓库或访问网络。

解析结果包含：

```ts
type GitRuntimeSource = 'override' | 'system' | 'bundled'

interface GitRuntimeDescriptor {
  generation: number
  source: GitRuntimeSource
  executablePath: string
  version: string
  commandEnvPatch: NodeJS.ProcessEnv
  shellPathEntries: string[]
}
```

解析器采用 single-flight refresh：启动、用户点击“重新检测”或确认 executable 已消失时生成新一代不可变 descriptor；并发命令各自捕获启动时的 descriptor，刷新只影响后续命令。已有长生命周期 PTY/Agent 子进程不热改环境，UI 提示重开终端或重启相关会话；新建子进程使用最新 generation。

子进程 `ENOENT` 不能直接等同于 Git 丢失。执行前先校验 cwd；出错后分别检查 cwd、executable 和动态加载器/依赖。只有确认进程未启动且 executable 已消失时，才允许 single-flight refresh 并最多重试一次；cwd 消失、runtime 文件仍存在但加载失败等情况直接返回精确错误。任何已启动命令都不因刷新而重放。

生产日志只记录 `source`、`version`、平台和结构化失败码，不记录仓库 URL、命令参数中的敏感内容或用户目录完整路径。

### 4.3 运行环境

内置 runtime 的环境补丁由平台描述符产生，不在业务调用点散落硬编码，也不写入全局 `process.env`：

- `GitCommandService` 在每次命令上合并 selected runtime 的 `commandEnvPatch`；Agent shell/PTY 通过统一 `buildGitChildEnvironment(baseEnv, descriptor)` 获取完整子进程环境，不能只补 PATH；
- 优先把 helper、templates 和 CA 做成 runtime 自身可重定位默认路径。只有制品确实需要时才在该 runtime 的子进程设置 `GIT_EXEC_PATH` 等私有路径，不污染系统 Git；
- 用户已有的凭据、代理、企业 CA、SSH 和 transport 环境默认优先。若某个变量是内置 runtime 正确绑定自身 helper 的硬要求，必须逐项列入 platform descriptor 并在 Phase 0 说明覆盖理由；
- 保留用户的 HOME、全局/仓库 Git 配置和 SSH 环境；
- 不设置或覆盖 `GIT_CONFIG_GLOBAL`、`GIT_CONFIG_SYSTEM` 等会改变用户配置语义的变量；
- checkpoint 的 `GIT_INDEX_FILE` 只在该次命令上叠加，不污染全局环境。

Windows 环境合并统一处理 `PATH`/`Path` 大小写，只保留一个有效键。若必须给自由 shell 暴露启动 wrapper，wrapper 只负责绑定该 runtime 的必要环境并 `exec` 实际 Git；内部 `GitCommandService` 永远直接运行绝对二进制，不经过 shell wrapper。

### 4.4 统一命令执行层

在 `agent-runtime` 提供与 Electron 无关的 `GitCommandService`，桌面端 `GitRuntimeService` 负责提供已解析 descriptor。执行接口应支持：

- 参数数组执行，禁止内部操作拼 shell 字符串；
- `cwd`、timeout、maxBuffer、命令级环境补丁；
- 明确允许的退出码，不把所有非零退出吞成 `null`；
- 标准化 stdout/stderr 和 spawn error；
- 测试注入，保留 `GitWorktreeService` 现有可注入 executor 的能力；
- 只在“进程根本未启动”的 `ENOENT` 场景重新解析 runtime。任何已启动命令的非零退出都不自动重放。

执行器按命令性质使用不同 timeout profile：只读本地查询、本地写操作、网络操作分别配置；超时需终止跨平台进程树并检查残留 lock/子进程。写操作或网络操作超时时返回“结果可能已生效”的稳定错误码，立即刷新状态供用户判断，禁止自动重试。hook、SSH 或 credential helper 超时同样遵循该规则。

内部代码最终不得再直接 `execFile('git', ...)`。Agent 自由 shell 和内置终端仍可输入 `git`，由子进程 env builder 保证所选 runtime 的 PATH 与必要环境一致。

### 4.5 错误模型

新增可复用于 status、branches、worktrees 和 session worktree 的 Git 可用性判别。`isGitRepo` 作为过渡字段保留，但改为 `boolean | null`，其中 `ready=true`、`not_repository=false`、两个错误态必须为 `null`；同一 Phase 审计并更新所有消费者，禁止继续用 `isGitRepo !== true` 推导“非仓库”：

```ts
type WorkspaceGitState =
  | {
      kind: 'ready'
      repositoryKind: 'worktree' | 'bare'
      runtimeSource: GitRuntimeSource
      runtimeVersion: string
    }
  | { kind: 'not_repository' }
  | { kind: 'runtime_unavailable'; code: 'GIT_RUNTIME_UNAVAILABLE'; message: string }
  | { kind: 'failed'; code: GitFailureCode; message: string }

type GitFailureCode = 'GIT_OPERATION_FAILED' | 'GIT_OPERATION_OUTCOME_UNKNOWN' | 'AUTH_REQUIRED'
```

同时在统一错误码中增加 `GIT_RUNTIME_UNAVAILABLE` 和 `GIT_OPERATION_OUTCOME_UNKNOWN`。分类规则：

- 找不到或无法启动任何 Git：`runtime_unavailable` / `GIT_RUNTIME_UNAVAILABLE`；
- 通过固定 locale 的 `rev-parse --is-inside-work-tree` / `--is-bare-repository` 探测普通仓库、linked worktree 和 bare repo；bare repo 属于 `ready`，但 UI 禁用依赖工作区文件的操作；只有明确的非仓库结果映射为 `not_repository`；
- dubious ownership、权限、损坏仓库、配置错误、hook/transport 错误等：`failed` / `GIT_OPERATION_FAILED`；
- 查询可选 ref、upstream 或 stash 时，只吞该命令语义允许的退出码，不吞 spawn、timeout 或 runtime 错误。

仓库探测可单独使用稳定英文 locale 便于错误分类；真实用户操作保留用户 locale，不为了解析而改变 hook/命令行为。原始 stderr 只存在于受控的本地诊断边界；进入 IPC、UI、日志或遥测前分别脱敏 URL 凭据、令牌、敏感环境变量和用户路径。UI 展示可行动摘要，日志只写稳定 code 与必要的非敏感上下文。

远程操作的 v1 支持契约为：保证公共 HTTPS、已有非交互 credential helper、已运行 ssh-agent、无口令 key/已确认 known_hosts 可工作。UI 发起的 fetch/pull/push 禁止无界交互，缺凭据或首次 host-key/口令交互时快速返回 `AUTH_REQUIRED` 或精确操作错误；自由 shell/内置终端保留正常交互能力。Git LFS、自定义 remote helper、GCM/osxkeychain 是否随包交付必须在 Phase 0 明确；若不随包，缺失时不得归类为 runtime unavailable。

### 4.6 UI 行为

- Git 面板继续保留 loading skeleton。
- `not_repository` 显示“当前项目不是 Git 仓库”。
- `runtime_unavailable` 显示“Git 运行环境不可用”，提供“重新检测”和“打开设置 → 完整性”入口，不再伪装成非仓库。
- `failed` 显示精确错误摘要和重试入口。
- 完整性页把 Git 标记为“系统”或“内置”，展示版本；内置可用时不再提示用户下载安装系统 Git。
- 会话分支/工作树状态发生 runtime 错误时保留上一个可信快照并展示不可用提示，不用空字符串覆盖可信分支。
- branches/worktrees/status 三类接口使用同一 availability state；任何一条读取链路都不得 catch-all 后返回空数组或 `isGitRepo: false`。

## 5. 分阶段实施计划

### Phase 0：Runtime 制品与发布可行性门禁

本阶段不改业务调用点。

1. 固定 Git 版本、上游来源、依赖和构建方式。
2. 产出 macOS arm64/x64、Windows x64 runtime 归档。
3. 验证 `--version`、init/status/branch/worktree、commit、HTTPS `ls-remote`、SSH 启动链和证书。
4. 测量压缩包与安装后体积，形成基础包增量预算。
5. 决定并记录 GCM/osxkeychain、Git LFS、自定义 remote helper 和 hooks 的支持边界。
6. 完成上游签名、runtime lock、SBOM、provenance、CVE、GPLv2 与第三方依赖分发材料核对。
7. 审计 macOS rpath/最低系统版本、Windows DLL/VC runtime、符号链接和可执行位，不得依赖构建机绝对路径。
8. 发布到 Spark 制品仓库并完成公网下载与 SHA 闭环。

通过标准：三个正式目标制品均可在无系统 Git 的干净环境独立运行；大小和许可证材料被接受后才进入 Phase 1。

### Phase 1：打包、解析与完整性

预计改动：

- 新增 `package-git-runtime` / `verify-packaged-git-runtime` 脚本及测试；
- `after-pack.js`、桌面发布 workflow；
- 新增 `GitRuntimeService` 及纯函数测试；
- `ShellEnvironmentService` 与 `GitRuntimeService` 协作检测 runtime；新增子进程级 env builder，不向全局 `process.env` 写 Git 专用变量；
- 完整性页展示 runtime 来源和版本。

通过标准：安装包在受限 PATH/无系统 Git 环境能解析内置 Git；系统 Git 健康时仍选系统 Git；包内文件、签名/公证和版本均通过验证。

### Phase 2：Workspace Git 与错误状态迁移

1. 引入 `GitCommandService` 和结构化错误。
2. 迁移 `workspace-git-status.ts` 中所有查询/写操作。
3. 迁移 `ipc/index.ts` 中切分支、tag、fetch、commit、创建分支和 worktree 列表调用。
4. 协议增加 `WorkspaceGitState` 与 `GIT_RUNTIME_UNAVAILABLE`。
5. status、branches、worktrees、会话状态共享 availability state，Git 面板、分支弹窗和完整性页接入四态展示。
6. 把 `tryGitStdout` 类 helper 改为按命令语义接受退出码，禁止全量 catch。

当前 Git 面板/branch picker 并行改动必须先收口，Phase 2 在独立 worktree 中基于最新代码实施。

### Phase 3：Agent Runtime 消费者迁移

1. `GitWorktreeService` 改用注入的统一 executor，保留测试构造方式。
2. `SessionWorktreeStateService`、`WorkspaceService` 和历史导入沿用同一实例/descriptor。
3. `CheckpointGitService` 迁移统一 executor，并验证临时 index 环境叠加不变。
4. `/git status`、`/git log`、`/git branch`、`/git stash`（仅 list）直接以参数数组调用 `GitCommandService`；其他写子命令仍交给 Agent 自由 shell，并遵守写操作不重放规则。
5. Agent 自由 shell 和内置终端统一使用子进程 env builder；已有长生命周期 PTY 在 runtime refresh 后提示重开。
6. 删除运行时代码中剩余的直接字符串 `git` 启动点，保留测试、构建和用户 shell 边界白名单。

### Phase 4：发布验收与灰度

1. 跑完整单元/集成/安装包矩阵。
2. 在 Windows 无 Git 干净虚拟机和 macOS 受限 PATH 环境做真实 UI 验证。
3. 检查系统 Git 与内置 Git 两种来源下的同仓库行为差异。
4. 验证包体、启动耗时、签名、公证、自动更新和卸载残留。
5. 先内部灰度，再进入正式发布；日志按结构化失败码观察，不采集仓库内容。

## 6. 测试与验收矩阵

### 6.1 单元测试

- resolver 优先级：override / system / bundled；
- 无效 override 严格失败；
- 系统 Git 版本过低、缺 exec-path/关键 helper 或 macOS 无 CLT 时回退 bundled，且不得触发系统安装弹窗；
- bundled 缺主程序/helper/templates 时返回完整性错误；
- 安装路径含空格、中文和 Windows 反斜杠；
- Windows `PATH`/`Path` 合并后只有一个有效键；
- single-flight refresh、descriptor generation、并发命令快照和已有 PTY 不热更新；
- 区分 executable/cwd/动态加载器导致的 ENOENT；
- GitCommandService 的 stdout/stderr、timeout、maxBuffer、env 合并和允许退出码；
- 只对未启动的 `ENOENT` 重新解析，不对非零退出重放；
- runtime 不可用、非仓库、dubious ownership 和普通命令失败的分类；
- GitWorktreeService、CheckpointGitService 注入统一 executor 后的回归；
- Git 面板四态和会话分支保留最后可信值；
- stderr 到 IPC/UI/log/telemetry 的分层脱敏。

### 6.2 集成测试

- 无系统 Git + bundled fixture：init、status、branch、tag、diff、log、stage、commit、stash；
- 本地 bare remote：fetch、pull、push，不依赖外网凭据；
- worktree 创建/移除、base branch、merged branch；
- checkpoint snapshot/restore/prune，确认不污染真实 index；
- `/git status/log/branch/stash` 和 Agent shell `git --version`；
- 空目录、普通目录、损坏仓库、linked worktree、submodule；
- 系统 Git 与内置 Git 使用同一个 `~/.gitconfig` 和仓库配置；
- mock credential helper、ssh-agent、known_hosts、缺 helper、需交互认证和挂起 hook/helper；确认认证问题不误报 runtime 缺失，超时后无残留子进程且写操作结果标记为未知。

### 6.3 安装包测试

- macOS arm64/x64、Windows x64 包内 runtime 清单和 SHA；
- Windows Authenticode、macOS codesign/notarization 对嵌套二进制有效，SBOM/provenance 与 runtime lock 一致；
- 离线首次启动可显示分支和 Git 面板；
- Windows 干净虚拟机确认没有系统 Git 也能完整操作；macOS bundled 场景强制 `bundled-only`，并断言 source、executable、helper/SSH 均来自包内；另测 `auto` 的真实回退路径，避免误用 `/usr/bin/git` 产生假阳性；
- HTTPS 公共仓库 `ls-remote` 验证 transport/CA；
- SSH 启动链读取用户 `~/.ssh`，不新增私钥处理逻辑；
- 私有 HTTPS/本地 SSH server 覆盖非交互 helper、ssh-agent、known_hosts 和需要交互时的快速失败；
- 自动更新后 runtime 版本和文件完整性正确；
- 安装/卸载不在用户目录遗留第二套未托管 runtime。

### 6.4 静态门禁

新增 CI 检查：运行时代码中除中央执行器和明确白名单外，不得出现 `execFile/spawn('git', ...)` 或内部固定 shell 字符串 `git ...`。构建脚本和测试 fixture 可保留，但需在白名单中说明原因。

## 7. 回滚、灰度与兼容策略

- 保留 `SPARK_GIT_RUNTIME_MODE=auto|system-only|bundled-only` 作为开发、CI 和诊断开关，默认 `auto`；不在普通设置中暴露。它只是排障手段，不是已发布版本的回滚能力。
- 未完成 Phase 2/3 中央执行器与子进程环境迁移前不得发布；不依赖全局 PATH 注入把旧直接调用点当作正式兼容层。
- 每个 Phase 独立提交、独立可回退。协议/UI 四态与后端状态必须同一阶段合并，避免 renderer/main 语义错位。
- 发布前定义 bundled resolver/命令失败率、崩溃和包体异常的灰度暂停阈值与负责人。触发后立即停止自动更新 rollout；已安装版本不能靠远端 manifest 回退包内 runtime，也不能假设自动更新支持降级，必须发布更高版本号的签名热修。上一签名安装包只作为人工恢复选项，并先核对数据库/协议向后兼容。
- 对无系统 Git 用户，`system-only` 无法恢复能力；若 bundled runtime 出现平台问题，短期 UI 必须准确提示并提供安装系统 Git 的可执行指引，正式恢复依赖热修包。
- 不迁移、不删除用户配置与凭据，因此回滚不会改写仓库或 Git 配置。

## 8. 文档与发布记录

实施时同步更新：

- 本计划：启动时改为“实施中”，发布验收完成后改为“已落地”；
- `docs/design/desktop-runtime-and-remote-assets.md`：增加 Git runtime 布局和制品来源；
- 发布/完整性文档：增加 runtime 版本、包体与签名验收；
- 制品发布记录：记录上游版本、SHA256、平台、架构、许可证和公网复验结果。

## 9. 开发开始前的确认门

以下条件全部满足后再开始业务代码开发：

1. 用户确认本计划的核心决策：基础包内置完整 Git、系统优先、内置回退。
2. Phase 0 三个平台制品、包体预算和许可证核对通过。
3. 当前 Git 面板/branch picker 并行改动已合并，或已创建隔离 worktree。
4. 若 GitNexus MCP 恢复可用，对 `getWorkspaceGitStatus`、`GitWorktreeService`、`CheckpointGitService` 和相关 IPC 做 upstream impact；仍不可用则保留本计划的源码检索降级证据。
5. 明确每个 Phase 的负责人和提交边界，避免在脏工作树中混合暂存。
