import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      Spark Work 的代码开发面把 Agent 放进你真实的项目里：读你的仓库、改文件、跑命令、接受审批、
      产出可逐文件审查的 diff。这一页按你实际会走的顺序讲清楚每一步的入口、字段和限制，
      所有描述都对应应用里的真实界面。
    </p>

    <h2 id="workspace">1. 添加项目与工作区</h2>
    <p>
      代码工作以「项目（Project）」为单位，一个项目对应一个本地目录。 入口在会话侧边栏的{' '}
      <strong>「添加项目」</strong>（项目分组工具栏上的加号）：
    </p>
    <ol>
      <li>点「添加项目」，弹出创建对话框。</li>
      <li>
        填 <strong>项目名称</strong>（例如 <code>Spark-Agent</code>）。
      </li>
      <li>
        设置 <strong>项目位置</strong>：把文件夹拖进虚线区域，或点按钮选择本地文件夹。
        该目录会登记为一个工作区（workspace）。
      </li>
      <li>点「创建项目」。之后在项目分组上点加号可以「新建此项目的会话」。</li>
    </ol>
    <p>
      项目菜单里还有「打开项目」（把项目送进代码面板并展开文件树）、
      「在文件夹中打开」（调系统文件管理器）、重命名、归档、删除。
      工作区列表只把普通项目作为分组展示，隔离 worktree 不单独成组，它的会话归并回所属项目。
    </p>
    <p>
      <strong>Git 状态在哪里看</strong>：会话顶栏右侧的 Git 入口展开后是 Git 环境浮层，
      包含分支行（在 worktree 里会点亮并标 <code>worktree</code>）、<code>+/-</code> 行数统计，
      以及「提交或推送」入口；输入区底部另有一个分支选择器可以直接切分支。 右侧{' '}
      <strong>会话检查器</strong> 的「Worktree」区块能看到各 worktree 的分支与 HEAD 短 SHA。 不是
      Git 仓库时，分支选择器和 worktree 开关都会自动隐藏或置灰，并给出原因 （「当前项目不是 Git
      仓库」/「Git 运行环境不可用，请在设置 → 完整性中重新检测」）。
    </p>

    <h2 id="branch">2. 分支与 Worktree 隔离</h2>
    <p>
      先说结论：Spark Work 的 worktree 隔离是<strong>真的 Git worktree</strong>，
      在本地磁盘上新建一个独立工作目录并检出一个新分支，不是「在同一个目录里换个引用」。
    </p>

    <h3 id="branch-picker">2.1 分支选择器</h3>
    <p>输入区底部的分支按钮打开选择器，按三组列出条目：</p>
    <ul>
      <li>
        <strong>本地分支</strong>：点击直接切到该分支。
      </li>
      <li>
        <strong>远程分支</strong>：可检出为本地分支。
      </li>
      <li>
        <strong>标签</strong>：不会直接
        checkout，而是展开「基于该标签创建新分支」，填名字后点「创建并检出」。
      </li>
    </ul>
    <p>
      顶部有搜索框（「搜索分支或标签」），面板里也能直接新建分支（输入「新分支名称」→ 创建并检出）。
      注意：当前工作区的 base 分支已经在主工作树检出，无法在同一个目录里再 checkout 一次，
      想并行就该用下面的 worktree。
    </p>

    <h3 id="worktree-flow">2.2 在隔离 worktree 里跑一次改动</h3>
    <ol>
      <li>
        新建会话（或活跃会话还没有任何消息）时，输入区右下方会出现 <strong>worktree</strong> 开关 ——
        只有 Git 仓库可用，会话一旦有消息就不再显示，因为 worktree 必须在会话产生消息前绑定。
      </li>
      <li>
        勾上它，旁边的输入框可以填分支名（占位提示「留空自动生成」）；
        <strong>留空则自动生成</strong>：主进程优先用你配置的模型把任务描述转成语义化 slug
        （最终分支名形如 <code>spark/add-login-form</code>）；
        没有可用模型或调用失败时，退化为直接用任务文本生成 slug，任务文本为空时用时间戳分支。
      </li>
      <li>发送消息。应用会在主仓库下创建 worktree 并把该会话绑定过去。</li>
    </ol>
    <p>隔离具体发生在这几件事上：</p>
    <ul>
      <li>
        <strong>目录</strong>：worktree 建在主仓库的 <code>.worktrees/&lt;分支 slug&gt;</code>；
        如果仓库本来就有 <code>.claude/worktrees/</code>，则沿用它。 容器目录会被自动写进仓库的{' '}
        <code>.gitignore</code>。
      </li>
      <li>
        <strong>分支</strong>：新建一个分支，base 分支优先取 <code>origin/HEAD</code>， 其次{' '}
        <code>main</code> / <code>master</code>，再退回当前分支。
        如果分支名或目标目录已存在，自动追加 <code>-2</code>、<code>-3</code>。
      </li>
      <li>
        <strong>会话 cwd</strong>：会话以及它的终端都在 worktree 目录里跑，主仓库工作区不被污染。
        但界面的「当前项目」仍然指向主仓库，不切到 worktree。
      </li>
    </ul>

    <h3 id="worktree-panel">2.3 Worktree 面板与 agent 自建 worktree</h3>
    <p>
      入口在右侧 <strong>会话检查器</strong> 里的「Worktree」区块（默认折叠，标题旁显示数量）。
      它列的是 <code>git worktree list</code> 的全部结果——不只 Spark 建的， 也包括其他工具建的
      worktree。每条显示分支名、HEAD 短 SHA、关联会话标题，以及徽标：
      <code>main</code>（主工作树）、<strong>已合并 / 未合并</strong>、<strong>当前</strong>。
    </p>
    <p>每条可用的操作是：</p>
    <ul>
      <li>
        <strong>合并</strong>（仅当前会话所在的 worktree）：它不是一键 merge，
        而是向你当前会话发一条指令，让 Agent 到主仓库目录执行
        <code>git -C &lt;主仓库&gt; merge &lt;分支&gt;</code> 并处理冲突、汇报结果。
      </li>
      <li>
        <strong>打开</strong>：在系统文件管理器里打开该 worktree 目录。
      </li>
      <li>
        <strong>删除</strong>：立即移除 worktree（带 <code>--force</code>），
        并连带删除它检出的分支，没有二次确认弹窗——点之前确认这个分支已经没有要保留的提交。
      </li>
    </ul>
    <p>
      还有一种情况：Agent 自己在会话里跑
      <code>git worktree add</code>，或 Claude 的 <code>EnterWorktree</code> 工具切进了一个
      worktree—— 应用也能感知。它会通过 <code>set_worktree_state</code> 上报（或由运行时事件推断），
      把状态写进会话元数据，侧栏会话条目上会出现 worktree 分支徽标。
    </p>

    <h2 id="terminal">3. 内置终端</h2>
    <p>
      终端是统一侧边面板的一个 tab，入口是对话头部的面板按钮，或从消息里的工具调用直接跳进来。
      底层是真正的 PTY（<code>node-pty</code>；Windows 上用 ConPTY）， 不是模拟的命令回显，所以{' '}
      <code>vim</code>、<code>htop</code>、交互式 REPL 都能用。
    </p>
    <ul>
      <li>
        <strong>多标签</strong>：标签栏右侧的加号「新建终端」；每个标签可重命名
        （标签名旁边打开输入条，回车确认、Esc 取消，上限 80 字符）、可单独关闭，
        进程退出后标签保留并标记 <code>·exited</code>。
      </li>
      <li>
        <strong>未读提示</strong>：非活动标签有新输出时标一个红点，切换标签不会中断后台进程。
      </li>
      <li>
        <strong>终端环境</strong>：<code>TERM=xterm-256color</code>、
        <code>COLORTERM=truecolor</code>、<code>FORCE_COLOR=1</code>，颜色和 ANSI 转义正常。
      </li>
      <li>
        <strong>右键菜单</strong>：复制 / 粘贴 / 清空缓冲区 /
        打开链接等，链接可直接用系统浏览器打开。
      </li>
    </ul>
    <p>
      <strong>shell 是主进程决定的，不能在设置里改</strong>：macOS / Linux 先取
      <code>$SHELL</code>，依次回退 <code>/bin/zsh</code>、<code>/bin/bash</code>、
      <code>/bin/sh</code>； Windows 依次尝试 pwsh → Windows PowerShell → <code>cmd.exe</code>
      。渲染进程不能传 shell 路径。
    </p>
    <div className="docs-callout">
      <strong>别把审批卡和终端搞混</strong>：审批针对的是<strong>Agent 的工具调用</strong>
      （它要写文件、跑命令、访问网络时先问你要不要放行），不是针对你自己在终端里敲的命令。
      你自己在终端里执行的操作，按你的系统权限和 shell 能力直接生效。
      <br />
      高风险命令不会因为「看起来危险」就被自动拦下——真正生效的是 Agent 侧的权限模式 和「设置 →
      权限策略」里的规则。
    </div>

    <h2 id="review">4. 审查 AI 改动</h2>
    <p>审查分事前和事后两层，两层都要用。</p>
    <p>
      <strong>事前：审批卡</strong>。Agent 每次要执行有副作用的工具时，输入区上方弹出审批卡，
      显示工具名、参数摘要、所属会话和风险等级（低 / 中 / 高），四个按钮：
      <strong>拒绝</strong>、<strong>会话拒绝</strong>、<strong>会话允许</strong>、
      <strong>允许</strong>； 按 <code>Esc</code> 等于拒绝。长时间无响应会自动拒绝并让 Agent
      跳过该操作。
      不想每步都点，就把权限模式调成「自动编辑」或「自动审批」——但破坏性操作仍建议留在手动档。
    </p>
    <p>
      <strong>事后：审查面板</strong>。侧边面板里的 <strong>「审查」</strong> tab （标题是 Git
      Review）展示当前工作区的完整变更：
    </p>
    <ul>
      <li>
        顶部是分支对照 chip（当前分支 → 对比目标）与统计：文件数、<code>+行数</code>、
        <code>-行数</code>。
      </li>
      <li>
        每个文件一行，带类型徽标、目录 / 文件名、暂存状态（已暂存 / 未暂存 / 未跟踪）与行数增减。
      </li>
      <li>点文件行展开逐 hunk 的 diff 正文；右侧可切出独立文件结构面板，方便在大量改动里定位。</li>
      <li>文件行上有「在编辑器中打开并编辑（diff 视图）」，可以直接跳进代码面板改。</li>
      <li>改动范围包含已提交的改动和未提交的改动，不只是暂存区。</li>
    </ul>
    <p>
      如果远端是 GitHub，面板顶部还会出现 <strong>「查看 Pull Request」</strong> 按钮——
      它打开的是该分支的 GitHub compare 页面，不是已经创建的 PR（详见第 5 节）。
    </p>

    <h3 id="checkpoint">4.1 代码还原点</h3>
    <p>
      还原点是「改坏了能回去」的兜底。入口在右侧 <strong>会话检查器</strong> 的
      「代码还原点」区块，点「打开时间线」打开抽屉。它只在 Git 仓库可用 （非 Git
      仓库时这个区块直接不显示）；在抽屉里打开开关后， 每轮开始前会按需记录当前已跟踪文件的状态。
    </p>
    <ul>
      <li>
        快照用临时 index（<code>add -A</code> + <code>write-tree</code> + <code>commit-tree</code>
        ）生成提交对象， 存到 <code>refs/spark/checkpoints/&lt;会话&gt;/&lt;id&gt;</code>
        ，按会话隔离，不会进你的 Git 历史。
      </li>
      <li>
        因为走的是 Git 对象，
        <strong>
          天然尊重 <code>.gitignore</code>
        </strong>
        ：<code>node_modules</code>、构建产物不会被记进去。
      </li>
      <li>工作区相对上一个检查点没有变化时不会新建，避免堆积。</li>
      <li>
        还原是<strong>文件级覆盖</strong>（<code>git restore --source=&lt;ref&gt; --worktree</code>
        ）： 只回退检查点里记录过的文件，<strong>不会删除</strong>检查点之后新建的文件，也不会改动
        Git 历史。
      </li>
      <li>时间线上可以展开看受影响的文件清单，点「回到这一步」并二次确认后执行。</li>
    </ul>

    <h2 id="pr">5. 提交、推送与 PR</h2>
    <p>
      改完之后的动作在两个地方：会话顶栏的 Git 环境浮层（分支行 / <code>+行数</code>
      <code>-行数</code> / 「提交或推送」入口），以及代码面板里的 Git 面板 （已暂存 / 更改 / Stash /
      提交历史四段）。提交对话框里的动作是：
    </p>
    <ul>
      <li>
        <strong>提交</strong>：填提交信息，留空会自动生成；提交范围可选「全部」或手动圈定文件清单。
      </li>
      <li>
        <strong>提交并推送</strong>：一次完成两步，按钮上会分别标出「待提交 N」「待推送 N」。
      </li>
      <li>
        <strong>推送</strong>：仅推送已有提交。
      </li>
      <li>
        代码面板的 Git 面板里还有提交历史、单文件历史、Stash 等常规操作； 进入 detached HEAD
        时，分支对话框会提示新提交不归属任何分支，并列出可恢复的本地分支。
      </li>
    </ul>
    <div className="docs-callout">
      <strong>关于「生成 PR」</strong>：应用里没有「一键创建 PR」的按钮。 审查面板上的{' '}
      <strong>查看 Pull Request</strong> 打开的是 GitHub 的 compare 链接 （形如{' '}
      <code>/compare/&lt;分支&gt;?expand=1</code>），由你在网页上确认并创建。
      <br />
      想让 Agent 直接建 PR，用会话里的 GitHub 连接器： 它提供{' '}
      <code>github_create_pull_request</code>（owner、repo、title、head、base、body、draft），
      需要连接器开启写权限。先让 Agent 推送分支，再让它建 PR，是最顺的链路。
    </div>
    <p>
      没有 GitHub 连接器也没关系：让 Agent 在终端里执行 <code>git push</code>， 再用你自己的 Git
      平台网页或 CLI 建 PR。仓库里也支持其他 Git 平台——它们不参与 PR 创建， 只作为普通远端使用。
    </p>

    <h2 id="code-viewer">6. 应用内代码查看与编辑</h2>
    <p>
      不离开应用也能看代码、改代码。统一侧边面板的 <strong>「代码」</strong> tab 里是 Monaco
      编辑器， 带文件树与搜索面板，并且和会话深联动。
    </p>
    <ul>
      <li>
        <strong>入口</strong>：会话侧栏的「代码」tab；项目菜单的「打开项目」；
        回答或变更记录里引用的文件路径可以直接点开。
      </li>
      <li>
        <strong>编辑体验</strong>：源码 / 本次改动 diff 双视图切换、多文件 tab、面包屑、
        <code>Cmd/Ctrl+S</code> 保存、保存后状态栏反馈，以及 Monaco 原生右键能力的中文浮层
        （折叠、格式化、查找替换等，环境不支持的项自动隐藏）。
      </li>
      <li>
        <strong>冲突防护</strong>：保存前校验磁盘文件的修改时间。若文件在外部被改过 （比如 Agent
        刚写了这个文件），会弹出「文件已被外部修改（如 agent
        写入），继续保存将覆盖磁盘内容」的横幅， 由你决定覆盖还是重载，不会静默覆盖。
      </li>
      <li>
        <strong>文件树</strong>：工具栏可新建文件 / 新建文件夹 / 折叠全部 / 刷新 / 切到搜索面板
        （文件名与内容搜索）；节点右键支持打开、复制路径、复制、剪切、粘贴、新建、重命名、删除。
        删除走系统回收站，确认框会写明「可从回收站恢复」。
      </li>
      <li>
        <strong>回填会话</strong>：编辑器里选中代码后按 <code>Cmd/Ctrl+Alt+I</code>
        「添加选中代码到会话」；<code>Cmd/Ctrl+Alt+F</code> 是「添加文件到会话」。
        两者都追加到输入框，不会覆盖你已经写好的内容。
      </li>
      <li>非代码文件（图片 / PDF / Office 文档等）自动走预览面板，不占编辑器。</li>
    </ul>

    <h2 id="best-practices">7. 最佳实践与常见坑</h2>
    <ul>
      <li>
        <strong>让隔离真的生效</strong>：worktree 开关只在会话还没有消息时可用。
        如果已经聊了几轮才想到隔离，只能新开会话，或者手动让 Agent 在终端里
        <code>git worktree add</code> —— 但手动建的那份不会被应用自动绑定成会话 cwd。
      </li>
      <li>
        <strong>合并交给 Agent，但要看它的命令</strong>：Worktree 面板的「合并」只是发指令，
        真正执行的是 Agent。合并前确认它在主仓库目录操作，而不是在 worktree 里 checkout base 分支。
      </li>
      <li>
        <strong>小步提交</strong>
        ：一轮一提交，配合提交范围里的「已选文件」，还原点和审查面板都会更好用。
      </li>
      <li>
        <strong>删 worktree 之前先看分支状态</strong>：面板上的「删除」是即时的， 会同时删掉
        worktree 和它检出的分支，不经过确认弹窗。
      </li>
      <li>
        <strong>改完先跑验证</strong>：在终端里跑 <code>pnpm test</code> / <code>pytest</code> /
        <code>tsc --noEmit</code>，或在提示词里明确要求 Agent 用同一套命令自检。
      </li>
      <li>
        <strong>
          注意 <code>.worktrees/</code> 已被自动忽略
        </strong>
        ： 不要手动把它提交进仓库；同理，如果你把仓库换到另一台机器，worktree 需要重建。
      </li>
      <li>
        <strong>「审查」面板看到的是工作区真实状态</strong>，不是 Agent 的自述。 Agent
        说改完了，仍要以面板里的 diff 为准。
      </li>
    </ul>
  </>
)

export const codeDevelopment: DocsPageContent = {
  slug: 'code-development',
  toc: [
    { id: 'workspace', title: '1. 添加项目与工作区', level: 2 },
    { id: 'branch', title: '2. 分支与 Worktree 隔离', level: 2 },
    { id: 'branch-picker', title: '2.1 分支选择器', level: 3 },
    { id: 'worktree-flow', title: '2.2 在隔离 worktree 里跑一次改动', level: 3 },
    { id: 'worktree-panel', title: '2.3 Worktree 面板与 agent 自建 worktree', level: 3 },
    { id: 'terminal', title: '3. 内置终端', level: 2 },
    { id: 'review', title: '4. 审查 AI 改动', level: 2 },
    { id: 'checkpoint', title: '4.1 代码还原点', level: 3 },
    { id: 'pr', title: '5. 提交、推送与 PR', level: 2 },
    { id: 'code-viewer', title: '6. 应用内代码查看与编辑', level: 2 },
    { id: 'best-practices', title: '7. 最佳实践与常见坑', level: 2 },
  ],
  faq: [
    {
      question: 'Worktree 是真的 Git worktree，还是在同一目录切分支？',
      answer:
        '是真的 Git worktree：应用在主仓库的 .worktrees/<分支 slug> 下新建目录并检出分支，会话的 cwd 指向那里，主仓库工作区不受影响。仓库若已有 .claude/worktrees/ 则沿用它。',
    },
    {
      question: '为什么我看不到 worktree 开关？',
      answer:
        '三个条件：当前项目是 Git 仓库、Git 运行环境可用、会话还没有任何消息。任一不满足开关就不显示或置灰，鼠标悬停会给出原因。',
    },
    {
      question: '删掉 worktree 会连带删掉分支吗？',
      answer:
        '会。删除 worktree 时会一并删除它检出的分支，确认框里已经写明。删除失败只会跳过分支删除，不影响 worktree 记录的清理。',
    },
    {
      question: '终端里跑 rm -rf 会弹审批吗？',
      answer:
        '不会。审批针对 Agent 的工具调用，不是你在终端里敲的命令。要收紧边界，请调低 Agent 的权限模式，或改「设置 → 权限策略」里的规则。',
    },
    {
      question: '「查看 Pull Request」按钮为什么直接打开了网页？',
      answer:
        '因为它打开的是该分支的 GitHub compare 链接，用于让你在网页上确认并创建 PR——应用不会替你调用平台 API 建 PR。想自动化就用 GitHub 连接器的 github_create_pull_request。',
    },
    {
      question: 'Agent 改坏了代码怎么回退？',
      answer:
        '用代码还原点：在抽屉里开启后，每轮开始前会按需记录已跟踪文件状态，点「回到这一步」即可文件级还原。它只覆盖检查点里记录的文件，不会删除之后新建的文件，也不动 Git 历史。',
    },
  ],
  quickReference: [
    { key: '隔离机制', value: '真实 Git worktree（.worktrees/<slug>，自动写入 .gitignore）' },
    {
      key: 'worktree 开关位置',
      value: '输入区右下角 worktree 开关（仅新会话 / 空会话 + Git 仓库）',
    },
    { key: '分支名', value: '留空自动生成 spark/<语义 slug>，回退任务文本 slug 或时间戳分支' },
    { key: 'Worktree 面板', value: '会话检查器 → Worktree（合并 / 打开 / 删除）' },
    { key: '终端实现', value: 'node-pty（Windows 走 ConPTY），shell 由主进程决定' },
    { key: '审查面板', value: '侧边面板「审查」tab：分支对照 + 文件数 + ± 行数 + 逐 hunk diff' },
    { key: '还原点 ref', value: 'refs/spark/checkpoints/<会话>/<id>' },
    { key: '插入代码快捷键', value: 'Cmd/Ctrl+Alt+I（选中代码）、Cmd/Ctrl+Alt+F（整文件）' },
    { key: '保存冲突', value: '保存前校验磁盘 mtime，外部改动会先提示再决定' },
    { key: '删除文件', value: '走系统回收站（shell.trashItem），可恢复' },
    {
      key: '建 PR 的真实路径',
      value: 'GitHub 连接器 github_create_pull_request 或自行在网页 / CLI 创建',
    },
  ],
  howTo: {
    name: '在隔离 worktree 里完成一次代码改动并审查',
    description: '添加项目 → 开隔离 worktree → 让 Agent 改动 → 逐文件审查 → 提交推送',
    totalTime: 'PT15M',
    steps: [
      '在会话侧边栏点「添加项目」，填项目名称并选择本地仓库目录，创建项目',
      '新建一个会话，在输入区右下角勾上 worktree 开关（分支名留空即自动生成）',
      '用自然语言描述目标改动并发送；Agent 的写文件 / 跑命令请求会在审批卡上等你确认',
      '打开侧边面板的「审查」tab，逐文件展开 diff 确认改动范围与行数',
      '在「终端」tab 里跑项目的测试与类型检查命令',
      '需要回退就在代码还原点时间线里点「回到这一步」',
      '确认无误后在 Git 面板提交（可只提交选中文件）并推送',
      '远端是 GitHub 时点「查看 Pull Request」打开 compare 页创建 PR，或让 Agent 用 GitHub 连接器创建',
    ],
  },
  aiSummary:
    'Spark Work 代码开发实测细节：添加项目（项目名称 + 项目位置）与工作区分组规则；真实 Git Worktree 隔离（.worktrees/<slug>，自动 gitignore，分支名可由模型按任务生成，会话 cwd 指向 worktree 但界面项目仍是主仓库）、' +
    '分支选择器（本地 / 远程 / 标签三组）、会话检查器里的 Worktree 面板（main / 已合并 / 未合并 / 当前徽标，合并=发指令给 Agent，删除连带删分支）与 agent 自建 worktree 的感知；' +
    '内置终端（node-pty + ConPTY、多标签 / 重命名 / 未读红点 / exited、shell 由主进程决定且不可配置、审批只作用于 Agent 工具调用）；' +
    '审查（四档审批卡 + Git Review 面板逐 hunk diff + 代码还原点 refs/spark/checkpoints，文件级还原且不删新增文件）；' +
    '提交 / 提交并推送 / 推送，以及「查看 Pull Request」实为 GitHub compare 链接、真正建 PR 走 GitHub 连接器 github_create_pull_request；' +
    '应用内 Monaco 代码面板（Cmd/Ctrl+Alt+I 与 Cmd/Ctrl+Alt+F 插入会话、mtime 冲突检测、文件树回收站删除）。',
  Body,
}

export default codeDevelopment
