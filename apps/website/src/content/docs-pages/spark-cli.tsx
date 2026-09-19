import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      Spark CLI 是桌面应用之外的第二入口：一个终端程序，名叫 <code>spark</code>，包名{' '}
      <code>@spark/agent</code>。 它自带交互式 TUI、一次性任务模式与一组维护命令，并且
      <strong>
        与桌面应用共用 <code>~/.spark</code> 数据根
      </strong>
      —— 你在桌面里配好的渠道，CLI 能直接用，靠的是桌面进程里一个只监听回环地址的本地桥。
    </p>
    <p>
      这一页讲清三件事：CLI 自己的命令面（参数、输出格式、退出码、会话、TUI），
      桌面联动那条链路的真实协议与边界，以及 <code>~/.spark</code> 与项目级 <code>.spark</code>{' '}
      里到底存了什么。 凡是容易被想当然写错的地方都单独标出来了。
    </p>

    <h2 id="what">1. 这是什么</h2>

    <h3 id="package">1.1 包与入口</h3>
    <table>
      <thead>
        <tr>
          <th>项</th>
          <th>实际值</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>包名</td>
          <td>
            <code>@spark/agent</code>
          </td>
        </tr>
        <tr>
          <td>安装后的命令</td>
          <td>
            <code>spark</code>（bin 映射到 <code>./dist/cli/main.js</code>）
          </td>
        </tr>
        <tr>
          <td>Node 要求</td>
          <td>
            <code>engines.node &gt;= 22.14.0</code>
          </td>
        </tr>
        <tr>
          <td>源码根</td>
          <td>
            仓库里的 <code>spark-engine/</code>
          </td>
        </tr>
        <tr>
          <td>自带依赖</td>
          <td>
            Ink + React（TUI）、zod、ajv、smol-toml、<code>@modelcontextprotocol/sdk</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      它<strong>不是</strong>桌面应用的包装脚本，而是一套独立的引擎：SDK、事件账本、工具运行时、MCP
      客户端、 TUI 都在这个包里，桌面应用的 Spark 执行器复用的是同一套内核。
    </p>

    <h3 id="vs-desktop">1.2 与桌面端的关系</h3>
    <p>两边通过三个共享面协作，理解这三个面基本就理解了「桌面联动」：</p>
    <table>
      <thead>
        <tr>
          <th>共享面</th>
          <th>路径 / 形式</th>
          <th>作用</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>数据根</td>
          <td>
            <code>~/.spark</code>（<code>SPARK_HOME</code> 可覆盖）
          </td>
          <td>配置、会话账本、账号凭据、桥描述文件、更新状态</td>
        </tr>
        <tr>
          <td>本地桥</td>
          <td>
            <code>~/.spark/hosts/sparkwork/bridge-&lt;id&gt;.json</code>
          </td>
          <td>让 CLI 用桌面已配置的渠道与凭据发请求</td>
        </tr>
        <tr>
          <td>宿主技能目录</td>
          <td>
            <code>~/.claude/skills</code>、<code>~/.codex/skills</code>、
            <code>~/.agents/skills</code>、<code>~/.spark/skills</code>
          </td>
          <td>两边都扫描这四处，CLI 侧同一份技能可见</td>
        </tr>
      </tbody>
    </table>
    <p>
      <strong>注意一个反直觉的例外</strong>：长期记忆<strong>不在</strong> <code>~/.spark</code>{' '}
      下，而在 <code>~/.spark-agent</code>
      （见 <a href="#data">第 12 章</a>
      ）。所以「两边共用数据根」这句话对配置和会话成立，对记忆不成立。
    </p>

    <h3 id="three-clis">1.3 三套容易混淆的「CLI」</h3>
    <p>仓库里还有两个名字里带 CLI 的东西，它们是不同的对象，不要混写：</p>
    <table>
      <thead>
        <tr>
          <th>名称</th>
          <th>是什么</th>
          <th>怎么区分</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>spark</code> CLI
          </td>
          <td>本文档的主角，独立安装的终端程序</td>
          <td>
            命令是 <code>spark</code>，包名 <code>@spark/agent</code>
          </td>
        </tr>
        <tr>
          <td>「本机 AI 工具」渠道</td>
          <td>
            桌面里的两个内置 Provider（<code>local-cli</code> / <code>local-codex-cli</code>
            ），把模型调用转给你机器上已登录的 Claude Code / Codex CLI
          </td>
          <td>没有 Key、没有 Endpoint，属于 Provider 而非程序</td>
        </tr>
        <tr>
          <td>
            <code>spark serve</code>
          </td>
          <td>
            <strong>只是存根</strong>，不启动任何服务
          </td>
          <td>固定打印一句「M1 kernel slice / M3 才有」，退出码 2</td>
        </tr>
      </tbody>
    </table>
    <pre>
      <code>
        spark serve # spark serve is not part of the M1 kernel slice; the versioned App Server lands
        in M3. # 退出码 2
      </code>
    </pre>
    <p>
      另外 <code>spark-engine</code> 这个目录名指的是引擎源码包，不是命令名——命令始终是{' '}
      <code>spark</code>。
    </p>

    <h2 id="install">2. 安装、卸载与 PATH</h2>

    <h3 id="three-installs">2.1 三种安装路径的真实差别</h3>
    <p>这三条路经常被当成同一件事，其实职责完全不同：</p>
    <table>
      <thead>
        <tr>
          <th>方式</th>
          <th>下载</th>
          <th>做什么</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>install.sh</code> / <code>install.ps1</code>
          </td>
          <td>
            <strong>会</strong>
          </td>
          <td>
            下载 tarball → 校验 sha256 → <code>npm install -g</code>；只有 npm 全局 bin 不在 PATH
            时才回落去链 <code>~/.spark/bin</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>npm install -g @spark/agent</code>
          </td>
          <td>
            <strong>会</strong>
          </td>
          <td>标准 npm 安装，shim 落在 npm 全局 bin</td>
        </tr>
        <tr>
          <td>
            <code>spark install</code>
          </td>
          <td>
            <strong>不会</strong>
          </td>
          <td>
            只把<strong>当前正在运行的这份代码</strong>的入口链到 <code>--bin</code> 目录
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      最后一条最容易被误解。它从运行中的代码向上找包根（最多 8 层），入口常量是{' '}
      <code>dist/cli/main.js</code>； 在源码树里直接跑会因为没构建而报{' '}
      <code>is missing dist/cli/main.js; build it with npm run build</code>。
    </p>

    <h3 id="install-detail">
      2.2 <code>spark install</code> 做了什么
    </h3>
    <ul>
      <li>
        <strong>launcher 形态分平台</strong>：POSIX 建<strong>符号链接</strong>指向{' '}
        <code>&lt;包&gt;/dist/cli/main.js</code>；Windows 写一个文本 shim，内容固定为三行（
        <code>@echo off</code>、<code>rem @spark/agent launcher</code>、
        <code>node "&lt;entry&gt;" %*</code>）。
      </li>
      <li>
        <strong>写入是原子的</strong>：先写 <code>.spark-launcher-&lt;pid&gt;.tmp</code>，Windows
        上把旧文件改名成 <code>.bak</code> 再换新，失败回滚。
      </li>
      <li>
        <strong>不校验 PATH，只警告</strong>：成功后提示 <code>Verify with: spark doctor</code>
        ，PATH 不在只给一条 NOTE。
      </li>
      <li>
        <strong>报错一律退出码 2</strong>，不是「安装失败=3」。
      </li>
    </ul>
    <blockquote>
      <p>
        一个容易踩的细节：<code>--bin</code> 的默认值是 <code>join(defaultSparkHome(), 'bin')</code>
        ， 而 <code>defaultSparkHome()</code> 读 <code>SPARK_HOME</code>。帮助文本只写{' '}
        <code>default ~/.spark/bin</code>， 没提环境变量——所以你改过 <code>SPARK_HOME</code>{' '}
        时，默认 launcher 目录会跟着变。
      </p>
    </blockquote>

    <h3 id="uninstall">2.3 卸载的三种粒度</h3>
    <table>
      <thead>
        <tr>
          <th>命令</th>
          <th>删除范围</th>
          <th>保留</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>spark uninstall</code>
          </td>
          <td>只删 launcher 文件</td>
          <td>
            npm 包、<code>~/.spark</code> 全部保留
          </td>
        </tr>
        <tr>
          <td>
            <code>spark uninstall --package</code>
          </td>
          <td>launcher + npm 全局 shim + 包目录本身</td>
          <td>
            <strong>
              <code>~/.spark</code> 的配置 / 会话 / 缓存永不删除
            </strong>
          </td>
        </tr>
        <tr>
          <td>
            <code>npm uninstall -g @spark/agent</code>
          </td>
          <td>npm 侧</td>
          <td>PATH 上的 launcher 会变成悬空链接</td>
        </tr>
      </tbody>
    </table>
    <p>
      <code>--package</code> 的所有权校验是保守的：只会删「能证明属于 spark」的文件——POSIX
      要求符号链接且目标落在包目录内， Windows 要读文件内容匹配包目录或标记。无法证明的条目会打印
      <code>exists but does not provably belong to spark; left untouched</code> 并原样留着。 成功
      <strong>恒定返回 0</strong>，包括什么都没删到的情况。
    </p>
    <p>
      <strong>
        但它卸不掉 <code>npm link</code> 装的版本
      </strong>
      ：更新路径在发现目标目录本身是符号链接时会明确拒绝， 需要先{' '}
      <code>npm unlink -g @spark/agent</code>。
    </p>

    <h3 id="path">2.4 PATH 与「外来 launcher」</h3>
    <p>
      「外来 launcher」指的是 PATH 上那个 <code>spark</code>{' '}
      不是我们装的：判定要求它要么不是符号链接， 要么指向的包名不是 <code>@spark/agent</code>。此时{' '}
      <code>spark install</code> 会拒绝并提示加 <code>--force</code>；<code>spark uninstall</code>{' '}
      同样拒绝，让你手工处理。
    </p>
    <p>
      PATH 探测按 PATH 顺序逐目录找，<strong>悬空符号链接也算候选</strong>（会明确提示{' '}
      <code>broken link</code>）。 多份 launcher 同时存在时，靠前者会遮蔽靠后者，<code>doctor</code>{' '}
      会给出
      <code>WARNING: &lt;path&gt; shadows a spark launcher later on PATH.</code>
    </p>

    <h2 id="commands">3. 命令面与参数解析</h2>

    <h3 id="subcommand-list">3.1 子命令清单</h3>
    <p>子命令是一张硬编码白名单，共 18 个：</p>
    <pre>
      <code>
        serve models doctor update upgrade install uninstall init login logout whoami config mcp
        memory plan skills todo sessions
      </code>
    </pre>
    <p>
      分发不是框架，而是 <code>main()</code> 里一串手写分支。这带来一个必须知道的行为：
      <strong>
        <code>positionals[0]</code> 一旦命中这些字面量就直接走子命令
      </strong>
      ， 所以 <code>spark update</code> 永远不会被当成任务名；反过来 <code>spark hello update</code>{' '}
      会被拼成任务提示 <code>"hello update"</code>。
    </p>

    <h3 id="flags-global">3.2 「全局 flag」是文档概念，不是解析概念</h3>
    <p>
      所有 flag 都定义在<strong>同一张</strong> <code>parseArgs.options</code>{' '}
      里，任何子命令在语法上都能接受任何 flag。
      <code>strict: true</code> 只拒绝<strong>未定义</strong>的 flag（比如 <code>--nope</code>{' '}
      会报错并退出 2）， 不拒绝「定义了但与本命令无关」的 flag——后者被<strong>静默忽略</strong>。
    </p>
    <pre>
      <code>
        # 这两个都不会报错： spark -p "分析日志" --check # --check 被静默丢弃，任务照常跑 spark todo
        list --scope user # --scope 只映射给 memory，这里无效
      </code>
    </pre>
    <p>同一个 flag 复用到多个子命令的地方，是最容易记错的一类：</p>
    <table>
      <thead>
        <tr>
          <th>flag</th>
          <th>实际接收者</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>--limit</code>
          </td>
          <td>
            <code>memory</code>（1–100）、<code>todo</code>（1–100）、<code>skills</code>（1–200）——
            <strong>三处区间不同</strong>
          </td>
        </tr>
        <tr>
          <td>
            <code>--body</code>
          </td>
          <td>
            <code>memory save</code> 与 <code>plan set|append</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>--global</code> / <code>--project</code>
          </td>
          <td>
            <code>config</code> 与 <code>mcp</code>（帮助文本只写了 config）
          </td>
        </tr>
        <tr>
          <td>
            <code>--scope</code>
          </td>
          <td>
            只有 <code>memory</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>--session</code>
          </td>
          <td>
            只有 <code>plan</code>
          </td>
        </tr>
      </tbody>
    </table>

    <h3 id="prompt">3.3 任务提示词的三种来源</h3>
    <p>
      优先级是 <code>-p/--prompt</code> &gt; 位置参数 &gt; 管道 stdin：
    </p>
    <pre>
      <code>
        spark "重构这个文件" # 位置参数按空格拼成完整提示词 spark -p "重构这个文件" # 与上一行等价
        cat notes.md | spark # stdin 非 TTY 时才读管道
      </code>
    </pre>
    <p>
      <code>-p</code> 一旦给出，位置参数被静默忽略。没有提示词、又不是交互 TTY 时报
      <code>
        No task was provided. Pass a prompt, pipe stdin, or run spark in an interactive TTY.
      </code>{' '}
      并退出 2。
    </p>

    <h3 id="resume-sentinel">
      3.4 <code>--resume</code> 的空值哨兵
    </h3>
    <p>
      <code>node:util</code> 的 <code>parseArgs</code> 拒绝无值 flag，所以裸 <code>--resume</code>{' '}
      会被预处理： 在它后面插入一个空串 <code>''</code> 当哨兵，下游把哨兵解释成「打开 TUI
      会话选择器」。
    </p>
    <pre>
      <code>
        spark --resume # TUI 里弹选择器（需要 TTY） spark -r session_... # 直接恢复指定会话 spark -c
        # 继续当前目录最近一次会话
      </code>
    </pre>
    <p>
      副作用值得一提：预处理是「后面跟任何以 <code>-</code> 开头的 token 就插空串」， 所以{' '}
      <code>spark -r -p "x"</code> 会被改写成 <code>-r '' -p x</code>——<code>-r</code> 吃掉了哨兵，
      <code>-p</code> 正常生效。
    </p>

    <h2 id="output">4. 输出格式</h2>

    <h3 id="three-formats">4.1 三态语义</h3>
    <p>
      这里有两个长得像但语义不同的开关，<strong>混用是这一块最常见的错误</strong>：
    </p>
    <table>
      <thead>
        <tr>
          <th>写法</th>
          <th>输出什么</th>
          <th>含流式 delta？</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>（默认）</td>
          <td>人类可读文本</td>
          <td>是，直接写 stdout</td>
        </tr>
        <tr>
          <td>
            <code>--json</code>
          </td>
          <td>
            事实事件 NDJSON（<strong>无 delta</strong>）
          </td>
          <td>否</td>
        </tr>
        <tr>
          <td>
            <code>--output-format stream-json</code>
          </td>
          <td>
            事实事件 + <code>&#123;"type":"delta",…&#125;</code> 记录
          </td>
          <td>是</td>
        </tr>
        <tr>
          <td>
            <code>--output-format json</code>
          </td>
          <td>
            <strong>恰好一行</strong>最终结果对象
          </td>
          <td>否</td>
        </tr>
      </tbody>
    </table>
    <p>
      所以「<code>--json</code> 就是机器可读的最终结果」是错的——它给的是事件流。
      想要一行结果对象，只能用 <code>--output-format json</code>。
    </p>
    <p>
      <code>--json</code> 与 <code>--output-format text</code> / <code>json</code> 冲突报错， 但与{' '}
      <code>--output-format stream-json</code> 是<strong>合法组合</strong>，且此时行为等同纯{' '}
      <code>stream-json</code>。
    </p>

    <h3 id="text-split">4.2 text 模式的 stdout / stderr 分工</h3>
    <p>这是脚本化调用时最实用的一条：</p>
    <ul>
      <li>
        <strong>stdout</strong>：只有模型的正文输出。
      </li>
      <li>
        <strong>stderr</strong>：工具调用、权限请求、失败、取消等全部「过程事实」。
      </li>
    </ul>
    <p>
      如果模型一个字面 delta 都没给，会在 <code>assistant.completed</code> 之后补打整段文本。
      这意味着 <code>spark -p "..." &gt; answer.txt</code> 拿到的就是干净的答案。
    </p>

    <h3 id="result-object">
      4.3 <code>--output-format json</code> 的字段
    </h3>
    <pre>
      <code>
        &#123;"type":"result","sessionId":"session_…","turnId":"turn_…",
        "status":"completed","message":"…","terminal":&#123;"type":"turn.completed",…&#125;&#125;
      </code>
    </pre>
    <p>
      <code>status</code> 取值与终态事件一致，<code>message</code> 在没有文本时是 <code>null</code>
      。 该模式下 delta 被显式关闭，内容只来自 <code>assistant.completed</code>。
    </p>

    <h3 id="json-side-effect">4.4 一个容易踩的副作用</h3>
    <p>
      <code>--output-format</code> 会<strong>顺手打开所有子命令的 JSON 输出</strong>：
    </p>
    <pre>
      <code>
        spark models --output-format json # 输出 JSON spark models --output-format text # 输出表格
      </code>
    </pre>
    <p>不需要 JSON 的子命令上带了这个 flag，输出形态会被意外改掉。</p>

    <h2 id="exit">5. 退出码</h2>
    <p>退出码是脚本化调用最依赖的东西，也是文档里最容易写错的部分。分三组记。</p>

    <h3 id="exit-oneshot">5.1 一次性任务</h3>
    <table>
      <thead>
        <tr>
          <th>码</th>
          <th>条件</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>0</code>
          </td>
          <td>
            终态事件是 <code>turn.completed</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>1</code>
          </td>
          <td>
            其它终态（含 <code>turn.failed</code>）
          </td>
        </tr>
        <tr>
          <td>
            <code>130</code>
          </td>
          <td>
            终态是 <code>turn.cancelled</code>（例如你按了 Ctrl+C）
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      <strong>取消是 130 而不是 1</strong>，与 Unix 的 SIGINT 约定一致； 另有 <code>EPIPE</code>{' '}
      被单独吞成 0（写管道时下游提前关闭不算失败）。
    </p>

    <h3 id="exit-usage">5.2 用法错误统一是 2</h3>
    <p>
      参数解析失败会<strong>打印错误 + 整篇帮助</strong>并退出 2。触发条件包括：未知 flag、
      <code>--output-format</code> 非法、<code>--json</code> 冲突、<code>--permission-mode</code>{' '}
      非法、
      <code>--effort</code> 非法、<code>--continue</code> 与 <code>--resume</code> 同给、
      <code>--global</code> 与 <code>--project</code> 同给、
      <code>--dangerously-skip-permissions</code> 与显式非 bypass 模式冲突。
    </p>
    <p>
      除此之外，下面这些也走 2：配置加载失败、模型无法解析、图片读取失败、裸 <code>--resume</code>{' '}
      但没有 TTY。
    </p>

    <h3 id="exit-sub">5.3 子命令自带的分支</h3>
    <p>「用法错误是 2、找不到/未登录是 1」是大致规律，但有真实的不一致：</p>
    <table>
      <thead>
        <tr>
          <th>命令</th>
          <th>退出 1 的情况</th>
          <th>退出 2 的情况</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>config get</code>
          </td>
          <td>键未设置</td>
          <td>用法错误、未知子命令</td>
        </tr>
        <tr>
          <td>
            <code>config unset</code>
          </td>
          <td>—</td>
          <td>
            <strong>键不存在也是 2</strong>（与 <code>get</code> 相反）
          </td>
        </tr>
        <tr>
          <td>
            <code>mcp remove</code>
          </td>
          <td>名字不存在</td>
          <td>用法错误</td>
        </tr>
        <tr>
          <td>
            <code>mcp status</code>
          </td>
          <td>任一服务器启动失败</td>
          <td>用法错误、变量缺失</td>
        </tr>
        <tr>
          <td>
            <code>skills read</code>
          </td>
          <td>
            找不到技能，
            <strong>
              或 <code>--limit</code> 非法
            </strong>
          </td>
          <td>未知子命令、参数个数不对</td>
        </tr>
        <tr>
          <td>
            <code>todo remove</code>
          </td>
          <td>id 不存在</td>
          <td>id 格式非法、用法错误</td>
        </tr>
        <tr>
          <td>
            <code>plan</code>
          </td>
          <td>
            <code>PlanStoreError</code>（非法 sessionId、超限）
          </td>
          <td>
            无会话、缺 <code>--body</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>whoami</code>
          </td>
          <td>未登录、会话过期</td>
          <td>未知子命令</td>
        </tr>
      </tbody>
    </table>
    <p>
      <code>plan show</code> / <code>plan clear</code> 在没有计划时<strong>仍返回 0</strong>，
      只打印 <code>No plan exists for session …</code>；<code>logout</code> 在未登录时也返回 0。
    </p>

    <h2 id="sessions">6. 会话与账本</h2>

    <h3 id="ledger-path">6.1 会话存在哪里</h3>
    <p>
      会话不是散落的文件，而是一份<strong>按项目目录归档的事件账本</strong>：
    </p>
    <pre>
      <code>~/.spark/projects/&lt;编码后的项目目录&gt;/&lt;sessionId&gt;/events.jsonl</code>
    </pre>
    <p>目录名由两段拼成，这个规则值得记住，因为你去磁盘找文件时只能靠它：</p>
    <ul>
      <li>
        把绝对路径里所有非 <code>[a-zA-Z0-9._-]</code> 的字符换成 <code>-</code>，去掉首尾{' '}
        <code>-</code>，<strong>取最后 96 个字符</strong>（空了就用 <code>root</code>）；
      </li>
      <li>
        再接一个 <code>-</code> 和绝对路径 sha256 的<strong>前 12 位十六进制</strong>。
      </li>
    </ul>
    <p>事件按行追加，每行一个 JSON。同目录下可并存多个会话，互不干扰。</p>

    <h3 id="session-flags">6.2 三个入口的差别</h3>
    <table>
      <thead>
        <tr>
          <th>命令</th>
          <th>选中的会话</th>
          <th>找不到时</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>spark -c</code>
          </td>
          <td>
            当前目录<strong>最近更新</strong>的主会话（排除 subagent）
          </td>
          <td>
            不报错：打印提示并<strong>开新会话</strong>，退出 0
          </td>
        </tr>
        <tr>
          <td>
            <code>spark -r &lt;id&gt;</code>
          </td>
          <td>
            按完整 id 精确匹配（<strong>包含</strong> subagent 会话）
          </td>
          <td>
            报 <code>Session not found: …</code> + 最近 5 条提示，退出 2
          </td>
        </tr>
        <tr>
          <td>
            <code>spark --resume</code>
          </td>
          <td>TUI 里手动选</td>
          <td>没有 TTY 时报错退出 2</td>
        </tr>
      </tbody>
    </table>
    <blockquote>
      <p>
        <strong>最容易踩的坑</strong>：<code>spark sessions</code> 列表里显示的是
        <strong>8 位短 id</strong>（去掉 <code>session_</code> 前缀后取前 8 个字符）， 而{' '}
        <code>--resume</code> 只接受<strong>完整 id</strong>。直接把列表里的短 id 粘进去一定失败。
        完整 id 要用 <code>spark sessions --json</code> 拿，或在 TUI 里用 <code>/status</code> 看。
      </p>
    </blockquote>

    <h3 id="session-perm">6.3 恢复时的权限语义</h3>
    <p>会话会把当时的权限模式记进账本。恢复时：</p>
    <ul>
      <li>
        <strong>显式</strong>给了 <code>--permission-mode</code> → 覆盖账本里的模式；
      </li>
      <li>
        没给 → <strong>沿用会话原有的模式</strong>，而不是当前配置里的默认值。
      </li>
    </ul>
    <p>
      另外两条硬约束：<strong>恢复 subagent 会话会被明确拒绝</strong>； 恢复一个带未终止 turn
      的会话时，会先
      <strong>
        补写一条 <code>turn.failed</code>
      </strong>
      ，把断掉的轮次收尾。
    </p>

    <h2 id="tui">7. TUI 与 plain REPL</h2>

    <h3 id="tui-entry">7.1 什么情况下会进 TUI</h3>
    <p>
      进入 TUI 需要同时满足七个条件，并且<strong>没有提示词</strong>：
    </p>
    <pre>
      <code>
        --plain 未给 且 --json 未给 且 --output-format 是 text 且 stdin 与 stdout 都是 TTY 且 CI !=
        'true' 且 TERM != 'dumb'
      </code>
    </pre>
    <p>
      注意 <code>--output-format json</code> / <code>stream-json</code> 会让内部 <code>json</code>{' '}
      标志为真， 从而<strong>永久关闭 TUI</strong>——这是「加了输出格式就不进界面了」的原因。
    </p>
    <p>
      还有一类输入永远不会进 TUI：<code>-i/--image</code> 只对一次性任务有效，
      带子命令或没有提示词时都会先被拦掉（见 <a href="#images">第 8 章</a>）。
    </p>

    <h3 id="slash">7.2 斜杠命令</h3>
    <p>
      公开的是这 9 条（<code>/help</code> 显示的就是它们）：
    </p>
    <table>
      <thead>
        <tr>
          <th>命令</th>
          <th>作用</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>/help</code>
          </td>
          <td>显示命令与快捷键</td>
        </tr>
        <tr>
          <td>
            <code>/status</code>
          </td>
          <td>会话 id、排队 turn、事件数</td>
        </tr>
        <tr>
          <td>
            <code>/model</code>
          </td>
          <td>切换模型或配置本地渠道</td>
        </tr>
        <tr>
          <td>
            <code>/perm</code>
          </td>
          <td>选择权限策略</td>
        </tr>
        <tr>
          <td>
            <code>/effort</code>
          </td>
          <td>选择推理强度</td>
        </tr>
        <tr>
          <td>
            <code>/update</code>
          </td>
          <td>
            检查并安装新版本（<code>--check</code> 仅检查）
          </td>
        </tr>
        <tr>
          <td>
            <code>/sessions</code>
          </td>
          <td>选择并切换到历史会话</td>
        </tr>
        <tr>
          <td>
            <code>/clear</code>
          </td>
          <td>开启全新会话</td>
        </tr>
        <tr>
          <td>
            <code>/exit</code>
          </td>
          <td>退出（Ctrl+C 两次同效）</td>
        </tr>
      </tbody>
    </table>
    <p>
      <strong>
        还有一条未公开的 <code>/quit</code>
      </strong>
      ：它和 <code>/exit</code> 走同一个分支， 但<strong>不在命令表里</strong>——不出现在 Tab 补全和{' '}
      <code>/help</code> 中，也不占用保留名， 所以项目里的 <code>.spark/commands/quit.md</code>{' '}
      可以把 <code>/quit</code> 抢注成自定义命令。 未知命令会提示{' '}
      <code>未知命令: … · 输入 /help 查看命令</code>。
    </p>
    <p>
      <code>/model</code>、<code>/perm</code>、<code>/effort</code>、<code>/clear</code>、
      <code>/sessions</code>
      在有 turn 正在跑时<strong>只提示不执行</strong>，不会打断进行中的工作。
    </p>

    <h3 id="shortcuts">7.3 快捷键</h3>
    <table>
      <thead>
        <tr>
          <th>按键</th>
          <th>行为</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>Esc</code>
          </td>
          <td>有草稿时先清空草稿；草稿为空则中断当前 turn</td>
        </tr>
        <tr>
          <td>
            <code>Shift+Tab</code>
          </td>
          <td>
            在 manual ↔ auto 之间循环（<strong>永远不会切到 bypass</strong>）
          </td>
        </tr>
        <tr>
          <td>
            <code>Ctrl+O</code>
          </td>
          <td>开关思考流展示</td>
        </tr>
        <tr>
          <td>
            <code>Ctrl+E</code>
          </td>
          <td>展开/折叠折叠区</td>
        </tr>
        <tr>
          <td>
            <code>Ctrl+U</code> / <code>Ctrl+W</code>
          </td>
          <td>行编辑快捷删除</td>
        </tr>
        <tr>
          <td>
            <code>Shift+Enter</code> / <code>\</code>+Enter
          </td>
          <td>换行而不提交</td>
        </tr>
        <tr>
          <td>
            <code>↑</code> / <code>↓</code>
          </td>
          <td>历史输入</td>
        </tr>
        <tr>
          <td>
            <code>Tab</code>
          </td>
          <td>命令补全</td>
        </tr>
        <tr>
          <td>
            <code>Ctrl+C</code>
          </td>
          <td>按两次退出</td>
        </tr>
      </tbody>
    </table>
    <p>
      <code>Shift+Tab</code> 到不了 <code>bypass</code> 是刻意的：完全访问权限必须在{' '}
      <code>/perm</code> 里 经过二次确认才能开启。另外 <code>Ctrl+V</code>{' '}
      粘贴图片只出现在欢迎框提示里，不在 <code>/help</code> 的快捷键表中。
    </p>

    <h3 id="perm-effort">7.4 权限模式与推理强度</h3>
    <p>权限模式只有三个值：</p>
    <table>
      <thead>
        <tr>
          <th>值</th>
          <th>含义</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>manual</code>
          </td>
          <td>每次工具调用按策略询问</td>
        </tr>
        <tr>
          <td>
            <code>auto</code>
          </td>
          <td>按规则自动放行低风险操作</td>
        </tr>
        <tr>
          <td>
            <code>bypass</code>
          </td>
          <td>完全放行，仅用于受控环境</td>
        </tr>
      </tbody>
    </table>
    <p>
      <strong>
        默认值不是帮助文本写的 <code>manual</code>
      </strong>
      。实际链是 「显式 flag → <code>[permissions].mode</code> → <code>/perm</code> 持久化过的{' '}
      <code>agent.permission_mode</code> → <code>manual</code>」。 TUI 里 <code>/perm</code>{' '}
      的选择会<strong>写回全局配置</strong>，所以下一次启动仍然生效。
    </p>
    <pre>
      <code>
        spark --permission-mode bypass "跑一遍测试" # stderr 会打印： # DANGER: permission bypass is
        active; registered tools may execute without approval.
      </code>
    </pre>
    <p>
      这条警告只在<strong>一次性任务与 plain REPL</strong> 路径打印，<strong>TUI 路径不打印</strong>
      。<code>--dangerously-skip-permissions</code> 是 <code>--permission-mode bypass</code>{' '}
      的别名， 但和显式给出的非 bypass 模式同时出现会报错。
    </p>
    <p>
      推理强度五值 <code>off | low | medium | high | max</code>，默认链同样是 「flag → 持久化偏好 →{' '}
      <code>high</code>」。<code>off</code> 关闭思考；<code>max</code> 在 Anthropic 上是 65536 token
      的思考预算。
    </p>

    <h3 id="plain-repl">
      7.5 <code>--plain</code> 到底是什么
    </h3>
    <p>
      帮助文本写的是「Disable color and terminal redraw」，但实现里它选的是
      <strong>行式 REPL</strong>： stdin/stdout 都是 TTY 且没有提示词时进入，横幅是{' '}
      <code>spark plain REPL · /exit 退出</code>。
    </p>
    <ul>
      <li>
        <strong>
          只识别 <code>/exit</code> 与 <code>/quit</code>
        </strong>
        ，其它 <code>/xxx</code> 一律当任务文本发给模型；
      </li>
      <li>
        该路径
        <strong>
          完全忽略 <code>--json</code> 与 <code>--output-format</code>
        </strong>
        ；
      </li>
      <li>
        配一次性提示词或配子命令时，<code>--plain</code> 没有任何效果。
      </li>
    </ul>

    <h2 id="images">8. 图片附件</h2>
    <p>
      <code>-i/--image</code> 把图片附加到一次性任务的提示词上，可重复出现：
    </p>
    <pre>
      <code>spark -p "分析这张截图的问题" -i shot.png -i arch.jpg</code>
    </pre>

    <h3 id="image-limits">8.1 格式与限额</h3>
    <table>
      <thead>
        <tr>
          <th>项</th>
          <th>实际值</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>支持格式</td>
          <td>PNG / JPEG / WEBP / GIF</td>
        </tr>
        <tr>
          <td>判定依据</td>
          <td>
            <strong>文件头魔数</strong>，不是扩展名
          </td>
        </tr>
        <tr>
          <td>单轮张数</td>
          <td>最多 20 张</td>
        </tr>
        <tr>
          <td>单张大小</td>
          <td>最多 20 MiB</td>
        </tr>
        <tr>
          <td>合计大小</td>
          <td>最多 50 MiB</td>
        </tr>
      </tbody>
    </table>
    <p>
      校验在读取阶段完成，<strong>整批失败就整体拒绝</strong>（不会只跳过坏的那张）。
      因为按魔数判断，把 PNG 改名成 <code>notes.bin</code> 也能通过；反过来把一个文本文件改名成{' '}
      <code>.png</code> 会被拒。
    </p>

    <h3 id="image-rules">8.2 两条约束</h3>
    <ul>
      <li>
        <strong>只能配一次性任务</strong>：图片在模型解析之前就读取校验，而 TUI
        分支在此之前就已经被排除。
      </li>
      <li>
        <strong>不能配子命令</strong>：<code>spark models -i a.png</code> 会报{' '}
        <code>--image only applies to a task prompt, not to models.</code> 并退出 2。
      </li>
    </ul>
    <p>
      图片不会以 base64 形式写进事件账本——账本里只记制品引用，请求体里才是 data URL。 这也意味着
      <strong>账本可以安全地按行传阅</strong>，不会夹带图片内容。
    </p>

    <h2 id="bridge">9. 桌面联动：本地桥</h2>
    <p>
      「CLI 与桌面共用 <code>~/.spark</code>，所以能看到同一批渠道」这句话只说对了一半。 真正让 CLI
      用上桌面渠道的，是桌面主进程里跑的一个<strong>只监听回环地址的本地 HTTP 服务</strong>。 CLI
      从不直接读桌面的数据库，也不直接读系统钥匙串——它只和这个桥说话。
    </p>

    <h3 id="bridge-what">9.1 桥是什么</h3>
    <table>
      <thead>
        <tr>
          <th>项</th>
          <th>实际值</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>实现位置</td>
          <td>
            Electron 主进程内的 <code>node:http</code> 服务器
          </td>
        </tr>
        <tr>
          <td>绑定地址</td>
          <td>
            <code>127.0.0.1</code> + <strong>系统分配的临时端口</strong>（<code>listen(0)</code>）
          </td>
        </tr>
        <tr>
          <td>端口</td>
          <td>
            <strong>每次启动都变，没有固定端口</strong>
          </td>
        </tr>
        <tr>
          <td>发现方式</td>
          <td>
            只靠描述文件里的 <code>endpoint</code> 字段
          </td>
        </tr>
        <tr>
          <td>是否可关闭</td>
          <td>
            <strong>不能</strong>：没有设置项、没有 IPC 开关，随应用启动无条件尝试创建
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      端口不固定意味着你无法靠 <code>curl 127.0.0.1:某端口</code> 直接调试——必须先读描述文件拿到
      endpoint。 如果启动时绑定失败，只记一条 <code>log.warn</code>，整进程<strong>不会重试</strong>
      。
    </p>

    <h3 id="bridge-descriptor">9.2 描述文件</h3>
    <pre>
      <code>~/.spark/hosts/sparkwork/bridge-&lt;instanceId&gt;.json</code>
    </pre>
    <p>
      目录权限 <code>0700</code>、文件 <code>0600</code>，用「同目录临时文件 + fsync +
      rename」原子写入。 内容共 7 个字段：
    </p>
    <pre>
      <code>
        &#123; "schemaVersion": 1, "host": "sparkwork", "instanceId": "&lt;uuid&gt;", "endpoint":
        "http://127.0.0.1:&lt;port&gt;", "token": "&lt;32 字节随机数的 base64url&gt;", "pid": 12345,
        "startedAt": "2026-09-19T…Z" &#125;
      </code>
    </pre>
    <p>
      <code>token</code> 在每次进程启动时重新生成，<strong>不做轮换</strong>
      ，只存在于描述文件与内存里。 CLI 侧用严格的 zod schema 校验同一组字段——
      <strong>多一个字段整份描述会被判无效</strong>。
    </p>
    <blockquote>
      <p>
        <strong>两侧的文件名正则不等价，这是最容易写错的一处。</strong>
        桌面端接受 <code>bridge.json</code>（单实例时代的遗留名，会被 GC 清理）， 而 CLI 侧的正则
        <strong>
          要求必须有 <code>-&lt;id&gt;</code> 段
        </strong>
        ， 所以 <code>bridge.json</code> 对 CLI 来说等于不存在。
      </p>
    </blockquote>

    <h3 id="bridge-discovery">9.3 发现与选主</h3>
    <p>CLI 每次开始任务时都重新发现一遍，流程是：</p>
    <ol>
      <li>
        扫 <code>~/.spark/hosts/sparkwork/</code> 下匹配 <code>bridge-&lt;id&gt;.json</code>{' '}
        的普通文件；
      </li>
      <li>
        按文件 <strong>mtime 倒序</strong>取前 8 个作为候选；
      </li>
      <li>
        逐个校验权限（非 Windows 要求 <code>0600</code> 或更严）、大小（≤ 64 KiB）、endpoint 必须是
        <strong>回环 HTTP</strong>且不带凭据/路径/查询/fragment；
      </li>
      <li>
        带 token 请求 <code>/v1/catalog</code>；
      </li>
      <li>
        成功的候选里，取 <code>startedAt</code> 最大的那个作为胜出者。
      </li>
    </ol>
    <p>
      探测超时分两档：<strong>pid 存活给 2000 ms，pid 已消失只给 250 ms</strong>——
      后者是防「端口复用巧合应答」拖慢启动。
    </p>
    <p>
      多开桌面应用是支持的：每个实例写自己的描述文件，退出时只删自己那份；
      启动时还会清理「能证明已死」的残留（判定依据是 <code>kill(pid, 0)</code> 返回 ESRCH， EPERM
      视为存活）。解析失败的垃圾文件不会阻塞启动，交给 CLI 侧跳过。
    </p>

    <h3 id="bridge-endpoints">9.4 桥的全部端点</h3>
    <p>只有三条有效路由，没有「凭据端点」这种设计：</p>
    <table>
      <thead>
        <tr>
          <th>方法</th>
          <th>路径</th>
          <th>返回</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>GET</code>
          </td>
          <td>
            <code>/v1/health</code>
          </td>
          <td>
            <code>&#123;"ok":true,"schemaVersion":1,"host":"sparkwork"&#125;</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>GET</code>
          </td>
          <td>
            <code>/v1/catalog</code>
          </td>
          <td>
            模型目录：<code>revision</code> / <code>generatedAt</code> / <code>defaultRoute?</code>{' '}
            / <code>routes[]</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>POST</code>
          </td>
          <td>
            <code>/v1/proxy/&lt;providerId&gt;/v1/messages</code>
          </td>
          <td>代理到上游 Anthropic Messages</td>
        </tr>
        <tr>
          <td>
            <code>POST</code>
          </td>
          <td>
            <code>/v1/proxy/&lt;providerId&gt;/v1/responses</code>
          </td>
          <td>代理到上游 OpenAI Responses</td>
        </tr>
      </tbody>
    </table>
    <p>
      <code>revision</code> 是 <code>sha256(JSON.stringify(&#123;defaultRoute, routes&#125;))</code>
      ，<strong>routes 里含渠道显示名</strong>，所以改一个渠道的名字也会换 revision。
    </p>
    <p>
      <strong>
        <code>/v1/health</code> 也要 token
      </strong>
      （鉴权在路由分发之前）， 而且它在整个仓库里<strong>没有任何调用方</strong>
      ——是一条定义了但没人用的路由。
    </p>
    <p>
      鉴权头有两种写法，<strong>两种都必须支持</strong>：
      <code>authorization: Bearer &lt;token&gt;</code>或 <code>x-api-key: &lt;token&gt;</code>
      。原因是 CLI 的 Anthropic 路由把 token 放进 <code>x-api-key</code>、 OpenAI 路由放进{' '}
      <code>authorization</code>。只实现一种会出现「Anthropic 渠道全部 401」。
    </p>

    <h2 id="bridge-models">10. 哪些渠道会被桥接</h2>
    <p>
      这是本章最容易写错的部分。桥不会把桌面里的<strong>全部</strong>渠道暴露给 CLI，
      筛选规则相当窄。
    </p>

    <h3 id="protocol-rule">10.1 协议判定规则</h3>
    <p>
      渠道必须命中下面两条之一，否则<strong>根本不出现在目录里</strong>：
    </p>
    <table>
      <thead>
        <tr>
          <th>渠道类型</th>
          <th>条件</th>
          <th>桥协议</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Anthropic</td>
          <td>
            <code>provider === 'anthropic'</code>
          </td>
          <td>
            <code>anthropic-messages</code>
          </td>
        </tr>
        <tr>
          <td>OpenAI</td>
          <td>
            <code>provider === 'openai'</code> <strong>且</strong>{' '}
            <code>codexApiKind === 'responses'</code>
          </td>
          <td>
            <code>openai-responses</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      也就是说：<strong>OpenAI 渠道必须显式标记为 Responses API 才会进桥</strong>。 普通走{' '}
      <code>/chat/completions</code> 的渠道在桌面里能用，但<strong>在 CLI 里彻底看不到</strong>。
      这一点很反直觉，因为桌面端自己两种协议都支持。
    </p>
    <p>
      按内置预设统计：Anthropic 系全部可桥接（约 16 条），OpenAI 加{' '}
      <code>codexApiKind: 'responses'</code> 的只有 5 条， 其余约 32 条 OpenAI
      兼容渠道（含通义千问、Google Gemini、DeepSeek 这类未标记 <code>codexApiKind</code> 的预设）
      都不进桥。想知道某个渠道能不能用，看它有没有显式的 <code>codexApiKind: 'responses'</code>{' '}
      即可。
    </p>

    <h3 id="exclusions">10.2 排除集</h3>
    <p>除协议外，还有三类过滤：</p>
    <ul>
      <li>
        <code>enabled === false</code> 的渠道不出现；
      </li>
      <li>
        <code>modelType === 'image'</code> 的渠道不出现；
      </li>
      <li>
        下面四个 id 被<strong>硬编码排除</strong>。
      </li>
    </ul>
    <pre>
      <code>local-cli local-codex-cli claude-auto-router codex-auto-router</code>
    </pre>
    <p>
      这个排除集是<strong>承重的，不是冗余</strong>： 前两个是「本机 AI 工具」渠道，没有 Key 也没有
      Endpoint， 但它们<strong>有非空的模型名</strong>——如果不排除，桥会真的生成
      <code>sparkwork:local-cli:claude cli</code> 这样的路由，然后在调用时返回 503。
      后两个是运行时合成的「自动路由」profile，本身模型名为空。
    </p>
    <p>
      另外，被时段策略临时禁用的渠道/模型也会从目录里消失——目录是<strong>每次请求现算的</strong>
      ，不是启动时快照。
    </p>

    <h3 id="upstream-url">10.3 上游地址如何推导（含一处不一致）</h3>
    <p>桥拿到 providerId 后，按下表推导真正的上游地址：</p>
    <table>
      <thead>
        <tr>
          <th>协议</th>
          <th>规则</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>anthropic-messages</code>
          </td>
          <td>
            已以 <code>/v1/messages</code> 结尾 → 原样；以 <code>/v1</code> 结尾 → 补{' '}
            <code>/messages</code>；否则补 <code>/v1/messages</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>openai-responses</code>
          </td>
          <td>
            已以 <code>/responses</code> 结尾 → 原样；以 <code>/chat/completions</code> 结尾 → 换成{' '}
            <code>/responses</code>；最后一段是 <code>/vN</code> 形式 → 补 <code>/responses</code>
            ；以 <code>/v1</code> 结尾 → 补 <code>/responses</code>；否则补{' '}
            <code>/v1/responses</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      <code>/vN</code> 规则这条曾有一处真实缺陷：桌面端一直有这条规则， 而桥的实现里此前
      <strong>没有</strong>，导致因为地址以 <code>/vN</code> 结尾而被自动标成
      <code>responses</code> 的编程端点（如 <code>…/api/coding/paas/v4</code>）会被拼成
      <code>…/paas/v4/v1/responses</code>——同一个渠道「桌面里能用、CLI 里报错」。
      该缺陷已在桥侧修复：桥的推导与桌面端 <code>getOpenAiResponsesEndpoint</code>{' '}
      逐分支对齐，并用回归测试锁定（覆盖
      <code>…/paas/v4</code> 与 <code>…/coding/v3</code>{' '}
      两类端点）。如果你还在旧版本上遇到这个症状，升级桌面端后重启 CLI 即可。
    </p>

    <h3 id="models-view">
      10.4 在 <code>spark models</code> 里长什么样
    </h3>
    <p>每行格式固定是「选中标记 + 模型名 + 渠道名 + 协议 + 来源」：</p>
    <pre>
      <code>
        * gpt-5.5 OpenAI openai-responses [sparkwork] claude-sonnet-4-5 Claude anthropic-messages
        [sparkwork] my-local local anthropic-messages [local]
      </code>
    </pre>
    <p>
      <strong>
        来源只有 <code>local</code> 与 <code>sparkwork</code> 两个值
      </strong>
      ， 终端里不出现「bridge」这个词——看到 <code>[sparkwork]</code> 就是指它来自桌面桥。 路由 id
      的内部格式是 <code>sparkwork:&lt;providerId&gt;:&lt;model&gt;</code>， 但列表和 TUI
      显示时会还原成裸模型名。<code>--model</code> 两种都接受： 既可以直接给路由 id，也可以给
      <strong>唯一的</strong>模型名；名字重复时报
      <code>Model X exists in multiple SparkWork providers; use one of: …</code>。
    </p>
    <p>
      目录里<strong>桥路由排在本地配置的模型前面</strong>，所以打开 <code>/model</code> 时
      光标默认落在桥路由上。但默认选中项另有优先级链：
    </p>
    <pre>
      <code>
        --model &gt; SPARK_MODEL &gt; 项目层 [agent].model &gt; 全局 [agent].model &gt; 桌面的
        defaultRoute
      </code>
    </pre>
    <p>
      只要 CLI 侧存过任何本地默认，桌面的 <code>defaultRoute</code>{' '}
      就轮不到——这是刻意的「sticky」设计。
    </p>
    <p>
      最后一个必须知道的后果：<strong>桌面没开时没有回退，只有报错</strong>。 如果你之前用 TUI
      选过一个桥路由，它会被写进 <code>~/.spark/config.toml</code> 的 <code>[agent].model</code>；
      关掉桌面再启动 CLI，就会撞上
      <code>Model &lt;id&gt; is not defined locally or available from SparkWork</code>。
      解法是重开桌面，或在 TUI 里换回本地模型。
    </p>

    <h2 id="bridge-security">11. 桥的安全模型</h2>
    <p>这部分的边界值得单独讲，因为它决定了「谁能读到你的 Key」。</p>

    <h3 id="bridge-authz">11.1 三道约束</h3>
    <table>
      <thead>
        <tr>
          <th>约束</th>
          <th>实现</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>只监听回环</td>
          <td>
            服务端只 bind <code>127.0.0.1</code>；客户端还会<strong>拒绝</strong>任何非回环 endpoint
          </td>
        </tr>
        <tr>
          <td>随机 token</td>
          <td>32 字节随机数，每次启动重新生成，随描述文件传递</td>
        </tr>
        <tr>
          <td>文件权限</td>
          <td>
            目录 <code>0700</code>、文件 <code>0600</code>；CLI 侧反向校验，权限过松直接拒绝
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      <strong>没有 CORS / Origin 检查，也没有 Host 头校验</strong>—— 防护完全建立在「回环 + 随机
      token + 文件权限」之上。这意味着同一台机器上的其他进程
      只要能读到描述文件，就能用你的渠道额度。
    </p>

    <h3 id="bridge-headers">11.2 请求头白名单</h3>
    <p>桥转发到上游的客户端头是一张 6 项白名单，其余一律丢弃：</p>
    <pre>
      <code>
        anthropic-version anthropic-beta openai-organization openai-project x-opencode-session
        user-agent
      </code>
    </pre>
    <p>
      <code>x-opencode-session</code> 的存在有个具体原因：某些网关要求每个会话带稳定的会话头，
      缺了直接返回 400。桥生成不出这个值（它必须跨请求稳定且与会话一一对应），只能原样透传。 桥对
      <strong>头值从不记录</strong>，日志里只有「这个头在不在」的布尔值。
    </p>
    <p>
      客户端没带 User-Agent 时，兜底值是 <code>sparkwork-cli-bridge</code>， 这样上游不会看到 Node
      的默认 UA。
    </p>

    <h3 id="bridge-limits">11.3 体积与流式</h3>
    <table>
      <thead>
        <tr>
          <th>项</th>
          <th>上限</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>请求体</td>
          <td>
            32 MiB（超出返回 <code>413 request_too_large</code>）
          </td>
        </tr>
        <tr>
          <td>未完成的 SSE 累积缓冲</td>
          <td>8 MiB</td>
        </tr>
      </tbody>
    </table>
    <p>
      请求体是<strong>全量缓冲成字符串再转发</strong>，即使 <code>stream:true</code>{' '}
      也不做背压转发。
    </p>
    <p>
      流式响应按<strong>完整 SSE 帧</strong>转发，帧边界取 <code>\n\n</code> 与{' '}
      <code>\r\n\r\n</code> 中较早的一个。 上游中途断流时，半截 JSON 会被丢弃，然后追加一个
      <strong>协议原生形状</strong>的错误帧—— Anthropic 用{' '}
      <code>&#123;type:"error", error:&#123;type:"bridge_stream_error"…&#125;&#125;</code>， OpenAI
      用 <code>&#123;code:"bridge_stream_error"…&#125;</code>
      ——这样下游解析器不会看到两个事件被粘在一起。 连接 EOF
      处那个「天然完整」的尾帧还要再验一次能否解析成合法 JSON 或 <code>[DONE]</code>。
    </p>

    <h3 id="bridge-credential">11.4 凭据是怎么用的</h3>
    <p>
      凭据链路是：URL 里的 providerId → 桌面 SQLite 里的渠道行 → 系统钥匙串。 桥
      <strong>每次代理请求现取一次凭据，不缓存</strong>；取到空串就返回 503。
    </p>
    <blockquote>
      <p>
        <strong>但那个 503 的错误码永远到不了调用方。</strong>
        桥的通用错误处理规则是「状态码 &lt; 500 时回传原始消息，否则统一返回
        <code>bridge_request_failed</code>」，而凭据缺失恰好是 503。 所以 CLI 侧只会看到{' '}
        <code>&#123;"error":"bridge_request_failed"&#125;</code>；
        想知道到底是「凭据没了」还是别的，得去翻桌面端日志。
      </p>
    </blockquote>
    <p>
      凭据只写进上游请求的 <code>x-api-key</code>（Anthropic）或 <code>authorization: Bearer</code>
      （OpenAI）， 且会<strong>覆盖</strong>客户端传来的同名头——调用方无法用自己的值顶替。
      回传给调用方的响应头也只是一张固定白名单（<code>content-type</code>、<code>retry-after</code>
      、<code>request-id</code> 及两个厂商的 request-id）。 目录响应里不含任何密钥。
    </p>
    <p>
      另外，桥本身<strong>不做 sk- 之类的密钥模式脱敏</strong>，只做控制字符清洗与 1024 字符截断。
      正常路径上密钥不会出现在响应体里，但如果上游把密钥回显到错误文本里，桥不会主动擦掉。
    </p>

    <h2 id="data">12. 数据落点与配置分层</h2>

    <h3 id="spark-home">
      12.1 <code>~/.spark</code> 里到底有什么
    </h3>
    <p>
      全局根的解析是 <code>SPARK_HOME ?? ~/.spark</code>。真实落盘项：
    </p>
    <table>
      <thead>
        <tr>
          <th>路径</th>
          <th>内容</th>
          <th>权限</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>config.toml</code>
          </td>
          <td>全局配置层</td>
          <td>文件 0600 / 目录 0700</td>
        </tr>
        <tr>
          <td>
            <code>credentials.json</code>
          </td>
          <td>账号会话（含 token / refreshToken）</td>
          <td>0600</td>
        </tr>
        <tr>
          <td>
            <code>projects/&lt;编码目录&gt;/&lt;sessionId&gt;/events.jsonl</code>
          </td>
          <td>会话账本</td>
          <td>—</td>
        </tr>
        <tr>
          <td>
            <code>artifacts/&lt;sha256 前 2 位&gt;/&lt;sha256&gt;</code>
          </td>
          <td>工具结果制品</td>
          <td>—</td>
        </tr>
        <tr>
          <td>
            <code>settings.json</code>
          </td>
          <td>Hooks 的 user 作用域配置</td>
          <td>—</td>
        </tr>
        <tr>
          <td>
            <code>hosts/sparkwork/</code>
          </td>
          <td>桌面桥描述文件目录</td>
          <td>目录 0700</td>
        </tr>
        <tr>
          <td>
            <code>update-check.json</code>
          </td>
          <td>更新提示的最近检查时间与版本</td>
          <td>—</td>
        </tr>
        <tr>
          <td>
            <code>update.lock</code>
          </td>
          <td>更新并发锁</td>
          <td>—</td>
        </tr>
        <tr>
          <td>
            <code>bin/</code>
          </td>
          <td>
            <code>spark install</code> 的默认 launcher 目录
          </td>
          <td>—</td>
        </tr>
      </tbody>
    </table>

    <h3 id="project-spark">
      12.2 项目级 <code>.spark</code>
    </h3>
    <p>
      以 <code>process.cwd()</code> 为根，<strong>不会向上查找父目录</strong>：
    </p>
    <table>
      <thead>
        <tr>
          <th>路径</th>
          <th>内容</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>.spark/config.toml</code>
          </td>
          <td>项目配置层，覆盖全局</td>
        </tr>
        <tr>
          <td>
            <code>.spark/todos.json</code>
          </td>
          <td>
            <code>spark todo</code> 的任务清单
          </td>
        </tr>
        <tr>
          <td>
            <code>.spark/plans/&lt;sessionId&gt;.md</code>
          </td>
          <td>
            <code>spark plan</code> 的会话计划
          </td>
        </tr>
        <tr>
          <td>
            <code>.spark/settings.json</code> / <code>settings.local.json</code>
          </td>
          <td>项目级 Hooks 配置</td>
        </tr>
        <tr>
          <td>
            <code>.spark/skills</code>
          </td>
          <td>项目级技能</td>
        </tr>
      </tbody>
    </table>

    <h3 id="memory-exception">12.3 记忆是那个例外</h3>
    <p>
      长期记忆
      <strong>
        不在 <code>~/.spark</code> 下
      </strong>
      ，而在：
    </p>
    <pre>
      <code>~/.spark-agent/memory/&lt;scope&gt;/</code>
    </pre>
    <p>
      默认根是 <code>SPARK_AGENT_HOME ?? ~/.spark-agent</code>， 而 CLI 构造记忆存储时
      <strong>不传自定义 home</strong>， 所以
      <strong>
        设置 <code>SPARK_HOME</code> 对记忆完全无效
      </strong>
      。这是一个非常容易踩的坑： 你以为把 <code>SPARK_HOME</code>{' '}
      指到别处就隔离了全部状态，实际记忆还留在原处。
    </p>
    <p>
      项目作用域的记忆目录名是 <code>.spark-agent/memory</code>（注意是 <code>.spark-agent</code>
      ，不是 <code>.spark</code>）， 而且它会<strong>逐级向上查找第一个已存在的目录</strong>
      ——这一点与 todo / plan 只认当前目录的行为不同。
    </p>

    <h3 id="config-layers">12.4 配置分层与合并</h3>
    <p>
      两层合并规则是「全局在下、项目在上，项目赢」，实现为
      <strong>对象递归合并、数组与标量整体替换</strong>。 真实的 section 与 key 只有这些：
    </p>
    <table>
      <thead>
        <tr>
          <th>section</th>
          <th>键</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>[agent]</code>
          </td>
          <td>
            <code>model</code>、<code>permission_mode</code>、<code>reasoning_effort</code>、
            <code>failover</code>、<code>max_retries</code>、<code>retry_initial_delay_ms</code>、
            <code>retry_max_delay_ms</code>、<code>retry_jitter_ratio</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>[providers.&lt;id&gt;]</code>
          </td>
          <td>
            <code>protocol</code>、<code>base_url</code>、<code>api_key_env</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>[models.&lt;id&gt;]</code>
          </td>
          <td>
            <code>provider</code>、<code>model</code>、<code>context_window</code>、
            <code>max_tokens</code>、<code>capabilities</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>[permissions]</code>
          </td>
          <td>
            <code>mode</code>、<code>allow</code>、<code>deny</code>、<code>ask</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>[tools]</code>
          </td>
          <td>
            <code>enabled</code>、<code>disabled</code>（二者互斥）
          </td>
        </tr>
        <tr>
          <td>
            <code>[mcp]</code> / <code>[mcp.servers.&lt;name&gt;]</code>
          </td>
          <td>
            <code>startup_timeout_ms</code>；<code>enabled</code>、<code>command</code>、
            <code>args</code>、<code>env</code>、<code>cwd</code>、<code>url</code>、
            <code>headers</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>[memory]</code>
          </td>
          <td>
            <code>enabled</code>、<code>max_inject_tokens</code>、<code>agent_id</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>[platform]</code>
          </td>
          <td>
            <code>server_url</code>、<code>web_login_url</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>[update]</code>
          </td>
          <td>
            <code>base_url</code>、<code>version</code>、<code>enabled</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      <strong>根 schema 是 strict 的</strong>：写一个不存在的键不是被静默丢弃，而是报错退出 2。 所以{' '}
      <code>spark config set foo bar</code> 会失败。
    </p>
    <blockquote>
      <p>
        <strong>表级递归合并有一个隐蔽的坑。</strong>
        如果全局写了 <code>mcp.servers.x.url</code>、项目层写了 <code>mcp.servers.x.command</code>，
        合并结果是<strong>两者共存</strong>，而 schema 明确禁止 <code>command</code> 与{' '}
        <code>url</code> 同时出现。 于是所有读配置的命令都会退出 2。修复只能用{' '}
        <code>spark config unset</code>（写前校验的是合并后的结果）。
      </p>
    </blockquote>

    <h2 id="subcommands">13. 子命令逐个说</h2>

    <h3 id="sub-auth">
      13.1 <code>login</code> / <code>logout</code> / <code>whoami</code>
    </h3>
    <p>
      登录走的是<strong>浏览器 + PKCE + 轮询</strong>，不是设备码，也不是本地回调：
    </p>
    <ol>
      <li>
        生成 <code>state</code>、<code>codeVerifier</code>（各 32 字节随机数的 hex），
        <code>codeChallenge = sha256(verifier)</code>；
      </li>
      <li>
        拼出 <code>?desktop=1&amp;state=…&amp;challenge=…</code> 的登录页并打开浏览器；
      </li>
      <li>
        轮询服务端 <code>GET /auth/desktop/poll?state=</code>，
        <strong>间隔 2 秒、总超时 300 秒</strong>；
      </li>
      <li>
        成功后一次性 <code>POST /auth/desktop/exchange</code> 换回会话。
      </li>
    </ol>
    <p>
      <code>state</code> 与 verifier <strong>只存在进程内存里</strong>，交换成功前不写盘。
      <code>--no-browser</code> 只打印登录链接，适合远程或容器环境。 轮询间隔与超时
      <strong>没有对应的命令行开关</strong>（它们只是测试注入口）。
    </p>
    <pre>
      <code>
        spark login --no-browser # 打印链接，自己在浏览器打开 spark whoami # 显示当前账号与服务器
        spark logout # 删除本地凭据
      </code>
    </pre>
    <p>
      <code>credentials.json</code> 的结构是
      <code>
        &#123;version, serverUrl, session:&#123;token, refreshToken, userId&#125;, account?,
        updatedAt&#125;
      </code>
      ， 写入时 0600；如果加载时发现权限被放宽，会<strong>自动 chmod 回 0600</strong>。
      文件损坏或字段不符会直接报错，<strong>不会静默登出</strong>。
    </p>
    <blockquote>
      <p>
        <strong>
          <code>spark logout</code> 只删本地文件，不调用任何服务端吊销接口。
        </strong>
        CLI 使用的服务端端点里根本没有 logout / revoke， 所以「登出后旧 token
        在服务端是否还有效」在代码层面无法确认——按仍然有效来处理更安全。
      </p>
    </blockquote>
    <p>
      <code>whoami</code> 用的是
      <strong>
        存储里的 <code>serverUrl</code>
      </strong>
      （不是当前配置里的）， 两者不一致只在 stderr 提示。会话过期时会<strong>清空凭据</strong>并退出
      1。
    </p>

    <h3 id="sub-config">
      13.2 <code>config</code>
    </h3>
    <table>
      <thead>
        <tr>
          <th>子命令</th>
          <th>行为</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>spark config</code> / <code>list</code>
          </td>
          <td>
            列出生效配置，每行 <code>key = value [scope]</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>get &lt;key&gt;</code>
          </td>
          <td>
            text 模式<strong>打印原始值</strong>；<code>--json</code> 给完整条目
          </td>
        </tr>
        <tr>
          <td>
            <code>set &lt;key&gt; &lt;value&gt;</code>
          </td>
          <td>
            默认写<strong>全局</strong>层；<code>--project</code> 写项目层
          </td>
        </tr>
        <tr>
          <td>
            <code>unset &lt;key&gt;</code>
          </td>
          <td>
            从默认（全局）层删除；键不存在<strong>退出 2</strong>
          </td>
        </tr>
        <tr>
          <td>
            <code>path</code>
          </td>
          <td>打印全局与项目的配置文件路径，并标注是否已创建</td>
        </tr>
      </tbody>
    </table>
    <p>两个必须注意的口径：</p>
    <ul>
      <li>
        <code>config list</code> 只反映<strong>显式写过的键</strong>，schema 默认值不出现；
      </li>
      <li>
        <code>config get</code> 读的是合并结果，<strong>看不到 schema 默认值</strong>——
        比如配置文件里没写 <code>agent.max_retries</code>，<code>get</code> 会说「not
        set」，尽管运行时默认是 2。
      </li>
    </ul>
    <p>
      取值解析规则：以 <code>[</code> / <code>&#123;</code> 开头按 JSON 解析成数组或对象；
      <code>true</code>/<code>false</code> 转布尔；纯数字转 number；带引号会剥掉引号。
    </p>

    <h3 id="sub-mcp">
      13.3 <code>mcp</code>
    </h3>
    <p>stdio 与 http 两种服务器的配置形状：</p>
    <pre>
      <code>
        [mcp.servers.filesystem] command = "npx" args = ["-y",
        "@modelcontextprotocol/server-filesystem", "/tmp"] env = &#123; TOKEN = "abc" &#125; cwd =
        "/tmp" [mcp.servers.remote] url = "https://example.com/mcp" headers = &#123; Authorization =
        "Bearer xyz" &#125;
      </code>
    </pre>
    <p>schema 强制几条约束，违反会直接退出 2：</p>
    <ul>
      <li>
        <code>command</code> 与 <code>url</code> <strong>必须二选一</strong>；
      </li>
      <li>
        <code>args</code> / <code>env</code> / <code>cwd</code> 只能配 <code>command</code>；
      </li>
      <li>
        <code>headers</code> 只能配 <code>url</code>；
      </li>
      <li>
        服务名要求 <code>^[A-Za-z0-9._:-]&#123;1,96&#125;$</code>。
      </li>
    </ul>
    <p>
      <code>spark mcp add</code> 写的是<strong>整表替换</strong>
      ：同名服务器的原有字段会被清掉，不是字段级合并。 要临时关闭某个服务器，只能
      <code>spark config set mcp.servers.&lt;name&gt;.enabled false</code>，<code>add</code>{' '}
      本身不提供关闭选项。
    </p>
    <p>
      <code>spark mcp status</code> 会<strong>真的把每个启用的服务器拉起来</strong>： 串行启动、每个
      15 秒超时，读注册表里 <code>mcp__&lt;name&gt;__</code> 前缀的工具，然后关闭。 任一失败即退出
      1。所以它是真实连接测试，不是读配置文件。 因为要展开 <code>$&#123;VAR&#125;</code>
      ，环境变量缺失会报错退出 2，而 <code>mcp list</code> 不展开变量所以不会。
    </p>

    <h3 id="sub-memory">
      13.4 <code>memory</code>
    </h3>
    <table>
      <thead>
        <tr>
          <th>子命令</th>
          <th>作用</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>list</code>
          </td>
          <td>列出记忆摘要（不含正文）</td>
        </tr>
        <tr>
          <td>
            <code>search &lt;q&gt;</code>
          </td>
          <td>按摘要检索</td>
        </tr>
        <tr>
          <td>
            <code>recall &lt;id&gt;</code>
          </td>
          <td>
            读取一条完整记忆（含正文）；<strong>会写盘</strong>——命中计数 +1
          </td>
        </tr>
        <tr>
          <td>
            <code>save</code>
          </td>
          <td>
            写入一条记忆，需要 <code>--scope</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      <strong>
        <code>--type</code> 与 <code>--scope</code> 是两个不同域的枚举
      </strong>
      ，这点最容易搞混：
    </p>
    <table>
      <thead>
        <tr>
          <th>枚举</th>
          <th>取值</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>--scope</code>
          </td>
          <td>
            <code>user</code> | <code>project</code> | <code>agent</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>--type</code>
          </td>
          <td>
            <code>user</code> | <code>feedback</code> | <code>project</code> |{' '}
            <code>reference</code> ——
            <strong>
              没有 <code>agent</code>
            </strong>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      不指定 <code>--type</code> 时按 scope 推导：<code>project</code> scope 落成{' '}
      <code>type: project</code>，
      <strong>
        其余（含 agent）都落成 <code>type: user</code>
      </strong>
      。 所以「agent 作用域的记忆类型是 agent」是错的。
    </p>
    <p>几条实用口径：</p>
    <ul>
      <li>
        <code>--confidence</code> 取值范围 0–1（含端点）；<code>--limit</code> 是 1–100；
      </li>
      <li>
        同名条目是<strong>覆盖而非新增</strong>（按 name 在目标作用域内查，命中就沿用原 id 重写）；
      </li>
      <li>
        <code>list</code> 的排序<strong>不是</strong> user→project→agent，而是按类型优先级{' '}
        <code>feedback</code> &lt; <code>user</code> &lt; <code>project</code> &lt;{' '}
        <code>reference</code>，再按更新时间倒序；
      </li>
      <li>
        手写 <code>.md</code> 放进目录<strong>不会被识别</strong>——id 必须匹配{' '}
        <code>^(usr|prj|agt)_…</code>，否则整条跳过；
      </li>
      <li>
        <code>[memory].enabled = false</code> <strong>不阻止 CLI 读写</strong>，它只影响提示词注入。
      </li>
    </ul>

    <h3 id="sub-plan">
      13.5 <code>plan</code>
    </h3>
    <p>
      会话计划是<strong>会话私有</strong>的 Markdown，落在{' '}
      <code>&lt;cwd&gt;/.spark/plans/&lt;sessionId&gt;.md</code>， 与项目级的 todo 刻意分开。CLI
      与模型工具<strong>共用同一个 store</strong>， 所以 <code>spark plan show</code>{' '}
      读到的就是模型写下的计划。
    </p>
    <table>
      <thead>
        <tr>
          <th>子命令</th>
          <th>行为</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>show</code>（别名 <code>read</code>）
          </td>
          <td>打印当前计划；没有则打印提示并退出 0</td>
        </tr>
        <tr>
          <td>
            <code>set</code>（别名 <code>write</code>）
          </td>
          <td>
            整体覆写，需要 <code>--body</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>append</code>
          </td>
          <td>读出现有计划，用空行拼接后整体写回</td>
        </tr>
        <tr>
          <td>
            <code>clear</code>
          </td>
          <td>删除该文件；文件不存在仍退出 0</td>
        </tr>
      </tbody>
    </table>
    <p>
      不写 <code>--session</code> 时默认用<strong>该项目下更新时间最新的会话</strong>；
      一条会话都没有才报错退出 2。sessionId 有格式校验（只允许 <code>[A-Za-z0-9._-]</code>
      、≤128、不含 <code>..</code>）， 单文件上限 256 KB。
    </p>
    <p>
      有个校验缺口：<code>plan set &lt;任意合法 id&gt;</code> <strong>不校验该会话是否存在</strong>
      ， 会直接给你创建一个 <code>.spark/plans/&lt;id&gt;.md</code>。
    </p>

    <h3 id="sub-skills">
      13.6 <code>skills</code>
    </h3>
    <p>技能从四个宿主根发现，再加上每个祖先目录下的同名四兄弟（越深越优先）：</p>
    <pre>
      <code>~/.claude/skills ~/.codex/skills ~/.agents/skills ~/.spark/skills</code>
    </pre>
    <p>
      <code>spark skills list [query]</code> 按 name / description / id 做子串匹配， 默认上限{' '}
      <strong>200</strong> 条（超出会被截断且<strong>不提示</strong>）；
      <code>--limit</code> 允许 1–200。
    </p>
    <p>
      <code>spark skills read &lt;id-or-name&gt;</code> 打印完整的 <code>SKILL.md</code> 正文，
      <code>--json</code> 时正文字段名是{' '}
      <strong>
        <code>instructions</code>
      </strong>
      。 目录扫描时每个技能只读前 16 KB 解析 frontmatter，整文件上限 256 KB； 再次加载会校验 name
      与目录清单一致，不一致报 <code>changed_document</code>。
    </p>
    <blockquote>
      <p>
        <strong>桌面里装的技能在 CLI 里看不到。</strong>
        桌面的托管技能目录是应用数据目录下的 <code>skills/</code>， CLI 侧
        <strong>完全不引用它</strong>；两边只共享上面那四个宿主目录。
      </p>
    </blockquote>

    <h3 id="sub-todo">
      13.7 <code>todo</code>
    </h3>
    <p>
      任务是单个 JSON 文件 <code>&lt;cwd&gt;/.spark/todos.json</code>， 结构是{' '}
      <code>
        &#123;version:1,
        items:[&#123;id,title,status,priority,notes,createdAt,updatedAt&#125;]&#125;
      </code>
      ， 最多 1000 条。id 形如 <code>todo_&lt;uuid&gt;</code>。
    </p>
    <table>
      <thead>
        <tr>
          <th>枚举</th>
          <th>取值</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>--status</code>
          </td>
          <td>
            <code>pending</code> | <code>in_progress</code> | <code>completed</code> |{' '}
            <code>cancelled</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>--priority</code>
          </td>
          <td>
            <code>low</code> | <code>normal</code> | <code>high</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>两条容易错的：</p>
    <ul>
      <li>
        <strong>
          <code>todo list</code> 不传 <code>--limit</code> 是「全量」
        </strong>
        ，不是默认 10 或 20；传了则必须在 1–100 之间。
      </li>
      <li>
        <strong>
          <code>todo clear</code> 只删已完成与已取消
        </strong>
        ；要连待办一起清掉必须加 <code>--all</code>。
      </li>
    </ul>
    <p>
      列表排序是按状态分组（进行中 → 待办 → 已完成 → 已取消），再按优先级降序、更新时间降序。
      <code>add</code> 的 <code>--title</code> 与位置参数<strong>互斥</strong>；标题禁止换行、最长
      240 字符。
    </p>

    <h3 id="sub-aliases">13.8 未公开的别名</h3>
    <p>
      下面这些等价写法
      <strong>
        不在 <code>--help</code> 里
      </strong>
      ，但确实是同一分支：
    </p>
    <table>
      <thead>
        <tr>
          <th>写法</th>
          <th>等价于</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>spark config</code>（无子命令）
          </td>
          <td>
            <code>spark config list</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>spark mcp</code>（无子命令）
          </td>
          <td>
            <code>spark mcp list</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>spark memory add</code>
          </td>
          <td>
            <code>spark memory save</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>spark plan read</code> / <code>write</code>
          </td>
          <td>
            <code>spark plan show</code> / <code>set</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>spark todo delete</code>
          </td>
          <td>
            <code>spark todo remove</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      另一类不一致是「位置参数被静默忽略」：
      <code>spark mcp list &lt;x&gt;</code>、<code>spark config path &lt;x&gt;</code>、
      <code>spark memory list &lt;x&gt;</code>
      都不会报错；而 <code>spark todo list &lt;x&gt;</code> 反而会报用法错误退出 2。
    </p>

    <h2 id="update">14. 版本与更新</h2>

    <h3 id="update-base">14.1 从哪里取版本</h3>
    <p>发布源与版本的解析顺序是两条独立的链：</p>
    <table>
      <thead>
        <tr>
          <th>项</th>
          <th>优先级（高 → 低）</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>发布源</td>
          <td>
            <code>--base</code> → <code>SPARK_RELEASE_BASE</code> → <code>SPARK_INSTALL_BASE</code>{' '}
            → 全局 <code>[update] base_url</code> → 内置地址
          </td>
        </tr>
        <tr>
          <td>固定版本</td>
          <td>
            <code>--target</code> → <code>SPARK_INSTALL_VERSION</code> →{' '}
            <code>[update] version</code>
          </td>
        </tr>
      </tbody>
    </table>
    <blockquote>
      <p>
        <strong>两个容易踩的坑。</strong>
        第一，<code>install.sh</code>{' '}
        <strong>
          只认 <code>SPARK_INSTALL_BASE</code>
        </strong>
        （不认 <code>SPARK_RELEASE_BASE</code>）， 所以设了后者的机器上，<code>spark update</code>{' '}
        与 <code>install.sh</code> 会走<strong>两个不同的源</strong>。 第二，
        <code>SPARK_INSTALL_VERSION</code> / <code>[update] version</code> 一旦设置就会
        <strong>永久钉死</strong>后续每次更新， 而且钉死状态下
        <strong>比当前更旧的版本会被当成「有更新」并执行降级</strong>。
      </p>
    </blockquote>
    <p>
      项目级 <code>.spark/config.toml</code> 里的 <code>[update]</code>{' '}
      <strong>
        只能改 <code>enabled</code>
      </strong>
      ， 它的 <code>base_url</code> 与 <code>version</code> 会被忽略。
    </p>

    <h3 id="update-exit">
      14.2 <code>spark update</code> 的退出码
    </h3>
    <table>
      <thead>
        <tr>
          <th>码</th>
          <th>含义</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>0</code>
          </td>
          <td>
            <strong>有可用更新</strong>（<code>--check</code>）或更新已应用
          </td>
        </tr>
        <tr>
          <td>
            <code>1</code>
          </td>
          <td>已是最新 / 远端更旧 / 预发布被门槛挡住</td>
        </tr>
        <tr>
          <td>
            <code>2</code>
          </td>
          <td>用法错误（由参数解析产生，不是 update 模块）</td>
        </tr>
        <tr>
          <td>
            <code>3</code>
          </td>
          <td>检查或升级失败</td>
        </tr>
        <tr>
          <td>
            <code>4</code>
          </td>
          <td>另一个更新正持有锁</td>
        </tr>
      </tbody>
    </table>
    <p>
      <strong>
        「<code>--check</code> 发现新版本」是 0，不是 1
      </strong>
      —— 「什么都没做」才是 1。这一点与大多数工具的直觉相反。
    </p>
    <p>
      分类顺序也值得注意：先相等 → <code>up_to_date</code>，再比较大小 → <code>remote_older</code>，
      然后是预发布门槛，最后才是 <code>update_available</code>。
      所以「远端是个更旧的预发布版」得到的是 <code>remote_older</code>，不是「有预发布可用」。
    </p>

    <h3 id="update-mechanics">14.3 锁、校验与原子交换</h3>
    <ul>
      <li>
        <strong>并发锁</strong>在 <code>~/.spark/update.lock</code>，内容是
        <code>&#123;pid, token, acquiredAt&#125;</code>，用 <code>open(…, 'wx')</code> 独占创建。
        抢不到时：owner 进程被内核证实已消失（ESRCH）就立刻抢占；否则按{' '}
        <strong>mtime 超过 15 分钟</strong>判为陈旧。 总共只尝试 2 次，第二次仍失败就返回码 4。
      </li>
      <li>
        <strong>
          锁目录刻意不受 <code>SPARK_HOME</code> 影响
        </strong>
        ——把 <code>SPARK_HOME</code> 指到别处并不能换锁位置， 这是为了防止两个更新器竞争同一份安装。
      </li>
      <li>
        <strong>校验是双重的</strong>：下载后比对 tarball 的 sha256 与清单，再校验包内
        <code>package.json</code> 的 <code>name</code> / <code>version</code> 以及 Node engines。
        <code>--target</code> 路径不读 <code>latest.json</code>，改读版本化 tarball 旁边的{' '}
        <code>.sha256</code> sidecar。
      </li>
      <li>
        <strong>交换用两次 rename</strong>（不是符号链接）：旧包改名到
        <code>.spark-agent-backup-&lt;pid&gt;/package</code>，暂存目录改名到正式位置。 换完会重链
        npm bin 与 <code>$SPARK_HOME/bin</code> 两处 launcher，再跑一次健康检查；
        任何一步抛错都会把备份 rename 回去。
      </li>
    </ul>
    <p>
      两个限制：更新只作用于 <code>@spark/agent</code> 的 npm 全局树， 并且只
      <strong>重链默认的两处 launcher</strong>——如果你当初用
      <code>spark install --bin /usr/local/bin</code> 装的，更新后那个 launcher 不会被刷新。
    </p>
    <p>
      被 kill 掉的更新会留下 <code>.spark-agent-stage-*</code> 与备份目录，
      下次更新时会自动修复或清理。
    </p>

    <h3 id="update-notice">14.4 更新提示</h3>
    <p>TUI 启动时会顺手做一次更新检查，规则如下：</p>
    <table>
      <thead>
        <tr>
          <th>项</th>
          <th>值</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>触发条件</td>
          <td>
            非 <code>--plain</code>、非 <code>--json</code>、输出格式是 text、stdin/stdout 都是
            TTY、<code>CI != 'true'</code>、<code>TERM != 'dumb'</code>
          </td>
        </tr>
        <tr>
          <td>检查频率</td>
          <td>
            24 小时一次（缓存在 <code>~/.spark/update-check.json</code>）
          </td>
        </tr>
        <tr>
          <td>硬超时</td>
          <td>4 秒</td>
        </tr>
        <tr>
          <td>打印位置</td>
          <td>
            <strong>stderr</strong>，且在 TUI 退出之后
          </td>
        </tr>
        <tr>
          <td>关闭开关</td>
          <td>
            <code>SPARK_UPDATE_CHECK=0</code>（
            <strong>
              只有字符串 <code>0</code> 有效
            </strong>
            ）或<code>[update] enabled = false</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      <strong>
        <code>SPARK_UPDATE_CHECK=false</code> 不生效
      </strong>
      ，必须是 <code>0</code>。 另外 <code>--json</code> 模式下这次检查<strong>根本不会发起</strong>
      （不是「查了但不打印」）， 因为 <code>--json</code> 会让内部 <code>json</code> 标志为真。
      提示只针对「非预发布且严格更新」；抓取失败也会写缓存时间，避免每次调用都重试。
    </p>

    <h2 id="doctor">15. doctor 与排查</h2>

    <h3 id="doctor-what">
      15.1 <code>spark doctor</code> 看什么
    </h3>
    <p>
      <code>models</code> 与 <code>doctor</code> 走的是<strong>同一个函数</strong>， 区别只是{' '}
      <code>doctor</code> 额外做两件事：检查配置是否可加载、生成安装报告。 输出分几块：
    </p>
    <pre>
      <code>
        SparkWork bridge: connected | not connected Diagnostic: … # 桥不可达时的原因 Stale bridge
        descriptors: N … # 陈旧描述文件数量 Selected model: … # 当前生效模型 Available models: N
        Configuration: ready | error — … # 配置是否可加载 spark on PATH: … # 安装报告 Node
        &lt;版本&gt;: …
      </code>
    </pre>
    <p>
      退出码是「有模型且配置能加载 → 0，否则 1」——<strong>一个模型都没有时 doctor 也返回 1</strong>
      。
    </p>
    <blockquote>
      <p>
        <strong>「Stale bridge descriptors」这个数字与它的文案不符。</strong>
        实现里它统计的是<strong>所有探测失败的候选</strong>
        （包括「进程活着但没应答」「权限读不了」「401」的活实例）， 但文案写成了「left by SparkWork
        instances that are no longer running」。 而且这个数字受「最多探测 8
        个候选」的截断影响。看到非零不必惊慌，先用
        <code>spark doctor</code> 的 <code>Diagnostic</code> 行判断真实原因。
      </p>
    </blockquote>

    <h3 id="troubleshooting">15.2 排查对照表</h3>
    <table>
      <thead>
        <tr>
          <th>现象</th>
          <th>最可能的原因</th>
          <th>怎么确认 / 怎么办</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>Model … is not defined locally or available from SparkWork</code>
          </td>
          <td>
            之前选过的桥路由被写进 <code>[agent].model</code>，而桌面没开
          </td>
          <td>
            重开桌面应用，或在 TUI 里 <code>/model</code> 换回本地模型
          </td>
        </tr>
        <tr>
          <td>
            <code>spark models</code> 里看不到某个桌面渠道
          </td>
          <td>
            该渠道不是 Anthropic，也不是 <code>codexApiKind: 'responses'</code> 的 OpenAI
          </td>
          <td>去桌面 Provider 设置里确认协议标记；普通 chat 渠道不会进桥</td>
        </tr>
        <tr>
          <td>渠道在桌面能用、在 CLI 报错</td>
          <td>
            旧版本桥的地址拼接缺陷：上游地址多了一段 <code>/v1</code>（<code>/vN</code>{' '}
            规则缺失，已在 10.3 所述版本修复）
          </td>
          <td>升级桌面端并重启 CLI；若仍复现，比对拼出的上游 URL</td>
        </tr>
        <tr>
          <td>
            调用返回 <code>bridge_request_failed</code>
          </td>
          <td>桥侧 5xx，多半是凭据缺失（原始码 503 被通用规则掩盖）</td>
          <td>去桌面日志找真实原因；检查该渠道的 Key 是否还在</td>
        </tr>
        <tr>
          <td>所有 Anthropic 渠道都 401</td>
          <td>
            鉴权只实现了 <code>authorization</code> 头，没实现 <code>x-api-key</code>
          </td>
          <td>
            两种头都要接受（Anthropic 协议走 <code>x-api-key</code>）
          </td>
        </tr>
        <tr>
          <td>描述文件明明在却探测不到</td>
          <td>
            文件名不是 <code>bridge-&lt;id&gt;.json</code>，或权限宽于 0600，或 endpoint 不是回环
          </td>
          <td>CLI 侧会分别报 invalid / unreadable；对照 9.2 的约束</td>
        </tr>
        <tr>
          <td>
            <code>spark sessions</code> 里的 id 喂给 <code>--resume</code> 失败
          </td>
          <td>列表显示的是 8 位短 id，匹配用的是完整 id</td>
          <td>
            用 <code>spark sessions --json</code> 取完整 id
          </td>
        </tr>
        <tr>
          <td>
            裸 <code>--resume</code> 报错
          </td>
          <td>它需要 TUI；管道或非 TTY 环境下用不了</td>
          <td>
            改用 <code>--resume &lt;完整id&gt;</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>--continue</code> 没接上历史
          </td>
          <td>当前目录还没有会话，此时会静默开新会话</td>
          <td>
            确认 <code>spark sessions</code> 非空；注意会话按项目目录归档
          </td>
        </tr>
        <tr>
          <td>恢复会话后权限模式变了</td>
          <td>
            给了显式 <code>--permission-mode</code>，它会覆盖账本里的模式
          </td>
          <td>不传该 flag 即沿用会话原模式</td>
        </tr>
        <tr>
          <td>
            <code>-i</code> 加了却没生效
          </td>
          <td>图片只用于一次性任务；配子命令或无提示词都会退出 2</td>
          <td>
            写成 <code>spark -p "…" -i a.png</code>
          </td>
        </tr>
        <tr>
          <td>图片被判格式不支持</td>
          <td>判定按魔数不按扩展名</td>
          <td>确认文件本身真的是 PNG/JPEG/WEBP/GIF</td>
        </tr>
        <tr>
          <td>图片批次被整体拒绝</td>
          <td>超过 20 张 / 单张 20 MiB / 合计 50 MiB 中的任一条</td>
          <td>拆成多轮，或先压缩</td>
        </tr>
        <tr>
          <td>
            加了 <code>--json</code> 却拿不到最终结果
          </td>
          <td>
            <code>--json</code> 给的是事件流，不是结果对象
          </td>
          <td>
            改用 <code>--output-format json</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>--json</code> 报冲突
          </td>
          <td>
            与 <code>--output-format text/json</code> 互斥
          </td>
          <td>
            只保留一个，或显式用 <code>stream-json</code>
          </td>
        </tr>
        <tr>
          <td>子命令输出突然变成 JSON</td>
          <td>
            <code>--output-format</code> 会顺手打开所有子命令的 JSON
          </td>
          <td>
            去掉该 flag，或用 <code>--output-format text</code>
          </td>
        </tr>
        <tr>
          <td>任务被取消想区分于失败</td>
          <td>取消是 130，失败是 1</td>
          <td>按退出码分支处理</td>
        </tr>
        <tr>
          <td>
            脚本里 <code>spark update --check</code> 判定反了
          </td>
          <td>有更新是 0，无更新是 1</td>
          <td>按此语义写判断，别按常规直觉</td>
        </tr>
        <tr>
          <td>更新一直报「另一个更新持有锁」（4）</td>
          <td>上次更新被中断，锁文件还在且未满 15 分钟</td>
          <td>
            确认没有更新的进程后删除 <code>~/.spark/update.lock</code>
          </td>
        </tr>
        <tr>
          <td>更新完 PATH 上的 launcher 没刷新</td>
          <td>
            更新只重链 npm bin 与 <code>$SPARK_HOME/bin</code>
          </td>
          <td>
            用非默认 <code>--bin</code> 装的，更新后需要重跑一次 <code>spark install</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>SPARK_UPDATE_CHECK=false</code> 没关掉提示
          </td>
          <td>
            只有字符串 <code>0</code> 被识别为关闭
          </td>
          <td>
            改成 <code>SPARK_UPDATE_CHECK=0</code>
          </td>
        </tr>
        <tr>
          <td>
            改过 <code>SPARK_HOME</code> 但记忆还在原处
          </td>
          <td>
            记忆根是独立的 <code>SPARK_AGENT_HOME ?? ~/.spark-agent</code>
          </td>
          <td>
            要隔离记忆需同时设 <code>SPARK_AGENT_HOME</code>
          </td>
        </tr>
        <tr>
          <td>放了手写的记忆文件但读不到</td>
          <td>
            id 不符合 <code>(usr|prj|agt)_…</code> 格式会被整条跳过
          </td>
          <td>
            用 <code>spark memory save</code> 生成，而不是手写
          </td>
        </tr>
        <tr>
          <td>所有读配置的命令突然退出 2</td>
          <td>
            全局与项目层各写了 <code>url</code> / <code>command</code>，合并后冲突
          </td>
          <td>
            用 <code>spark config unset</code> 删掉冲突的一侧
          </td>
        </tr>
        <tr>
          <td>
            <code>spark mcp status</code> 很慢
          </td>
          <td>它会串行拉起每个启用的服务器，每个 15 秒超时</td>
          <td>这是预期行为；临时禁用不需要的服务器可提速</td>
        </tr>
        <tr>
          <td>
            桌面里装的技能 <code>skills list</code> 看不到
          </td>
          <td>CLI 只扫四个宿主目录，不读桌面托管目录</td>
          <td>
            把技能放到 <code>~/.claude/skills</code> 等宿主目录，两边都能用
          </td>
        </tr>
        <tr>
          <td>登出后担心 token 还在服务端有效</td>
          <td>
            <code>logout</code> 只删本地文件，没有吊销端点
          </td>
          <td>按「仍然有效」处理；需要真吊销得走服务端渠道</td>
        </tr>
      </tbody>
    </table>

    <h3 id="boundaries">15.3 已知边界</h3>
    <p>下面这些是代码层面能确认的限制或缺口，写在这里避免你按「应该有」去排查：</p>
    <ul>
      <li>
        <strong>
          <code>spark serve</code> 没有实现
        </strong>
        ，只打印一句说明并退出 2。
      </li>
      <li>
        <strong>桥没有开关</strong>，无法通过设置或 IPC 关闭；启动失败也不会重试。
      </li>
      <li>
        <strong>桥没有 CORS / Origin / Host 校验</strong>
        ，同一台机器上能读到描述文件的进程即可使用你的渠道。
      </li>
      <li>
        <strong>桥不缓存凭据</strong>，每个代理请求都重新取一次；也不做密钥模式脱敏。
      </li>
      <li>
        <strong>
          <code>/v1/health</code> 在仓库里没有任何调用方
        </strong>
        。
      </li>
      <li>
        <strong>桥与 CLI 的目录 schema 是两份手写实现</strong>，没有共享类型也没有跨端契约测试；
        任一侧加字段或改名，另一侧只会报「catalog 无效」。
      </li>
      <li>
        <strong>
          桥暴露的 <code>descriptorPath</code> 与 <code>endpoint</code> 生产代码不使用
        </strong>
        ，只有测试读取。
      </li>
      <li>
        <strong>
          进程存活判定只靠 <code>kill(pid, 0)</code>
        </strong>
        ；pid 被系统复用后，残留描述文件将不会被回收。
      </li>
      <li>
        <strong>没有任何命令行开关能改登录轮询间隔与超时</strong>（2 秒 / 300 秒是固定值）。
      </li>
      <li>
        <strong>
          <code>plan set</code> 不校验会话是否存在
        </strong>
        ，可以给不存在的会话创建计划文件。
      </li>
      <li>
        <strong>
          更新提示的 base 解析不含 <code>--base</code>
        </strong>
        ，所以用自定义源时提示可能指向另一个源。
      </li>
      <li>
        <strong>
          <code>install.ps1</code> 的真机行为未验证
        </strong>
        ：脚本头部自述仅做静态评审，且没有清理临时文件的 trap。
      </li>
    </ul>
  </>
)

const content = {
  slug: 'spark-cli',
  toc: [
    { id: 'what', title: '1. 这是什么', level: 2 },
    { id: 'package', title: '1.1 包与入口', level: 3 },
    { id: 'vs-desktop', title: '1.2 与桌面端的关系', level: 3 },
    { id: 'three-clis', title: '1.3 三套容易混淆的「CLI」', level: 3 },
    { id: 'install', title: '2. 安装、卸载与 PATH', level: 2 },
    { id: 'three-installs', title: '2.1 三种安装路径的真实差别', level: 3 },
    { id: 'install-detail', title: '2.2 spark install 做了什么', level: 3 },
    { id: 'uninstall', title: '2.3 卸载的三种粒度', level: 3 },
    { id: 'path', title: '2.4 PATH 与「外来 launcher」', level: 3 },
    { id: 'commands', title: '3. 命令面与参数解析', level: 2 },
    { id: 'subcommand-list', title: '3.1 子命令清单', level: 3 },
    { id: 'flags-global', title: '3.2 「全局 flag」是文档概念，不是解析概念', level: 3 },
    { id: 'prompt', title: '3.3 任务提示词的三种来源', level: 3 },
    { id: 'resume-sentinel', title: '3.4 --resume 的空值哨兵', level: 3 },
    { id: 'output', title: '4. 输出格式', level: 2 },
    { id: 'three-formats', title: '4.1 三态语义', level: 3 },
    { id: 'text-split', title: '4.2 text 模式的 stdout / stderr 分工', level: 3 },
    { id: 'result-object', title: '4.3 --output-format json 的字段', level: 3 },
    { id: 'json-side-effect', title: '4.4 一个容易踩的副作用', level: 3 },
    { id: 'exit', title: '5. 退出码', level: 2 },
    { id: 'exit-oneshot', title: '5.1 一次性任务', level: 3 },
    { id: 'exit-usage', title: '5.2 用法错误统一是 2', level: 3 },
    { id: 'exit-sub', title: '5.3 子命令自带的分支', level: 3 },
    { id: 'sessions', title: '6. 会话与账本', level: 2 },
    { id: 'ledger-path', title: '6.1 会话存在哪里', level: 3 },
    { id: 'session-flags', title: '6.2 三个入口的差别', level: 3 },
    { id: 'session-perm', title: '6.3 恢复时的权限语义', level: 3 },
    { id: 'tui', title: '7. TUI 与 plain REPL', level: 2 },
    { id: 'tui-entry', title: '7.1 什么情况下会进 TUI', level: 3 },
    { id: 'slash', title: '7.2 斜杠命令', level: 3 },
    { id: 'shortcuts', title: '7.3 快捷键', level: 3 },
    { id: 'perm-effort', title: '7.4 权限模式与推理强度', level: 3 },
    { id: 'plain-repl', title: '7.5 --plain 到底是什么', level: 3 },
    { id: 'images', title: '8. 图片附件', level: 2 },
    { id: 'image-limits', title: '8.1 格式与限额', level: 3 },
    { id: 'image-rules', title: '8.2 两条约束', level: 3 },
    { id: 'bridge', title: '9. 桌面联动：本地桥', level: 2 },
    { id: 'bridge-what', title: '9.1 桥是什么', level: 3 },
    { id: 'bridge-descriptor', title: '9.2 描述文件', level: 3 },
    { id: 'bridge-discovery', title: '9.3 发现与选主', level: 3 },
    { id: 'bridge-endpoints', title: '9.4 桥的全部端点', level: 3 },
    { id: 'bridge-models', title: '10. 哪些渠道会被桥接', level: 2 },
    { id: 'protocol-rule', title: '10.1 协议判定规则', level: 3 },
    { id: 'exclusions', title: '10.2 排除集', level: 3 },
    { id: 'upstream-url', title: '10.3 上游地址如何推导（含一处不一致）', level: 3 },
    { id: 'models-view', title: '10.4 在 spark models 里长什么样', level: 3 },
    { id: 'bridge-security', title: '11. 桥的安全模型', level: 2 },
    { id: 'bridge-authz', title: '11.1 三道约束', level: 3 },
    { id: 'bridge-headers', title: '11.2 请求头白名单', level: 3 },
    { id: 'bridge-limits', title: '11.3 体积与流式', level: 3 },
    { id: 'bridge-credential', title: '11.4 凭据是怎么用的', level: 3 },
    { id: 'data', title: '12. 数据落点与配置分层', level: 2 },
    { id: 'spark-home', title: '12.1 ~/.spark 里到底有什么', level: 3 },
    { id: 'project-spark', title: '12.2 项目级 .spark', level: 3 },
    { id: 'memory-exception', title: '12.3 记忆是那个例外', level: 3 },
    { id: 'config-layers', title: '12.4 配置分层与合并', level: 3 },
    { id: 'subcommands', title: '13. 子命令逐个说', level: 2 },
    { id: 'sub-auth', title: '13.1 login / logout / whoami', level: 3 },
    { id: 'sub-config', title: '13.2 config', level: 3 },
    { id: 'sub-mcp', title: '13.3 mcp', level: 3 },
    { id: 'sub-memory', title: '13.4 memory', level: 3 },
    { id: 'sub-plan', title: '13.5 plan', level: 3 },
    { id: 'sub-skills', title: '13.6 skills', level: 3 },
    { id: 'sub-todo', title: '13.7 todo', level: 3 },
    { id: 'sub-aliases', title: '13.8 未公开的别名', level: 3 },
    { id: 'update', title: '14. 版本与更新', level: 2 },
    { id: 'update-base', title: '14.1 从哪里取版本', level: 3 },
    { id: 'update-exit', title: '14.2 spark update 的退出码', level: 3 },
    { id: 'update-mechanics', title: '14.3 锁、校验与原子交换', level: 3 },
    { id: 'update-notice', title: '14.4 更新提示', level: 3 },
    { id: 'doctor', title: '15. doctor 与排查', level: 2 },
    { id: 'doctor-what', title: '15.1 spark doctor 看什么', level: 3 },
    { id: 'troubleshooting', title: '15.2 排查对照表', level: 3 },
    { id: 'boundaries', title: '15.3 已知边界', level: 3 },
  ],
  faq: [
    {
      question: '不装 Spark CLI 能用吗？',
      answer:
        '能。桌面应用内置了完整的 spark 引擎，SDK 在进程内运行。CLI 只在你需要终端命令、TUI、脚本化调用（--output-format json）或把任务接进 shell 流水线时才需要单独安装。',
    },
    {
      question: '为什么 spark models 里看不到我在桌面上配的渠道？',
      answer:
        '桥的筛选规则很窄：只有 Anthropic 协议渠道，以及显式标记 codexApiKind 为 responses 的 OpenAI 渠道会被暴露。普通走 /chat/completions 的 OpenAI 兼容渠道（含通义千问、Google Gemini 这类未标记 codexApiKind 的预设）在 CLI 里完全不可见。另外已禁用的渠道与图片类型渠道也不出现。',
    },
    {
      question: 'spark logout 之后服务端 token 会失效吗？',
      answer:
        '代码层面无法确认会失效。spark logout 只删除本地的 ~/.spark/credentials.json，CLI 使用的服务端端点里没有任何 logout 或 revoke 接口。按「token 仍然有效」来处理更安全；需要真正吊销要走服务端渠道。',
    },
    {
      question: '--json 和 --output-format json 有什么区别？',
      answer:
        '--json 是历史兼容选项，输出的是事实事件 NDJSON 流，不含流式 delta。--output-format json 输出的是一行最终结果对象（含 sessionId、turnId、status、message、terminal）。要拿结构化结果用后者。--json 与 --output-format text 或 json 同时出现会报冲突，但与 stream-json 组合是合法的。',
    },
    {
      question: 'spark sessions 列出的 id 为什么不能直接用于 --resume？',
      answer:
        '列表显示的是去掉 session_ 前缀后的 8 位短 id，而 --resume 做的是完整 id 的精确字符串匹配。用 spark sessions --json 取完整 id，或在 TUI 里用 /status 查看。',
    },
    {
      question: '改 SPARK_HOME 能隔离全部状态吗？',
      answer:
        '不能。配置、会话账本、凭据、桥描述文件确实跟着 SPARK_HOME 走，但长期记忆的根是独立的 SPARK_AGENT_HOME，默认 ~/.spark-agent，而 CLI 构造记忆存储时不传自定义路径。要隔离记忆必须同时设置 SPARK_AGENT_HOME。',
    },
    {
      question: '桌面应用关掉后 CLI 还能用吗？',
      answer:
        '能用，但只能用在 ~/.spark/config.toml 里显式配置过的本地模型。桥路由会全部消失：如果你之前用 TUI 选过桥路由，它已被写进 [agent].model，启动时会报 Model <id> is not defined locally or available from SparkWork。重开桌面或换回本地模型即可。',
    },
  ],
  aiSummary:
    'Spark CLI（包名 @spark/agent，命令 spark）是桌面应用之外的第二入口，自带 TUI、一次性任务模式与一组维护子命令。这一页讲清三部分：CLI 自身的命令面（18 个子命令、参数解析的真实边界、三种输出格式的区别、完整退出码表、会话账本的组织方式、TUI 的准入条件与斜杠命令）；桌面联动那条链路（本地回环桥的发现与选主、描述文件协议、几个真实端点、以及哪些渠道会被桥接——只有 Anthropic 与显式标记 responses 的 OpenAI 渠道）；以及 ~/.spark 与项目级 .spark 的数据落点、配置分层的合并规则与各子命令的真实行为。',
  quickReference: [
    { key: '命令', value: 'spark（包名 @spark/agent）' },
    { key: 'Node 要求', value: '>= 22.14.0' },
    { key: '全局数据根', value: 'SPARK_HOME ?? ~/.spark' },
    { key: '记忆数据根', value: 'SPARK_AGENT_HOME ?? ~/.spark-agent（独立于 SPARK_HOME）' },
    { key: '项目级配置', value: '<cwd>/.spark/config.toml（不向上查找父目录）' },
    { key: '会话账本', value: '~/.spark/projects/<编码目录>/<sessionId>/events.jsonl' },
    {
      key: '桥描述文件',
      value: '~/.spark/hosts/sparkwork/bridge-<instanceId>.json（目录 0700 / 文件 0600）',
    },
    { key: '桥绑定', value: '127.0.0.1 + 系统分配临时端口（每次启动都变）' },
    {
      key: '桥端点',
      value:
        'GET /v1/health · GET /v1/catalog · POST /v1/proxy/<providerId>/v1/(messages|responses)',
    },
    { key: '桥路由 id', value: 'sparkwork:<providerId>:<model>' },
    { key: '桥鉴权头', value: 'authorization: Bearer <token> 或 x-api-key: <token>' },
    { key: '桥请求体上限', value: '32 MiB（未完成 SSE 缓冲 8 MiB）' },
    { key: '更新锁', value: '~/.spark/update.lock（不受 SPARK_HOME 影响，陈旧阈值 15 分钟）' },
    { key: '更新提示关闭', value: 'SPARK_UPDATE_CHECK=0（只有字符串 0 生效）' },
    {
      key: '发布源优先级',
      value: '--base → SPARK_RELEASE_BASE → SPARK_INSTALL_BASE → [update] base_url → 内置',
    },
    { key: '退出码 · 一次任务', value: '0 完成 / 1 失败 / 130 取消' },
    { key: '退出码 · 用法', value: '2（含参数解析失败、配置加载失败、模型无法解析）' },
    { key: '退出码 · update', value: '0 有更新或已更新 / 1 无更新 / 2 用法 / 3 失败 / 4 锁冲突' },
    { key: '图片限额', value: '20 张 / 单张 20 MiB / 合计 50 MiB' },
    { key: '图片格式', value: 'PNG · JPEG · WEBP · GIF（按魔数判定，不看扩展名）' },
    { key: '推理强度', value: 'off | low | medium | high | max' },
    { key: '权限模式', value: 'manual | auto | bypass' },
    {
      key: '技能扫描根',
      value: '~/.claude/skills · ~/.codex/skills · ~/.agents/skills · ~/.spark/skills',
    },
    { key: '登录轮询', value: '间隔 2 秒 / 总超时 300 秒（无命令行开关）' },
  ],
  howTo: {
    name: '装好 CLI 并让它用上桌面的渠道',
    description:
      '在 macOS 或 Linux 上安装 Spark CLI，确认安装状态，登录账号，并验证它能发现桌面应用暴露的模型。',
    totalTime: 'PT10M',
    steps: [
      '确认 Node 版本：node -v 应满足 >= 22.14.0。',
      '用官方脚本安装（脚本会下载并校验 sha256），或直接 npm install -g @spark/agent。',
      '跑 spark doctor，确认 Install 区显示 launcher 在 PATH 上且版本与当前安装一致；若提示 not on PATH，按提示把 <binDir> 加进 shell 配置并重启终端。',
      '跑 spark init 生成 ~/.spark/config.toml 起步模板（文件已存在时不会覆盖）。',
      '跑 spark login 完成账号登录；无图形环境时用 spark login --no-browser 拿到链接后自行打开。',
      '用 spark whoami 确认登录状态与服务器地址。',
      '启动桌面应用，等它完成启动后再跑 spark models：来源列标为 [sparkwork] 的行就是桌面暴露的渠道。',
      '注意筛选规则：只有 Anthropic 渠道与显式标记 responses 的 OpenAI 渠道会出现，普通 chat 兼容渠道不会出现。',
      '跑一次真实任务验证：spark -p "用一句话说明这个仓库的用途"；需要结构化输出时改用 spark --output-format json -p "…"。',
      '把常用模型固化下来：在 TUI 里用 /model 选择后会自动写入 ~/.spark/config.toml 的 [agent].model。',
      '需要脚本化时按退出码分支：0 成功、1 失败、130 被取消。',
    ],
  },
  Body,
} satisfies DocsPageContent

export default content
