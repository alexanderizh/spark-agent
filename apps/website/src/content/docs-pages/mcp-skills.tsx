import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      Spark Agent 把 Skills 与 MCP Servers 作为可扩展的「能力层」。Skills 是给 Agent 读的「说明书」，
      MCP 是给 Agent 调的「工具集」。本主题聚焦于内置 + 可安装 + 按需加载的完整机制。
    </p>

    <h2 id="why-catalog">1. 为什么用「安装卡片」而不是直接内置</h2>
    <p>
      部分技能（如 <code>ppt-master</code> ~96MB、上万文件）体积大，直接随包内置会显著膨胀安装包；
      另一些技能（如 <code>playwright</code> 终端 CLI 技能）虽不大，但并非所有用户都需要。
      为此 Spark Agent 采用「<strong>内置安装卡片 + 一键按需安装完整原装技能</strong>」的方式：
    </p>
    <ul>
      <li>应用只内置技能的<strong>元信息卡片</strong>（名字、描述、来源），新机器装完即可在「技能 → 精选技能」看到；</li>
      <li>用户点「安装」时，才从 GitHub 下载<strong>完整原装技能</strong>（不裁剪、不精简）；</li>
      <li>安装后技能落到用户技能目录（<code>&#123;userData&#125;/skills/</code>），与本地导入的技能同等可用、可启用、可挂到会话。</li>
    </ul>
    <p>
      与「内置技能」（<code>apps/desktop/resources/skills/</code>，随包分发、只读）的区别：
      内置卡片只装<strong>来源信息</strong>，真正内容按需从远端拉取。
      <code>multi-search-engine</code> 等小而通用的技能仍走「直接内置」。
    </p>

    <h2 id="data-flow">2. 数据流</h2>
    <pre>
{`┌────────────────────┐  skill:list-installable   ┌──────────────────────────┐
│  SkillStoreView    │ ◀─────────────────────── │ SkillRegistryService     │
│  「精选技能」Tab    │                          │  .listInstallableCatalog()│
│  (renderer)        │                          │   ↑ 读 INSTALLABLE_SKILL │
│                    │  skill:install-catalog    │     _CATALOG 常量 + 查库  │
│  卡片 [安装] 按钮   │ ───────────────────────▶ │  .installFromCatalog()   │
│                    │                          │   ├ type=tarball → tarball│
│  进度条            │ ◀ stream:skill:           │   │   -installer         │
│  (stream 推送)     │   install-progress        │   └ type=github  → 既有  │
└────────────────────┘                          │       installFromGithub   │
                                                └────────────┬─────────────┘
                                                               │ 写入 {userData}/skills/<slug>
                                                               ▼
                                                ┌──────────────────────────┐
                                                │ skills 表（skill:catalog:*）│
                                                └──────────────────────────┘`}
    </pre>

    <h2 id="install-paths">3. 两种安装路径</h2>
    <table>
      <thead>
        <tr><th>source.type</th><th>适用</th><th>实现</th><th>限制</th></tr>
      </thead>
      <tbody>
        <tr>
          <td><code>tarball</code></td>
          <td>大体量技能（ppt-master 上万文件 / 近百 MB）</td>
          <td>下载 <code>codeload.github.com/&lt;repo&gt;/tar.gz/refs/heads/&lt;ref&gt;</code> → 解压 → 取 <code>path</code> 子目录 → 整目录复制到 <code>&#123;userData&#125;/skills/&lt;slug&gt;/</code></td>
          <td>解包优先用系统 <code>tar</code>，不可用时回落纯 JS（POSIX ustar 解析）。突破 GitHub Contents API 的 60 文件 / 1MB 限制</td>
        </tr>
        <tr>
          <td><code>github</code></td>
          <td>小技能（≤60 文件、单文件 ≤1MB）</td>
          <td>复用既有 <code>installFromGithub()</code>：逐文件下载、落盘、建库</td>
          <td>受 GitHub Contents API 限速与文件上限约束</td>
        </tr>
      </tbody>
    </table>
    <p>
      当前两个收录技能（<code>ppt-master</code>、<code>playwright</code>）均走 <code>tarball</code>，更稳、不受 API 限速影响。
    </p>

    <h2 id="add-skill">5. 如何新增一个「可安装技能」</h2>
    <p>在 <code>installable-catalog.ts</code> 的 <code>INSTALLABLE_SKILL_CATALOG</code> 追加一项：</p>
    <pre>{`{
  id: 'my-skill',            // 卡片唯一标识
  slug: 'my-skill',          // 落盘目录名（去重 / 状态匹配用）
  name: 'My Skill',
  description: '一句话描述',
  icon: '🧩',
  author: '作者',
  tags: ['tag1', 'tag2'],
  source: {
    type: 'tarball',         // 大技能用 tarball；小技能可 'github'
    repo: 'owner/name',
    ref: 'main',
    path: 'skills/my-skill', // 仓库内含 SKILL.md 的目录
  },
  homepageUrl: 'https://github.com/owner/name',
  postInstallHint: '可选：安装后依赖提示（如 pip install ...）',
}`}</pre>
    <p>无需改其它代码。重启应用，「精选技能」Tab 即出现新卡片。</p>

    <h2 id="mcp-add">6. 添加 / 配置 MCP 服务器</h2>
    <div className="docs-callout">
      <strong>给非 IT 用户的解释</strong>：
      MCP 是「让 Agent 能调外部工具的标准协议」。比如调浏览器、调 GitHub、调数据库。
      你装好 MCP 后，Agent 就像多了一个「瑞士军刀」。
    </div>
    <p>
      在「设置 → MCP」里点 MCP 卡片，弹出右侧编辑面板：
    </p>
    <ul>
      <li><strong>基本信息</strong>：名称（用于工具列表里标识，如 <code>playwright</code>）、作用域（<code>managed</code> 是系统内置不可删，<code>user</code> 是用户自建）、描述（给该 MCP 写一句话说明）。</li>
      <li><strong>启动配置</strong>：
        <ul>
          <li><strong>传输</strong>：<code>stdio</code>（本地子进程）/<code>http</code>（HTTP 接口）/<code>sse</code>（Server-Sent Events）。</li>
          <li><strong>启动命令</strong>：stdio 模式下要执行的二进制（如 <code>npx @playwright/mcp</code>）。</li>
          <li><strong>参数</strong>：空格分隔传给启动命令的参数。</li>
        </ul>
      </li>
      <li><strong>环境变量</strong>：仅 stdio 模式生效；常用于注入 API Key（如 <code>SPARK_SEARCH_API_KEY</code>），Agent 永远看不到。</li>
    </ul>
    <p>
      <img
        src="/docs/img/mcp-edit.png"
        alt="MCP 服务器编辑页面：基本信息 + 启动配置 + 环境变量"
        loading="lazy"
      />
    </p>
    <p>
      点「保存」后 MCP 进入「在线」状态，Agent 立刻能用。下次会话默认挂载，<code>managed</code> 类型的所有会话生效。
    </p>

    <h2 id="relations">7. 与既有体系的关系</h2>
    <table>
      <thead><tr><th>文件</th><th>作用</th></tr></thead>
      <tbody>
        <tr><td><code>packages/agent-runtime/src/services/skill-registry/installable-catalog.ts</code></td><td>内置可安装技能清单常量 <code>INSTALLABLE_SKILL_CATALOG</code> + 类型。新增技能只改这里</td></tr>
        <tr><td><code>packages/agent-runtime/src/services/skill-registry/tarball-installer.ts</code></td><td>tarball 下载 / 解压 / 取子目录 / 落盘（突破文件数上限）</td></tr>
        <tr><td><code>packages/agent-runtime/src/services/skill-registry/index.ts</code></td><td><code>SkillRegistryService</code> 暴露 <code>listInstallableCatalog()</code> / <code>installFromCatalog()</code> / <code>uninstallFromCatalog()</code></td></tr>
        <tr><td><code>packages/protocol/src/ipc/index.ts</code></td><td><code>InstallableSkillCatalogItem</code> 等类型；channels <code>skill:list-installable</code> / <code>skill:install-catalog</code> / <code>skill:uninstall-catalog</code>；流 <code>stream:skill:install-progress</code></td></tr>
        <tr><td><code>apps/desktop/src/main/ipc/index.ts</code></td><td>注册上述 channel；安装时用 <code>pushStreamEvent</code> 推送进度</td></tr>
        <tr><td><code>apps/desktop/src/renderer/design/views/SkillStoreView.tsx</code></td><td>「精选技能」Tab + <code>InstallableSkillCard</code>（卡片、安装/卸载、进度、postInstallHint 提示）</td></tr>
      </tbody>
    </table>

    <h2 id="behavior">8. 行为约束与边界</h2>
    <ul>
      <li><strong>不进 <code>ensureBuiltInSkills()</code></strong>：catalog 技能是「可安装」而非「已内置」，启动时只读取清单用于展示，不自动落库。</li>
      <li><strong>安装后等同本地技能</strong>：落盘到 <code>&#123;userData&#125;/skills/&lt;slug&gt;/</code>，DB 记录 <code>scope=user</code>、<code>id=skill:catalog:&lt;指纹&gt;</code>，可启用 / 挂会话 / 卸载。</li>
      <li><strong>依赖提示</strong>：<code>postInstallHint</code> 在安装成功后以 toast 形式提示用户（如 ppt-master 需 <code>pip install -r requirements.txt</code>）。技能本身在 <code>SKILL.md</code> 内也会说明。</li>
      <li><strong>与内置浏览器自动化能力不冲突</strong>：<code>playwright</code> CLI 技能靠 <code>npx @playwright/cli</code> 工作；桌面端另有内置的 <code>@playwright/mcp</code> managed MCP 和 <code>spark_browser</code> 可见窗口 MCP，三者面向不同场景，可组合使用。</li>
    </ul>

    <h2 id="catalog">9. 当前收录</h2>
    <table>
      <thead><tr><th>技能</th><th>来源</th><th>安装路径</th><th>说明</th></tr></thead>
      <tbody>
        <tr><td><code>ppt-master</code></td><td><code>hugohe3/ppt-master</code>（<code>skills/ppt-master</code>, main）</td><td>tarball</td><td>AI 驱动 SVG→原生可编辑 PPTX 全链路</td></tr>
        <tr><td><code>playwright</code></td><td><code>microsoft/playwright-cli</code>（<code>skills/playwright-cli</code>, main）</td><td>tarball</td><td>微软官方终端浏览器自动化 CLI 技能</td></tr>
      </tbody>
    </table>
    <p>
      <code>multi-search-engine</code> 已直接随包内置（<code>resources/skills/multi-search-engine</code>），无需安装，故不在本目录中。
    </p>

    <h2 id="loading">10. 按需加载</h2>
    <p>
      Skill 的内容只在 Agent 真正需要时才读入上下文：
    </p>
    <ul>
      <li>Skill 元信息（名字、描述）始终可见。</li>
      <li>完整 <code>SKILL.md</code> 在 Agent 决定使用该 Skill 时才注入。</li>
      <li>每个 Skill 的 token 占用是预估的，模型只在「必要」时加载。</li>
    </ul>
  </>
)

export const mcpSkills: DocsPageContent = {
  slug: 'mcp-skills',
  toc: [
    { id: 'why-catalog', title: '1. 为什么用「安装卡片」', level: 2 },
    { id: 'data-flow', title: '2. 数据流', level: 2 },
    { id: 'install-paths', title: '3. 两种安装路径', level: 2 },
    { id: 'key-files', title: '4. 关键文件', level: 2 },
    { id: 'add-skill', title: '5. 如何新增一个技能', level: 2 },
    { id: 'mcp-add', title: '6. 添加 / 配置 MCP 服务器', level: 2 },
    { id: 'relations', title: '7. 与既有体系的关系', level: 2 },
    { id: 'behavior', title: '8. 行为约束与边界', level: 2 },
    { id: 'catalog', title: '9. 当前收录', level: 2 },
    { id: 'loading', title: '10. 按需加载', level: 2 },
  ],
  faq: [
    {
      question: 'Skill 和 MCP 有什么区别？',
      answer: 'Skill 是给 Agent 读的「说明书」（SKILL.md），MCP 是给 Agent 调的「工具集」（JSON-RPC）。两者可叠加。',
    },
    {
      question: 'Skill 会一直在上下文里吗？',
      answer: '不会。Skill 元信息（名字、描述）始终可见，完整 SKILL.md 只在 Agent 决定使用该 Skill 时才注入。',
    },
    {
      question: '可以装第三方 Skill 吗？',
      answer: '可以。点击「从 GitHub 安装」填入仓库路径，会走 github 安装路径（受 60 文件 / 1MB 限制）。',
    },
    {
      question: '安装 Skill 失败怎么办？',
      answer: '检查网络与 GitHub 访问；tarball 路径会用 codeload，github 路径用 Contents API（限速 60/h 未认证）。',
    },
  ],
  quickReference: [
    { key: '安装路径', value: 'tarball（codeload）/ github（Contents API）' },
    { key: 'tarball 限制', value: '无（用本地 tar / POSIX ustar 解析）' },
    { key: 'github 限制', value: '≤60 文件 / 单文件 ≤1MB / 60 req/h 未认证' },
    { key: '安装目录', value: '{userData}/skills/<slug>/' },
    { key: 'DB 记录', value: 'id=skill:catalog:<指纹>, scope=user' },
    { key: '当前收录', value: 'ppt-master / playwright（multi-search-engine 直接内置）' },
  ],
  howTo: {
    name: '在 Spark Agent 中安装一个可安装技能',
    description: '从打开技能市场到启用 Skill',
    totalTime: 'PT3M',
    steps: [
      '打开「技能 → 精选技能」Tab',
      '选一个卡片（如 ppt-master），点「安装」',
      '等进度条走完（tarball 走 codeload，下载快）',
      '安装后该 Skill 出现在「已安装」列表，启用即可',
      '新会话里给 Agent 发指令即可触发',
    ],
  },
  aiSummary:
    'Spark Agent MCP 与 Skills：内置安装卡片（INSTALLABLE_SKILL_CATALOG）+ 按需从 GitHub 下载完整原装技能，' +
    '数据流 SkillStoreView ↔ SkillRegistryService (listInstallableCatalog / installFromCatalog / uninstallFromCatalog) ↔ stream:skill:install-progress。' +
    '安装路径：tarball（codeload.github.com/<repo>/tar.gz/refs/heads/<ref>，解压到 {userData}/skills/<slug>/，无 60 文件/1MB 限制）' +
    '与 github（Contents API，≤60 文件/单文件 ≤1MB）。当前收录：ppt-master（hugohe3/ppt-master，AI SVG→PPTX 全链路）、' +
    'playwright（microsoft/playwright-cli，终端 CLI 自动化）。multi-search-engine 直接内置，不在 catalog 里。' +
    '按需加载：Skill 元信息始终可见，完整 SKILL.md 仅在 Agent 决定使用时才注入上下文。' +
    '新增技能只改 installable-catalog.ts 的 INSTALLABLE_SKILL_CATALOG 常量，无需改其它代码。',
  Body,
}

export default mcpSkills
