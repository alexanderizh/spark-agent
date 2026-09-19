import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      「任务面板」是 Spark Work 内的全局看板（页面标题写的是「任务看板」）：按状态分列管理离散工单，
      适合「需要多步处理、有验收标准、有执行 Agent」的工作项。任务可以直接派给 Agent 执行， Agent
      完成后按约定回写状态。
    </p>

    <h2 id="open">1. 三个「新建任务」入口，别走错</h2>
    <p>界面上有三处名字很像的入口，行为完全不同：</p>
    <table>
      <thead>
        <tr>
          <th>入口</th>
          <th>真实行为</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>左侧导航最上方的「新建任务」（带消息气泡图标）</td>
          <td>
            <strong>不创建看板任务</strong>：清空当前会话进入一个全新对话。快捷键 Cmd/Ctrl+N 同效
          </td>
        </tr>
        <tr>
          <td>快捷键 Cmd/Ctrl+B「快捷录入任务」</td>
          <td>
            弹出全局任务快捷录入浮窗（浮窗标题也叫「新建任务」）：填正文、可粘贴图片、选项目 /
            优先级 / 处理 Agent / 日期，按钮为「创建任务」和「创建并执行」
          </td>
        </tr>
        <tr>
          <td>看板页右上角「新建任务」</td>
          <td>
            进入整页创建表单（<code>task-form-page</code>，不是弹窗），字段最全
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      看板本身的入口是左侧导航里的「任务面板」（<code>nav.board</code>）。从任务卡片还可以
      「立即执行」或右键「立即执行」，直接把它派给 Agent。
    </p>

    <h2 id="columns">2. 状态列：6 个枚举，默认只显示 4 列</h2>
    <p>状态枚举是固定六项，列的固定顺序如下（这个顺序也是筛选下拉里的顺序）：</p>
    <table>
      <thead>
        <tr>
          <th>顺序</th>
          <th>状态键</th>
          <th>列名</th>
          <th>颜色</th>
          <th>默认可见</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>1</td>
          <td>
            <code>todo</code>
          </td>
          <td>📋 待办</td>
          <td>
            灰 <code>#6b7280</code>
          </td>
          <td>是</td>
        </tr>
        <tr>
          <td>2</td>
          <td>
            <code>in-progress</code>
          </td>
          <td>🔄 进行中</td>
          <td>
            蓝 <code>#3b82f6</code>
          </td>
          <td>是</td>
        </tr>
        <tr>
          <td>3</td>
          <td>
            <code>bug-fix</code>
          </td>
          <td>🐛 Bug 修复</td>
          <td>
            红 <code>#ef4444</code>
          </td>
          <td>否</td>
        </tr>
        <tr>
          <td>4</td>
          <td>
            <code>done</code>
          </td>
          <td>✅ 已完成</td>
          <td>
            绿 <code>#10b981</code>
          </td>
          <td>是</td>
        </tr>
        <tr>
          <td>5</td>
          <td>
            <code>accepted</code>
          </td>
          <td>🎯 已验收</td>
          <td>
            紫 <code>#8b5cf6</code>
          </td>
          <td>否</td>
        </tr>
        <tr>
          <td>6</td>
          <td>
            <code>closed</code>
          </td>
          <td>📦 已关闭</td>
          <td>
            浅灰 <code>#9ca3af</code>
          </td>
          <td>是</td>
        </tr>
      </tbody>
    </table>
    <p>
      默认可见列是 <code>todo / in-progress / done / closed</code> 四列——<code>bug-fix</code> 与{' '}
      <code>accepted</code> 默认<strong>隐藏</strong>，所以在看板上「看不到 Bug 修复列」是正常的：
      点工具栏的「面板」按钮，在弹出面板里勾选（或点「全选」）即可显示。选择结果存在{' '}
      <code>localStorage</code> 的 <code>board-visible-columns</code> 键下，下次打开自动恢复。
    </p>
    <p>
      状态枚举不可自定义（不能加新列），但可以隐藏。列内卡片按 <code>sortOrder</code> 升序排列。
    </p>

    <h2 id="create">3. 创建任务：整页表单，项目和标题必填</h2>
    <p>
      创建 / 编辑都是<strong>整页视图</strong>（左侧有「返回看板」）。表单字段与真实约束：
    </p>
    <table>
      <thead>
        <tr>
          <th>字段</th>
          <th>说明</th>
          <th>必填</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>项目</td>
          <td>决定任务派发时用哪个工作区（下拉来自工作区列表）</td>
          <td>
            <strong>必填</strong>：未选项目时「创建任务」「立即执行」都是禁用状态
          </td>
        </tr>
        <tr>
          <td>标题</td>
          <td>一句话说清做什么</td>
          <td>
            <strong>必填</strong>
          </td>
        </tr>
        <tr>
          <td>描述</td>
          <td>
            详细背景与上下文；在描述框里 <code>Ctrl/Cmd+V</code> 可直接粘贴图片成为附件
          </td>
          <td>可选</td>
        </tr>
        <tr>
          <td>附件</td>
          <td>「上传图片/文件」可选多个文件；粘贴的图片走图片附件路径，可预览、可逐个移除</td>
          <td>可选</td>
        </tr>
        <tr>
          <td>状态</td>
          <td>
            六个状态任选，默认 <code>todo</code>
          </td>
          <td>有默认值</td>
        </tr>
        <tr>
          <td>优先级</td>
          <td>
            <code>low</code> 低 / <code>medium</code> 中（默认）/ <code>high</code> 高 /{' '}
            <code>urgent</code> 紧急
          </td>
          <td>有默认值</td>
        </tr>
        <tr>
          <td>负责人</td>
          <td>下拉自 Agent 列表，可搜索、可清空（是给人看的归属字段）</td>
          <td>可选</td>
        </tr>
        <tr>
          <td>截止日期</td>
          <td>日期选择器；过期且未完成时卡片上会标红</td>
          <td>可选</td>
        </tr>
        <tr>
          <td>处理 Agent</td>
          <td>
            真正执行任务的 Agent；选项来自 Agent 列表 + 团队定义（团队显示为{' '}
            <code>[团队] 名称</code>，值形如 <code>team:名称</code>）
          </td>
          <td>可选，但「立即执行」需要能解析出 Agent</td>
        </tr>
        <tr>
          <td>测试 Agent</td>
          <td>负责验收的 Agent，同样支持团队</td>
          <td>可选</td>
        </tr>
        <tr>
          <td>验收条件</td>
          <td>完成的客观标准，会随任务一起写进派发提示词</td>
          <td>可选</td>
        </tr>
        <tr>
          <td>标签</td>
          <td>
            逗号分隔的多个标签，卡片上最多显示 3 个（多出的显示 <code>+N</code>）
          </td>
          <td>可选</td>
        </tr>
      </tbody>
    </table>
    <p>
      快捷键：<code>Ctrl/Cmd+Enter</code> 提交，<code>Esc</code> 返回看板。创建成功后卡片按{' '}
      <code>sortOrder</code> 落在对应列（新任务默认在同列末尾，步长 100）。
    </p>

    <h2 id="run">4. 派给 Agent：立即执行与自动执行</h2>
    <p>
      <strong>立即执行</strong>（表单顶部按钮，或卡片右键菜单）会做四件事：把任务状态改成{' '}
      <code>in-progress</code>；用任务内容拼一段提示词（标题、描述、验收条件、处理 Agent、测试
      Agent， 以及附件摘要，附件会作为会话附件一起发出）；创建一个标题为{' '}
      <code>[📋] &lt;任务标题&gt;</code> 的新会话并发起一轮对话；然后跳到对话视图。
    </p>
    <p>
      派发提示词里明确要求 Agent 收尾时调用平台工具 <code>mcp__spark_platform__board_update</code>{' '}
      回写状态：全部完成写 <code>&#123; id, status: "done" &#125;</code>，遇到无法解决的问题写{' '}
      <code>&#123; id, status: "bug-fix" &#125;</code>。
    </p>
    <p>工具栏上的「自动执行」开关是另一套机制，规则如下：</p>
    <ul>
      <li>
        最多并行 <strong>2</strong> 个 <code>todo</code> 任务；完成一个就补下一个。
      </li>
      <li>
        每秒不轮询：以 1 分钟为兜底周期，另外订阅会话终态事件提前唤醒（唤醒前防抖 1.5 秒，留给 Agent
        落最后一次状态回写）。
      </li>
      <li>
        会话结束 8 秒后任务仍是 <code>in-progress</code>，判定为「被中断」，自动重派。
      </li>
      <li>
        会话持续运行超过 <strong>45 分钟</strong> 视为卡死：取消会话后重派。
      </li>
      <li>
        同一个任务最多重派 <strong>2</strong> 次，之后不再重试，留在 <code>bug-fix</code>{' '}
        交给人处理。
      </li>
      <li>
        <code>done</code> / <code>accepted</code> / <code>closed</code> / <code>bug-fix</code>{' '}
        都算「已完成」，自动执行不会再动它——包括尊重 Agent 自己给出的失败判定。
      </li>
      <li>关闭开关只停止派发新任务与重启中断任务，已经在跑的会话任其跑完。</li>
    </ul>

    <h2 id="drag">5. 拖拽改状态与排序</h2>
    <ol>
      <li>按住卡片拖到目标列（拖拽时卡片会带半透明效果，落点有插入指示线）。</li>
      <li>松手后立即乐观更新界面，同时通过 IPC 持久化单个任务。</li>
      <li>
        拖到列内两张卡片之间 = 列内排序：新 <code>sortOrder</code> 取相邻两条的中点；拖到列的空白处
        = 放到末尾。
      </li>
      <li>
        如果中点导致相邻间距小于 2，会自动把该列整列重排为 <code>0, 100, 200, …</code>
        ，避免精度耗尽。
      </li>
    </ol>
    <p>
      不支持多选拖拽：进入选择模式后卡片不再可拖（选择模式只提供批量删除与导出）。 也没有「拖到 Bug
      修复列时填写原因」这类弹窗。
    </p>

    <h2 id="context">6. 右键菜单与卡片上的操作</h2>
    <p>卡片右键只有四项：</p>
    <ul>
      <li>
        <strong>打开详情</strong>：进入整页编辑视图。
      </li>
      <li>
        <strong>立即执行</strong>：派给 Agent（同第 4 节）。
      </li>
      <li>
        <strong>复制任务</strong>：按当前卡片内容新建一条，标题追加 <code> (副本)</code>。
      </li>
      <li>
        <strong>删除</strong>：软删除（弹确认框，说明「任务将移至回收站，可以恢复」）。
      </li>
    </ul>
    <p>
      卡片正面还会显示：优先级徽标、标签数、项目名、描述、最多 2 张图片缩略图（多出的显示{' '}
      <code>+N</code>）、文件数、负责人头像与名字、评论数、图片/文件数、截止日期（过期标红）、
      状态色点。当状态是 <code>done</code> 时，卡片右下会出现 <strong>🎯 验收</strong> 按钮，
      点一下直接把状态改成 <code>accepted</code>——这是「已验收」列唯一的来源。
    </p>
    <p>菜单里没有「永久删除」和「移动到…」；要永久删除请去回收站，要改状态请拖拽或改表单。</p>

    <h2 id="comments">7. 评论与附件</h2>
    <p>
      评论字段为 <code>comments</code>，每条包含{' '}
      <code>id / taskId / author / content / createdAt</code>。 评论区只出现在
      <strong>编辑态</strong>（创建表单里没有）。可以新增、编辑、删除评论
      （删除前有确认框），输入框提示「输入评论…（Ctrl+Enter 发送）」，作者为空时显示为「用户」。
      评论正文是<strong>纯文本渲染</strong>：不解析 Markdown，也没有 @ 提及功能。
    </p>
    <p>
      附件字段为 <code>attachments</code>，每项含{' '}
      <code>id / type（image | file）/ name / path / previewPath?</code>。 图片经主进程的粘贴 /
      预处理通道落到看板附件目录，界面通过安全文件协议读取；
      文件附件记录绝对路径。卡片正面只展示最多 2
      张缩略图与数量（缩略图本身不弹预览，点卡片进入详情）；在创建 / 编辑页里点图片会打开预览浮层。
    </p>

    <h2 id="recycle">8. 回收站与永久删除</h2>
    <ul>
      <li>
        删除是软删除：写入 <code>deletedAt</code> 时间戳，卡片立刻从看板消失。
      </li>
      <li>
        工具栏右侧的「回收站」按钮打开回收站面板，列出 <code>deletedAt</code>{' '}
        非空的全部任务，显示「删除于 &lt;时间&gt;」。
      </li>
      <li>
        回收站里可以「恢复」（清空 <code>deletedAt</code>
        ）或「彻底删除」（确认后从存储中移除，并顺带清理该任务的附件文件）。
      </li>
      <li>
        <strong>没有自动清理</strong>：不存在「30
        天后自动删除」这类策略，也没有对应的设置项。回收站会一直保留到你自己处理。
      </li>
    </ul>

    <h2 id="filter">9. 筛选、搜索与导入导出</h2>
    <ul>
      <li>
        <strong>搜索框</strong>：前端匹配标题、描述、负责人、项目、标签（子串、大小写不敏感），
        覆盖的范围比筛选下拉更广。
      </li>
      <li>
        <strong>筛选下拉</strong>：只有三个维度——优先级、状态、项目（项目下拉来自工作区列表，
        且会排除「不使用项目」）。条件生效时筛选按钮上会显示一个小圆点。
      </li>
      <li>
        <strong>没有</strong>负责人筛选、标签筛选、排序方式切换；列内顺序固定按{' '}
        <code>sortOrder</code>。
      </li>
      <li>
        <strong>持久化范围</strong>：只有「显示哪些列」写进 <code>localStorage</code>；
        搜索词与筛选条件都是组件状态，切换视图或刷新后会重置。
      </li>
      <li>
        <strong>导入导出</strong>：「导入导出」下拉里有「导入任务」「导出全部任务」「选择导出…」。
        导出的是 JSON（含 <code>version</code>、<code>exportedAt</code> 与任务数组，
        只导出未删除的任务，且<strong>不含评论与附件</strong>，默认文件名{' '}
        <code>tasks-YYYY-MM-DD.json</code>）；
        选择导出会进入选择模式，可「全选当前筛选结果」「导出选中」「删除选中」（批量软删）。
        导入时选一个 JSON，校验结构后按状态批量建卡（未知状态会被计数并回落到待办）。
      </li>
    </ul>

    <h2 id="storage">10. 数据存在哪、有哪些字段</h2>
    <p>
      <strong>持久化位置</strong>：任务不是存在 SQLite 里，而是主进程维护的本地 JSON 文件{' '}
      <code>~/.spark-agent/board-tasks.json</code>（附件在{' '}
      <code>~/.spark-agent/board-attachments/</code>）。 渲染层通过 <code>board:*</code> IPC
      通道读写，写入前会做自愈处理（清理指向不存在文件的附件）。 因为是单机单文件，任务面板
      <strong>没有多用户实时协作</strong>，也不会在多台设备间同步。
    </p>
    <p>
      一条任务（<code>BoardTask</code> / <code>TaskCard</code>）的完整字段：
    </p>
    <table>
      <thead>
        <tr>
          <th>字段</th>
          <th>类型</th>
          <th>说明</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>id</code>
          </td>
          <td>string</td>
          <td>任务 ID（新建时生成，Agent 回写状态要用它）</td>
        </tr>
        <tr>
          <td>
            <code>title</code>
          </td>
          <td>string</td>
          <td>标题</td>
        </tr>
        <tr>
          <td>
            <code>description</code>
          </td>
          <td>string</td>
          <td>描述</td>
        </tr>
        <tr>
          <td>
            <code>status</code>
          </td>
          <td>
            <code>BoardTaskStatus</code>
          </td>
          <td>
            <code>todo</code> / <code>in-progress</code> / <code>done</code> / <code>accepted</code>{' '}
            / <code>closed</code> / <code>bug-fix</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>priority</code>
          </td>
          <td>
            <code>BoardTaskPriority</code>
          </td>
          <td>
            <code>low</code> / <code>medium</code> / <code>high</code> / <code>urgent</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>assignee</code>
          </td>
          <td>string</td>
          <td>负责人（人名或 Agent 名）</td>
        </tr>
        <tr>
          <td>
            <code>project</code>
          </td>
          <td>string</td>
          <td>项目名（存储值经 ProjectSelect 归一）</td>
        </tr>
        <tr>
          <td>
            <code>tags</code>
          </td>
          <td>string[]</td>
          <td>标签</td>
        </tr>
        <tr>
          <td>
            <code>dueDate</code>
          </td>
          <td>string</td>
          <td>截止日期</td>
        </tr>
        <tr>
          <td>
            <code>processingAgent</code>
          </td>
          <td>string</td>
          <td>
            处理 Agent（或 <code>team:名称</code>）
          </td>
        </tr>
        <tr>
          <td>
            <code>acceptanceCriteria</code>
          </td>
          <td>string</td>
          <td>验收条件</td>
        </tr>
        <tr>
          <td>
            <code>testAgent</code>
          </td>
          <td>string</td>
          <td>测试 / 验收 Agent</td>
        </tr>
        <tr>
          <td>
            <code>comments</code>
          </td>
          <td>
            <code>BoardComment[]</code>
          </td>
          <td>
            <code>id / taskId / author / content / createdAt</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>attachments</code>
          </td>
          <td>
            <code>BoardTaskAttachment[]</code>
          </td>
          <td>
            <code>id / type / name / path / previewPath?</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>sortOrder</code>
          </td>
          <td>number</td>
          <td>列内排序权重，步长 100</td>
        </tr>
        <tr>
          <td>
            <code>createdAt</code> / <code>updatedAt</code>
          </td>
          <td>string</td>
          <td>ISO 时间戳</td>
        </tr>
        <tr>
          <td>
            <code>deletedAt</code>
          </td>
          <td>string | null</td>
          <td>非空表示在回收站</td>
        </tr>
      </tbody>
    </table>

    <h2 id="automation">11. 让 Agent 操作看板（真实工具名）</h2>
    <p>
      内置技能 <code>builtin:platform-manager</code> 提供 10 个看板工具，命名空间是{' '}
      <code>mcp__spark_platform__</code>（注意工具名是 <code>board_*</code>，不是{' '}
      <code>board_tasks_*</code>）：
    </p>
    <table>
      <thead>
        <tr>
          <th>工具</th>
          <th>关键参数</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>board_list</code>
          </td>
          <td>
            <code>status</code> / <code>priority</code> / <code>assignee</code>（模糊）/{' '}
            <code>project</code>（精确）/ <code>query</code> / <code>includeDeleted</code>（默认
            false）
          </td>
        </tr>
        <tr>
          <td>
            <code>board_get</code>
          </td>
          <td>
            <code>id</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>board_create</code>
          </td>
          <td>
            <code>title</code>（必填）+ 描述、状态、优先级、负责人、项目、标签、截止日期、处理
            Agent、验收条件、测试 Agent、附件、<code>sortOrder</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>board_update</code>
          </td>
          <td>
            <code>id</code> + 要改的字段（附件是整体替换语义）
          </td>
        </tr>
        <tr>
          <td>
            <code>board_delete</code>
          </td>
          <td>
            <code>id</code>（软删除，进回收站）
          </td>
        </tr>
        <tr>
          <td>
            <code>board_batch_create</code> / <code>board_batch_update</code> /{' '}
            <code>board_batch_delete</code>
          </td>
          <td>
            数组形式；批量更新每项包含 <code>id</code> 与要改的字段；批量删除传 <code>ids</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>board_restore</code>
          </td>
          <td>
            <code>id</code>（从回收站恢复）
          </td>
        </tr>
        <tr>
          <td>
            <code>board_permanent_delete</code>
          </td>
          <td>
            <code>id</code>（不可恢复；工具描述里要求先向用户确认）
          </td>
        </tr>
      </tbody>
    </table>
    <p>典型用法：</p>
    <ul>
      <li>
        「列出所有 <code>bug-fix</code> 状态的任务，按优先级排一下」
      </li>
      <li>
        「把 backlog 里 P0 任务的截止日期推迟一周」（<code>board_list</code> +{' '}
        <code>board_batch_update</code>）
      </li>
      <li>「把这条任务标记成 done，并补一句验收条件」</li>
    </ul>
    <p>
      注意：<strong>没有</strong>评论相关的平台工具（<code>board_comment_*</code> 不存在）， Agent
      只能改任务本体字段，评论要在界面上写。
    </p>

    <h2 id="best-practices">12. 最佳实践</h2>
    <ul>
      <li>
        <strong>标题写动词短语</strong>：「实现 X」「修复登录报错」「跟进 Y 反馈」，便于搜索与扫读。
      </li>
      <li>
        <strong>验收条件写客观可判定项</strong>：「CI 全绿 + 关键 e2e
        通过」远好于「没问题」。它会随派发提示词一起给到 Agent。
      </li>
      <li>
        <strong>项目字段别省</strong>：它决定任务派发到哪个工作区；没选项目连创建按钮都是禁用的。
      </li>
      <li>
        <strong>一次执行一条主任务</strong>：自动执行最多并行 2 条，任务太小会让 Agent
        频繁起会话，太大又会撞上 45 分钟的卡死判定。
      </li>
      <li>
        <strong>
          失败任务留在 <code>bug-fix</code>
        </strong>
        ：自动执行会尊重这个判定、不再重派，适合放人工介入的队列。
      </li>
      <li>
        <strong>定期清回收站</strong>：没有自动清理策略，长期不处理会一直占着 JSON 文件与附件目录。
      </li>
      <li>
        <strong>用标签而不是把信息糊进标题</strong>：模块名 / 类型 /
        紧急度都可以做标签，卡片上会显示前 3 个。
      </li>
    </ul>
  </>
)

export const boardView: DocsPageContent = {
  slug: 'board-view',
  toc: [
    { id: 'open', title: '1. 三个「新建任务」入口，别走错', level: 2 },
    { id: 'columns', title: '2. 状态列：6 个枚举，默认只显示 4 列', level: 2 },
    { id: 'create', title: '3. 创建任务：整页表单', level: 2 },
    { id: 'run', title: '4. 派给 Agent：立即执行与自动执行', level: 2 },
    { id: 'drag', title: '5. 拖拽改状态与排序', level: 2 },
    { id: 'context', title: '6. 右键菜单与卡片上的操作', level: 2 },
    { id: 'comments', title: '7. 评论与附件', level: 2 },
    { id: 'recycle', title: '8. 回收站与永久删除', level: 2 },
    { id: 'filter', title: '9. 筛选、搜索与导入导出', level: 2 },
    { id: 'storage', title: '10. 数据存在哪、有哪些字段', level: 2 },
    { id: 'automation', title: '11. 让 Agent 操作看板（真实工具名）', level: 2 },
    { id: 'best-practices', title: '12. 最佳实践', level: 2 },
  ],
  faq: [
    {
      question: '为什么我看不到「Bug 修复」和「已验收」列？',
      answer:
        '这两列默认隐藏。默认可见列只有 todo / in-progress / done / closed 四列，点工具栏的「面板」按钮勾选 bug-fix 与 accepted（或点「全选」）就会显示，选择存在 localStorage 的 board-visible-columns 里。',
    },
    {
      question: '侧栏的「新建任务」为什么没给我建看板任务？',
      answer:
        '侧栏「新建任务」（以及 Cmd/Ctrl+N）的行为是开一个全新对话，不是建任务。要建看板任务：用 Cmd/Ctrl+B 调出快捷录入浮窗，或到看板页点右上角「新建任务」打开完整表单。',
    },
    {
      question: '能批量改状态吗？',
      answer:
        '看板界面上不能——选择模式只提供批量删除和导出，任务卡也不能多选拖拽。让 Agent 调 mcp__spark_platform__board_batch_update 可以按 id 数组批量改（每项包含 id 与要改的字段）。',
    },
    {
      question: '回收站里的任务会自动清理吗？',
      answer:
        '不会。没有自动清理策略，也没有相关设置项；任务会一直留在回收站，直到你手动点「彻底删除」（会同时清理该任务的附件文件）。',
    },
    {
      question: '任务面板支持多用户协作吗？',
      answer:
        '不支持。任务是单机存储的（~/.spark-agent/board-tasks.json），没有账号体系与实时同步，多台设备之间不共享。',
    },
    {
      question: '「立即执行」之后任务会自己变成已完成吗？',
      answer:
        '不会自动完成。派发提示词要求 Agent 收尾时调用 mcp__spark_platform__board_update 把状态写成 done 或 bug-fix；自动执行开关只负责在会话中断 / 卡死时重派。done 之后还需要人在卡片上点 🎯 验收 才会进入已验收。',
    },
  ],
  quickReference: [
    {
      key: '状态枚举',
      value: 'todo / in-progress / bug-fix / done / accepted / closed（列顺序同此）',
    },
    { key: '默认可见列', value: 'todo / in-progress / done / closed（另两列需在「面板」里勾选）' },
    { key: '列可见性存储', value: 'localStorage 键 board-visible-columns' },
    { key: '优先级', value: 'low / medium（默认）/ high / urgent' },
    {
      key: '持久化',
      value: '~/.spark-agent/board-tasks.json（不是 SQLite）+ ~/.spark-agent/board-attachments/',
    },
    { key: '必填字段', value: 'title 与 project（未选项目时创建按钮禁用）' },
    {
      key: '任务字段',
      value:
        'id / title / description / status / priority / assignee / project / tags / dueDate / processingAgent / acceptanceCriteria / testAgent / comments / attachments / sortOrder / createdAt / updatedAt / deletedAt',
    },
    { key: '自动执行', value: '并行上限 2；兜底轮询 1 分钟；45 分钟判卡死；最多重派 2 次' },
    { key: '快捷录入', value: 'Cmd/Ctrl+B（浮窗，可「创建并执行」）' },
    {
      key: 'Agent 工具',
      value:
        'mcp__spark_platform__board_list / get / create / update / delete / batch_create / batch_update / batch_delete / restore / permanent_delete',
    },
    { key: '评论', value: '只在编辑态可见；纯文本；Ctrl+Enter 发送；无 @ 提及' },
    { key: '回收站', value: '软删除（deletedAt）+ 手动恢复/彻底删除，无自动清理' },
  ],
  howTo: {
    name: '用任务面板跟踪一次功能上线',
    description: '从建卡到派发、验收、归档',
    totalTime: 'PT10M',
    steps: [
      '左侧导航点「任务面板」进入看板',
      '点右上角「新建任务」，先选项目，再填标题、描述与验收条件',
      '选处理 Agent（可选测试 Agent），设置优先级与截止日期，需要时在描述框 Ctrl+V 粘贴图片',
      'Ctrl/Cmd+Enter 保存，卡片落在 todo 列',
      '右键卡片「立即执行」（或打开「自动执行」开关让待办任务自动排队），任务转为 in-progress 并开始跑',
      '过程中在编辑页底部评论区同步进展、贴链接',
      'Agent 把状态回写成 done 或 bug-fix；done 的卡片会出现 🎯 验收 按钮',
      '确认结果符合验收条件后点「验收」，任务进入已验收列；不再需要时拖到已关闭列归档',
      '误删的任务可在工具栏「回收站」里恢复或彻底删除',
    ],
  },
  aiSummary:
    'Spark Work 任务面板（BoardView）实测说明：状态枚举固定 6 个（todo / in-progress / bug-fix / done / accepted / closed，列顺序同此），' +
    '默认只显示 todo / in-progress / done / closed 四列，列可见性存在 localStorage 的 board-visible-columns。' +
    '任务字段为 id / title / description / status / priority / assignee / project / tags / dueDate / processingAgent / acceptanceCriteria / ' +
    'testAgent / comments / attachments / sortOrder / createdAt / updatedAt / deletedAt；创建与编辑是整页表单，title 与 project 必填。' +
    '「立即执行」会创建 [📋] 标题的会话、把状态改成 in-progress，并要求 Agent 用 mcp__spark_platform__board_update 回写 done 或 bug-fix；' +
    '自动执行最多并行 2 条、1 分钟兜底轮询、45 分钟判卡死、最多重派 2 次。拖拽改状态并按相邻 sortOrder 中点重排序（间距 < 2 时整列重排）。' +
    '右键菜单只有打开详情 / 立即执行 / 复制任务 / 删除；评论只在编辑态、纯文本、无 @ 提及。' +
    '删除是软删除（deletedAt），回收站可恢复或彻底删除，没有自动清理策略。' +
    '数据存 ~/.spark-agent/board-tasks.json（不是 SQLite），附件在 ~/.spark-agent/board-attachments/，单机无多用户协作。' +
    'Agent 侧有 10 个 board_* 平台工具（list/get/create/update/delete/batch_create/batch_update/batch_delete/restore/permanent_delete），没有评论工具。',
  Body,
}

export default boardView
