import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      应用把高频能力打包成「内置 Skill」，随安装包一起发布：每个 Skill 是一个目录，含一份
      <code>SKILL.md</code>（YAML frontmatter + Markdown 正文）、一个声明 id 与依赖工具的
      <code>manifest.json</code>，需要时还会带 <code>references/</code>、<code>scripts/</code>、{' '}
      <code>templates/</code>、<code>data/</code>。本页按真实目录逐个列出
      <strong>当前内置的全部 17 个 Skill</strong>，并给出各自真实的
      id、版本、分类、配套工具与踩坑点。
    </p>
    <p>
      目录位置：开发态 <code>apps/desktop/resources/skills/</code>，打包后{' '}
      <code>process.resourcesPath/skills</code>；只读，随应用升级更新。
    </p>

    <h2 id="how-loaded">1. 内置 Skill 怎么生效</h2>
    <ol>
      <li>
        <strong>进库</strong>：每次技能列表被请求时会重新扫描内置目录（
        <code>ensureBuiltInSkills()</code>）， 按 <code>manifest.json</code> 里的 <code>id</code>
        （形如 <code>builtin:&lt;目录名&gt;</code>）写入 / 更新
        <code>skills</code> 表，<code>scope=system</code>。改完文件不用手动同步。
      </li>
      <li>
        <strong>分配给 Agent</strong>：技能靠 Agent 配置里的 <code>skillIds</code>{' '}
        生效。到左侧「Agent」页编辑 目标 Agent，在 Skills 一栏点「管理 Skills」勾选；被列入{' '}
        <code>disabledSkillIds</code> 的则从该 Agent
        的可用集里剔除。新装技能后应用会弹「技能已就绪，是否现在分配给 Agent」的提示，就是因为
        这一步不做的话技能不会自动参与对话。
      </li>
      <li>
        <strong>进上下文的是目录</strong>：system prompt 里只有 <code>id + 名称 + 截断描述</code>，
        并提示 Agent「需要时用 <code>mcp__spark_platform__skills_load</code> 取完整指令」。
        这就是渐进式披露：17 个技能全开也只占一份目录的体积，正文按需加载。
      </li>
      <li>
        <strong>手动点名</strong>：会话输入框的「+ → 技能」菜单会列出可用技能（含当前工作区扫描到的
        项目级技能），点击把 <code>@技能名</code> 插入输入框，用来在单轮里显式指定要用哪个技能。
      </li>
      <li>
        <strong>启用 / 停用与删除</strong>：内置技能<strong>不能删除</strong>（删除接口明确拒绝
        <code>builtin:</code> 前缀），只能通过 <code>skills_toggle</code>（或界面开关）把
        <code>enabled</code> 置 0 停用。
      </li>
    </ol>

    <h2 id="overview">2. 17 个内置 Skill 总览</h2>
    <table>
      <thead>
        <tr>
          <th>Skill id</th>
          <th>名称</th>
          <th>分类</th>
          <th>版本</th>
          <th>一句话定位</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>builtin:claude-api</code>
          </td>
          <td>claude-api</td>
          <td>utility</td>
          <td>—（frontmatter 未给版本）</td>
          <td>Claude API / Anthropic SDK 应用的构建、调试、迁移与 prompt caching</td>
        </tr>
        <tr>
          <td>
            <code>builtin:commit</code>
          </td>
          <td>commit</td>
          <td>coding</td>
          <td>1.0.0</td>
          <td>分析变更并生成 Conventional Commits 提交信息</td>
        </tr>
        <tr>
          <td>
            <code>builtin:react</code>
          </td>
          <td>react</td>
          <td>utility</td>
          <td>—</td>
          <td>@lobehub/ui + antd-style 技术栈的 React 组件与路由约定</td>
        </tr>
        <tr>
          <td>
            <code>builtin:frontend-design</code>
          </td>
          <td>frontend-design</td>
          <td>utility</td>
          <td>—</td>
          <td>先定美学方向再写代码，避免通用 AI 审美</td>
        </tr>
        <tr>
          <td>
            <code>builtin:skill-creator</code>
          </td>
          <td>skill-creator</td>
          <td>utility</td>
          <td>—</td>
          <td>创建 / 改进 Skill：评测、基准、触发描述优化</td>
        </tr>
        <tr>
          <td>
            <code>builtin:spark-workflow-generator</code>
          </td>
          <td>spark-workflow-generator</td>
          <td>utility</td>
          <td>0.2.0</td>
          <td>从自然语言生成可导入的 WorkflowGraph JSON（13 种节点）</td>
        </tr>
        <tr>
          <td>
            <code>builtin:multi-search-engine</code>
          </td>
          <td>multi-search-engine</td>
          <td>utility</td>
          <td>2.1.0</td>
          <td>
            用内置 <code>spark_search</code> 检索网页并给出有出处的答案
          </td>
        </tr>
        <tr>
          <td>
            <code>builtin:browser-use</code>
          </td>
          <td>browser-use</td>
          <td>utility</td>
          <td>1.0.0</td>
          <td>用 Playwright MCP 的 snapshot + ref 操作真实浏览器</td>
        </tr>
        <tr>
          <td>
            <code>builtin:canvas-studio</code>
          </td>
          <td>画布工作室</td>
          <td>utility</td>
          <td>1.7.0</td>
          <td>
            用 <code>spark_canvas</code> 工具操作无限画布与影视流水线
          </td>
        </tr>
        <tr>
          <td>
            <code>builtin:multimedia-use</code>
          </td>
          <td>多媒体使用</td>
          <td>utility</td>
          <td>1.0.0</td>
          <td>图片 / 视频 / 音频的生成、编辑与转写路由</td>
        </tr>
        <tr>
          <td>
            <code>builtin:video-workflow</code>
          </td>
          <td>video-workflow</td>
          <td>utility</td>
          <td>1.0.0</td>
          <td>纯本地 ffmpeg 视频处理（抽帧 / 转码 / 剪辑 / 字幕）</td>
        </tr>
        <tr>
          <td>
            <code>builtin:spark-web-tool</code>
          </td>
          <td>Spark Web Tool</td>
          <td>writing</td>
          <td>2.1.0</td>
          <td>课件 / 专题讲解 / 数据分析报告三类内容产物</td>
        </tr>
        <tr>
          <td>
            <code>builtin:echarts</code>
          </td>
          <td>echarts</td>
          <td>utility</td>
          <td>1.0.0</td>
          <td>生成可直接使用的 ECharts 配置</td>
        </tr>
        <tr>
          <td>
            <code>builtin:ui-ux-pro-max</code>
          </td>
          <td>ui-ux-pro-max</td>
          <td>utility</td>
          <td>—</td>
          <td>带 CSV 数据与检索脚本的 UI/UX 设计知识库</td>
        </tr>
        <tr>
          <td>
            <code>builtin:spark-debug</code>
          </td>
          <td>Spark Debug</td>
          <td>debugging</td>
          <td>1.0.0</td>
          <td>假设驱动 + 人在回路的插桩调试闭环</td>
        </tr>
        <tr>
          <td>
            <code>builtin:find-skills</code>
          </td>
          <td>find-skills</td>
          <td>utility</td>
          <td>1.0.0</td>
          <td>按任务描述搜索并推荐技能（含远程市场）</td>
        </tr>
        <tr>
          <td>
            <code>builtin:platform-manager</code>
          </td>
          <td>平台管理</td>
          <td>utility</td>
          <td>2.8.0</td>
          <td>
            用 <code>mcp__spark_platform__*</code> 管理平台数据
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      表中「—」表示该 <code>SKILL.md</code> 的 frontmatter 只声明了 <code>name</code> 与{' '}
      <code>description</code>（部分还带 <code>license</code>），没有 <code>version</code> /{' '}
      <code>author</code>，入库时版本落到 <code>0.0.0</code>。带 <code>LICENSE.txt</code> 的 （
      <code>claude-api</code>、<code>frontend-design</code>）是随包分发的第三方技能。
    </p>
    <p>
      两个容易看错的字段：
      <strong>
        分类只从 frontmatter 的 <code>category</code> 读
      </strong>
      （缺省按 <code>utility</code> 入库），<code>manifest.json</code> 里的 <code>category</code>{' '}
      不参与入库——例如 <code>react</code> 目录的 manifest 写的是 <code>coding</code>， 但它的
      frontmatter 没有 <code>category</code>，所以入库分类是 <code>utility</code>； 同理{' '}
      <code>manifest.json</code> 只负责提供 <code>id</code>、<code>requiredTools</code>、
      <code>parameters</code>，其余元信息都来自 <code>SKILL.md</code>。
    </p>

    <h2 id="coding">3. 编程与工程类</h2>

    <h3 id="claude-api">3.1 claude-api</h3>
    <p>
      覆盖 Claude API / Anthropic SDK 应用的构建、调试与优化：prompt caching、tool use、
      batch、files、citations、memory、thinking、compaction，以及把老代码迁移到当前模型、
      替换已退役模型。目录里有 45 个文件、17 个子目录，按语言给出示例（<code>python</code>、
      <code>typescript</code>、<code>go</code>、<code>java</code>、<code>php</code>、
      <code>ruby</code>、<code>csharp</code>、<code>curl</code>、<code>shared</code>）。
    </p>
    <ul>
      <li>
        <strong>触发</strong>：代码里 import <code>anthropic</code> / <code>@anthropic-ai/sdk</code>
        ，或问 prompt caching 命中率、thinking、batch、Managed Agents、模型迁移。
      </li>
      <li>
        <strong>跳过</strong>：代码 import <code>openai</code> 或其它厂商 SDK、文件名形如{' '}
        <code>*-openai.py</code> / <code>*-generic.py</code>、provider-neutral 代码。
      </li>
      <li>
        <strong>配套工具</strong>：无（<code>requiredTools</code> 为空），纯说明 + 代码示例。
      </li>
    </ul>

    <h3 id="commit">3.2 commit</h3>
    <p>
      分析 <code>git diff</code> / <code>git status</code>，把变更按逻辑分组，生成 Conventional
      Commits 格式的提交信息：<code>&lt;type&gt;(&lt;scope&gt;): &lt;subject&gt;</code>。 type
      枚举为 <code>feat</code>、<code>fix</code>、<code>refactor</code>、<code>style</code>、
      <code>docs</code>、<code>test</code>、<code>chore</code>、<code>perf</code>、<code>ci</code>；
      subject 建议不超过 50 字符、不以句号结尾。
    </p>
    <ul>
      <li>
        <strong>配套工具</strong>：<code>Bash</code>（跑 git 命令）。
      </li>
      <li>
        <strong>关键约束</strong>：生成信息后<strong>必须展示给用户确认</strong>再执行提交，不会自动
        commit。
      </li>
      <li>
        <strong>典型提示词</strong>：「按 conventional commits
        规范提交我的改动」「把这次改动拆成几个合理的 commit」。
      </li>
    </ul>

    <h3 id="react">3.3 react</h3>
    <p>
      面向 <code>@lobehub/ui</code> + antd 技术栈的 React 组件写作约定：复杂样式用
      <code>antd-style</code>、简单场景用 inline <code>style</code>；布局优先用 <code>Flexbox</code>{' '}
      / <code>Center</code>；组件优先级为 <code>src/components</code> &gt; 已安装包 &gt;{' '}
      <code>@lobehub/ui</code> &gt; antd； zustand 用 selector 取值。路由部分区分 Next.js App
      Router（登录 / 注册 / OAuth）与 react-router-dom 主 SPA（<code>desktopRouter.config.tsx</code>
      ），并强调 SPA 内用 <code>Link</code> / <code>useNavigate</code> 而不是 <code>next/link</code>
      。
    </p>
    <ul>
      <li>
        <strong>配套文件</strong>：<code>references/layout-kit.md</code>；<code>@lobehub/ui</code>{' '}
        组件清单在技能正文里。
      </li>
      <li>
        <strong>注意</strong>：这些约定来自 <code>@lobehub/ui</code>{' '}
        生态（含具体文件路径），换到其它 React 技术栈时只有通用部分可参考。
      </li>
    </ul>

    <h3 id="frontend-design">3.4 frontend-design</h3>
    <p>
      先做设计判断、再写代码：明确用途与受众、选定一个明确的美学方向（极简 / 极大主义 / 复古未来 /
      编辑风 / 工业风等）、再落到字体、色彩、动效、空间构图与背景质感。 明确禁止通用 AI 审美——不用
      Inter / Roboto / Arial 之类默认字体，不用「白底紫渐变」， 也不要每次都收敛到同一套选择。
    </p>
    <ul>
      <li>
        <strong>典型场景</strong>：「做一个有质感的 SaaS landing page」「把这个 dashboard 做得不那么
        AI 味」。
      </li>
      <li>
        <strong>配套工具</strong>：无。产出是可运行的 HTML/CSS/JS 或 React 代码，写文件靠宿主 Agent
        自身能力。
      </li>
    </ul>

    <h3 id="skill-creator">3.5 skill-creator</h3>
    <p>
      创建和改进 Skill 的完整工作流：捕获意图 → 访谈补齐输入 / 输出格式与边界 → 写草稿 → 造测试
      prompt → 生成量化 eval → 用评测脚本看结果 → 按反馈重写 → 扩大测试集； 最后还有专门的
      description 优化步骤，用于提升技能触发的准确率。
    </p>
    <ul>
      <li>
        <strong>配套文件</strong>：19 个文件（含 <code>eval-viewer/generate_review.py</code>{' '}
        之类的评测脚本与模板）。
      </li>
      <li>
        <strong>典型提示词</strong>：「帮我创建一个 <code>sql-explain</code>{' '}
        技能」「我的技能总在错误的场景被触发，帮我改 description」。
      </li>
    </ul>

    <h3 id="spark-workflow-generator">3.6 spark-workflow-generator</h3>
    <p>
      把自然语言需求编译成 Spark 可导入的 <code>WorkflowGraph</code> JSON，节点种类是封闭枚举的{' '}
      <strong>13 种</strong>：<code>input</code>、<code>plan</code>、<code>route</code>、{' '}
      <code>agent</code>、<code>subagent</code>、<code>skill</code>、<code>tool</code>、{' '}
      <code>mcp</code>、<code>approval</code>、<code>verify</code>、<code>review</code>、{' '}
      <code>artifact</code>、<code>loop</code>。产物是「待审草案 + 校验报告」，
      需要人工确认后才导入。
    </p>
    <ul>
      <li>
        <strong>配套文件</strong>：<code>references/schema-freeze.md</code>（schema 与 preflight
        错误码）、<code>references/node-spec.md</code>（13 种节点规格）、4 个模板（线性 / 条件路由 /
        迭代循环 / 审批+MCP）、<code>demos/</code> 示例。
      </li>
      <li>
        <strong>离线校验</strong>：生成后先跑{' '}
        <code>node scripts/validate.mjs &lt;生成的.json&gt;</code>，错误码与导入前的 preflight
        对齐。
      </li>
      <li>
        <strong>硬性规则</strong>：绑定类字段（<code>agentId</code> / <code>skillIds</code> /{' '}
        <code>toolIds</code> / <code>mcpServerIds</code> / <code>ruleIds</code> /{' '}
        <code>modelId</code> / <code>providerProfileId</code> / <code>toolServerId</code>
        ）必须留空，跨环境写死必然失效；坐标 <code>x</code> / <code>y</code> 在节点顶层而不在{' '}
        <code>config</code> 里；分支条件必须互斥且各自独立收尾，不能汇合；<code>loop</code> 不嵌套、
        <code>maxIterations ≤ 50</code>；每张图恰有一个 <code>input</code> 起点、每条链以{' '}
        <code>artifact</code> 收尾。
      </li>
      <li>
        <strong>分工</strong>：实时操作当前画布请用 <code>canvas-studio</code>，视频转码剪辑请用{' '}
        <code>video-workflow</code>，本技能只负责生成 / 修改工作流定义 JSON。
      </li>
    </ul>

    <h2 id="web">4. 联网与浏览器类</h2>

    <h3 id="multi-search-engine">4.1 multi-search-engine</h3>
    <p>
      用内置 <code>spark_search</code> MCP 的 <code>web_search</code> / <code>fetch_url</code>{' '}
      检索网络并抓取正文，综合多来源给出带出处的答案。因为搜索在本地子进程里自己发 HTTP，
      与模型供应商解耦，走第三方 OpenAI 兼容 API 时同样有效（SDK 自带的 WebSearch / WebFetch
      在第三方供应商下会被剥离）。
    </p>
    <ul>
      <li>
        <strong>配套工具</strong>：<code>mcp__spark_search__web_search</code>、
        <code>mcp__spark_search__fetch_url</code>（写在 manifest 的 requiredTools 里）。
      </li>
      <li>
        <strong>用法与后端配置</strong>：见 <a href="/docs/web-search">联网搜索</a>（免密默认链 +
        keyed 后端）。
      </li>
      <li>
        <strong>行为约定</strong>
        ：按时效性判断要不要搜；优先一手权威来源；片段不够就抓正文；材料冲突要显式调和；不得把「没搜到」当成「不存在」。
      </li>
    </ul>

    <h3 id="browser-use">4.2 browser-use</h3>
    <p>
      通过 Playwright MCP 驱动真实浏览器完成导航、点击、输入、截图与数据提取。核心方法论：
      <code>browser_navigate</code> 之后立刻 <code>browser_snapshot</code> 拿到可访问性树，
      每个可交互元素带 <code>ref</code> 编号；后续一律基于 <code>ref</code> 操作 （
      <code>element="ref=3"</code>），不要写 CSS selector；每次动作后再 snapshot 确认；
      复杂视觉页面才截图辅助；收尾调 <code>browser_close</code> 释放资源。
    </p>
    <ul>
      <li>
        <strong>配套工具</strong>（manifest 声明 7 个）：
        <code>mcp__playwright__browser_navigate</code> / <code>snapshot</code> / <code>click</code>{' '}
        / <code>type</code> / <code>press_key</code> / <code>take_screenshot</code> /{' '}
        <code>close</code>。
      </li>
      <li>
        <strong>运行参数</strong>：<code>mode</code> 可选 <code>headful</code>（默认，显示窗口）/{' '}
        <code>headless</code>。
      </li>
      <li>
        <strong>环境兜底</strong>：会话里没有 <code>mcp__playwright__browser_*</code> 时，先用{' '}
        <code>mcp__spark_platform__mcp_status</code> 检查内置 <code>playwright</code> MCP 是否被停用
        （停用就让用户去启用，不要自己重启进程）；确实缺失才自行安装并注册{' '}
        <code>scope=project</code>、<code>type=stdio</code>、<code>command=npx</code>、
        <code>args=["-y","@playwright/mcp"]</code> 的 MCP。网络受限时切{' '}
        <code>registry.npmmirror.com</code> 与 <code>PLAYWRIGHT_DOWNLOAD_HOST</code>， 且
        <strong>不要</strong>写进全局 <code>~/.npmrc</code>。
      </li>
      <li>
        <strong>chromium 按需下载</strong>：仅当确认没有可用的系统 Chrome/Edge / Playwright
        缓存时才下载，且要先告知用户约 150MB。
      </li>
      <li>
        <strong>另一条路</strong>：需要应用内可见窗口、本地 <code>file://</code> 调试、console /
        network 观察或保留登录态时，用内置的 <code>mcp__spark_browser__*</code>（见{' '}
        <a href="/docs/browser-automation">浏览器自动化</a>）。
      </li>
    </ul>

    <h2 id="media">5. 画布、多媒体与内容生产类</h2>

    <h3 id="canvas-studio">5.1 canvas-studio（画布工作室）</h3>
    <p>
      用 <code>mcp__spark_canvas__*</code> 工具直接读写当前打开的画布项目。工具清单以
      <code>canvas.tools.ts</code> 注册为准（当前 <strong>53 个</strong>），只有画布弹窗 attach
      到当前会话时 才注入——没有画布绑定时，Agent 看不到这些工具。
    </p>
    <ul>
      <li>
        <strong>节点类型</strong>：内容节点 <code>image</code> / <code>audio</code> /{' '}
        <code>video</code> / <code>text</code> / <code>prompt</code> / <code>group</code>，加上 AI
        操作节点 <code>text_to_image</code>、<code>image_to_image</code>、<code>image_edit</code>、
        <code>image_compose</code>、<code>panorama_360</code>、<code>text_generate</code>、
        <code>text_rewrite</code>、<code>prompt_optimize</code>、<code>text_to_video</code>、
        <code>image_to_video</code>、<code>video_edit</code>、<code>video_extend</code>、
        <code>text_to_audio</code>、<code>audio_transcribe</code>。
      </li>
      <li>
        <strong>影视语义</strong>：<code>node.data.pipelineRole</code> 表达流水线角色（
        <code>style_bible</code> / <code>screenplay</code> / <code>character</code> /{' '}
        <code>scene</code> / <code>shot</code> / <code>keyframe</code> / <code>clip</code> 等）；
        <code>node.data.productionState</code> 走 <code>empty → drafting → draft → confirmed</code>
        ，上游变更后下游可标 <code>stale</code>。
      </li>
      <li>
        <strong>黄金规则</strong>：编辑前先 <code>canvas_get_project_summary</code>；宽泛目标先{' '}
        <code>canvas_get_production_plan</code>；针对某节点先{' '}
        <code>canvas_get_available_actions</code>；多节点流程必须用{' '}
        <code>canvas_create_reusable_workflow_graph</code>{' '}
        原子创建（不要拼低层创建后漏连线）；只操作当前画布，不创建 /
        切换多画板；破坏性操作先问用户；保存工作流是独立动作（
        <code>canvas_workflow_extract_selection</code>），不会自动落库。
      </li>
      <li>
        <strong>常见坑</strong>：画布工具必须由主 Agent 直接调用，不要委派给子 Agent（子 Agent 没有
        attach
        上下文）；工具返回「无输出」不等于画布断连，先读回验证再决定是否重试；参数字段不确定时用{' '}
        <code>canvas_describe_tool</code> 取精确 schema。
      </li>
    </ul>

    <h3 id="multimedia-use">5.2 multimedia-use（多媒体使用）</h3>
    <p>
      把创作意图翻译成可执行的图片 / 视频 / 音频任务。覆盖文生图、图生图、图片编辑与局部重绘、
      多图合成、文生视频、图生视频、首尾帧视频、视频编辑与扩展、TTS / 配音、音频转写，
      以及模型能力与参数约束的查询。
    </p>
    <ul>
      <li>
        <strong>画布会话</strong>：优先用 <code>mcp__spark_canvas__*</code>——
        <code>canvas_list_media_models</code> 选模型 → <code>canvas_create_operation_node</code>{' '}
        建可检查的操作节点 → 用户明确要求立即执行时才 <code>canvas_run_operation</code> →{' '}
        <code>canvas_list_tasks</code> 跟进。
      </li>
      <li>
        <strong>普通会话</strong>：用 <code>mcp__spark_media__*</code>——先 <code>list_models</code>
        ，再 <code>describe_model</code> 看参数 schema，最后调 <code>generate_image</code> /{' '}
        <code>edit_image</code> / <code>generate_video</code> / <code>generate_audio</code> /{' '}
        <code>transcribe_audio</code>；异步任务用 <code>get_task</code> / <code>cancel_task</code>
        ；Provider 文件用 <code>upload_file</code> / <code>get_file</code> / <code>list_files</code>{' '}
        / <code>delete_file</code>（删除前必须确认）。
      </li>
      <li>
        <strong>常见坑</strong>：不得静默改用默认模型——用户指定模型时要原样传{' '}
        <code>list_models</code> 返回的 <code>selectionKey</code>；不要把适配器模板里的模型 ID
        当成真实模型 ID；工具没注入时如实说明，不要假装已生成。
      </li>
    </ul>

    <h3 id="video-workflow">5.3 video-workflow</h3>
    <p>
      纯本地 ffmpeg 处理，不经过大模型：关键帧提取（场景突变 / I 帧 / 均匀采样）、转码、
      剪辑、合并、变速、倒放、裁剪、加水印、烧字幕、生成 GIF、分割视频。
    </p>
    <ul>
      <li>
        <strong>配套工具</strong>：<code>Bash</code>（调 <code>ffmpeg</code> / <code>ffprobe</code>
        ）。
      </li>
      <li>
        <strong>前置检查</strong>：每次处理前先 <code>ffmpeg -version</code> /{' '}
        <code>ffprobe -version</code>；不可用时<strong>不要自行安装</strong>，引导用户到「设置 →
        完整性 → 视频处理 (FFmpeg) → 下载 FFmpeg」。
      </li>
      <li>
        <strong>路径线索</strong>：Spark 管理的 ffmpeg 落在应用 userData 的{' '}
        <code>bin/&lt;版本&gt;/</code> 下（macOS 形如{' '}
        <code>~/Library/Application Support/spark-desktop/bin/&lt;版本&gt;/ffmpeg</code>）。
      </li>
      <li>
        <strong>流程约定</strong>：先 <code>ffprobe</code> 探明时长 / 分辨率 /
        编码再决定参数；产物文件名带操作语义放在工作目录；长任务告知预计耗时。
      </li>
    </ul>

    <h3 id="spark-web-tool">5.4 spark-web-tool</h3>
    <p>三类内容产物，全部先过一遍澄清再动手：</p>
    <ol>
      <li>
        <strong>
          交互式课件（<code>courseware</code>）
        </strong>
        ：澄清 → 大纲确认 → 内容脚本 → 产物生成，输出 PPTX / HTML / DOCX / Markdown。
      </li>
      <li>
        <strong>
          专题讲解（<code>explain</code>）
        </strong>
        ：澄清 → 理解 → 研究 → 验证 → 脚本 → 产物生成，输出 HTML 幻灯片 / 自定义网页 / PPTX / DOCX。
      </li>
      <li>
        <strong>
          数据分析（<code>data-analysis</code>）
        </strong>
        ：读 CSV / Excel → 分析 → 产出带图表的 HTML 报告。
      </li>
    </ol>
    <ul>
      <li>
        <strong>澄清协议</strong>：Stage 0 会生成 7~12
        个问题，覆盖「内容」「设计方向」「视觉细节」三组，配色题给色板选项、版式题给预览；用户已经说过的信息不重复问。
      </li>
      <li>
        <strong>配套工具</strong>：<code>Read</code>、<code>Write</code>、<code>Bash</code>、
        <code>mcp__spark_search__web_search</code>、<code>mcp__spark_search__fetch_url</code>。
      </li>
      <li>
        <strong>参数</strong>：<code>taskType</code>、<code>outputFormats</code>、<code>style</code>
        、<code>includeQuiz</code>、<code>dataFileName</code>、<code>dataFileUrl</code>、
        <code>chartTypes</code>、<code>designSystem</code>。
      </li>
      <li>
        <strong>配套文件</strong>：33 个文件，<code>references/</code> 下按 <code>clarify</code> /{' '}
        <code>courseware</code> / <code>explain</code> / <code>data-analysis</code> /{' '}
        <code>snippets</code> 分目录，另有 <code>README.md</code>。
      </li>
      <li>
        <strong>典型提示词</strong>：「做一份《光合作用》的交互式课件」「把这份 CSV
        变成数据报告」「讲解一下快速排序，要能互动的网页」。
      </li>
    </ul>

    <h3 id="echarts">5.5 echarts</h3>
    <p>
      生成可直接使用的 ECharts 配置：按数据特征选图型（趋势 → 折线 / 面积，占比 → 饼 / 环形， 分布 →
      散点 / 气泡，多维 → 雷达，层级 → 矩形树图 / 旭日图，流向 → 桑基 / 漏斗， 时序 → K 线，地理 →
      地图 / 热力，关系 → 关系图），并带上默认样式约定。
    </p>
    <ul>
      <li>
        <strong>默认样式</strong>：色板{' '}
        <code>
          ['#5470c6','#91cc75','#fac858','#ee6666','#73c0de','#3ba272','#fc8452','#9a60b4','#ea7ccc']
        </code>
        ；开 <code>tooltip</code>、<code>legend</code>，<code>grid</code> 留白{' '}
        <code>top 60 / right 40 / bottom 40 / left 60</code>；配 resize 监听。
      </li>
      <li>
        <strong>组合用法</strong>：可以单独使用，也可以作为 <code>spark-web-tool</code>{' '}
        数据分析报告里的图表子任务。
      </li>
    </ul>

    <h2 id="design">6. UI / 设计类</h2>

    <h3 id="ui-ux-pro-max">6.1 ui-ux-pro-max</h3>
    <p>
      一个带数据的本地设计知识库：<code>data/*.csv</code> 存知识，
      <code>scripts/search.py</code> 做 BM25 检索，<code>scripts/design_system.py</code>{' '}
      生成成套设计系统建议。 技能自述的规模是「50+ 风格 / 161 色板 / 57 字体配对 / 161 产品类型 / 99
      UX 准则 / 25 图表 / 10 技术栈」， 按随包数据的实际行数核对如下：
    </p>
    <table>
      <thead>
        <tr>
          <th>数据文件</th>
          <th>行数</th>
          <th>对应能力</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>data/colors.csv</code>
          </td>
          <td>161</td>
          <td>按产品类型选的完整色板（primary / accent / border / ring 等）</td>
        </tr>
        <tr>
          <td>
            <code>data/products.csv</code>
          </td>
          <td>161</td>
          <td>产品类型 → 设计模式</td>
        </tr>
        <tr>
          <td>
            <code>data/styles.csv</code>
          </td>
          <td>84</td>
          <td>UI 风格库（glassmorphism、brutalism、bento grid 等）</td>
        </tr>
        <tr>
          <td>
            <code>data/typography.csv</code>
          </td>
          <td>73</td>
          <td>字体配对推荐</td>
        </tr>
        <tr>
          <td>
            <code>data/ux-guidelines.csv</code>
          </td>
          <td>99</td>
          <td>UX 准则（含 Do / Don't 与代码示例）</td>
        </tr>
        <tr>
          <td>
            <code>data/charts.csv</code>
          </td>
          <td>25</td>
          <td>图表类型选择建议</td>
        </tr>
        <tr>
          <td>
            <code>data/icons.csv</code>
          </td>
          <td>105</td>
          <td>图标使用建议</td>
        </tr>
        <tr>
          <td>
            <code>data/react-performance.csv</code>
          </td>
          <td>44</td>
          <td>React 渲染性能准则</td>
        </tr>
        <tr>
          <td>
            <code>data/stacks/react-native.csv</code>
          </td>
          <td>—</td>
          <td>
            技术栈专属数据（<code>--stack</code> 目前只有 <code>react-native</code> 一项）
          </td>
        </tr>
      </tbody>
    </table>
    <p>检索脚本的真实用法（在技能目录下执行）：</p>
    <pre>{`# 生成成套设计系统建议
python3 scripts/search.py "<产品类型> <行业> <关键词>" --design-system -p "项目名"

# 落盘到 design-system/MASTER.md（可再为单页生成覆盖文件）
python3 scripts/search.py "<关键词>" --design-system --persist -p "项目名" --page "dashboard"

# 按域查询明细
python3 scripts/search.py "<关键词>" --domain <domain> -n 5

# 技术栈专属查询（当前仅 react-native）
python3 scripts/search.py "<关键词>" --stack react-native`}</pre>
    <ul>
      <li>
        <strong>可用 domain</strong>（脚本的真实可选值）：<code>style</code>、<code>color</code>、
        <code>chart</code>、<code>landing</code>、<code>product</code>、<code>ux</code>、
        <code>typography</code>、<code>icons</code>、<code>react</code>、<code>web</code>、
        <code>google-fonts</code>。
      </li>
      <li>
        <strong>输出控制</strong>：<code>--format ascii|markdown</code>、<code>--json</code>、
        <code>--output-dir</code>。
      </li>
      <li>
        <strong>注意</strong>：仓库里 <code>scripts/search.py</code> 的 <code>--help</code>{' '}
        文案仍写着 <code>html-tailwind / react / nextjs</code>，但 <code>STACK_CONFIG</code>{' '}
        实际只实现了 <code>react-native</code>；其它栈请用 <code>--domain</code> 查询。
      </li>
    </ul>

    <h2 id="ops">7. 调试与平台管理类</h2>

    <h3 id="spark-debug">7.1 spark-debug</h3>
    <p>
      「假设驱动 + 人在回路」的调试闭环。核心原则是<strong>Agent 不复现 bug</strong>：
      它负责假设、插桩、读日志、修复、清理，用户负责操作复现；每插一轮桩就结束 turn
      把控制权交回用户。
    </p>
    <ul>
      <li>
        <strong>挂载条件</strong>
        ：不是常驻技能。会话里打开「调试模式」开关（per-session，不继承全局偏好）后，运行时才挂载{' '}
        <code>mcp__spark_debug__*</code> 并注入状态机提示词。
      </li>
      <li>
        <strong>工具</strong>：<code>begin</code>（拿 sid / 端口 / 轮次与插桩上报器）、
        <code>read</code>（拉本轮日志）、<code>status</code>（看本轮条数与假设台账）、
        <code>next_round</code>（推进轮次）、<code>finish</code>（清空日志并返回待删除的插桩标记）。
      </li>
      <li>
        <strong>参数</strong>：<code>bugDescription</code>（必填，现象 + 复现步骤 + 期望 vs 实际）、
        <code>targetRuntime</code>（<code>browser</code> 默认 / <code>node</code> /{' '}
        <code>other</code>，决定用哪套语言的上报器模板）。
      </li>
      <li>
        <strong>插桩规范</strong>：日志块必须用{' '}
        <code>// __SPARK_DEBUG_START__ ... // __SPARK_DEBUG_END__</code> 包裹；
        <code>status.thisRound === 0</code> 时不要硬分析空日志，改插桩点或复现步骤。
      </li>
      <li>
        <strong>护栏</strong>：约 6 轮仍未定位就收口总结；交付的硬条件是 <code>finish</code> 后全仓
        grep <code>__SPARK_DEBUG</code> 零残留；报告中还要说明日志证据。
      </li>
    </ul>

    <h3 id="find-skills">7.2 find-skills</h3>
    <p>
      技能发现与推荐：解析任务需要什么能力（编码 / 设计 / 搜索 / 数据处理）与技术栈，用{' '}
      <code>mcp__spark_platform__skills_search</code> 搜远程技能库，再结合已安装列表给出推荐，
      每条说明「匹配原因 / 如何使用 / 来源是已安装还是需要安装」。推荐策略偏保守：
      基础编程任务不额外推荐、用户已指定工具时不推替代品、优先已安装的技能，
      并在需要多种能力时给组合（如前端页面 → <code>frontend-design</code> + <code>react</code>）。
    </p>

    <h3 id="platform-manager">7.3 platform-manager（平台管理）</h3>
    <p>
      用 <code>mcp__spark_platform__*</code> 管理应用内的平台数据（本机 SQLite + JSON 文件，
      不是全局 Claude 配置）。工具清单以
      <code>packages/agent-runtime/src/tools/platform-management-mcp-server.mjs</code> 注册为准，
      当前共 <strong>124 个</strong>（技能正文里写的「94 个」是历史值），分组如下：
    </p>
    <table>
      <thead>
        <tr>
          <th>分组</th>
          <th>数量</th>
          <th>代表工具</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Skills</td>
          <td>8</td>
          <td>
            <code>skills_list</code> / <code>skills_load</code> / <code>skills_install_github</code>{' '}
            / <code>skills_toggle</code>
          </td>
        </tr>
        <tr>
          <td>MCP</td>
          <td>5</td>
          <td>
            <code>mcp_list</code> / <code>mcp_create</code> / <code>mcp_update</code> /{' '}
            <code>mcp_delete</code> / <code>mcp_status</code>
          </td>
        </tr>
        <tr>
          <td>自定义工具</td>
          <td>11</td>
          <td>
            <code>custom_tools_guide</code> / <code>custom_tools_validate</code> /{' '}
            <code>custom_tools_test</code> / <code>custom_tools_publish</code>
          </td>
        </tr>
        <tr>
          <td>工具包（Tool Package）</td>
          <td>22</td>
          <td>
            <code>tool_packages_create_project</code> / <code>tool_packages_install_git</code> /{' '}
            <code>tool_packages_test</code>
          </td>
        </tr>
        <tr>
          <td>Providers</td>
          <td>13</td>
          <td>
            <code>providers_list</code> / <code>providers_health_check</code> /{' '}
            <code>providers_media_configure</code>
          </td>
        </tr>
        <tr>
          <td>Workflows</td>
          <td>5</td>
          <td>
            <code>workflows_list</code> / <code>workflows_create</code> /{' '}
            <code>workflows_update</code>
          </td>
        </tr>
        <tr>
          <td>Agents</td>
          <td>5</td>
          <td>
            <code>agents_list</code> / <code>agents_create</code> / <code>agents_update</code>
          </td>
        </tr>
        <tr>
          <td>Teams</td>
          <td>5</td>
          <td>
            <code>teams_list</code> / <code>teams_create</code> / <code>teams_update</code>
          </td>
        </tr>
        <tr>
          <td>看板任务</td>
          <td>10</td>
          <td>
            <code>board_list</code> / <code>board_create</code> / <code>board_batch_update</code> /{' '}
            <code>board_restore</code>
          </td>
        </tr>
        <tr>
          <td>GitHub</td>
          <td>15</td>
          <td>
            <code>github_status</code> / <code>github_create_branch</code> /{' '}
            <code>github_create_pull_request</code>
          </td>
        </tr>
        <tr>
          <td>会话</td>
          <td>6</td>
          <td>
            <code>sessions_get</code> / <code>sessions_switch_model</code> /{' '}
            <code>sessions_switch_permission</code>
          </td>
        </tr>
        <tr>
          <td>会话定时任务</td>
          <td>5</td>
          <td>
            <code>session_schedule_create</code> / <code>session_schedule_delete</code>
          </td>
        </tr>
        <tr>
          <td>会话历史</td>
          <td>3</td>
          <td>
            <code>session_history_list</code> / <code>session_history_search</code> /{' '}
            <code>session_history_read</code>
          </td>
        </tr>
        <tr>
          <td>参考会话</td>
          <td>3</td>
          <td>
            <code>referenced_sessions_list</code> / <code>referenced_session_search</code>
          </td>
        </tr>
        <tr>
          <td>Artifacts</td>
          <td>2</td>
          <td>
            <code>artifacts_list</code> / <code>artifacts_resolve</code>
          </td>
        </tr>
        <tr>
          <td>Codex 运行时</td>
          <td>2</td>
          <td>
            <code>codex_runtime_diagnostics</code> / <code>codex_runtime_restart_idle</code>
          </td>
        </tr>
        <tr>
          <td>设置</td>
          <td>4</td>
          <td>
            <code>settings_get</code> / <code>settings_set</code> / <code>settings_get_all</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      破坏性操作（删除、卸载、发布、启用）在工具描述里都要求先向用户确认； Agent
      侧只管平台数据，不替代画布 UI 操作。详见
      <a href="/docs/agents-workflows">Agent 工作流 / Platform 管理工具</a>。
    </p>

    <h2 id="pick">8. 按任务挑选</h2>
    <table>
      <thead>
        <tr>
          <th>你的任务</th>
          <th>优先 Skill</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>查资料 / 调研 / 抓网页正文</td>
          <td>multi-search-engine</td>
        </tr>
        <tr>
          <td>登录态网页操作 / 抓数据 / UI 验证</td>
          <td>browser-use</td>
        </tr>
        <tr>
          <td>应用内可见窗口调试 / console / network</td>
          <td>
            browser-use + <code>mcp__spark_browser__*</code>
          </td>
        </tr>
        <tr>
          <td>写 React 组件 / 改样式</td>
          <td>react（配合 frontend-design）</td>
        </tr>
        <tr>
          <td>做有设计感的页面 / Landing</td>
          <td>frontend-design</td>
        </tr>
        <tr>
          <td>挑配色 / 字体 / 风格 / UX 准则</td>
          <td>ui-ux-pro-max</td>
        </tr>
        <tr>
          <td>生成 Spark 工作流 JSON</td>
          <td>spark-workflow-generator</td>
        </tr>
        <tr>
          <td>画布节点与影视流水线操作</td>
          <td>canvas-studio</td>
        </tr>
        <tr>
          <td>生图 / 生视频 / 配音 / 转写</td>
          <td>multimedia-use</td>
        </tr>
        <tr>
          <td>视频抽帧 / 转码 / 剪辑 / 字幕</td>
          <td>video-workflow</td>
        </tr>
        <tr>
          <td>出课件 / 专题讲解 / 数据分析报告</td>
          <td>spark-web-tool</td>
        </tr>
        <tr>
          <td>单张图表配置</td>
          <td>echarts</td>
        </tr>
        <tr>
          <td>调用 Anthropic SDK 或做模型迁移</td>
          <td>claude-api</td>
        </tr>
        <tr>
          <td>整理提交信息</td>
          <td>commit</td>
        </tr>
        <tr>
          <td>难复现 bug 的排查</td>
          <td>spark-debug（先开会话的调试模式）</td>
        </tr>
        <tr>
          <td>管理 Skills / MCP / Agents / Teams / 看板</td>
          <td>platform-manager</td>
        </tr>
        <tr>
          <td>不确定该用哪个 Skill</td>
          <td>find-skills</td>
        </tr>
        <tr>
          <td>写或改进一个 Skill</td>
          <td>skill-creator</td>
        </tr>
      </tbody>
    </table>
    <p>
      组合建议：一次会话里 2~4 个技能足够。技能越多，system prompt 里的技能目录越长，
      而且在技能职责重叠时模型更容易选错（例如截图任务同时开 <code>browser-use</code> 和
      <code>canvas-studio</code>）。
    </p>

    <h2 id="author">9. 自己写一个 Skill</h2>
    <p>三条落地路径，按「是否要跟随项目 / 是否要分享」选：</p>
    <table>
      <thead>
        <tr>
          <th>目的</th>
          <th>做法</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>只给某个项目用</td>
          <td>
            在仓库里建 <code>.agents/skills/&lt;slug&gt;/SKILL.md</code>（或{' '}
            <code>.claude/skills</code>{' '}
            等被扫描的目录）。跟随代码走，会话内实时可见，不进全局技能列表
          </td>
        </tr>
        <tr>
          <td>给本机所有项目用</td>
          <td>
            放到 <code>&#123;userData&#125;/skills/&lt;slug&gt;/</code>，或在「技能 →
            创建」里用「文件/目录导入 / 软链接 / 手动创建」，再到 Agent 页把技能分配给需要它的 Agent
          </td>
        </tr>
        <tr>
          <td>发给别人</td>
          <td>
            把技能推到 GitHub 仓库（目录里含 <code>SKILL.md</code>），对方用 Agent 调{' '}
            <code>mcp__spark_platform__skills_install_github</code>（<code>repo</code> /{' '}
            <code>ref</code> / <code>path</code>）安装；或让维护者把它加进「精选推荐」目录
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      <strong>frontmatter 真实字段</strong>：<code>name</code>（必填，非空字符串）和{' '}
      <code>description</code>（必填）是硬性要求；<code>version</code> / <code>author</code> /{' '}
      <code>category</code> / <code>tags</code> / <code>license</code> 可选；
      <code>requiredTools</code> 与 <code>tools</code> 会被合并成依赖工具清单（写在这里只是声明，
      不会自动帮你装上对应的 MCP）。<code>category</code> 的常见取值为 <code>coding</code> /{' '}
      <code>writing</code> / <code>analysis</code> / <code>workflow</code> / <code>utility</code>；
      内置技能里还出现过 <code>debugging</code>。
    </p>
    <pre>{`---
name: sql-explain
description: "把 SQL 拆成执行步骤并解释代价。用户粘贴 EXPLAIN 输出、或问「这条 SQL 为什么慢」时加载。"
version: 1.0.0
author: Your Name
category: coding
tags: [sql, explain, performance]
requiredTools: [Bash]
---

## 何时使用
…

## 工作流
1. …

## 注意
- …`}</pre>
    <p>
      想让技能被稳定触发，关键在 <code>description</code>：写清「做什么 + 什么场景加载 +
      什么场景不要加载」。 内置技能的 description 普遍是这个写法（例如 <code>claude-api</code>{' '}
      明确列出 TRIGGER 与 SKIP）， 可以直接参考。写完用 <code>skill-creator</code> 跑一轮评测和
      description 优化。
    </p>
    <p>
      注意：内置技能的内容在安装目录里是只读的，改本机副本会在升级时被覆盖；
      想长期保留自己的版本请用独立 slug 放到 <code>&#123;userData&#125;/skills/</code>。
    </p>
  </>
)

export const builtinTools: DocsPageContent = {
  slug: 'builtin-tools',
  toc: [
    { id: 'how-loaded', title: '1. 内置 Skill 怎么生效', level: 2 },
    { id: 'overview', title: '2. 17 个内置 Skill 总览', level: 2 },
    { id: 'coding', title: '3. 编程与工程类', level: 2 },
    { id: 'claude-api', title: '3.1 claude-api', level: 3 },
    { id: 'commit', title: '3.2 commit', level: 3 },
    { id: 'react', title: '3.3 react', level: 3 },
    { id: 'frontend-design', title: '3.4 frontend-design', level: 3 },
    { id: 'skill-creator', title: '3.5 skill-creator', level: 3 },
    { id: 'spark-workflow-generator', title: '3.6 spark-workflow-generator', level: 3 },
    { id: 'web', title: '4. 联网与浏览器类', level: 2 },
    { id: 'multi-search-engine', title: '4.1 multi-search-engine', level: 3 },
    { id: 'browser-use', title: '4.2 browser-use', level: 3 },
    { id: 'media', title: '5. 画布、多媒体与内容生产类', level: 2 },
    { id: 'canvas-studio', title: '5.1 canvas-studio', level: 3 },
    { id: 'multimedia-use', title: '5.2 multimedia-use', level: 3 },
    { id: 'video-workflow', title: '5.3 video-workflow', level: 3 },
    { id: 'spark-web-tool', title: '5.4 spark-web-tool', level: 3 },
    { id: 'echarts', title: '5.5 echarts', level: 3 },
    { id: 'design', title: '6. UI / 设计类', level: 2 },
    { id: 'ui-ux-pro-max', title: '6.1 ui-ux-pro-max', level: 3 },
    { id: 'ops', title: '7. 调试与平台管理类', level: 2 },
    { id: 'spark-debug', title: '7.1 spark-debug', level: 3 },
    { id: 'find-skills', title: '7.2 find-skills', level: 3 },
    { id: 'platform-manager', title: '7.3 platform-manager', level: 3 },
    { id: 'pick', title: '8. 按任务挑选', level: 2 },
    { id: 'author', title: '9. 自己写一个 Skill', level: 2 },
  ],
  faq: [
    {
      question: '内置 Skill 一共有多少个？',
      answer:
        '17 个目录（apps/desktop/resources/skills/），分别是 claude-api、commit、react、frontend-design、skill-creator、spark-workflow-generator、multi-search-engine、browser-use、canvas-studio、multimedia-use、video-workflow、spark-web-tool、echarts、ui-ux-pro-max、spark-debug、find-skills、platform-manager。每个目录是一份 SKILL.md + 一份声明 id 的 manifest.json。',
    },
    {
      question: '一次开几个 Skill 合适？',
      answer:
        '2~4 个。技能目录（id + 名称 + 描述）会整段进 system prompt，开太多会拉长提示词，职责重叠时还容易选错技能。技能正文只有被加载时才占上下文。',
    },
    {
      question: '为什么装了技能但对话里没生效？',
      answer:
        '技能必须分配给 Agent 才生效：到「Agent」页编辑目标 Agent，在 Skills 一栏点「管理 Skills」勾选；同时确认该技能没有被停用（enabled=0）。项目目录里的技能只在对应工作区的会话里可用。',
    },
    {
      question: '改内置技能的文件会怎样？',
      answer:
        '内置目录随应用升级更新，改动会被覆盖；而且内置技能不能删除（删除接口拒绝 builtin: 前缀），只能停用。要长期保留自己的版本，请用独立 slug 放到 {userData}/skills/ 或项目内的被扫描目录。',
    },
    {
      question: 'spark-debug 为什么有时看不到 mcp__spark_debug__* 工具？',
      answer:
        '它按会话挂载：只有在该会话打开「调试模式」开关后，运行时才会挂上 spark_debug MCP 并注入状态机提示词。这个开关是 per-session 的，不会从全局偏好继承。',
    },
    {
      question: 'platform-manager 到底有多少个平台工具？',
      answer:
        '以 platform-management-mcp-server.mjs 注册为准，当前 124 个（技能正文里写的 94 个是旧值）。分 17 组，最大的是 Tool Package 22 个、GitHub 15 个、Providers 13 个、自定义工具 11 个、看板任务 10 个。',
    },
  ],
  quickReference: [
    {
      key: '内置 Skill 数量',
      value: '17 个（apps/desktop/resources/skills/，打包后在 process.resourcesPath/skills）',
    },
    { key: 'Skill id 形态', value: 'builtin:<目录名>，取自目录内 manifest.json 的 id' },
    { key: '生效前提', value: '分配给 Agent（skillIds）；停用走 enabled=0 / skills_toggle' },
    { key: '不可删除', value: 'builtin: 前缀的技能只能停用' },
    { key: '加载策略', value: 'system prompt 只放 id + 名称 + 描述；正文按需 skills_load' },
    { key: '会话内点名', value: '输入框「+ → 技能」插入 @技能名' },
    { key: '项目级技能目录', value: '.claude/skills → … → .agents/skills → skills（按顺序去重）' },
    { key: '自定义落盘', value: '{userData}/skills/<slug>/（scope=user）' },
    { key: '平台工具命名空间', value: 'mcp__spark_platform__*（当前 124 个）' },
    {
      key: '工作流生成校验',
      value: 'node scripts/validate.mjs <生成的.json>（13 种节点封闭枚举）',
    },
  ],
  aiSummary:
    'Spark Work 内置 Skill 全览（按真实目录核对，共 17 个）：claude-api / commit / react / frontend-design / skill-creator / ' +
    'spark-workflow-generator / multi-search-engine / browser-use / canvas-studio / multimedia-use / video-workflow / spark-web-tool / ' +
    'echarts / ui-ux-pro-max / spark-debug / find-skills / platform-manager，目录位于 apps/desktop/resources/skills，' +
    '每个目录含 SKILL.md（frontmatter 必填 name/description）与 manifest.json（id=builtin:<目录名>，可声明 requiredTools 与 parameters）。' +
    '技能靠 Agent 的 skillIds 生效、可被 skills_toggle 停用、builtin: 前缀不可删除；system prompt 只注入 id+名称+描述（渐进式披露），' +
    '正文按需用 mcp__spark_platform__skills_load 加载，会话输入框「+ → 技能」可插入 @技能名。' +
    '本页逐条给出真实版本、分类、触发场景、配套 MCP 命名空间（spark_search / spark_canvas / spark_media / spark_debug / spark_platform / playwright）' +
    '与常见坑，例如 spark-debug 需先开会话调试模式、video-workflow 依赖设置页下载的 ffmpeg、ui-ux-pro-max 的检索脚本真实 --domain 取值、' +
    'platform-manager 实际注册 124 个工具（技能正文写的 94 为旧值）。',
  Body,
}

export default builtinTools
