import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      Spark Agent 的代码开发面把 AI 放进你真实的项目里：它能读你打开的项目、写文件、跑命令、
      看 diff、生成 Pull Request，并且所有改动都可逐文件审查。下面是日常会用到的几个关键面。
    </p>

    <h2 id="workspace">1. 项目与工作区</h2>
    <p>
      Spark Agent 以「项目（Project）」为单位管理代码工作区，每个项目对应一个本地目录。
      进入 <strong>「Workspace」</strong> 选择仓库根目录后，Agent 可以访问：
    </p>
    <ul>
      <li>完整文件树（可单文件 / 多文件 / 目录级别授权）。</li>
      <li>当前 Git 分支、HEAD、最近 100 条 commit、远程分支。</li>
      <li>本地 Git Worktree（用于隔离 AI 改动）。</li>
      <li>内置终端（默认 zsh / bash，可切换 PowerShell）。</li>
      <li>可选的远程工作机（SSH / 本地代理）。</li>
    </ul>

    <h2 id="branch">2. 选择分支与 Worktree 隔离</h2>
    <p>
      为了避免 AI 改动污染主分支，Spark Agent 默认建议把工作放到 Git Worktree：
    </p>
    <ol>
      <li>在右上角点「Worktree」 → 选源分支（通常 <code>main</code> / <code>develop</code>）。</li>
      <li>输入新分支名，例如 <code>feat/agent-doc-search</code>。</li>
      <li>所有 AI 改动会写入这个 Worktree 的工作区。</li>
      <li>满意后点「生成 PR」直接推到远端并打开 PR 页。</li>
    </ol>
    <p>
      这种「隔离 → 验证 → 合并」的工作流让 AI 的所有改动都可逆、可对比、可回退。
    </p>

    <h2 id="terminal">3. 内置终端</h2>
    <p>
      Spark Agent 通过内嵌 <code>node-pty</code> 提供真终端，支持：
    </p>
    <ul>
      <li>任意 shell（默认 zsh / bash / PowerShell，可在设置切换）。</li>
      <li>交互式命令（vim / htop / REPL）。</li>
      <li>终端内的彩色与 ANSI 转义。</li>
      <li>命令级权限审批：高风险命令（<code>rm -rf</code> / <code>git push --force</code> 等）会先弹窗确认。</li>
    </ul>

    <h2 id="review">4. 审查与补丁</h2>
    <p>
      Spark Agent 的代码审查分为两个层级：
    </p>
    <ul>
      <li>
        <strong>生成时审查</strong>：Agent 每次写入文件前会自检语法与边界条件，
        写入后会再次跑 <code>tsc --noEmit</code> / <code>eslint</code> 等静态检查（按项目）。
      </li>
      <li>
        <strong>人工审查</strong>：在 <strong>「Code Review」</strong> 面板看 <code>develop</code> 与
        <code>origin/develop</code> 的完整 diff（带 +389 / -309 行数统计），可逐文件确认或回退。
      </li>
    </ul>

    <h2 id="pr">5. Pull Request 与补丁</h2>
    <p>
      审查通过后点「生成 PR」，Spark Agent 会：
    </p>
    <ol>
      <li>把当前 Worktree 分支推送到远端。</li>
      <li>用 commit 信息模板生成 commit（按 conventional commits 风格）。</li>
      <li>调用 GitHub / Gitee API 创建 PR，标题 + 描述都从改动里自动提取。</li>
      <li>把 PR 链接回写到会话里便于追踪。</li>
    </ol>
    <p>
      没装 CLI 也可以走「补丁」流程：导出 <code>.patch</code> 文件，手动 <code>git am</code>。
    </p>

    <h2 id="best-practices">6. 最佳实践</h2>
    <ul>
      <li>永远在 Worktree 里跑 AI 改动，主分支留作「可信基线」。</li>
      <li>小步提交：让 Agent 改完一个文件就提交一次，便于回退。</li>
      <li>跑测试：让 Agent 改完后必须 <code>pnpm test</code> / <code>pytest</code> 通过再生成 PR。</li>
      <li>代码风格：用 <code>eslint --fix</code> / <code>prettier --write</code> 在终端里跑一次。</li>
      <li>遇到依赖变更：让 Agent 先 <code>pnpm why &lt;pkg&gt;</code> 再决定升级路径。</li>
    </ul>
  </>
)

export const codeDevelopment: DocsPageContent = {
  slug: 'code-development',
  toc: [
    { id: 'workspace', title: '1. 项目与工作区', level: 2 },
    { id: 'branch', title: '2. 选择分支与 Worktree 隔离', level: 2 },
    { id: 'terminal', title: '3. 内置终端', level: 2 },
    { id: 'review', title: '4. 审查与补丁', level: 2 },
    { id: 'pr', title: '5. Pull Request 与补丁', level: 2 },
    { id: 'best-practices', title: '6. 最佳实践', level: 2 },
  ],
  faq: [
    {
      question: '能在主分支直接改吗？',
      answer: '技术上可以，但强烈不推荐。主分支应当作为「可信基线」，所有 AI 改动放 Worktree。',
    },
    {
      question: 'Worktree 与新建分支有什么区别？',
      answer:
        'Worktree 是 Git 的目录级工作区，可同时在多个分支并行开发；新建分支只是引用，工作目录不变。',
    },
    {
      question: '为什么我的 PR 没有自动生成 commit 信息？',
      answer: '检查「设置 → 项目」是否启用了 conventional commits 模板；Agent 会按模板生成。',
    },
    {
      question: '支持 Gitee / 自建 GitLab 吗？',
      answer:
        '支持。PR 生成走的是通用 Git 平台适配层，可在 Provider 配置里填入自定义 API 根路径与 Token。',
    },
  ],
  quickReference: [
    { key: '隔离机制', value: 'Git Worktree + 独立分支' },
    { key: '终端实现', value: 'node-pty 嵌入式 PTY' },
    { key: '审查面板', value: 'develop ↔ origin/develop diff（带行数统计）' },
    { key: '代码静态检查', value: 'tsc --noEmit / eslint / 项目自检脚本' },
    { key: 'PR 平台', value: 'GitHub / Gitee / 自建 GitLab（可扩展）' },
    { key: '补丁导出', value: 'git format-patch → git am' },
  ],
  howTo: {
    name: '用 Spark Agent 完成一次代码改动并生成 PR',
    description: '在隔离分支上让 AI 修改代码、跑测试、生成 Pull Request',
    totalTime: 'PT15M',
    steps: [
      '打开项目工作区，选择主分支（如 develop）',
      '新建 Worktree，输入新分支名（如 feat/agent-doc-search）',
      '在侧边对话里描述目标改动，让 Agent 编辑文件',
      '在「Code Review」面板逐文件审查 diff，确认无误',
      '在「终端」面板跑 pnpm test / pytest 验证',
      '点「生成 PR」推到远端并打开 PR 页',
    ],
  },
  aiSummary:
    'Spark Agent 代码开发工作流：项目工作区与 Git Worktree 隔离、内置终端（node-pty）、Code Review 面板（逐文件 diff）、' +
    'Pull Request 自动生成（GitHub / Gitee / 自建 GitLab）、conventional commits 模板、补丁导出 (git format-patch / git am)、' +
    '命令级权限审批（rm -rf / git push --force 等高风险命令）。最佳实践：Worktree 隔离 + 小步提交 + 跑测试。',
  Body,
}

export default codeDevelopment
