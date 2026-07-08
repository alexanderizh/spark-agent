import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      无限画布（Infinite Canvas）不是单一生图页，而是「以项目为单位的多模态创作工作台」。
      用户先进入项目管理页创建项目，再进入项目画布布置节点、发起 AI 操作、追溯生成血缘。
    </p>

    <h2 id="core-loop">1. 核心闭环</h2>
    <ol>
      <li>创建画布项目。</li>
      <li>进入项目画布。</li>
      <li>上传或创建文本 / 图片节点。</li>
      <li>选择节点并发起 AI 操作。</li>
      <li>主进程创建画布任务，调用 Agent / Provider 能力。</li>
      <li>任务进度回写画布。</li>
      <li>AI 输出自动成为新画布节点。</li>
      <li>节点保留来源关系，可继续派生。</li>
    </ol>

    <h2 id="node-types">2. 节点类型</h2>
    <ul>
      <li><strong>图片节点</strong>：本地上传、AI 输出。</li>
      <li><strong>文本节点</strong>：文案、Prompt、脚本、备注。</li>
      <li><strong>视频节点</strong>：AI 输出视频，可预览。</li>
      <li><strong>任务节点</strong>：进行中的 AI 任务（pending/running/completed/failed/cancelled）。</li>
      <li><strong>分组节点</strong>：把多个节点编组。</li>
      <li><strong>全景节点</strong>：360° 全景预览。</li>
    </ul>
    <p>
      节点都有「常驻头部工具栏」（复制 / 确认 / 标记待更新 / 锁定 / 置顶 / 删除等高频动作）。
      双击进入内联激活态：节点卡片向下展开编辑/配置面板。
    </p>

    <h2 id="ai-ops">3. AI 操作</h2>
    <ul>
      <li><strong>文生图 / 图生图 / 图片编辑 / 多图合成</strong>：基于 spark_media / spark_image MCP。</li>
      <li><strong>文本生成 / 改写 / Prompt 优化</strong>：调用文本模型，文本类节点可叠加 Skills。</li>
      <li><strong>图片转视频</strong>：基于 spark_media 视频能力。</li>
      <li><strong>扩图（九宫格）</strong>：图片 / 文本 / Prompt 节点右键创建的操作节点。菜单里以「扩图（九宫格）」呈现，与图片节点自带的本地「宫格切分」区分开。</li>
      <li><strong>360 全景图</strong>：生成 2:1 等距圆柱投影（equirectangular）图，可沉浸预览与环视。</li>
    </ul>
    <p>
      文本类操作节点的运行配置支持选 Agent、文本模型和多选 Skills；图片 / 视频类操作只暴露媒体模型
      和参数，避免把文本 Skill 注入媒体任务。
    </p>

    <h3 id="node-menu">3.1 节点菜单与 AI 操作菜单</h3>
    <p>
      在画布上<strong>右键节点</strong>会弹出节点菜单，按节点类型聚合：
      「<strong>副本流水线</strong>」（把当前节点复制为下一节点、整列扩展）、
      「<strong>复制 / 编辑</strong>」等结构化动作，
      以及「<strong>AI 操作</strong>」二级菜单。
    </p>
    <p>
      <img
        src="/docs/img/canvas-node-menu.png"
        alt="画布节点右键菜单：副本流水线 → 转副本 / 生成场景图"
        loading="lazy"
      />
    </p>
    <p>
      点「<strong>AI 操作</strong>」打开二级菜单，按节点类型先铺出「上下文专属」能力，再接泛化能力：
    </p>
    <ul>
      <li><strong>上下文专属</strong>：图片节点有「图片扩图」「提取风格」「扩图（九宫格）」；文本 / Prompt 节点只有「扩图（九宫格）」。</li>
      <li><strong>泛化能力</strong>：文生图、图生图、多图合成、360 全景图、文本生成、文本改写、Prompt 优化、文生视频、图生视频、文生音频、语音转写。</li>
    </ul>
    <p>
      <img
        src="/docs/img/canvas-ai-ops-menu.png"
        alt="AI 操作二级菜单：文生图 / 图生图 / 多图合成 / 360 全景图 / 文生视频 / 文生音频"
        loading="lazy"
      />
    </p>
    <div className="docs-callout">
      <strong>给非 IT 用户的解释</strong>：
      <ul>
        <li>「节点菜单」= 节点上能干什么（复制、删、变种等）。</li>
        <li>「AI 操作菜单」= 让 AI 帮你做什么（生图、改字、做视频等）。</li>
        <li>菜单按场景聚合，常用的放一起（"剧本流水线"、"图像生成"），不用记命令。</li>
      </ul>
    </div>

    <h3 id="panorama">3.2 360 全景图：保持场景一致性的利器</h3>
    <p>
      360 全景图（equirectangular / 等距圆柱投影，2:1 比例）是无限画布里
      <strong>保持多个镜头场景一致性</strong>的关键节点类型。
      同一个全景图可以从任何角度取景（截图），所有取景都来自同一光源 / 物体布局，
      所以多角度的画面天然连贯。
    </p>
    <p>
      常用工作流：
    </p>
    <ol>
      <li>在剧本里为某个场景生成一张 360 全景图（如「傍晚的办公室全景」）。</li>
      <li>点节点菜单的「<strong>截图生成场景图</strong>」进入沉浸预览。</li>
      <li>拖动 / 方向键环视定位到想要的镜头角度，点「<strong>截图</strong>」落地为新图片节点。</li>
      <li>重复多次，取不同角度，得到一组<strong>同一场景但不同视角</strong>的画面。</li>
    </ol>
    <p>
      <img
        src="/docs/img/canvas-panorama.png"
        alt="360 全景图预览：沉浸全屏、拖动环视、远近缩放、76° E Pitch 4° FOV 100°、自动环视、截图生成场景图"
        loading="lazy"
      />
    </p>
    <div className="docs-callout">
      <strong>360 预览的快捷键</strong>：
      <ul>
        <li><strong>鼠标拖动 / 触屏滑动</strong>：水平 360°、俯仰方向环视。</li>
        <li><strong>滚轮 / 滑杆</strong>：缩放（FOV 范围 30°~120°）。</li>
        <li><strong>方向键</strong>：←/→ 水平旋转、↑/↓ 俯仰、+/- 缩放。</li>
        <li><strong>沉浸全屏</strong>：隐藏所有 UI，占满屏幕给团队预览。</li>
        <li><strong>自动环视</strong>：打开后慢慢水平旋转，适合审片和录屏。</li>
        <li><strong>截图生成场景图</strong>：把当前视角落成新图片节点，自动建立 lineage。</li>
      </ul>
    </div>
    <p>
      <strong>为什么这对影视 / 漫画 / 游戏团队关键</strong>：
      同一组全景图派生出来的多个截图，灯光、阴影、物体位置完全一致，
      多角色同框 / 长镜头分解 / 故事板推进都不用担心「这房间怎么忽大忽小」。
      对中小团队来说，等价于自带了一个轻量 3D 场景锁定工具，但用的是 2D 图像。
    </p>

    <h2 id="tasks">4. 任务与结果</h2>
    <p>
      创建任务后画布产生「任务节点」，状态包括：
    </p>
    <ul>
      <li><code>pending</code>：已入队，未开始。</li>
      <li><code>running</code>：主进程在跑。</li>
      <li><code>completed</code>：成功，产物节点已落画布。</li>
      <li><code>failed</code>：失败，错误码显示在 Inspector。</li>
      <li><code>cancelled</code>：被用户取消。</li>
    </ul>
    <p>
      任务完成后自动创建结果节点，结果节点和输入节点之间建立 lineage 边。
      任务与产物节点的默认名是「类型 + 顺序号」（如「图片 #3」「文本生成 #2」），
      方便后续引用。
    </p>

    <h2 id="assets">5. 资产管理</h2>
    <p>
      项目内的资产侧栏按类型 / 状态 / 关键词筛选，支持：
    </p>
    <ul>
      <li>拖回画布继续编辑。</li>
      <li>查看来源任务、Prompt、模型、参数。</li>
      <li>跨项目导出 / 复用（受权限控制）。</li>
    </ul>

    <h2 id="media-flow">6. 媒体任务链路</h2>
    <pre>
{`Renderer (localStorage hot store)
   │ canvas:task:create-media
   ▼
Main Process ── MediaRouterService ── Manifest / APIMart / xAI / Volcengine adapter ── .spark-artifacts/media/*
   │ canvas:snapshot:save (debounced 500ms)                                          │
   ▼                                                                                   ▼
SQLite canvas_projects + canvas_snapshots                              safe-file:// protocol
(production persistence)                                            (renderer <audio>/<video>/<img>)`}
    </pre>
    <p>
      生成产物落在 <code>userData/.spark-artifacts/media/&#123;images,audio,videos&#125;</code>，
      通过 <code>safe-file://x/&lt;base64&gt;</code> 协议让 &lt;audio&gt;/&lt;video&gt;/&lt;img&gt;
      在画布节点里直接播放。CSP 允许 <code>media-src safe-file:</code>，主进程协议返回
      <code>Accept-Ranges / Content-Type / Content-Length</code>，支持进度条与 seek。
    </p>
    <p>
      <code>localStorage</code> 仍是热存储（毫秒级读写），每次 mutation 触发 500ms debounce 的
      <code>canvas:snapshot:save</code>，把全量快照写入 SQLite（<code>canvas_projects</code> +
      <code>canvas_snapshots</code>，migration 027）。启动时
      <code>hydrateFromStorage</code> 把 SQLite 中缺失的工程恢复到 localStorage。
    </p>

    <h2 id="errors">7. 错误处理</h2>
    <p>统一错误码（在画布与 Inspector 里展示）：</p>
    <ul>
      <li><code>provider_not_configured</code></li>
      <li><code>capability_not_supported</code></li>
      <li><code>api_key_missing</code></li>
      <li><code>invalid_input</code></li>
      <li><code>provider_http_error</code></li>
      <li><code>task_failed</code></li>
      <li><code>task_timeout</code></li>
      <li><code>artifact_download_failed</code></li>
    </ul>
    <p>失败任务停留在画布，状态 <code>failed</code>，节点 + Inspector 展示错误码与消息。异步任务超时返回 <code>task_timeout</code>。</p>

    <h2 id="not-in-mvp">8. MVP 不做的事</h2>
    <ul>
      <li>多人实时协作。</li>
      <li>复杂时间线剪辑。</li>
      <li>精细蒙版编辑器。</li>
      <li>Photoshop 级图层系统。</li>
      <li>复杂 DAG 工作流编排器。</li>
      <li>跨项目资产库。</li>
      <li>完整视频编辑，只做生成结果预览与下载。</li>
    </ul>
  </>
)

export const canvasMvp: DocsPageContent = {
  slug: 'canvas-mvp',
  toc: [
    { id: 'core-loop', title: '1. 核心闭环', level: 2 },
    { id: 'node-types', title: '2. 节点类型', level: 2 },
    { id: 'ai-ops', title: '3. AI 操作', level: 2 },
    { id: 'node-menu', title: '   3.1 节点菜单与 AI 操作菜单', level: 3 },
    { id: 'panorama', title: '   3.2 360 全景图：保持场景一致性', level: 3 },
    { id: 'tasks', title: '4. 任务与结果', level: 2 },
    { id: 'assets', title: '5. 资产管理', level: 2 },
    { id: 'media-flow', title: '6. 媒体任务链路', level: 2 },
    { id: 'errors', title: '7. 错误处理', level: 2 },
    { id: 'not-in-mvp', title: '8. MVP 不做的事', level: 2 },
  ],
  faq: [
    {
      question: '画布数据存在哪里？',
      answer: '热数据存在 localStorage（毫秒级），每次改动 debounce 500ms 后写入 SQLite 的 canvas_projects + canvas_snapshots。',
    },
    {
      question: '生成的图 / 视频存在哪里？',
      answer: 'userData/.spark-artifacts/media/{images,audio,videos}。',
    },
    {
      question: '画布任务和会话任务有什么区别？',
      answer: '画布任务是 canvas:task:create-media，会话任务是 session:send-turn；前者有 lineage 边，后者没有。',
    },
    {
      question: '可以取消画布任务吗？',
      answer: '可以，节点右键菜单选「取消任务」或 Inspector 顶部的「Cancel」。',
    },
  ],
  quickReference: [
    { key: '项目管理入口', value: '项目管理页 → 项目列表 / 新建 / 最近' },
    { key: '节点类型', value: 'image / text / video / task / group / panorama' },
    { key: 'AI 操作', value: '文生图 / 图生图 / 编辑 / 多图合成 / 文本生成 / 图生视频 / 九宫格' },
    { key: '产物目录', value: '.spark-artifacts/media/{images,audio,videos}' },
    { key: '持久化', value: 'SQLite canvas_projects + canvas_snapshots（migration 027）' },
    { key: '安全协议', value: 'safe-file://x/<base64>（CSP 允许 media-src safe-file:）' },
  ],
  howTo: {
    name: '用 Spark Agent 无限画布完成一次文生图迭代',
    description: '从空画布到生成第一个图像节点',
    totalTime: 'PT5M',
    steps: [
      '进入「项目管理」页，点「新建画布项目」并命名',
      '进入项目画布，按 N 新建一个文本节点，写入 Prompt',
      '选中文本节点，从顶部 AI 操作选「文生图」',
      '在右侧参数面板选 Provider / 模型 / 尺寸，点「生成」',
      '画布产生一个 running 任务节点；完成后自动产出 image 节点并建立 lineage 边',
    ],
  },
  aiSummary:
    'Spark Agent 无限画布（Infinite Canvas）核心：项目管理页 + 节点画布，节点类型（image / text / video / task / group / panorama），' +
    'AI 操作（文生图 / 图生图 / 编辑 / 多图合成 / 文本生成 / 图生视频 / 九宫格），任务状态机（pending/running/completed/failed/cancelled）与 lineage 边，' +
    '资产管理（按类型/状态/关键词筛选）。媒体任务链路：localStorage 热存储 + 500ms debounce 的 canvas:snapshot:save 写入 SQLite（canvas_projects + canvas_snapshots），' +
    '.spark-artifacts/media/{images,audio,videos} 产物，safe-file:// 协议，MediaRouterService + Manifest / APIMart / xAI / Volcengine 适配器，' +
    '统一错误码（provider_not_configured / capability_not_supported / api_key_missing / invalid_input / provider_http_error / task_failed / task_timeout / artifact_download_failed）。',
  Body,
}

export default canvasMvp
