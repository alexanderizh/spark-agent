import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      「任务面板」（BoardView）是 Spark Agent 内的全局任务看板，按状态分列管理任务。
      适合跟踪「需要多步处理、有验收标准、有负责人」的工作项，例如：实现某个功能、跟进一个 PR、处理用户反馈。
    </p>

    <h2 id="open">1. 怎么打开</h2>
    <p>
      在侧边导航栏里点「任务」图标（看板样式），或在主页/会话视图点底部状态栏的「打开面板」按钮。
      也可通过 <code>platform-manager</code> Skill 里的 <code>mcp__spark_platform__board_tasks_*</code> 工具用自然语言操作。
    </p>

    <h2 id="columns">2. 6 个状态列</h2>
    <table>
      <thead>
        <tr><th>状态</th><th>颜色</th><th>含义</th></tr>
      </thead>
      <tbody>
        <tr><td>📋 待办（todo）</td><td>灰</td><td>已规划、未开始</td></tr>
        <tr><td>🔄 进行中（in-progress）</td><td>蓝</td><td>有人 / Agent 正在处理</td></tr>
        <tr><td>🐛 Bug 修复（bug-fix）</td><td>红</td><td>执行失败或发现问题需要修</td></tr>
        <tr><td>✅ 已完成（done）</td><td>绿</td><td>实际工作完成，待验收</td></tr>
        <tr><td>🎯 已验收（accepted）</td><td>紫</td><td>负责人已确认结果，符合验收标准</td></tr>
        <tr><td>📦 已关闭（closed）</td><td>淡灰</td><td>归档，短期内不再打开</td></tr>
      </tbody>
    </table>
    <p>
      状态流转遵循：<code>todo → in-progress → done → accepted → closed</code>。
      任意阶段可转入 <code>bug-fix</code> 修问题，修完后再回到 <code>in-progress</code> 继续。
    </p>
    <p>
      你可以自定义要显示的列（在看板右上角设置），选择存在 localStorage 里；下次打开自动恢复。
    </p>

    <h2 id="create">3. 创建任务</h2>
    <ol>
      <li>点「+ 新建任务」按钮（或在 todo 列内点空白处）。</li>
      <li>
        填写内联表单（不是弹窗，所有字段一屏展开）：
        <ul>
          <li><strong>标题</strong>：一句话说清楚要做什么。</li>
          <li><strong>描述</strong>：详细背景、上下文、链接。</li>
          <li><strong>优先级</strong>：低 / 中 / 高 / 紧急。</li>
          <li><strong>负责人</strong>（assignee）：人名或 Agent 名。</li>
          <li><strong>处理 Agent</strong>（processingAgent）：实际跑工作的 Agent。</li>
          <li><strong>验收 Agent</strong>（testAgent）：跑验收的 Agent。</li>
          <li><strong>项目</strong>：关联到项目 workspace。</li>
          <li><strong>验收标准</strong>（acceptanceCriteria）：完成的客观条件。</li>
          <li><strong>到期日</strong>（dueDate）：截止时间。</li>
          <li><strong>标签</strong>（tags）：自由文本标签，便于筛选。</li>
          <li><strong>附件</strong>：图片或文件（拖拽上传或选择本地路径）。</li>
        </ul>
      </li>
      <li>点「创建」或回车提交。卡片出现在 todo 列顶端。</li>
    </ol>

    <h2 id="edit">4. 编辑任务</h2>
    <ol>
      <li>点卡片打开「详情 / 编辑」页（不是弹窗，是整页视图）。</li>
      <li>修改任意字段。</li>
      <li>底部有「保存」「删除」「复制」按钮。</li>
    </ol>
    <p>
      也可以在看板视图中点卡片右上角的「编辑」图标快速改标题、负责人、优先级。
    </p>

    <h2 id="drag">5. 拖拽改变状态</h2>
    <ol>
      <li>点住卡片（不是标题，是卡片空白处）拖到目标列。</li>
      <li>松开鼠标 —— 状态自动更新并持久化到 SQLite。</li>
      <li>如果拖到「Bug 修复」列，会弹窗让你填原因（可选）。</li>
    </ol>
    <p>
      拖拽时如果目标列是折叠状态，列会临时展开。卡片顺序在列内自动按 sortOrder 排序。
    </p>

    <h2 id="context">6. 右键菜单</h2>
    <p>在卡片上点右键：</p>
    <ul>
      <li><strong>打开详情</strong>：进入整页编辑视图。</li>
      <li><strong>复制</strong>：基于当前卡片创建新卡片（标题加「(副本)」）。</li>
      <li><strong>删除</strong>：移入回收站（软删除，可在「回收站」Tab 找回）。</li>
      <li><strong>永久删除</strong>：直接从数据库移除。</li>
      <li><strong>移动到…</strong>：快速改变状态。</li>
    </ul>

    <h2 id="comments">7. 评论与协作</h2>
    <p>
      每个 TaskCard 包含 <code>comments</code> 字段（id / taskId / author / content / createdAt）。
      在详情页底部「评论」区域可以添加新评论、删除自己的评论、@ 提到人 / Agent。
      评论支持 Markdown。
    </p>

    <h2 id="attachments">8. 附件</h2>
    <p>
      附件字段（TaskAttachment）支持 image / file 两种类型，存本地路径 + 可选预览。
      上传的图片会显示在卡片正面（缩略图），点击放大查看。
      文件附件可双击用系统默认应用打开。
    </p>

    <h2 id="recycle">9. 回收站</h2>
    <ol>
      <li>在看板顶部切到「回收站」Tab。</li>
      <li>看到所有 <code>deletedAt != null</code> 的卡片。</li>
      <li>可以「恢复」（deletedAt = null） 或「永久删除」。</li>
    </ol>
    <p>
      软删除 30 天后建议永久删除（可在「设置 → 数据」配置清理策略）。
    </p>

    <h2 id="filter">10. 筛选与排序</h2>
    <ul>
      <li>顶部「状态筛选」下拉：只看某一列或全部。</li>
      <li>「负责人筛选」：只看某个人或某个 Agent 的任务。</li>
      <li>「标签筛选」：多选标签，AND / OR 关系可切换。</li>
      <li>「排序」：按创建时间 / 到期日 / 优先级 / sortOrder 排序。</li>
    </ul>
    <p>
      筛选条件存在 localStorage，跨会话保留。
    </p>

    <h2 id="automation">11. 让 Agent 自动操作面板</h2>
    <p>
      通过内置的 <code>platform-manager</code> Skill，Agent 可以调用 MCP 工具操作任务面板：
    </p>
    <pre>{`mcp__spark_platform__board_tasks_list
mcp__spark_platform__board_tasks_get
mcp__spark_platform__board_tasks_create
mcp__spark_platform__board_tasks_update
mcp__spark_platform__board_tasks_delete
mcp__spark_platform__board_tasks_batch_update
mcp__spark_platform__board_tasks_restore
mcp__spark_platform__board_tasks_permanent_delete`}</pre>
    <p>典型场景：</p>
    <ul>
      <li>「帮我把 backlog 里所有 P0 任务的到期日延后一周」</li>
      <li>「完成 PR 审查后，自动把任务从 <code>in-progress</code> 移到 <code>done</code>」</li>
      <li>「按标签 <code>bug</code> 列出所有未关闭任务」</li>
    </ul>

    <h2 id="best-practices">12. 最佳实践</h2>
    <ul>
      <li>
        <strong>标题用动词开头</strong>：「实现 X 功能」/「修复登录报错」/「跟进 Y 反馈」。
      </li>
      <li>
        <strong>验收标准写客观条件</strong>：「CI 全绿 + 关键 e2e 通过」比「没问题」强。
      </li>
      <li>
        <strong>到期日配合优先级</strong>：紧急 + 临近 = 今日必处理；低优先级 + 远期 = 排到下季度。
      </li>
      <li>
        <strong>定期清理回收站</strong>：避免看板数据膨胀。
      </li>
      <li>
        <strong>用标签分组</strong>：模块名 / 类型 / 紧急程度，比硬编码到标题灵活。
      </li>
    </ul>
  </>
)

export const boardView: DocsPageContent = {
  slug: 'board-view',
  toc: [
    { id: 'open', title: '1. 怎么打开', level: 2 },
    { id: 'columns', title: '2. 6 个状态列', level: 2 },
    { id: 'create', title: '3. 创建任务', level: 2 },
    { id: 'edit', title: '4. 编辑任务', level: 2 },
    { id: 'drag', title: '5. 拖拽改变状态', level: 2 },
    { id: 'context', title: '6. 右键菜单', level: 2 },
    { id: 'comments', title: '7. 评论与协作', level: 2 },
    { id: 'attachments', title: '8. 附件', level: 2 },
    { id: 'recycle', title: '9. 回收站', level: 2 },
    { id: 'filter', title: '10. 筛选与排序', level: 2 },
    { id: 'automation', title: '11. 让 Agent 自动操作面板', level: 2 },
    { id: 'best-practices', title: '12. 最佳实践', level: 2 },
  ],
  faq: [
    {
      question: '任务面板和会话有什么区别？',
      answer: '会话是一次对话（有上下文、有 Agent 运行状态），任务是离散的工单（有状态、有验收、有负责人）。一个会话可关联多个任务。',
    },
    {
      question: '能批量改状态吗？',
      answer: '可以。用 platform-manager 的 board_tasks_batch_update，或在看板里多选（点住 Shift / Cmd 多选）拖到目标列。',
    },
    {
      question: '回收站里的任务多久会被永久清理？',
      answer: '默认不自动清理。在「设置 → 数据」可配置清理策略（如 90 天）。',
    },
    {
      question: '任务面板支持多用户协作吗？',
      answer: '当前版本是单用户本地存储。多用户实时协作在路线图里。',
    },
  ],
  quickReference: [
    { key: '状态列', value: 'todo / in-progress / bug-fix / done / accepted / closed（6 列）' },
    { key: '优先级', value: 'low / medium / high / urgent（4 级）' },
    { key: '视图', value: 'kanban / create / edit / recycle' },
    { key: 'TaskCard 字段', value: 'id / title / description / status / priority / assignee / project / tags / dueDate / processingAgent / acceptanceCriteria / testAgent / comments / attachments / sortOrder' },
    { key: '持久化', value: 'SQLite（IPC 同步）' },
    { key: 'Agent 操作', value: 'mcp__spark_platform__board_tasks_*（platform-manager Skill）' },
  ],
  howTo: {
    name: '用 Spark Agent 任务面板跟踪一次功能上线',
    description: '从创建任务到验收关闭的完整流程',
    totalTime: 'PT10M',
    steps: [
      '点「+ 新建任务」创建一张「实现 XX 功能」卡，状态默认 todo',
      '填标题、描述、验收标准、负责人、处理 Agent',
      '点击卡片右侧「编辑」，或拖动到「进行中」列',
      '在工作过程中在评论里同步进展 / 贴 PR 链接',
      '完成后拖到「已完成」列，等负责人在「详情页」点「验收通过」',
      '验收通过后自动移到「已验收」列；最后在合适的时机拖到「已关闭」归档',
      '回收站里可恢复误删的任务，或永久删除',
    ],
  },
  aiSummary:
    'Spark Agent 任务面板（BoardView）使用教程：6 个状态列（todo 待办 / in-progress 进行中 / bug-fix Bug 修复 / done 已完成 / ' +
    'accepted 已验收 / closed 已关闭），4 个优先级（low/medium/high/urgent）。' +
    'TaskCard 字段：id / title / description / status / priority / assignee / project / tags / dueDate / ' +
    'processingAgent / acceptanceCriteria / testAgent / comments / attachments / sortOrder。' +
    '支持内联创建 / 编辑（不是弹窗）、拖拽改变状态、右键菜单（打开详情 / 复制 / 删除 / 移动）、' +
    '软删除（回收站 30 天后清理）、状态/负责人/标签多维筛选。' +
    'Agent 通过 platform-manager Skill 调 mcp__spark_platform__board_tasks_* 工具（list / get / create / update / ' +
    'delete / batch_update / restore / permanent_delete）自动操作面板。' +
    '最佳实践：标题用动词开头、验收标准写客观条件、到期日配合优先级、定期清理回收站、用标签灵活分组。' +
    '与「会话」的区别：会话是上下文驱动的对话，任务是离散工单（带状态 / 验收 / 负责人）。',
  Body,
}

export default boardView
