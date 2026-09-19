import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      Spark Work 的能力扩展分两层：<strong>Skill</strong> 是写给 Agent 读的「操作说明书」（一份
      <code>SKILL.md</code>），<strong>MCP</strong> 是给 Agent 调的「外部工具集」（JSON-RPC 服务）。
      一句话区分：Skill 决定「怎么做」，MCP 决定「能用什么工具」。两者独立启用、可以叠加， 同一个
      Skill 常常会点名要用某个 MCP 命名空间。
    </p>

    <h2 id="capability-layer">1. 能力层：Skill 与 MCP 各管什么</h2>
    <table>
      <thead>
        <tr>
          <th>维度</th>
          <th>Skill</th>
          <th>MCP Server</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>载体</td>
          <td>
            <code>SKILL.md</code>（YAML frontmatter + Markdown 正文），可带 <code>references/</code>
            、<code>scripts/</code>、<code>templates/</code>
          </td>
          <td>本地子进程（stdio）或远程端点（http / sse），配置存在数据库里</td>
        </tr>
        <tr>
          <td>生效方式</td>
          <td>元信息（id + 名称 + 描述）进 system prompt；正文按需加载后作为指令执行</td>
          <td>
            进程连接后，工具以 <code>mcp__&lt;serverName&gt;__&lt;toolName&gt;</code> 进入工具列表
          </td>
        </tr>
        <tr>
          <td>作用对象</td>
          <td>
            按 Agent 配置的 <code>skillIds</code> / <code>disabledSkillIds</code> 决定（
            <code>builtin:*</code>、<code>skill:catalog:*</code> 等）
          </td>
          <td>
            所有 <code>enabled</code> 的 server 默认挂到所有会话，不按 Agent 过滤
          </td>
        </tr>
        <tr>
          <td>典型例子</td>
          <td>
            <code>builtin:browser-use</code> 教 Agent 用 snapshot 的 ref 而不是 CSS selector
            操作页面
          </td>
          <td>
            <code>playwright</code>（managed）提供 <code>mcp__playwright__browser_*</code> 工具
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      除数据库里配置的 MCP 之外，应用还有一批「会话级内置 MCP server」，它们不占用
      <code>mcp_servers</code> 表、由运行时代码直接注入，按会话能力开关出现或隐藏：
    </p>
    <table>
      <thead>
        <tr>
          <th>命名空间</th>
          <th>提供什么</th>
          <th>挂载条件</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>mcp__spark_platform__</code>
          </td>
          <td>
            Skills / MCP / Providers / Agents / Teams / Workflows / 看板 / GitHub / Artifacts /
            设置等平台管理工具
          </td>
          <td>默认挂载</td>
        </tr>
        <tr>
          <td>
            <code>mcp__spark_search__</code>
          </td>
          <td>
            <code>web_search</code> / <code>fetch_url</code> 联网检索与抓取
          </td>
          <td>默认挂载</td>
        </tr>
        <tr>
          <td>
            <code>mcp__spark_memory__</code>
          </td>
          <td>
            <code>search_memory</code> / <code>recall_memory</code> 长期记忆检索
          </td>
          <td>记忆总开关打开时</td>
        </tr>
        <tr>
          <td>
            <code>mcp__spark_canvas__</code>
          </td>
          <td>画布节点、素材、任务、媒体模型等画布操作</td>
          <td>会话绑定画布时</td>
        </tr>
        <tr>
          <td>
            <code>mcp__spark_media__</code> / <code>mcp__spark_image__</code>
          </td>
          <td>图片 / 视频 / 音频生成与转写</td>
          <td>配置了多媒体 Provider 时</td>
        </tr>
        <tr>
          <td>
            <code>mcp__spark_browser__</code>
          </td>
          <td>应用内可见浏览器窗口（open / navigate / eval / screenshot 等）</td>
          <td>浏览器自动化能力启用时</td>
        </tr>
        <tr>
          <td>
            <code>mcp__spark_debug__</code>
          </td>
          <td>
            <code>begin</code> / <code>read</code> / <code>next_round</code> / <code>status</code> /{' '}
            <code>finish</code> 调试闭环
          </td>
          <td>该会话打开「调试模式」时</td>
        </tr>
        <tr>
          <td>
            <code>mcp__spark_session__</code>
          </td>
          <td>
            <code>set_worktree_state</code> 上报 worktree 状态
          </td>
          <td>默认挂载</td>
        </tr>
        <tr>
          <td>
            <code>mcp__spark_files__</code> / <code>mcp__spark_ui__</code> /{' '}
            <code>mcp__spark_tool_results__</code>
          </td>
          <td>文件卡片、图表 / HTML 渲染、超长工具结果读取</td>
          <td>默认挂载</td>
        </tr>
        <tr>
          <td>
            <code>mcp__spark_app__</code>
          </td>
          <td>子应用（桌面宠物 / 悬浮窗等）的创建与管理</td>
          <td>默认挂载</td>
        </tr>
        <tr>
          <td>
            <code>mcp__spark_team__</code>
          </td>
          <td>团队 / goal / 工作流的成员派发与协作</td>
          <td>团队、goal、工作流相关会话</td>
        </tr>
        <tr>
          <td>
            <code>mcp__spark_plugins__</code>
          </td>
          <td>插件运行时暴露的工具</td>
          <td>有可用插件时</td>
        </tr>
        <tr>
          <td>
            <code>mcp__spark_computer__</code>
          </td>
          <td>电脑操作（Computer Use）</td>
          <td>该会话开启电脑操作时</td>
        </tr>
      </tbody>
    </table>
    <p>
      这些内置 server 不受 MCP 管理界面控制（界面里搜不到它们），也不要去
      <code>mcp_servers</code> 表里找。
    </p>

    <h2 id="skill-sources">2. Skill 的真实来源与落盘位置</h2>
    <p>
      技能可以来自七个地方，落盘位置和 <code>skills</code> 表的 <code>scope</code> 各不相同：
    </p>
    <table>
      <thead>
        <tr>
          <th>来源</th>
          <th>磁盘位置</th>
          <th>scope</th>
          <th>id 形态</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>应用内置（随安装包分发、只读）</td>
          <td>
            开发态 <code>apps/desktop/resources/skills/</code>；打包后{' '}
            <code>process.resourcesPath/skills</code>
          </td>
          <td>
            <code>system</code>
          </td>
          <td>
            <code>builtin:&lt;slug&gt;</code>（取自该目录 <code>manifest.json</code> 的{' '}
            <code>id</code>）
          </td>
        </tr>
        <tr>
          <td>从市场 / 精选目录安装、本地文件或目录导入</td>
          <td>
            <code>&#123;userData&#125;/skills/&lt;slug&gt;/</code>
          </td>
          <td>
            <code>user</code>
          </td>
          <td>
            <code>skill:catalog:&lt;指纹&gt;</code> / <code>skill:skillhub:&lt;slug&gt;</code> /{' '}
            <code>local:&lt;source&gt;:&lt;hash&gt;</code>
          </td>
        </tr>
        <tr>
          <td>宿主机软链自动导入</td>
          <td>
            软链放在 <code>&#123;userData&#125;/skills/_links/</code>
          </td>
          <td>
            <code>user</code>
          </td>
          <td>
            <code>local:linked:*</code>
          </td>
        </tr>
        <tr>
          <td>项目级（跟随工作区，不入全局列表）</td>
          <td>
            工作区根目录下按优先级扫描：<code>.claude/skills</code> → <code>.codex/skills</code> →{' '}
            <code>.cursor/skills</code> → <code>.trae/skills</code> → <code>.qoder/skills</code> →{' '}
            <code>.windsurf/skills</code> → <code>.github/skills</code> →{' '}
            <code>.agents/skills</code> → <code>skills</code>
          </td>
          <td>—（实时扫描，不落库）</td>
          <td>
            <code>project:*</code>
          </td>
        </tr>
        <tr>
          <td>团队注册中心（Nacos）</td>
          <td>
            安装后落到 <code>&#123;userData&#125;/skills/&lt;slug&gt;/</code>
          </td>
          <td>
            <code>user</code>
          </td>
          <td>
            <code>skill:team:*</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      <strong>项目级技能的扫描规则</strong>：会话绑定的第一个工作区根目录为扫描起点，上面目录名
      的先后顺序就是同名技能的优先级（先发现者优先，重名只保留一个）。项目级技能不出现在
      「技能」页的通用列表里，它们只在该会话的输入框 「+ → 技能」菜单里可见——所以「我在项目里放了
      SKILL.md，为什么技能页看不到」属于预期行为。
    </p>
    <p>
      <strong>SKILL.md 的硬性要求</strong>：文件必须以 <code>---</code> 开头、以 <code>---</code>{' '}
      结束的 YAML frontmatter 起始，且 <code>name</code>、<code>description</code> 都是非空字符串。
      缺 frontmatter、YAML 解析失败、缺 name / description 的目录会被直接跳过并在扫描结果里记为
      issue，不会出现在技能列表中。可选字段为 <code>version</code>、<code>author</code>、{' '}
      <code>category</code>、<code>tags</code>、<code>license</code>、<code>requiredTools</code>、
      <code>tools</code>；其中 <code>requiredTools</code> 与 <code>tools</code> 会被合并成该技能的
      依赖工具清单。
    </p>
    <pre>{`---
name: sql-explain
description: "把 SQL 查询拆成执行步骤并解释代价。用户粘贴 EXPLAIN 输出或问「这条 SQL 为什么慢」时加载。"
version: 1.0.0
author: Your Name
category: coding
tags: [sql, explain, performance]
---

（正文：触发场景、工作流、注意事项）`}</pre>

    <h2 id="builtin-pipeline">3. 内置 Skill 怎么进库、怎么进上下文</h2>
    <ol>
      <li>
        <strong>启动扫描</strong>：每次 <code>skill:list</code>
        （打开技能页、会话取技能列表）都会调用 <code>ensureBuiltInSkills()</code>
        。它重新读取内置目录里的每个 <code>SKILL.md</code>， 与数据库比对：已存在就更新名称 / 版本 /
        路径 / manifest 内容，不存在就新建， 老格式（<code>local:bundled:*</code>）和已下架（
        <code>builtin:*</code> 但文件没了）的行会被清掉。 所以修改{' '}
        <code>resources/skills/&lt;slug&gt;/SKILL.md</code> 后不需要手动同步，重开技能页即可。
      </li>
      <li>
        <strong>进 prompt 的只有目录</strong>：system prompt 里注入的是技能目录（
        <code>[Available Skills Catalog]</code>：每条只有 id、名称、截断后的描述），
        并明确告知「完整指令未加载，需要时用 <code>mcp__spark_platform__skills_load</code> 按 id
        取」。 这就是「渐进式披露」——装 20 个技能也只占一份目录的体积。
      </li>
      <li>
        <strong>谁会被列出来</strong>：会话按当前 Agent 的 <code>skillIds</code> 与{' '}
        <code>disabledSkillIds</code> 计算可用技能集；团队成员的技能集来自成员自身配置， 不是 Host
        的。原生 Claude SDK 路径还会把启用的技能做成托管插件目录 （
        <code>&#123;userData&#125;/skills/_plugin/</code>）交给 SDK 原生技能发现，失败时回落到{' '}
        <code>skills_load</code> 工具路径。
      </li>
      <li>
        <strong>手动点名一个技能</strong>：会话输入框的「+ → 技能」子菜单里点技能名，会把{' '}
        <code>@技能名</code> 插进输入框；也可以直接让 Agent 调用 <code>skills_load</code>。
      </li>
    </ol>
    <p>
      <strong>常见坑</strong>：技能从市场装完不会自动生效。「Skill 必须分配给 Agent 才能在对话中
      生效」——应用在安装成功后会弹提示引导你去分配。到「Agent」页编辑目标 Agent，在 Skills 一栏点
      「管理 Skills」勾选即可。另外，如果某个技能被 <code>skills_toggle</code> 关成了{' '}
      <code>enabled=0</code>，它也不会进入任何会话。
    </p>

    <h2 id="installable">4. 精选可安装目录（33 项）</h2>
    <p>
      「技能 → 精选推荐」Tab 里的卡片来自一份写死在代码里的清单
      <code>INSTALLABLE_SKILL_CATALOG</code>。它<strong>不落库、不依赖联网</strong>，
      新机器装完就能看到卡片；点「安装」时才真正下载技能内容。
    </p>
    <p>当前清单共 33 项，分四组：</p>
    <ul>
      <li>
        <code>ppt-master</code>（Hugo He）：PDF / DOCX / URL / Markdown → SVG → 原生可编辑 PPTX
      </li>
      <li>
        <code>playwright</code>（Microsoft）：<code>playwright-cli</code> 终端浏览器自动化技能
      </li>
      <li>
        14 项 <code>superpowers-*</code> 工程流程技能（brainstorming / writing-plans /
        test-driven-development / systematic-debugging / using-git-worktrees 等）
      </li>
      <li>
        6 项 <code>gitnexus-*</code> 代码智能技能（cli / exploring / impact-analysis / debugging /
        refactoring / guide）
      </li>
      <li>
        11 项影视与叙事技能（<code>screenwriting-lab</code>、<code>ai-film-production</code>、
        <code>hyperframes</code>*、<code>gsap-animation</code>、<code>scroll-storyteller</code>、
        <code>nano-banana</code>、<code>illustrated-slides-with-nano-banana</code> 等）
      </li>
    </ul>
    <p>
      每条目的 <code>source</code> 有三种形态，安装时按下面的顺序生效：
    </p>
    <table>
      <thead>
        <tr>
          <th>source.type</th>
          <th>怎么装</th>
          <th>适用</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>artifact</code>（当前 33 项全部使用）
          </td>
          <td>
            从 Spark 自建安装源 manifest 找 <code>artifact.id = skill.&lt;slug&gt;</code>，下载 zip
            → SHA-256 校验 → 落盘；默认 manifest 地址{' '}
            <code>https://minio.yiqibyte.com/spark-desktop/artifact-repository/v1/index.json</code>
            （可用环境变量 <code>SPARK_INSTALL_MANIFEST_URL</code> 覆盖）
          </td>
          <td>国内可达、可带平台专属依赖（如 ppt-master 的 wheelhouse）</td>
        </tr>
        <tr>
          <td>
            <code>tarball</code>（作为 artifact 的 fallback）
          </td>
          <td>
            下载 <code>https://codeload.github.com/&lt;repo&gt;/tar.gz/refs/heads/&lt;ref&gt;</code>
            ，系统 <code>tar</code> 解压失败时回落纯 JS 的 POSIX tar 解析，再取 <code>path</code>{' '}
            子目录复制到 <code>&#123;userData&#125;/skills/&lt;slug&gt;/</code>
          </td>
          <td>
            突破 GitHub Contents API 的 60 文件 / 单文件 1MB 限制；codeload
            直连失败会依次尝试国内镜像前缀
          </td>
        </tr>
        <tr>
          <td>
            <code>github</code>（小技能路径）
          </td>
          <td>
            走 <code>installFromGithub()</code> 逐文件下载（Contents API）
          </td>
          <td>
            ≤60 文件、单文件 ≤1MB；<strong>不支持进度回调</strong>，进度条不会动
          </td>
        </tr>
      </tbody>
    </table>
    <p>安装链路（renderer ↔ 主进程 ↔ runtime）：</p>
    <pre>{`技能页「精选推荐」Tab
  ├─ invoke skill:list-installable        → SkillRegistryService.listInstallableCatalog()（附 installed 状态）
  ├─ invoke skill:install-catalog {slug}  → installFromCatalog(slug, onProgress)
  │     └─ 进度经 stream:skill:install-progress 推回渲染层（payload: slug / source / downloaded / total）
  ├─ invoke skill:uninstall-catalog {slug}→ 删磁盘目录 + 删 DB 行
  └─ invoke skill:install-status          → 全局安装状态（含 failed 与错误信息）`}</pre>
    <p>
      新增一条精选技能，只改 <code>installable-catalog.ts</code> 一个文件：
    </p>
    <pre>{`{
  id: 'my-skill',          // 卡片唯一标识（不进 DB）
  slug: 'my-skill',        // 落盘目录名；安装状态与去重都按它判定
  name: 'My Skill',
  description: '一句话描述',
  icon: '🧩',
  author: '作者',
  tags: ['tag1', 'tag2'],
  source: {
    type: 'artifact',
    artifactId: 'skill.my-skill',
    manifestUrl: DEFAULT_SPARK_INSTALL_MANIFEST_URL,
    fallback: { type: 'tarball', repo: 'owner/name', ref: 'main', path: 'skills/my-skill' },
  },
  homepageUrl: 'https://github.com/owner/name',
  postInstallHint: '可选：安装后依赖提示（如 pip install -r requirements.txt）',
}`}</pre>
    <p>
      <strong>装机后的身份</strong>：技能落到 <code>&#123;userData&#125;/skills/&lt;slug&gt;/</code>
      ， DB 行 <code>scope=user</code>、<code>enabled=1</code>，id 为来源指纹{' '}
      <code>skill:catalog:&lt;hash&gt;</code>。artifact 来源的条目同时把 tarball
      兜底来源的指纹一起登记， 因此「先装 artifact、后装 fallback」不会产生两行。卸载只删「root_path
      恰好等于
      <code>&#123;userData&#125;/skills/&lt;slug&gt;</code>」或「id 命中上述指纹」的那一行，
      不会误删你手动导入的同名技能。安装完成若有 <code>postInstallHint</code>，会单独弹一条
      提示（例如 ppt-master 需要 Python / Node / wheelhouse 依赖），它只是文字提示，不会自动装依赖。
    </p>

    <h2 id="mcp-config">5. 添加 / 配置 MCP 服务器</h2>
    <p>
      入口：左侧导航「扩展中心」→「MCP」页签 → 右上角「添加 MCP」。 同页签另有「自定义工具 / 连接器
      / 团队商店」三个 Tab，别和 MCP 列表混淆。 点卡片进入右侧抽屉「添加 MCP 服务器 / 编辑 MCP
      服务器」，分三组字段：
    </p>
    <ul>
      <li>
        <strong>基本信息</strong>：名称（工具列表里的标识，也是 <code>mcp__&lt;名称&gt;__*</code>{' '}
        的前缀）、 作用域、描述、启用开关。
      </li>
      <li>
        <strong>启动配置</strong>：传输三选一 <code>stdio</code> / <code>http</code> /{' '}
        <code>sse</code>。 stdio 下填「启动命令」与「参数」（参数框按空格切分后写入{' '}
        <code>args</code> 数组）； http / sse 下填 URL。
      </li>
      <li>
        <strong>认证方式</strong>（仅 http / sse 显示）：<code>无</code> 或 <code>OAuth 2.0</code>。
      </li>
      <li>
        <strong>环境变量</strong>（标注「仅 stdio 模式生效」）：KEY / value 行，写入配置的{' '}
        <code>env</code>。
      </li>
    </ul>
    <p>
      <img
        src="/docs/img/mcp-edit.png"
        alt="MCP 服务器编辑抽屉：基本信息 + 启动配置（+ 认证方式） + 环境变量"
        loading="lazy"
      />
    </p>
    <p>
      卡片的「作用域」筛选提供五个值：<code>system</code>、<code>user</code>、<code>project</code>、
      <code>team</code>、<code>session</code>。需要注意：
    </p>
    <ul>
      <li>
        作用域是<strong>标签和筛选维度</strong>。会话加载 MCP 时取的是「所有
        <code>enabled</code> 的 server」，并不按作用域过滤（见第 7 节）， 所以不要指望把某个 server
        标成 <code>session</code> 就只对它生效。
      </li>
      <li>
        另有一个 <code>managed</code> 作用域<strong>不在下拉里</strong>：它由应用自动注册 （当前是{' '}
        <code>playwright</code>），不允许改名，也不允许删除，只能启用 / 停用或改配置。
        界面上你只会看到它显示为 <code>managed</code> 标签。
      </li>
    </ul>

    <h3 id="mcp-config-fields">5.1 配置 JSON 的真实字段</h3>
    <p>
      抽屉保存时写入的就是这段 JSON（存在 <code>mcp_servers.config_json</code>）。读取端做了字段兼容
      与自愈，直接编辑配置或让 Agent 建 server 时要按下面的规则来：
    </p>
    <table>
      <thead>
        <tr>
          <th>字段</th>
          <th>用途</th>
          <th>约束</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>transport</code> 或 <code>type</code>
          </td>
          <td>传输类型</td>
          <td>
            二者等价，<code>transport</code> 优先；写别的值会按可用字段推断
          </td>
        </tr>
        <tr>
          <td>
            <code>command</code> + <code>args</code>
          </td>
          <td>stdio 的启动命令与参数数组</td>
          <td>
            stdio 必须有 <code>command</code>，否则保存被拒（
            <code>stdio 传输需要填写 command（启动命令）</code>）
          </td>
        </tr>
        <tr>
          <td>
            <code>url</code>
          </td>
          <td>http / sse 端点</td>
          <td>
            协议必须是 <code>http</code> / <code>https</code> / <code>ws</code> / <code>wss</code>
            ；缺 url 保存被拒
          </td>
        </tr>
        <tr>
          <td>
            <code>env</code>
          </td>
          <td>stdio 子进程环境变量</td>
          <td>
            只在 stdio 生效；值以明文存在本地 <code>spark.db</code>，不要在里面塞长期密钥
          </td>
        </tr>
        <tr>
          <td>
            <code>cwd</code>
          </td>
          <td>stdio 子进程工作目录</td>
          <td>可选，界面没有对应输入框，需直接改配置</td>
        </tr>
        <tr>
          <td>
            <code>headers</code>
          </td>
          <td>http / sse 的自定义请求头</td>
          <td>可选，界面没有对应输入框，需直接改配置</td>
        </tr>
        <tr>
          <td>
            <code>auth</code>
          </td>
          <td>
            OAuth 2.0 配置：<code>type</code> / <code>scope</code> / <code>dcr</code> /{' '}
            <code>clientId</code> / <code>hasClientSecret</code>
          </td>
          <td>
            仅 <code>auth.type === 'oauth2'</code> 时走 OAuth 流程
          </td>
        </tr>
        <tr>
          <td>
            <code>description</code>
          </td>
          <td>卡片上显示的一句话说明</td>
          <td>
            可选，缺省时卡片副标题显示 <code>transport · 端点</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>tools</code>
          </td>
          <td>历史字段，卡片上的「工具数」读的是它的长度</td>
          <td>
            <strong>不是实时工具数</strong>，要查真实工具列表用 <code>mcp:server-tools</code>{' '}
            或平台工具 <code>mcp_status</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      <strong>已知自愈行为</strong>：某条配置声明了 <code>stdio</code> 但没有 <code>command</code>{' '}
      却带 <code>url</code>，读取时会按 <code>http</code> 处理；反之如果既没有可识别的传输、 也没有
      url / command，这个 server 会被跳过（日志里写 <code>no valid transport in config</code>），
      而不是退化成一个跑 <code>npx</code> 的空进程。
    </p>

    <h3 id="mcp-config-auth">5.2 OAuth 2.0（http / sse）</h3>
    <p>
      远程 MCP 需要授权时：认证方式选 <code>OAuth 2.0</code>，按需填 OAuth <code>scope</code>；
      「动态注册」默认开（走 DCR 自动注册客户端），关掉时必须填 <code>Client ID</code> （
      <code>Client Secret</code> 可选）。授权状态有五个取值：
      <code>unconfigured</code> / <code>needs-auth</code> / <code>authorizing</code> /{' '}
      <code>authorized</code> / <code>failed</code>，对应卡片上的 「需要授权 / 授权中 / 已授权 /
      授权失败」标签。令牌由主进程的 MCP OAuth 服务保管并自动刷新， 调用时以{' '}
      <code>Authorization: Bearer</code> 头注入；未授权时该 server 会被跳过， 不会阻塞会话。普通（无
      OAuth）MCP 的卡片状态标签是「本地配置 / 配置不完整 / 未启用」。
    </p>

    <h2 id="mcp-lifecycle">6. 存储、状态与热更新</h2>
    <ul>
      <li>
        <strong>存哪儿</strong>：MCP 配置存在本地 SQLite（<code>&#123;userData&#125;/spark.db</code>
        ）的 <code>mcp_servers</code> 表，字段为{' '}
        <code>id / scope / name / config_json / enabled / bundle_id / created_at / updated_at</code>
        。<code>bundle_id</code> 非空表示它由某个工作流包导入。
      </li>
      <li>
        <strong>创建即启动</strong>：新建 server 时若 <code>enabled</code> 不是 <code>false</code>，
        后台会异步发起连接（OAuth 类型的除外，需先授权）。启动失败不回滚 DB 行，
        失败原因通过状态查询暴露，避免「保存成功但连不上」时丢配置。
      </li>
      <li>
        <strong>改配置会重连</strong>：更新一个已连接的 server，会先停后启； 从未连接的 server
        由「停用 → 启用」触发启动。卡片的开关直接调 <code>mcp:update</code> 写 <code>enabled</code>
        。
      </li>
      <li>
        <strong>状态查询</strong>：<code>mcp:server-status</code> 返回{' '}
        <code>&#123; connected, toolCount, error?, authStatus? &#125;</code>；
        <code>mcp:server-tools</code> 返回该服务器真实的工具名 / 描述 / 入参 schema。 这两个 channel
        只对「已连接」的 server 有数据，断开或未启动时 toolCount 为 0。
      </li>
      <li>
        <strong>热更新是「下一轮生效」而不是「立刻生效」</strong>：MCP 的 create / update / delete /
        start / stop / tools-changed 都会让运行时的 MCP 版本号 +1。
        下一轮对话开始时发现版本变化，就会强制开一个全新会话（不复用旧会话上下文），
        让新工具清单生效。原因很实际：SDK 在 query 启动时就冻结了工具列表，无法在飞行中修改。
        正在跑的那一轮不受影响。
      </li>
      <li>
        <strong>managed 保护</strong>：<code>playwright</code> 这类 managed server
        不能改名、不能删除， 想让它消失只能在界面上停用。
      </li>
    </ul>

    <h2 id="mcp-mount">7. MCP 与会话 / Agent 的挂载关系</h2>
    <ul>
      <li>
        <strong>默认全挂</strong>：构建会话的 MCP 配置时，代码取的是 <code>listServers()</code>{' '}
        里所有 <code>enabled</code> 的 server，逐个解析传输并注入， 不区分 <code>scope</code>
        ，也不看当前 Agent 是谁。所以「加好 MCP，所有会话都能用」是成立的。
      </li>
      <li>
        <strong>
          Agent 的 <code>mcpServerIds</code> 是兼容字段
        </strong>
        ：Agent 配置里虽然还有这个字段， 但运行时不再据此过滤
        MCP（平台工具文档里直接标注「兼容字段，运行时忽略」）。 历史数据不会报错，只是不起作用。
      </li>
      <li>
        <strong>两个例外</strong>：工作流里的「工具 / MCP 节点」成员如果显式配置过 MCP 选择，
        会按它自己的 <code>mcpServerIds</code> 白名单加载（这就是「只给这个节点挂某个
        MCP」的用法）； 只读原子成员则从空能力集开始，不加载用户自定义 MCP。
      </li>
      <li>
        <strong>被静默跳过的情形</strong>：配置解析不出有效传输、OAuth server 未授权（拿不到
        token）、 配置 JSON 不合法。跳过只写日志，不中断会话——排查「启用了却没有工具」先看这三条。
      </li>
      <li>
        <strong>名称就是工具前缀</strong>：server 名称决定工具命名空间{' '}
        <code>mcp__&lt;name&gt;__&lt;tool&gt;</code>。同名 server 会互相覆盖， 所以别把自建 server
        命名成 <code>spark_search</code>、<code>spark_platform</code> 这类内置名字。
      </li>
    </ul>

    <h2 id="agent-manage">8. 让 Agent 管理 MCP 与 Skill</h2>
    <p>
      内置技能 <code>builtin:platform-manager</code> 暴露了 <code>mcp__spark_platform__*</code>{' '}
      工具，其中直接相关的是：
    </p>
    <table>
      <thead>
        <tr>
          <th>工具</th>
          <th>作用</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>mcp_list</code>
          </td>
          <td>列出 MCP 配置（可按 scope 过滤）</td>
        </tr>
        <tr>
          <td>
            <code>mcp_create</code> / <code>mcp_update</code> / <code>mcp_delete</code>
          </td>
          <td>增删改 MCP 配置</td>
        </tr>
        <tr>
          <td>
            <code>mcp_status</code>
          </td>
          <td>查看连接状态与工具数（排查「连不上 / 零工具」的第一站）</td>
        </tr>
        <tr>
          <td>
            <code>skills_list</code>
          </td>
          <td>列出已安装技能（含内置、应用内安装、宿主软链）</td>
        </tr>
        <tr>
          <td>
            <code>skills_load</code>
          </td>
          <td>按 id 取某个技能的完整 SKILL.md 正文（渐进式披露的加载入口）</td>
        </tr>
        <tr>
          <td>
            <code>skills_search</code> / <code>skills_search_github</code>
          </td>
          <td>在远程技能商店 / GitHub 上搜含 SKILL.md 的仓库</td>
        </tr>
        <tr>
          <td>
            <code>skills_install</code> / <code>skills_install_github</code>
          </td>
          <td>
            按注册表条目或 <code>owner/name</code>（可带 ref / path）安装技能
          </td>
        </tr>
        <tr>
          <td>
            <code>skills_toggle</code> / <code>skills_uninstall</code>
          </td>
          <td>启用停用 / 卸载技能</td>
        </tr>
      </tbody>
    </table>
    <p>可以直接这样对 Agent 说：</p>
    <ul>
      <li>
        「帮我把 <code>https://mcp.example.com/mcp</code> 加成一个 MCP，名字叫{' '}
        <code>doc-search</code>」
      </li>
      <li>「检查一下 playwright 这个 MCP 的状态，连上了但工具是 0 的话告诉我原因」</li>
      <li>
        「用 <code>skills_load</code> 读一下 <code>builtin:spark-workflow-generator</code>
        ，然后帮我生成一个工作流 JSON」
      </li>
    </ul>
    <p>
      注意：平台工具里<strong>没有</strong>启动 / 停止单个 MCP 的工具（Web 侧的{' '}
      <code>mcp:start-server</code> / <code>mcp:stop-server</code> 只给界面用）， Agent
      想恢复连接得走「启用开关」这条路径。
    </p>

    <h2 id="troubleshoot">9. 常见坑与排查</h2>
    <table>
      <thead>
        <tr>
          <th>现象</th>
          <th>真实原因 / 处理</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>保存 MCP 报「stdio 传输需要填写 command（启动命令）」</td>
          <td>
            传输选了 stdio 却没填命令。要么补 <code>command</code>，要么切到 http / sse 并填 URL
          </td>
        </tr>
        <tr>
          <td>远程 MCP 连不上、工具数为 0</td>
          <td>
            先确认 <code>transport</code> / <code>type</code> 没写反（历史上 http 配置被当成 stdio
            跑过 <code>npx</code>）；再确认 URL 协议合法；最后看是否 OAuth 未授权
          </td>
        </tr>
        <tr>
          <td>卡片显示「3 工具」但实际能用 12 个</td>
          <td>
            卡片数字读的是配置里的历史 <code>tools</code> 字段，不是实时值。用{' '}
            <code>mcp_status</code> 或 <code>mcp:server-tools</code> 看真实工具
          </td>
        </tr>
        <tr>
          <td>刚加完 MCP，当前这轮对话里 Agent 还是说没这个工具</td>
          <td>工具清单在下一轮才刷新（MCP 版本变化会强制开新会话）。结束当前轮再发一条即可</td>
        </tr>
        <tr>
          <td>技能装了但 Agent 不用</td>
          <td>
            技能必须分配给 Agent；确认目标 Agent 的 Skills 勾选里包含它，且该技能{' '}
            <code>enabled=1</code>
          </td>
        </tr>
        <tr>
          <td>
            项目里放了 <code>.agents/skills/x/SKILL.md</code>，「技能」页看不到
          </td>
          <td>项目级技能只在会话内实时扫描（输入框「+ → 技能」可见），不进全局技能列表</td>
        </tr>
        <tr>
          <td>精选技能安装成功但跑不起来</td>
          <td>
            看 <code>postInstallHint</code> 提示的运行时依赖（Python / Node /
            wheelhouse）。安装只负责落盘，不装依赖
          </td>
        </tr>
        <tr>
          <td>卸载精选技能后同名技能也被删了</td>
          <td>
            正常不会：卸载按磁盘路径与来源指纹精确匹配。若确实发生，检查该技能是否就是用同名 slug
            安装的
          </td>
        </tr>
        <tr>
          <td>环境变量里的密钥安全吗</td>
          <td>
            它只注入 stdio 子进程，不会进 prompt；但<strong>以明文</strong>
            存在本地配置里，长期密钥建议放到 Keychain 管理的 Provider 凭据，而不是 MCP env
          </td>
        </tr>
      </tbody>
    </table>

    <h2 id="key-files">10. 关键代码位置</h2>
    <table>
      <thead>
        <tr>
          <th>文件</th>
          <th>作用</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>packages/agent-runtime/src/services/mcp-server.service.ts</code>
          </td>
          <td>
            MCP 生命周期：CRUD、启停、状态、managed 保护、<code>MANAGED_MCP_SCOPE</code> /{' '}
            <code>PLAYWRIGHT_MCP_NAME</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>packages/agent-runtime/src/mcp/config-normalize.ts</code>
          </td>
          <td>
            配置归一化与写入校验（<code>resolveMcpConfig</code> / <code>validateMcpConfigJson</code>
            ），http / sse / stdio 的唯一判定入口
          </td>
        </tr>
        <tr>
          <td>
            <code>packages/agent-runtime/src/services/session/session-mcp-tooling.ts</code>
          </td>
          <td>
            <code>buildMcpServersForSDK()</code>：把库里所有 enabled 的 server 变成 SDK 配置；内置{' '}
            <code>spark_search</code> 与 <code>spark_memory</code> 的解析也在这里
          </td>
        </tr>
        <tr>
          <td>
            <code>packages/agent-runtime/src/services/session/spark-engine-runtime.ts</code>
          </td>
          <td>
            会话级内置 MCP server 名单（spark_platform / spark_search / spark_browser / spark_debug
            / spark_memory 等）
          </td>
        </tr>
        <tr>
          <td>
            <code>packages/storage/src/repositories/mcp-server.repository.ts</code>
          </td>
          <td>
            <code>mcp_servers</code> 表读写，含 <code>bundle_id</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>packages/storage/src/repositories/skill.repository.ts</code>
          </td>
          <td>
            <code>skills</code> 表读写（scope / root_path / manifest_json / enabled）
          </td>
        </tr>
        <tr>
          <td>
            <code>packages/agent-runtime/src/services/skill.service.ts</code>
          </td>
          <td>
            <code>ensureBuiltInSkills()</code>：内置技能扫描、进库、清理下架记录
          </td>
        </tr>
        <tr>
          <td>
            <code>packages/agent-runtime/src/services/local-skill-importer.ts</code>
          </td>
          <td>
            SKILL.md 解析与 frontmatter 校验（name / description 必填），本地导入与内置扫描共用
          </td>
        </tr>
        <tr>
          <td>
            <code>packages/agent-runtime/src/services/runtime-composition.service.ts</code>
          </td>
          <td>
            <code>[Available Skills Catalog]</code> 目录注入与「按需 skills_load」的提示词
          </td>
        </tr>
        <tr>
          <td>
            <code>packages/agent-runtime/src/services/skill-registry/installable-catalog.ts</code>
          </td>
          <td>
            精选目录清单 <code>INSTALLABLE_SKILL_CATALOG</code> 与默认 manifest 地址
          </td>
        </tr>
        <tr>
          <td>
            <code>packages/agent-runtime/src/services/skill-registry/index.ts</code>
          </td>
          <td>
            <code>listInstallableCatalog()</code> / <code>installFromCatalog()</code> /{' '}
            <code>uninstallFromCatalog()</code>，artifact / tarball / github 三条安装路径
          </td>
        </tr>
        <tr>
          <td>
            <code>packages/agent-runtime/src/services/skill-registry/tarball-installer.ts</code>
          </td>
          <td>tarball / zip 下载、镜像回退、系统 tar 与纯 JS 解包</td>
        </tr>
        <tr>
          <td>
            <code>packages/agent-runtime/src/services/project-context.service.ts</code>
          </td>
          <td>项目级技能扫描目录清单与优先级顺序</td>
        </tr>
        <tr>
          <td>
            <code>apps/desktop/src/main/services/AppSkillsManager.ts</code>
          </td>
          <td>
            内置目录 <code>resources/skills</code>、用户目录{' '}
            <code>&#123;userData&#125;/skills</code>、宿主软链与托管插件目录的路径真相
          </td>
        </tr>
        <tr>
          <td>
            <code>apps/desktop/src/main/services/PlaywrightMcpRegistration.ts</code>
          </td>
          <td>
            managed <code>playwright</code> 的自动注册
          </td>
        </tr>
        <tr>
          <td>
            <code>apps/desktop/src/renderer/design/views/McpView.tsx</code>
          </td>
          <td>「扩展中心」MCP 页：卡片、筛选、抽屉表单、OAuth 授权</td>
        </tr>
        <tr>
          <td>
            <code>apps/desktop/src/renderer/design/views/SkillStoreView.tsx</code>
          </td>
          <td>技能页四个 Tab（在线市场 / 精选推荐 / 已安装 / 创建）与安装进度</td>
        </tr>
        <tr>
          <td>
            <code>packages/agent-runtime/src/tools/platform-management-mcp-server.mjs</code>
          </td>
          <td>
            <code>mcp__spark_platform__*</code> 工具定义与 bridge 方法映射
          </td>
        </tr>
      </tbody>
    </table>
  </>
)

export const mcpSkills: DocsPageContent = {
  slug: 'mcp-skills',
  toc: [
    { id: 'capability-layer', title: '1. 能力层：Skill 与 MCP 各管什么', level: 2 },
    { id: 'skill-sources', title: '2. Skill 的真实来源与落盘位置', level: 2 },
    { id: 'builtin-pipeline', title: '3. 内置 Skill 怎么进库、怎么进上下文', level: 2 },
    { id: 'installable', title: '4. 精选可安装目录（33 项）', level: 2 },
    { id: 'mcp-config', title: '5. 添加 / 配置 MCP 服务器', level: 2 },
    { id: 'mcp-config-fields', title: '5.1 配置 JSON 的真实字段', level: 3 },
    { id: 'mcp-config-auth', title: '5.2 OAuth 2.0（http / sse）', level: 3 },
    { id: 'mcp-lifecycle', title: '6. 存储、状态与热更新', level: 2 },
    { id: 'mcp-mount', title: '7. MCP 与会话 / Agent 的挂载关系', level: 2 },
    { id: 'agent-manage', title: '8. 让 Agent 管理 MCP 与 Skill', level: 2 },
    { id: 'troubleshoot', title: '9. 常见坑与排查', level: 2 },
    { id: 'key-files', title: '10. 关键代码位置', level: 2 },
  ],
  faq: [
    {
      question: 'Skill 和 MCP 到底有什么区别？',
      answer:
        'Skill 是给 Agent 读的「说明书」（一份 SKILL.md，告诉它按什么步骤做），MCP 是给 Agent 调的「工具集」（连上后工具以 mcp__<名称>__<工具> 出现）。两者独立启用：装好 MCP 才有工具，装好 Skill 才有方法，常见组合是一个 Skill 点名要求用它配套的 MCP 命名空间。',
    },
    {
      question: 'Skill 会一直占用上下文吗？',
      answer:
        '不会。system prompt 里只放技能目录（id + 名称 + 截断的描述），并提示 Agent「需要时用 mcp__spark_platform__skills_load 取完整指令」。完整 SKILL.md 正文只有被加载时才进上下文。',
    },
    {
      question: '能装第三方 Skill 吗？从哪儿装？',
      answer:
        '能。四条路：①「技能 → 在线市场」搜 SkillHub 并安装；②「技能 → 精选推荐」装官方的 33 项可安装技能；③「技能 → 创建 → 文件/目录导入 / 软链接」装本地已有的技能；④ 让 Agent 调 mcp__spark_platform__skills_search_github 搜仓库、skills_install_github 安装。界面里没有独立的「从 GitHub 安装」按钮。',
    },
    {
      question: '技能装完为什么 Agent 还是不用？',
      answer:
        '技能必须分配给 Agent 才生效。到「Agent」页编辑目标 Agent，在 Skills 一栏点「管理 Skills」勾选它；同时确认这个技能没有被 skills_toggle 关成 enabled=0。安装成功时应用会弹提示引导分配。',
    },
    {
      question: 'MCP 保存后多久生效？',
      answer:
        '保存会立刻建立连接，但工具清单在「下一轮对话」才刷新——运行时发现 MCP 版本变化会强制开一个全新会话，因为 SDK 在启动时就冻结了工具列表。当前正在执行的那一轮不受影响。',
    },
    {
      question: '为什么我新建的 MCP 在别的会话里也生效了？',
      answer:
        '因为会话默认加载所有 enabled 的 server，不按作用域或 Agent 过滤（Agent 的 mcpServerIds 已是运行时忽略的兼容字段）。想限制范围只有一条路：在工作流的工具 / MCP 节点成员上显式配置 MCP 白名单。',
    },
  ],
  quickReference: [
    { key: 'MCP 配置存储', value: '{userData}/spark.db 的 mcp_servers 表（config_json 明文）' },
    {
      key: '传输类型',
      value: 'stdio（需 command）/ http / sse（需 url，协议限 http/https/ws/wss）',
    },
    {
      key: '作用域枚举',
      value: 'system / user / project / team / session（另有不对用户开放的 managed）',
    },
    {
      key: '会话挂载规则',
      value: '所有 enabled 的 server 默认挂到所有会话，不按 scope / Agent 过滤',
    },
    { key: '热更新时机', value: '下一个 turn 起新会话；in-flight turn 不变' },
    {
      key: '内置技能目录',
      value:
        'resources/skills（dev）/ process.resourcesPath/skills（prod），id 形如 builtin:<slug>',
    },
    { key: '用户技能目录', value: '{userData}/skills/<slug>/（scope=user）' },
    {
      key: '项目级技能目录',
      value: '.claude/skills → … → .agents/skills → skills（在工作区内扫描）',
    },
    {
      key: '精选目录规模',
      value: '33 项：ppt-master / playwright / 14 superpowers / 6 gitnexus / 11 影视叙事',
    },
    {
      key: '渐进式披露入口',
      value: 'mcp__spark_platform__skills_load（原生 Skill 工具可用时等同）',
    },
    {
      key: 'MCP 管理工具',
      value: 'mcp__spark_platform__mcp_list / mcp_create / mcp_update / mcp_delete / mcp_status',
    },
  ],
  howTo: {
    name: '在 Spark Work 中接入一个 MCP 并确认可用',
    description: '从新建 MCP 到验证工具清单与下一轮生效',
    totalTime: 'PT5M',
    steps: [
      '打开左侧「扩展中心」→「MCP」页签，点右上角「添加 MCP」',
      '填名称（决定 mcp__<名称>__* 前缀）与描述，保持不变的作用域标签即可',
      '选传输：本地进程用 stdio 并填命令与空格分隔的参数；远程用 http / sse 并填 URL',
      'stdio 如需注入环境变量，在「环境变量」里加 KEY/value（仅 stdio 生效）',
      '远程需要授权时把认证方式切成 OAuth 2.0，保存后点卡片上的授权按钮完成登录',
      '保存后确认卡片状态不是「配置不完整」，必要时用 mcp__spark_platform__mcp_status 查看 connected 与 toolCount',
      '结束当前回合，再发一条消息——新一轮会带着新工具清单启动',
    ],
  },
  aiSummary:
    'Spark Work 的 Skill 与 MCP 机制实测说明：Skill 是 SKILL.md（YAML frontmatter 必填 name/description），' +
    '来源含应用内置 resources/skills（scope=system，id=builtin:<slug>）、用户目录 {userData}/skills（scope=user，' +
    'id=skill:catalog:<指纹> / skill:skillhub:<slug> / local:*）、宿主软链 _links、工作区内扫描的项目级技能（project:*）与团队注册中心。' +
    '内置技能每次 skill:list 重新扫描进库；system prompt 只注入技能目录，正文按需用 mcp__spark_platform__skills_load 加载。' +
    '精选可安装目录 INSTALLABLE_SKILL_CATALOG 当前 33 项（ppt-master、playwright、14 个 superpowers、6 个 gitnexus、11 个影视叙事），' +
    '主路径是从 Spark 自建 artifact 源按 skill.<slug> 下载 zip 并校验 SHA-256，失败回落到 GitHub tarball 或 Contents API。' +
    'MCP 配置存 {userData}/spark.db 的 mcp_servers 表，传输为 stdio（需 command）/ http / sse（需 url），作用域枚举 ' +
    'system/user/project/team/session（另有不对用户开放的 managed，playwright 用它自动注册且不可删改）。' +
    '所有 enabled 的 MCP 默认挂到所有会话，不按 scope 或 Agent 过滤；配置变化会让下一个 turn 强制开新会话以刷新工具清单。' +
    'Agent 侧可用 mcp__spark_platform__mcp_list/mcp_create/mcp_update/mcp_delete/mcp_status 管理 MCP，' +
    '用 skills_list/skills_load/skills_search/skills_install/skills_toggle 等管理技能。',
  Body,
}

export default mcpSkills
