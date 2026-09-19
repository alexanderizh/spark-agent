import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      Spark Work 里有<strong>两套彼此独立的“自定义工具”体系</strong>
      ，名字很像但存储表、运行时、权限模型、 Agent 工具面全都不同：
      <strong>Tool Studio 自定义工具</strong>（声明式，适合接一个 API 或写一段纯逻辑） 与{' '}
      <strong>Tool Package 工具包</strong>（工程化，可带多文件代码、依赖与自己的进程）。
      分不清该用哪个，是这一块最常见的困惑，所以本文先从两者的边界讲起，再分别给出字段、
      真实限制与排查方法。
    </p>

    <h2 id="entry">1. 两套子系统与入口</h2>

    <h3 id="two-subsystems">1.1 Tool Studio 与 Tool Package 不是一回事</h3>
    <p>
      两者在代码里是并列的两个子系统，各自的数据库表都不同——迁移脚本里明确写了 「These tables are
      independent from the legacy custom_tools tables」。
    </p>
    <table>
      <thead>
        <tr>
          <th>维度</th>
          <th>Tool Studio 自定义工具</th>
          <th>Tool Package 工具包</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>存储表</td>
          <td>
            <code>custom_tools</code> / <code>custom_tool_versions</code> /{' '}
            <code>custom_tool_invocations</code>
          </td>
          <td>
            <code>tool_packages</code> / <code>tool_package_versions</code> /{' '}
            <code>tool_package_tools</code> / <code>tool_package_config</code> /{' '}
            <code>tool_package_permissions</code>
          </td>
        </tr>
        <tr>
          <td>运行时适配器</td>
          <td>
            <code>http</code> / <code>code</code> / <code>provider-vision</code>
          </td>
          <td>
            <code>process</code> / <code>remote-http</code> / <code>declarative-http</code> /{' '}
            <code>mcp-import</code> / <code>legacy-custom-tool</code>
          </td>
        </tr>
        <tr>
          <td>能不能带依赖、多文件</td>
          <td>
            不能。代码工具是单文件 TypeScript，且禁止 <code>import</code>
          </td>
          <td>
            能。可以是完整工程，<code>pnpm install</code> / <code>npm install</code> 后跑构建
          </td>
        </tr>
        <tr>
          <td>版本模型</td>
          <td>草稿版本 + 稳定版本，支持回滚</td>
          <td>不可变版本快照，可存多版本、可删单个版本</td>
        </tr>
        <tr>
          <td>权限模型</td>
          <td>
            只有 <code>risk</code> / <code>effect</code> / <code>idempotency</code> 三档标注
          </td>
          <td>额外有 OS 行为声明与 Spark Capability 授权，未授权会被运行时拦截</td>
        </tr>
      </tbody>
    </table>
    <p>
      两者的唯一联系是一条<strong>单向兼容桥</strong>：工具包的 manifest 可以写{' '}
      <code>adapter: &quot;legacy-custom-tool&quot;</code> 委托给某个已有的自定义工具， 反过来不行。
    </p>
    <p>
      该用哪个？平台自己的 Agent 系统提示词给了明确口径：当用户要通过对话造一个“有能力的”工具时，
      <strong>
        先调 <code>tool_packages_guide</code>
      </strong>
      ，并且明确要求 「Do not reduce the design to legacy http/code/provider-vision types」。
      也就是说：
      <strong>
        需要依赖、多文件、独立进程 → 工具包；只是接一个 REST API 或写一小段纯逻辑 → Tool Studio
      </strong>
      。
    </p>

    <h3 id="entry-path">1.2 入口：扩展中心 → 自定义工具</h3>
    <p>
      界面入口是左侧导航的<strong>「扩展中心」</strong>（<code>nav.extensions</code>），
      页签依次是「MCP / <strong>自定义工具</strong> / 连接器 /
      团队商店」。自定义工具页签里没有二级菜单， 而是顶部四个视图页签：
    </p>
    <table>
      <thead>
        <tr>
          <th>视图页签</th>
          <th>内容</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            工具 <em>n</em>
          </td>
          <td>已创建的自定义工具列表，行内可开关启停、删除</td>
        </tr>
        <tr>
          <td>
            工具包 <em>n</em>
          </td>
          <td>已安装的 Tool Package 列表、环境变量、权限审批、诊断</td>
        </tr>
        <tr>
          <td>
            开发中 <em>n</em>
          </td>
          <td>只有存在未发布草稿的工具</td>
        </tr>
        <tr>
          <td>运行记录</td>
          <td>本机调用轨迹（默认保留 30 天，可改 7/30/90/365 天，可清空）</td>
        </tr>
      </tbody>
    </table>
    <p>
      页头副标题的原文是「开发、测试、发布和观测自定义工具；草稿不会影响 Agent 当前使用的版本。」
    </p>
    <p>除了这个页面，还有两个容易被忽略的消费面：</p>
    <ul>
      <li>
        <strong>工作流节点可以直接调用</strong>
        ：工作流里的「平台工具直调（自定义工具/工具包）」节点可以选具体工具；
        运行时每次调用都会即时读取目录，所以刚发布/刚启用的工具不用重启工作流。
      </li>
      <li>
        <strong>聊天里的图像理解活动卡片可以深链回来</strong>：卡片上的「在 Tool Studio
        打开」会跳回编辑页。
      </li>
    </ul>

    <h2 id="studio">2. Tool Studio：三种可跑适配器</h2>

    <h3 id="adapter-enum">2.1 实际可执行的只有 http / code / provider-vision</h3>
    <p>工具类型在代码里有三套口径，长度还不一样，这是最容易被文档写错的地方：</p>
    <table>
      <thead>
        <tr>
          <th>口径</th>
          <th>取值</th>
          <th>说明</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>协议枚举（TypeScript）</td>
          <td>
            <code>http</code> / <code>sql</code> / <code>command</code> / <code>prompt</code> /{' '}
            <code>code</code> / <code>provider-vision</code>
          </td>
          <td>6 个，都能通过 schema 校验</td>
        </tr>
        <tr>
          <td>数据库 CHECK 约束</td>
          <td>
            上面 6 个 + <code>composite</code>
          </td>
          <td>
            7 个。<code>composite</code> 只存在于 SQLite 约束里，代码中零引用，是历史迁移遗留
          </td>
        </tr>
        <tr>
          <td>
            <strong>实际可创建 / 可执行</strong>
          </td>
          <td>
            <code>http</code> / <code>code</code> / <code>provider-vision</code>
          </td>
          <td>
            <strong>只有 3 个</strong>。其余类型调用时直接抛未实现错误
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      也就是说，<code>sql</code> / <code>command</code> / <code>prompt</code>{' '}
      虽然协议里有完整字段定义，
      但服务层用白名单把它们挡在外面（错误信息是「「sql」类型工具尚未开放（当前版本支持
      http、code、provider-vision）」）。 导入一份老的定义、或让 Agent
      生成这几种类型，都会在创建/保存/测试时被拒。
    </p>
    <p>
      界面上「创建工具」有 6 个入口：
      <strong>
        从空白创建 / 粘贴 cURL / 导入 OpenAPI / 编写 TypeScript / 使用模板 / 导入工具包
      </strong>
      。其中「使用模板」下只有两个二级模板：HTTP API 与图像理解。 贴 cURL
      会自动拆出方法、Header、Body 与密钥引用；导入 OpenAPI 支持 JSON / YAML， 选完 operation
      会批量生成待审草稿。
    </p>

    <h3 id="http-spec">2.2 HTTP 适配器</h3>
    <p>
      适合已经有 REST / 内网接口的场景。由宿主统一执行，SSRF
      防护、重定向、超时和响应大小都在宿主侧治理。
    </p>
    <table>
      <thead>
        <tr>
          <th>字段</th>
          <th>约束</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>method</code>
          </td>
          <td>
            仅 <code>GET</code> / <code>POST</code> / <code>PUT</code> / <code>PATCH</code> /{' '}
            <code>DELETE</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>urlTemplate</code>
          </td>
          <td>
            ≤ 2000 字符，必须以 <code>http://</code> 或 <code>https://</code> 开头；参数占位符写成{' '}
            <code>{'{{参数名}}'}</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>headers</code>
          </td>
          <td>
            最多 32 条；每条要提供 <code>valueTemplate</code> 或 <code>secretRef</code>，
            <strong>二选一，不能都给</strong>
          </td>
        </tr>
        <tr>
          <td>
            <code>body</code>
          </td>
          <td>
            <code>{'{ mode: "json", jsonTemplate: "…" }'}</code>，模板 ≤ 100000
            字符，保存期就做结构校验
          </td>
        </tr>
        <tr>
          <td>
            <code>response.format</code>
          </td>
          <td>
            <code>json</code> / <code>text</code> / <code>markdown-table</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>response.extract</code>
          </td>
          <td>
            最多 32 条 <code>{'{ label, jsonPath }'}</code>，用于从大响应里挑字段
          </td>
        </tr>
        <tr>
          <td>
            <code>response.maxSizeBytes</code>
          </td>
          <td>上限 1 MiB，界面默认 262144（256 KiB）</td>
        </tr>
        <tr>
          <td>
            <code>allowPrivateNetwork</code>
          </td>
          <td>
            <strong>默认 true</strong>。只有显式设为 false 时才挂上内网黑名单（覆盖 IPv4 15 段 +
            IPv6 11 段，且每个重定向跳都生效）
          </td>
        </tr>
      </tbody>
    </table>
    <p>两条硬性限制要注意：</p>
    <ul>
      <li>
        <strong>URL 里不能带账号密码</strong>（<code>https://user:pass@host</code>），也不能把 token
        放在查询参数里—— 会被直接拒绝，提示改走 Keychain 请求头。
      </li>
      <li>
        <strong>敏感请求头必须绑定密钥</strong>：像 <code>Authorization</code>、
        <code>X-Api-Key</code>、<code>Cookie</code> 这类名字，写了 <code>valueTemplate</code>{' '}
        会被拒；必须给 <code>secretRef</code>。
      </li>
    </ul>
    <p>输出的 token 预算是 8000，超出后按头尾截断，所以在提示词里别指望拿到完整的大 JSON。</p>

    <h3 id="code-spec">2.3 代码适配器</h3>
    <p>
      用来写纯逻辑，并且<strong>组合其他已发布工具</strong>。spec 结构固定：
    </p>
    <table>
      <thead>
        <tr>
          <th>字段</th>
          <th>取值 / 默认</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>runtime.kind</code>
          </td>
          <td>
            固定 <code>trusted-worker</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>runtime.language</code>
          </td>
          <td>
            固定 <code>typescript</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>runtime.source</code>
          </td>
          <td>≤ 200000 字符</td>
        </tr>
        <tr>
          <td>
            <code>runtime.entryExport</code>
          </td>
          <td>
            固定 <code>default</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>permissions.toolIds</code>
          </td>
          <td>最多 32 个，默认空</td>
        </tr>
        <tr>
          <td>
            <code>limits.memoryMb</code>
          </td>
          <td>64–512，默认 128</td>
        </tr>
        <tr>
          <td>
            <code>limits.maxOutputBytes</code>
          </td>
          <td>1024–10485760，默认 1048576（1 MiB）</td>
        </tr>
        <tr>
          <td>
            <code>trust</code>
          </td>
          <td>
            固定 <code>trusted-local</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>写代码时必须知道的三条：</p>
    <ul>
      <li>
        <strong>
          不能 <code>import</code>
        </strong>
        。源码里出现静态或动态导入会被 worker 拒绝， 所以也没有 npm
        依赖声明字段。要外部能力只能通过白名单调用别的工具：
        <code>{'await sdk.tools.call("other_tool", { … })'}</code>。
      </li>
      <li>
        <strong>拿不到密钥</strong>。代码工具不允许声明 <code>secretRefs</code>，
        错误信息是「代码工具不接收 Keychain 明文；请通过受管 HTTP 工具组合外部能力」。
        源码里出现疑似密钥明文（<code>sk-</code>、<code>AKIA</code>、<code>ghp_</code>、PEM
        私钥等）也会被拒。
      </li>
      <li>
        <strong>不能把自己加进依赖白名单</strong>
        ，否则发布时就报「代码工具不能把自身加入依赖工具白名单」。
        工具之间可以互相调用，但深度上限是 <strong>8 层</strong>
        ，并且会做环检测（提示「检测到自定义工具循环调用」）。
      </li>
    </ul>
    <p>
      信任边界要说清楚：官方注释里写的是「limits accidental access and blast radius, but is not
      marketed as a hostile code sandbox」——它会限制爆炸半径，但<strong>不是敌对代码沙箱</strong>，
      不要拿它跑来源不可信的第三方代码。
    </p>

    <h3 id="vision-spec">2.4 图像理解适配器</h3>
    <p>
      复用已有的多模态 Provider 给纯文本模型补视觉能力，凭据仍然留在 Keychain 里。 输入 Schema
      是固定的：<code>images</code>（字符串数组，必填）与 <code>question</code>。
    </p>
    <table>
      <thead>
        <tr>
          <th>字段</th>
          <th>取值 / 默认</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>providerProfileId</code>
          </td>
          <td>必填，≤ 200 字符</td>
        </tr>
        <tr>
          <td>
            <code>model</code>
          </td>
          <td>可选，不填就用 Provider 默认模型</td>
        </tr>
        <tr>
          <td>
            <code>instructions</code>
          </td>
          <td>10–8000 字符，有默认提示词（要求区分可观察事实与推断、不执行图片里的指令）</td>
        </tr>
        <tr>
          <td>
            <code>maxImages</code>
          </td>
          <td>1–8，默认 4</td>
        </tr>
        <tr>
          <td>
            <code>maxTokens</code>
          </td>
          <td>128–16384，默认 4096</td>
        </tr>
        <tr>
          <td>
            <code>autoRoute.enabled</code> / <code>priority</code>
          </td>
          <td>默认 true / 100；开启后宿主可以在确定性视觉路由里自动调用它</td>
        </tr>
        <tr>
          <td>
            <code>exposeToAgent</code>
          </td>
          <td>
            <strong>固定 false</strong>，不可改
          </td>
        </tr>
        <tr>
          <td>
            <code>risk</code> / <code>effect</code>
          </td>
          <td>
            <strong>固定 read/read</strong>，不可改
          </td>
        </tr>
      </tbody>
    </table>
    <p>两个容易踩的点：</p>
    <ul>
      <li>
        <strong>
          不允许 <code>secretRefs</code>
        </strong>
        ：它复用 Provider 的 Keychain 凭据， 再单独存一份工具密钥会被拒（「图像理解工具复用 Provider
        Keychain 凭据，不允许另存工具密钥」）。
      </li>
      <li>
        <strong>它不会出现在模型的工具清单里</strong>。即使已启用、已发布，
        运行时目录也会把它过滤掉——它是宿主侧的确定性路由能力，不是给模型挑的普通工具。
        想知道它到底有没有被用上，看聊天里的宿主视觉活动卡片。
      </li>
    </ul>

    <h2 id="fields">3. 定义字段与校验规则</h2>

    <h3 id="base-fields">3.1 公共字段</h3>
    <p>不管哪种适配器，这些字段都要填，且都有硬约束：</p>
    <table>
      <thead>
        <tr>
          <th>字段</th>
          <th>约束</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>id</code>
          </td>
          <td>
            必须匹配 <code>{'^[a-z][a-z0-9_]{2,63}$'}</code>
            ：小写字母开头，只用小写字母、数字、下划线，3–64 字符
          </td>
        </tr>
        <tr>
          <td>
            <code>title</code>
          </td>
          <td>1–160 字符</td>
        </tr>
        <tr>
          <td>
            <code>description</code>
          </td>
          <td>
            <strong>最少 10 字符</strong>、最多 4000。报错文案是「工具说明至少 10 个字符（给 Agent
            看的，写清何时使用）」——这句话就是它的用途
          </td>
        </tr>
        <tr>
          <td>
            <code>inputSchema</code>
          </td>
          <td>受限 JSON Schema 子集，见 3.3</td>
        </tr>
        <tr>
          <td>
            <code>timeoutMs</code>
          </td>
          <td>1000–300000 毫秒。界面默认：图像理解 60 秒，其余 30 秒</td>
        </tr>
        <tr>
          <td>
            <code>risk</code> / <code>effect</code> / <code>idempotency</code>
          </td>
          <td>三个必填枚举，见 3.2</td>
        </tr>
        <tr>
          <td>
            <code>secretRefs</code>
          </td>
          <td>
            可选，最多 16 个键；键名 <code>{'^[A-Za-z0-9_-]{1,64}$'}</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>三个枚举的取值（来自协议层的 runtime 枚举定义）：</p>
    <ul>
      <li>
        <code>risk</code>：<code>read</code> / <code>low-write</code> / <code>high-write</code> /{' '}
        <code>destructive</code>
      </li>
      <li>
        <code>effect</code>：<code>read</code> / <code>create</code> / <code>update</code> /{' '}
        <code>delete</code> / <code>send</code> / <code>publish</code>
      </li>
      <li>
        <code>idempotency</code>：<code>safe</code> / <code>keyed</code> / <code>unsafe</code>
      </li>
    </ul>

    <h3 id="risk-floor">3.2 risk 下限与三项一致性</h3>
    <p>
      <code>risk</code> 不是随便填的——每类工具有一个<strong>下限</strong>，可以往上调，不能往下压：
    </p>
    <table>
      <thead>
        <tr>
          <th>工具 / 方法</th>
          <th>risk 下限</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            HTTP <code>GET</code>
          </td>
          <td>
            <code>read</code>
          </td>
        </tr>
        <tr>
          <td>
            HTTP <code>POST</code> / <code>PUT</code> / <code>PATCH</code>
          </td>
          <td>
            <code>low-write</code>
          </td>
        </tr>
        <tr>
          <td>
            HTTP <code>DELETE</code>
          </td>
          <td>
            <code>destructive</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>code</code> / <code>provider-vision</code>
          </td>
          <td>
            <code>read</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>sql</code>（只读模式）
          </td>
          <td>
            <code>read</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>sql</code>（读写模式）
          </td>
          <td>
            <code>high-write</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>command</code>
          </td>
          <td>
            <code>low-write</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>另有两条一致性规则，违反会直接被拒：</p>
    <ul>
      <li>
        <code>risk</code> 是 <code>read</code> 时，<code>effect</code> 必须是 <code>read</code>。
      </li>
      <li>
        <code>risk</code> 是 <code>destructive</code> 时，<code>idempotency</code> 必须是{' '}
        <code>unsafe</code>。
      </li>
    </ul>
    <p>
      界面会在你改 method 时自动派生这三个值：<code>GET</code> → <code>read/read/safe</code>，
      <code>DELETE</code> → <code>destructive/delete/unsafe</code>，<code>POST</code> →{' '}
      <code>low-write/create/unsafe</code>，<code>PUT</code> → <code>low-write/update/keyed</code>，
      <code>PATCH</code> → <code>low-write/update/unsafe</code>。<code>risk</code> 还会影响一件事：
      <strong>
        只有 risk 为 <code>read</code> 的工具才会被模型自动放行
      </strong>
      ， 其余都要走确认。
    </p>

    <h3 id="input-schema">3.3 输入 Schema 是受限子集</h3>
    <p>这不是完整的 JSON Schema。它是手写不合法、由编辑器表单生成的受限形式，约束如下：</p>
    <ul>
      <li>
        顶层固定 <code>{'{ type: "object", properties: {…}, required: […] }'}</code>
        ，不允许别的写法。
      </li>
      <li>
        参数名必须匹配 <code>{'^[a-zA-Z_][a-zA-Z0-9_]*$'}</code>，<strong>参数最多 32 个</strong>。
      </li>
      <li>
        参数类型只有 5 种：<code>string</code> / <code>number</code> / <code>integer</code> /{' '}
        <code>boolean</code> / <code>array</code>。
      </li>
      <li>
        每种类型可带 <code>title</code>（≤120）、<code>description</code>（≤1000）、
        <code>default</code>、<code>enum</code>（最多 50 项）。
      </li>
      <li>
        <code>items</code> 只能用在 <code>array</code> 上，且元素只能是原始类型。
      </li>
      <li>
        <code>required</code> 里出现的名字必须在 <code>properties</code> 中已声明。
      </li>
    </ul>
    <p>
      <strong>
        没有 <code>outputSchema</code> 字段
      </strong>
      ——工具返回什么，由执行器决定： HTTP 由 <code>response.format</code> 与 <code>extract</code>{' '}
      决定，代码工具就是默认导出函数的返回值（序列化后按
      <code>maxOutputBytes</code> 校验），统一以 markdown 文本形式回给模型，并可能被截断。
    </p>
    <p>
      模板占位符（URL、Body、Header）只能引用已声明的参数，否则保存期就报错，
      所以「先加参数、再写模板」这个顺序不要反过来。
    </p>

    <h2 id="secrets">4. 密钥：只声明引用，不填值</h2>
    <p>
      这是整个自定义工具体系里设计得最收紧的一块，<strong>三层都禁明文</strong>。
    </p>
    <p>
      密钥的实际存放位置是<strong>系统 Keychain</strong>（keytar），不进 SQLite：
    </p>
    <ul>
      <li>
        密钥引用（<code>secretRefs</code>）的标准形式是{' '}
        <code>custom-tool:&lt;工具ID&gt;:&lt;密钥名&gt;</code>。
      </li>
      <li>数据库里存的只是这个引用字符串，明文永不落库。</li>
      <li>
        写入入口只有一个：Studio 编辑页里的「本机密钥」表单，文案是 「密钥写入系统 Keychain，不进入
        SQLite、导出文件或工具描述。」
      </li>
    </ul>
    <p>三个拒绝明文的位置：</p>
    <ol>
      <li>
        <strong>Agent 工具面没有写密钥的工具。</strong>
        <code>custom_tools_*</code> 一共 11 个， 其中没有任何一个能写入密钥值；
        <code>custom_tools_create_draft</code> 的描述里就写着 「密钥只能声明
        secretRefs，禁止在参数中传密钥值」。
      </li>
      <li>
        <strong>定义里不能出现疑似密钥明文。</strong>URL 模板、Body 模板、Header
        模板、代码源码都会被扫； 命中 <code>sk-…</code>、<code>AKIA…</code>、<code>ghp_…</code>、
        <code>xox…</code>、 硬编码 <code>bearer …</code>、PEM
        私钥等形态就报「模板中检测到疑似密钥明文，请改用密钥库（secretRefs）存储」。
      </li>
      <li>
        <strong>声明了就必须用上。</strong>
        <code>secretRefs</code> 里的每个名字都必须被某个请求头的 <code>secretRef</code>{' '}
        实际引用，否则报「密钥 X 未被任何请求头引用」。
      </li>
    </ol>
    <p>
      另外 <code>custom_tools_get</code> 只返回「密钥位是否已配置」（每项一个布尔值），
      <strong>永不返回密钥值</strong>；Agent 侧测试的输出也会用 Keychain
      真值加常见凭据形态做脱敏替换。
      发布或回滚之后，不再被引用的密钥会被自动清理；删除工具时其专属密钥会被一并删除， 若 Keychain
      清理失败，工具会保留记录并提示重试，不会留下“删了一半”的状态。
    </p>

    <h2 id="lifecycle">5. 生命周期与 Agent 工具面</h2>

    <h3 id="draft-version">5.1 草稿版本与 CAS</h3>
    <p>
      每个自定义工具有两个版本号：<code>publishedVersion</code>（Agent
      当前实际使用的稳定版本，可以为空） 和 <code>draftVersion</code>（工作副本）。
      <code>draftVersion &gt; publishedVersion</code> 就表示存在未发布草稿。
    </p>
    <table>
      <thead>
        <tr>
          <th>操作</th>
          <th>真实行为</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>创建草稿</td>
          <td>
            生成一条<strong>禁用</strong>草稿：<code>enabled=false</code>、
            <code>publishedVersion=null</code>、<code>draftVersion=1</code>
          </td>
        </tr>
        <tr>
          <td>保存草稿</td>
          <td>
            只动草稿版本，不影响在线版本。已有待发布草稿就复写同一版本号，否则开新版本号。
            <strong>类型与 ID 创建后不可修改</strong>
          </td>
        </tr>
        <tr>
          <td>发布</td>
          <td>把草稿提升为稳定版本，旧稳定版本转 archived</td>
        </tr>
        <tr>
          <td>回滚</td>
          <td>
            <strong>不是回退，而是从历史版本新建一个稳定版本</strong>
            ，当前版本仍留在历史里可以再恢复。前提是当前没有待发布草稿
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      发布带 CAS
      保护：传入的草稿版本号与数据库不一致会冲突（会提示「草稿已在其他窗口更新，请刷新后重试」），
      避免两个窗口同时改一个工具时互相覆盖。Agent 侧对应的参数是 <code>expectedDraftVersion</code>。
    </p>
    <p>
      <strong>第一次发布会自动启用</strong>——这是存储层的行为（后续发布沿用当前的启用状态）。
      所以「我明明只发布了、没点启用，Agent 怎么能用了」不是 bug。
    </p>

    <h3 id="agent-surface">5.2 什么条件下才进 Agent 工具面</h3>
    <p>一个自定义工具要出现在模型的工具清单里，必须同时满足三个条件：</p>
    <ul>
      <li>
        <code>enabled = 1</code>；
      </li>
      <li>
        <code>publishedVersion != null</code>（发布过）；
      </li>
      <li>
        <strong>
          类型不是 <code>provider-vision</code>
        </strong>
        。
      </li>
    </ul>
    <p>
      进工具面后，模型看到的工具名是 <code>custom_</code> 加工具 ID（例如{' '}
      <code>custom_weather_lookup</code>）。 刷新的时机是<strong>下一轮对话</strong>
      ：本轮发布不会立刻影响这一轮已经在跑的工具快照， 要下一轮才生效。
    </p>
    <p>各操作的前置条件（都是硬性拦截）：</p>
    <table>
      <thead>
        <tr>
          <th>操作</th>
          <th>前置条件</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>测试</td>
          <td>无——不需要先发布或启用，用正式执行器真跑</td>
        </tr>
        <tr>
          <td>发布</td>
          <td>
            所有 <code>secretRefs</code> 都必须已写入 Keychain；代码工具的依赖必须已发布
          </td>
        </tr>
        <tr>
          <td>启用</td>
          <td>已发布 + 稳定版本密钥齐备；未发布时开关是灰的</td>
        </tr>
        <tr>
          <td>回滚</td>
          <td>当前没有待发布草稿 + 目标版本存在 + 目标版本密钥齐备</td>
        </tr>
        <tr>
          <td>删除</td>
          <td>先禁用（若开着）→ 删密钥 → 删记录；Keychain 清理失败会保留记录并提示重试</td>
        </tr>
      </tbody>
    </table>

    <h2 id="agent-authored">6. 让 Agent 自己造工具：custom_tools_* 十一个</h2>
    <p>Agent 可以通过平台工具面完成整套流程。共 11 个工具，按正常顺序如下：</p>
    <table>
      <thead>
        <tr>
          <th>工具</th>
          <th>作用</th>
          <th>需要确认参数</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>custom_tools_guide</code>
          </td>
          <td>取开发指南、适配器说明、安全边界与 HTTP / TypeScript 示例</td>
          <td>—</td>
        </tr>
        <tr>
          <td>
            <code>custom_tools_list</code>
          </td>
          <td>
            列出工具与草稿/发布/启用状态。<code>limit</code> 默认 50、最大 100，返回带{' '}
            <code>total</code>/<code>truncated</code>
          </td>
          <td>—</td>
        </tr>
        <tr>
          <td>
            <code>custom_tools_get</code>
          </td>
          <td>读完整工作区（草稿、当前发布版本、版本历史、密钥位是否已配置）</td>
          <td>—</td>
        </tr>
        <tr>
          <td>
            <code>custom_tools_validate</code>
          </td>
          <td>只读校验完整定义，返回精确字段问题与归一化结果</td>
          <td>—</td>
        </tr>
        <tr>
          <td>
            <code>custom_tools_create_draft</code>
          </td>
          <td>
            创建<strong>禁用</strong>草稿，不进稳定工具面
          </td>
          <td>—</td>
        </tr>
        <tr>
          <td>
            <code>custom_tools_save_draft</code>
          </td>
          <td>保存草稿，不影响当前发布版本</td>
          <td>—</td>
        </tr>
        <tr>
          <td>
            <code>custom_tools_test</code>
          </td>
          <td>用正式执行器真实测试</td>
          <td>
            <code>confirmExecute</code>（必填）
          </td>
        </tr>
        <tr>
          <td>
            <code>custom_tools_publish</code>
          </td>
          <td>原子发布草稿为稳定版本</td>
          <td>
            <code>confirmPublish</code>（必填）
          </td>
        </tr>
        <tr>
          <td>
            <code>custom_tools_set_enabled</code>
          </td>
          <td>启用 / 停用已发布工具</td>
          <td>
            <code>confirmEnable</code> 仅启用时需要（<strong>不在 required 列表里</strong>）
          </td>
        </tr>
        <tr>
          <td>
            <code>custom_tools_rollback</code>
          </td>
          <td>把稳定版本回滚到指定历史版本</td>
          <td>
            <code>confirmRollback</code>（必填）
          </td>
        </tr>
        <tr>
          <td>
            <code>custom_tools_delete</code>
          </td>
          <td>删除工具、版本与关联密钥引用</td>
          <td>
            <code>confirmDelete</code>（必填）
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      所有 <code>confirmXxx</code> 的判据都是严格的 <code>=== true</code>；
      缺了会返回「&lt;动作&gt;需要用户明确确认」。注意 <code>confirmExecute</code>{' '}
      的含义不只是“我要执行”， 而是<strong>用户已经明确知情并同意</strong>
      ——真实测试可能访问网络、调用 Provider、产生费用或副作用。
    </p>
    <p>Agent 侧的流水线在指南里写死了六步，照着走就行：</p>
    <ol>
      <li>
        先 <code>custom_tools_list</code> 查重，避免重复创建或覆盖已有工具。
      </li>
      <li>
        生成完整定义后调 <code>custom_tools_validate</code>，不要猜 API、鉴权或副作用。
      </li>
      <li>
        <code>custom_tools_create_draft</code> 存一份禁用草稿。
      </li>
      <li>
        需要真调用时，先向用户说明目标、费用和副作用，再 <code>custom_tools_test</code>。
      </li>
      <li>用户确认后发布；首次发布会进稳定工具面。</li>
      <li>
        发布后用下一轮工具清单或真实会话验证；要停用就 <code>set_enabled</code>。
      </li>
    </ol>

    <h2 id="packages">7. Tool Package：spark-tool.json 与五个适配器</h2>

    <h3 id="manifest">7.1 manifest 字段</h3>
    <p>
      工具包的核心是根目录一个 <code>spark-tool.json</code>。完整字段与约束：
    </p>
    <table>
      <thead>
        <tr>
          <th>字段</th>
          <th>必填</th>
          <th>约束</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>schemaVersion</code>
          </td>
          <td>
            <strong>是</strong>
          </td>
          <td>
            目前固定为 <code>1</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>id</code>
          </td>
          <td>
            <strong>是</strong>
          </td>
          <td>
            <code>{'^[a-z0-9][a-z0-9._-]{2,95}$'}</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>version</code>
          </td>
          <td>
            <strong>是</strong>
          </td>
          <td>
            语义化版本，如 <code>1.0.0</code>，可带预发布后缀
          </td>
        </tr>
        <tr>
          <td>
            <code>name</code> / <code>description</code>
          </td>
          <td>
            <strong>是</strong>
          </td>
          <td>1–160 / 1–8000 字符</td>
        </tr>
        <tr>
          <td>
            <code>author</code>
          </td>
          <td>否</td>
          <td>
            <code>{'{ name, url? }'}</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>runtime</code>
          </td>
          <td>
            <strong>是</strong>
          </td>
          <td>五选一的适配器，见 7.2</td>
        </tr>
        <tr>
          <td>
            <code>development</code>
          </td>
          <td>否</td>
          <td>
            <code>{'{ installCommand?, buildCommand? }'}</code>，各 ≤ 500 字符
          </td>
        </tr>
        <tr>
          <td>
            <code>guidance</code>
          </td>
          <td>否</td>
          <td>给模型看的概述 / 共享指令 / 前置条件</td>
        </tr>
        <tr>
          <td>
            <code>tools</code>
          </td>
          <td>
            <strong>是</strong>
          </td>
          <td>
            数组，<strong>最少 1 个、最多 200 个</strong>
          </td>
        </tr>
        <tr>
          <td>
            <code>environment</code>
          </td>
          <td>否</td>
          <td>最多 200 个变量声明，默认空数组</td>
        </tr>
        <tr>
          <td>
            <code>permissions</code>
          </td>
          <td>否</td>
          <td>默认三个空数组</td>
        </tr>
      </tbody>
    </table>
    <p>
      每个 <code>tools[]</code> 条目必填 <code>name</code> / <code>title</code> /{' '}
      <code>description</code> / <code>inputSchema</code> / <code>risk</code> / <code>effect</code>{' '}
      / <code>idempotency</code>，可选 <code>outputSchema</code> 与 <code>guidance</code>。
      <code>inputSchema</code> 必须是对象类型且能被解析。跨字段校验规则：
    </p>
    <ul>
      <li>
        <code>risk</code> 为 <code>read</code> 时 <code>effect</code> 必须是 <code>read</code>；
      </li>
      <li>
        <code>risk</code> 为 <code>destructive</code> 时 <code>idempotency</code> 必须是{' '}
        <code>unsafe</code>；
      </li>
      <li>工具名不得重复，环境变量名不得重复；</li>
      <li>必要能力与可选能力不能声明同一个名字。</li>
    </ul>
    <p>
      校验失败时<strong>没有一套“错误码表”</strong>——schema 不通过就是校验器抛出的字段级问题列表，
      运行时兜底的错误码常量是 <code>TOOL_PACKAGE_EXECUTION_FAILED</code>；
      能力调用子系统的错误码则是 <code>CAPABILITY_NOT_DECLARED</code> /
      <code>CAPABILITY_NOT_AUTHORIZED</code> / <code>CAPABILITY_UNAVAILABLE</code> /
      <code>CAPABILITY_FAILED</code>。想快速定位问题，用 <code>tool_packages_inspect</code>{' '}
      做只读检查更直接。
    </p>

    <h3 id="package-adapters">7.2 五个 runtime.adapter</h3>
    <table>
      <thead>
        <tr>
          <th>adapter</th>
          <th>必填字段</th>
          <th>用途</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>process</code>
          </td>
          <td>
            <code>command</code> + <code>protocol: &quot;spark-tool-process-v1&quot;</code>
          </td>
          <td>
            真正的进程式工具。可选 <code>args</code>（≤128 个）、<code>lifecycle</code>（默认{' '}
            <code>per-call</code>）、<code>workingDirectory</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>remote-http</code>
          </td>
          <td>
            <code>baseUrl</code>
          </td>
          <td>
            远端 HTTP 工具服务。可选 <code>headers</code>（≤32，值支持 <code>{'${ENV_NAME}'}</code>{' '}
            模板）与 <code>timeoutMs</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>declarative-http</code>
          </td>
          <td>
            <code>tools</code> 映射
          </td>
          <td>
            免代码 HTTP 适配器：把工具名映射到 HTTP spec。映射必须与顶层 <code>tools</code> 一一对应
          </td>
        </tr>
        <tr>
          <td>
            <code>mcp-import</code>
          </td>
          <td>
            <code>serverId</code>
          </td>
          <td>
            把已有 MCP 服务器的工具包装成工具包，调用时仍代理回原服务器。可选{' '}
            <code>toolNameOverrides</code> 记录规范化映射
          </td>
        </tr>
        <tr>
          <td>
            <code>legacy-custom-tool</code>
          </td>
          <td>
            <code>toolId</code>
          </td>
          <td>兼容桥：委托给某个已有的 Tool Studio 自定义工具</td>
        </tr>
      </tbody>
    </table>
    <p>
      写 <code>process</code> 时最容易踩的坑：
      <strong>
        <code>command</code> 必须是单个可执行文件
      </strong>
      ，参数一律放 <code>runtime.args</code>。 进程<strong>不经 shell 拉起</strong>，所以{' '}
      <code>&quot;node index.js&quot;</code> 这种写法会在启动时直接报
      <code>ENOENT</code>。
    </p>
    <p>两种生命周期的区别：</p>
    <ul>
      <li>
        <code>per-call</code>（默认）：每次调用新起一个进程，<code>initialize</code> →{' '}
        <code>invoke</code> → <code>shutdown</code> 后退出。
      </li>
      <li>
        <code>persistent</code>：按「包 + 版本 + 环境」复用进程；配置或权限变更后会失效重建。
      </li>
    </ul>
    <p>
      协议上，stdout 只允许输出协议帧（换行分隔的 JSON，单帧上限 4 MB），
      <strong>任何杂散输出都会破坏帧解析</strong>；日志必须写 stderr。
    </p>

    <h3 id="install-paths">7.3 五条安装路径</h3>
    <p>
      先分清两个不同的枚举，它们经常被混为一谈：
      <strong>
        <code>runtime.adapter</code>
      </strong>
      （上面五个，决定怎么执行） 与
      <strong>
        安装来源 <code>source</code>
      </strong>
      （六个值：<code>managed-project</code> /<code>local-directory</code> /{' '}
      <code>local-archive</code> / <code>registry</code> /<code>remote</code> /{' '}
      <code>mcp-import</code>）。
    </p>
    <table>
      <thead>
        <tr>
          <th>入口</th>
          <th>落库 source</th>
          <th>说明</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>install_directory</code>（managed-project）
          </td>
          <td>
            <code>managed-project</code>
          </td>
          <td>把受管工程复制为不可变版本</td>
        </tr>
        <tr>
          <td>
            <code>install_directory</code>（local-directory）
          </td>
          <td>
            <code>local-directory</code>
          </td>
          <td>把任意本地目录复制为不可变版本</td>
        </tr>
        <tr>
          <td>
            <code>install_archive</code>
          </td>
          <td>
            <code>local-archive</code>
          </td>
          <td>
            解压 .zip；支持单层包裹目录，自动跳过 <code>.git</code>、<code>__MACOSX</code>、
            <code>.DS_Store</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>install_git</code>
          </td>
          <td>
            <strong>
              <code>registry</code>
            </strong>
          </td>
          <td>
            浅克隆（<code>--depth 1</code>）。注意 source 落的是 <code>registry</code> 而不是{' '}
            <code>git</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>install_remote</code>
          </td>
          <td>
            <code>remote</code>
          </td>
          <td>
            <strong>只登记 manifest，不落代码、不发任何网络请求</strong>
          </td>
        </tr>
        <tr>
          <td>
            <code>install_mcp_import</code>
          </td>
          <td>
            <code>mcp-import</code>
          </td>
          <td>
            自动生成 manifest；工具风险硬编码为 <code>low-write</code> / <code>update</code> /{' '}
            <code>unsafe</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      所有安装都遵守同一条不变量：<strong>装完保持一致禁用，且不执行任何包内代码</strong>。
    </p>
    <p>几个需要留意的边界：</p>
    <ul>
      <li>
        <strong>安装新版本不会自动启用它</strong>。数据库写入时状态固定为{' '}
        <code>installed-disabled</code>；
        对已启用的包再装新版本，旧版本仍然是指向中的启用版本，需要你手动切换。
      </li>
      <li>
        <strong>同一个版本号不能改内容</strong>
        。已存在同版本时，内容摘要不同会被拒绝；相同则幂等返回。
      </li>
      <li>
        <strong>界面只有四条导入路径</strong>：本地目录、压缩包、Git 仓库、MCP 服务器。
        <code>remote-http</code> 目前没有界面入口，只能通过 Agent 工具或 API 安装。
      </li>
      <li>
        Git 导入会校验 ref 与子目录；浅克隆默认超时 5 分钟、上限 15 分钟。找不到 git
        时会给安装指引。
      </li>
    </ul>

    <h2 id="managed-project">8. 受管工程：让 Agent 写多文件工具</h2>

    <h3 id="project-tools">8.1 五个工程工具</h3>
    <p>
      受管工程是 Agent 从零写一个工具包的工作目录（默认在应用数据目录的 <code>tool-projects</code>{' '}
      下）。 五个工具的语义：
    </p>
    <table>
      <thead>
        <tr>
          <th>工具</th>
          <th>语义</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>tool_packages_create_project</code>
          </td>
          <td>
            写一个已校验的 <code>spark-tool.json</code> 和初始文件，
            <strong>不安装、不构建、不执行、不启用</strong>。 文件数 ≤100、总字节 ≤4
            MB；目录已存在会报错；文件列表里不能再放 <code>spark-tool.json</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>tool_packages_write_project_file</code>
          </td>
          <td>写单个 UTF-8 文件，单个 ≤ 2 MB；拒绝符号链接与路径逃逸</td>
        </tr>
        <tr>
          <td>
            <code>tool_packages_read_project_file</code>
          </td>
          <td>读单个 ≤ 2 MB 的 UTF-8 文件</td>
        </tr>
        <tr>
          <td>
            <code>tool_packages_list_project_files</code>
          </td>
          <td>
            只列路径与字节数；跳过 <code>node_modules</code>/<code>.git</code>；上限 50000 个文件
          </td>
        </tr>
        <tr>
          <td>
            <code>tool_packages_run_project_step</code>
          </td>
          <td>
            在工程目录真实执行 install 或 build，需要 <code>confirmExecute=true</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      界面上的「源码工程」编辑器对应这几个能力：选文件、改源码、<strong>保存文件</strong>、
      <strong>安装新版本</strong>。注意<strong>安装前必须先保存</strong>，否则装进去的还是旧内容。
    </p>

    <h3 id="install-build">8.2 install / build 步骤</h3>
    <p>两个步骤的命令来源与推断规则不同：</p>
    <table>
      <thead>
        <tr>
          <th>步骤</th>
          <th>命令来源</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>install</code>
          </td>
          <td>
            优先用 manifest 的 <code>development.installCommand</code>；没声明就按 lockfile 推断：
            <code>pnpm-lock.yaml</code> → <code>pnpm install</code>，<code>yarn.lock</code> →{' '}
            <code>yarn install</code>，<code>bun.lockb</code> → <code>bun install</code>，只有{' '}
            <code>package.json</code> → <code>npm install</code>。
            <strong>
              一个都没有就报错，必须显式声明 <code>installCommand</code>
            </strong>
          </td>
        </tr>
        <tr>
          <td>
            <code>build</code>
          </td>
          <td>
            <strong>没有推断</strong>：必须声明 <code>development.buildCommand</code>，
            否则报错提示「add it to spark-tool.json or skip the build step」
          </td>
        </tr>
      </tbody>
    </table>
    <p>执行时的真实行为：</p>
    <ul>
      <li>
        工作目录是工程根目录，环境变量只透传 PATH/HOME/TEMP 等白名单，另加{' '}
        <code>SPARK_TOOL_PACKAGE_ID</code>、<code>SPARK_TOOL_PACKAGE_VERSION</code>、
        <code>SPARK_TOOL_PROJECT_STEP=1</code>，并关掉 npm 的 fund 与 audit 提示。
      </li>
      <li>
        默认超时 <strong>10 分钟</strong>，上限 <strong>30 分钟</strong>
        ；超时或取消会杀掉整个进程树。
      </li>
      <li>输出上限 256 KB，超出保留尾部 64 KB，结果里会标「输出已截断」。</li>
      <li>结果会标明命令是「声明命令」还是「推断命令」，并给出退出码、是否超时、是否已取消。</li>
    </ul>
    <p>
      <strong>这是真的在本机跑命令</strong>
      ，而且进程拥有当前用户权限。执行前必须把要跑的命令展示给用户并拿到同意， 再传{' '}
      <code>confirmExecute=true</code>。
    </p>

    <h2 id="permissions">9. 权限：OS 行为告知与 Spark Capability</h2>

    <h3 id="os-effects">9.1 declaredOsEffects 是告知，不是沙箱</h3>
    <p>
      manifest 的 <code>permissions.declaredOsEffects</code> 可声明这些值：
      <code>network</code>、<code>filesystem.read</code>、<code>filesystem.write</code>、
      <code>process.spawn</code>、<code>clipboard</code>、<code>browser</code>。
    </p>
    <p>
      <strong>但它在代码里只是告知项，没有任何执行期拦截。</strong>
      官方的口径写在指南文本里：
    </p>
    <blockquote>
      进程具有当前用户权限；declaredOsEffects 是告知与启用确认，不是细粒度 OS 沙箱。
    </blockquote>
    <p>
      界面上的措辞同样直接：「trusted-local 工具进程拥有当前用户权限。manifest 中的 OS
      行为是告知项， 不是操作系统沙箱；Spark Capability 会按授权强制拦截。」 换句话说，
      <strong>启用一个工具包等于信任它的代码</strong>，装之前请自己核对命令和声明的 OS 行为。
    </p>

    <h3 id="capabilities">9.2 Spark Capability 才会被真正拦截</h3>
    <p>
      与 OS 行为不同，<strong>Spark Capability 有执行期强制校验</strong>：进程请求一个能力时，
      宿主会先检查它有没有在 manifest 里声明、有没有被授权，未通过就返回{' '}
      <code>CAPABILITY_NOT_DECLARED</code> 或 <code>CAPABILITY_NOT_AUTHORIZED</code>。
    </p>
    <p>
      manifest 里分两组声明，名字必须带命名空间（形如 <code>a.b</code>）：
    </p>
    <ul>
      <li>
        <code>requiredSparkCapabilities</code>：最多 64 个，<strong>必须全部授权</strong>
        工具包才能启用；
      </li>
      <li>
        <code>optionalSparkCapabilities</code>：最多 64 个，缺失不影响启用。
      </li>
    </ul>
    <p>宿主提供的能力按家族划分，常用的包括：</p>
    <table>
      <thead>
        <tr>
          <th>家族</th>
          <th>能力 id</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>网络与存储</td>
          <td>
            <code>http.fetch</code>、<code>storage.kv.get</code>、<code>storage.kv.set</code>、
            <code>storage.kv.delete</code>、<code>storage.kv.list</code>
          </td>
        </tr>
        <tr>
          <td>文件</td>
          <td>
            <code>files.read</code>、<code>files.write</code>、<code>files.list</code>、
            <code>files.stat</code>、<code>files.copy</code>、<code>files.move</code>、
            <code>files.upload</code>、<code>files.present</code>、<code>files.trash</code>
          </td>
        </tr>
        <tr>
          <td>进程与系统</td>
          <td>
            <code>process.exec</code>、<code>notifications.show</code>
          </td>
        </tr>
        <tr>
          <td>模型与 Agent</td>
          <td>
            <code>models.list</code>、<code>models.get</code>、<code>models.invoke</code>、
            <code>agents.list</code>、<code>agents.get</code>、<code>agents.invoke</code>
          </td>
        </tr>
        <tr>
          <td>桌面交互</td>
          <td>
            <code>clipboard.read</code>、<code>clipboard.write</code>、<code>browser.open</code>、
            <code>dialogs.open</code>、<code>dialogs.save</code>、<code>artifacts.present</code>
          </td>
        </tr>
        <tr>
          <td>浏览器自动化</td>
          <td>
            <code>browser.automation.windows</code>、<code>browser.automation.open</code>、
            <code>browser.automation.navigate</code>、<code>browser.automation.screenshot</code>、
            <code>browser.automation.inspect</code>、<code>browser.automation.evaluate</code>、
            <code>browser.automation.close</code>
          </td>
        </tr>
        <tr>
          <td>电脑操作</td>
          <td>
            <code>computer.capabilities</code>、<code>computer.inspect</code>、
            <code>computer.execute</code>
          </td>
        </tr>
        <tr>
          <td>多媒体</td>
          <td>
            <code>media.models</code>、<code>media.generate</code>
          </td>
        </tr>
        <tr>
          <td>工作流</td>
          <td>
            <code>workflows.list</code>、<code>workflows.run</code>、<code>workflows.status</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      其中一部分是<strong>逐次确认</strong>的高风险能力，每次调用都会弹确认框：
      <code>process.exec</code>、<code>files.trash</code>、<code>media.generate</code>、
      <code>computer.execute</code>、<code>workflows.run</code>，以及大部分{' '}
      <code>browser.automation.*</code>。 执行 <code>process.exec</code>{' '}
      前会把实际命令展示出来给你确认。另外 <code>process.exec</code> 接收的是参数数组、
      <strong>不经 shell</strong>。
    </p>
    <p>
      授权状态用 <code>tool_packages_set_permission</code> 管理，<code>kind</code> 取{' '}
      <code>os-effect</code> 或 <code>spark-capability</code>，<code>state</code> 取{' '}
      <code>pending</code> / <code>granted</code> / <code>denied</code>。
      界面上必须在确认框里勾选后才写库。有个重要副作用：
      <strong>把一个必需能力改回非 granted，会自动把该工具包停用</strong>
      ，避免它带着未授权状态继续跑。
    </p>

    <h2 id="package-env">10. 环境变量与密钥</h2>
    <p>
      manifest 的 <code>environment</code> 声明变量名、类型、是否必填、是否密钥。变量名必须匹配{' '}
      <code>{'^[A-Z_][A-Z0-9_]{0,127}$'}</code>，类型取
      <code>string</code> / <code>number</code> / <code>integer</code> / <code>boolean</code> /{' '}
      <code>json</code>。
    </p>
    <p>两条与密钥有关的硬约束：</p>
    <ul>
      <li>
        <strong>密钥变量不能有默认值</strong>（会直接报错）；
      </li>
      <li>
        <strong>
          密钥变量只能是 <code>string</code> 类型
        </strong>
        。
      </li>
    </ul>
    <p>secret 与普通变量在存储和权限上是两套完全不同的路径：</p>
    <table>
      <thead>
        <tr>
          <th>维度</th>
          <th>普通变量</th>
          <th>secret</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>存储位置</td>
          <td>
            SQLite 的 <code>value_json</code> 列
          </td>
          <td>系统 Keychain，库里只存引用</td>
        </tr>
        <tr>
          <td>Agent 能否写</td>
          <td>
            能，但需要 manifest 声明 <code>agentConfigurable: true</code>
          </td>
          <td>
            <strong>不能</strong>，只能发起一次性安全输入请求
          </td>
        </tr>
        <tr>
          <td>读取</td>
          <td>状态接口会回显值</td>
          <td>只返回「是否已配置」</td>
        </tr>
        <tr>
          <td>日志</td>
          <td>原样</td>
          <td>子进程 stderr 中出现密钥值会被替换成脱敏标记</td>
        </tr>
      </tbody>
    </table>
    <p>
      密钥的填写流程是：Agent 调 <code>tool_packages_request_secret</code>{' '}
      创建请求（只返回请求状态）， 应用内弹出受保护的输入表单，用户填完点「保存到 Keychain」。
      表单上的说明是「密钥不会发送给 Agent，也不会写入会话记录或
      SQLite；主进程收到后会直接保存到系统 Keychain。」 请求有有效期（<strong>默认 15 分钟</strong>
      ），过期需要重新发起；同一目标已有待处理请求时会直接复用，不会重复弹窗。
    </p>
    <p>
      普通变量的配置可以限定作用域：<code>package</code> / <code>tool</code> / <code>project</code>{' '}
      / <code>agent</code> / <code>workflow</code> / <code>session</code>。 同一个 API 在 Agent 侧以
      agent 身份调用、在界面以 user 身份调用，权限不同—— Agent 只能改声明了{' '}
      <code>agentConfigurable</code> 的变量。
    </p>
    <p>
      在 <code>process</code> 适配器里，声明过的变量（含从 Keychain 取出的密钥）会注入到工具进程，
      另外还有基础变量与 <code>SPARK_TOOL_PACKAGE_ID</code> /{' '}
      <code>SPARK_TOOL_PACKAGE_VERSION</code> / <code>SPARK_TOOL_PROCESS_PROTOCOL</code>。
    </p>

    <h2 id="package-lifecycle">11. 启用、测试、卸载与删版本</h2>
    <p>工具包的启用前置条件比自定义工具严格得多，缺一条都不给启用：</p>
    <ol>
      <li>目标版本存在且状态是已安装；</li>
      <li>
        信任级别不是 <code>blocked</code>；
      </li>
      <li>适配器在可执行白名单内；</li>
      <li>
        <code>mcp-import</code> 类型要求原 MCP 服务器仍然存在；
      </li>
      <li>所有必需能力在当前宿主上都可用；</li>
      <li>
        所有必需权限都已经是 <code>granted</code>；
      </li>
      <li>所有必填环境变量都已配置。</li>
    </ol>
    <p>
      启用后，包内工具在<strong>下一次 Agent 循环</strong>
      动态注册，之后就和内置工具一样被模型自主调用。 停用不需要确认；<strong>启用需要</strong>（
      <code>confirmEnable=true</code>）。
    </p>
    <p>其余三个操作的硬约束：</p>
    <table>
      <thead>
        <tr>
          <th>操作</th>
          <th>约束</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>tool_packages_test</code>
          </td>
          <td>
            <strong>不需要先启用</strong>，按你指定的版本和工具名真实执行，需要{' '}
            <code>confirmExecute=true</code>。 成功返回结果、耗时与
            correlationId，失败返回错误码与信息
          </td>
        </tr>
        <tr>
          <td>
            <code>tool_packages_uninstall</code>
          </td>
          <td>
            <strong>必须先停用</strong>；会终止进程、删除全部不可变版本、数据库记录与 Keychain
            密钥。 受管工程源码<strong>默认保留</strong>，只有传{' '}
            <code>removeManagedProject=true</code> 才删
          </td>
        </tr>
        <tr>
          <td>
            <code>tool_packages_delete_version</code>
          </td>
          <td>
            不能删当前启用的版本，也<strong>不能删最后一个版本</strong>（那种情况只能整体卸载）
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      卸载受管工程前界面会问两次：先确认卸载，再单独确认要不要删源码，文案是
      「保留受管工程源码时可以继续开发并重新安装；删除后源码目录（tool-projects）不可恢复。」
      启用状态下点卸载会直接被拦下并提示「请先停用工具包，再执行卸载」。
    </p>
    <p>
      另外，<code>tool_packages_test</code> 会在诊断区展示运行进度、日志流与调用轨迹；
      要排查「装了但跑不起来」，先看诊断区，再决定是改 manifest 还是改代码。
    </p>

    <h2 id="troubleshooting">12. 常见坑与排查</h2>
    <table>
      <thead>
        <tr>
          <th>现象</th>
          <th>原因与处理</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>只「发布」了没点启用，Agent 却能调用它</td>
          <td>首次发布会自动启用，这是设计行为。不想要就发布后手动停用</td>
        </tr>
        <tr>
          <td>启用了、也发布了，但模型工具清单里没有它</td>
          <td>
            检查类型是不是 <code>provider-vision</code>——它按设计不进入模型工具面。 另外刷新发生在
            <strong>下一轮对话</strong>，本轮不生效
          </td>
        </tr>
        <tr>
          <td>发布报「草稿已在其他窗口更新」</td>
          <td>草稿版本 CAS 冲突：另一个窗口改过这个工具。刷新后重试</td>
        </tr>
        <tr>
          <td>回滚按钮点了没反应 / 报错</td>
          <td>
            回滚要求当前<strong>没有待发布草稿</strong>。先处理掉草稿（发布或丢弃）再回滚
          </td>
        </tr>
        <tr>
          <td>保存定义时报「密钥 X 未被任何请求头引用」</td>
          <td>
            声明了 <code>secretRefs</code> 但没在请求头里用。要么补上引用，要么删掉这条声明
          </td>
        </tr>
        <tr>
          <td>
            写 <code>Authorization</code> 头被拒
          </td>
          <td>
            敏感头名不能写明文 <code>valueTemplate</code>，必须绑定 <code>secretRef</code>
          </td>
        </tr>
        <tr>
          <td>
            代码工具里 <code>import</code> 报错
          </td>
          <td>
            代码工具禁止任何导入。要外部能力就用 <code>permissions.toolIds</code> 声明依赖，再用{' '}
            <code>sdk.tools.call</code>
          </td>
        </tr>
        <tr>
          <td>调用另一个工具报「检测到自定义工具循环调用」</td>
          <td>依赖链成环，或嵌套深度超过 8 层。捋一下依赖图</td>
        </tr>
        <tr>
          <td>工具包进程起不来，报 ENOENT</td>
          <td>
            <code>command</code> 必须是单个可执行文件，参数放 <code>runtime.args</code>。
            <code>&quot;node index.js&quot;</code> 这类整串写法必错
          </td>
        </tr>
        <tr>
          <td>工具包进程一起就崩，日志里没有自己的输出</td>
          <td>stdout 只能输出协议帧，杂散输出会破坏帧解析。日志改写到 stderr</td>
        </tr>
        <tr>
          <td>install 步骤报没有可用 lockfile</td>
          <td>
            认的是 <code>pnpm-lock.yaml</code>/<code>yarn.lock</code>/<code>bun.lockb</code>/
            <code>package.json</code>。都没有就在 manifest 里显式声明{' '}
            <code>development.installCommand</code>
          </td>
        </tr>
        <tr>
          <td>build 步骤报错说没声明命令</td>
          <td>
            build <strong>不做推断</strong>，必须在 manifest 里声明{' '}
            <code>development.buildCommand</code>
          </td>
        </tr>
        <tr>
          <td>装了新版本，跑的还是老版本</td>
          <td>安装不会自动切换启用版本，要到详情里显式切到新版本</td>
        </tr>
        <tr>
          <td>同一个版本号重新装被拒</td>
          <td>
            不可变版本要求内容摘要一致；改了内容请<strong>升版本号</strong>
          </td>
        </tr>
        <tr>
          <td>
            调用能力报 <code>CAPABILITY_NOT_AUTHORIZED</code>
          </td>
          <td>能力已声明但没授权。去权限区把它设为 granted（必需能力未授权会导致包被自动停用）</td>
        </tr>
        <tr>
          <td>Agent 说写不了密钥</td>
          <td>设计如此。Agent 只能发安全输入请求，密钥必须由你在应用内表单填写</td>
        </tr>
        <tr>
          <td>卸载时提示先停用</td>
          <td>先关掉启用开关再卸载</td>
        </tr>
        <tr>
          <td>想把最后一个版本删掉</td>
          <td>不允许。最后一个版本只能整体卸载工具包</td>
        </tr>
      </tbody>
    </table>
    <p>
      最后提醒一句：截至当前版本，Tool Studio 之外还有 <code>sql</code> / <code>command</code> /{' '}
      <code>prompt</code> 三种类型的协议定义与完整的 spec schema，但它们
      <strong>尚未进入稳定运行面</strong>，创建和调用都会被拒绝。
      看到别人写的这类定义，不要在文档或提示词里把它们当成可用能力。
    </p>
  </>
)

const customTools: DocsPageContent = {
  slug: 'custom-tools',
  Body,
  toc: [
    { id: 'entry', title: '1. 两套子系统与入口', level: 2 },
    { id: 'two-subsystems', title: '1.1 Tool Studio 与 Tool Package 不是一回事', level: 3 },
    { id: 'entry-path', title: '1.2 入口：扩展中心 → 自定义工具', level: 3 },
    { id: 'studio', title: '2. Tool Studio：三种可跑适配器', level: 2 },
    { id: 'adapter-enum', title: '2.1 实际可执行的只有 http / code / provider-vision', level: 3 },
    { id: 'http-spec', title: '2.2 HTTP 适配器', level: 3 },
    { id: 'code-spec', title: '2.3 代码适配器', level: 3 },
    { id: 'vision-spec', title: '2.4 图像理解适配器', level: 3 },
    { id: 'fields', title: '3. 定义字段与校验规则', level: 2 },
    { id: 'base-fields', title: '3.1 公共字段', level: 3 },
    { id: 'risk-floor', title: '3.2 risk 下限与三项一致性', level: 3 },
    { id: 'input-schema', title: '3.3 输入 Schema 是受限子集', level: 3 },
    { id: 'secrets', title: '4. 密钥：只声明引用，不填值', level: 2 },
    { id: 'lifecycle', title: '5. 生命周期与 Agent 工具面', level: 2 },
    { id: 'draft-version', title: '5.1 草稿版本与 CAS', level: 3 },
    { id: 'agent-surface', title: '5.2 什么条件下才进 Agent 工具面', level: 3 },
    { id: 'agent-authored', title: '6. 让 Agent 自己造工具：custom_tools_* 十一个', level: 2 },
    { id: 'packages', title: '7. Tool Package：spark-tool.json 与五个适配器', level: 2 },
    { id: 'manifest', title: '7.1 manifest 字段', level: 3 },
    { id: 'package-adapters', title: '7.2 五个 runtime.adapter', level: 3 },
    { id: 'install-paths', title: '7.3 五条安装路径', level: 3 },
    { id: 'managed-project', title: '8. 受管工程：让 Agent 写多文件工具', level: 2 },
    { id: 'project-tools', title: '8.1 五个工程工具', level: 3 },
    { id: 'install-build', title: '8.2 install / build 步骤', level: 3 },
    { id: 'permissions', title: '9. 权限：OS 行为告知与 Spark Capability', level: 2 },
    { id: 'os-effects', title: '9.1 declaredOsEffects 是告知，不是沙箱', level: 3 },
    { id: 'capabilities', title: '9.2 Spark Capability 才会被真正拦截', level: 3 },
    { id: 'package-env', title: '10. 环境变量与密钥', level: 2 },
    { id: 'package-lifecycle', title: '11. 启用、测试、卸载与删版本', level: 2 },
    { id: 'troubleshooting', title: '12. 常见坑与排查', level: 2 },
  ],
  faq: [
    {
      question: 'Tool Studio 自定义工具和 Tool Package 工具包，我该用哪个？',
      answer:
        '看需不需要依赖和多文件代码。只是接一个 REST 接口、或写一小段纯逻辑，用 Tool Studio（http / code / provider-vision 三种适配器，单文件、禁止 import）。需要 npm 依赖、多文件工程、独立进程，或者想把已有 MCP 服务器的工具包装起来，用 Tool Package。平台的 Agent 系统提示词也是这个口径：需要“有能力的”工具时先走 tool_packages_guide，并明确要求不要把设计缩减成 legacy 的 http/code/provider-vision。',
    },
    {
      question: '我的自定义工具发布了，为什么模型的工具清单里没有它？',
      answer:
        '三个条件要同时满足：已启用、有发布版本、类型不是 provider-vision。图像理解工具按设计不进入模型工具面，它是宿主侧的确定性路由能力，想知道有没有生效要看聊天里的宿主视觉活动卡片。另外刷新发生在下一轮对话，本轮发布不会立刻生效。',
    },
    {
      question: '我只点了发布，没点启用，Agent 怎么就能用了？',
      answer:
        '首次发布会自动启用，这是存储层的既定行为（后续发布会沿用当前启用状态）。不想要的话，发布完手动停用即可。',
    },
    {
      question: 'Agent 能不能帮我填 API Key？',
      answer:
        '不能，这是两端都做了硬限制的。自定义工具侧：11 个 custom_tools_* 里没有任何写密钥的工具，create_draft 的描述明确写着「密钥只能声明 secretRefs，禁止在参数中传密钥值」。工具包侧：configure_environment 遇到 secret 会直接拒绝，只能通过 request_secret 发起一次性安全输入请求，由你在应用内的受保护表单里填写，直接写入系统 Keychain。',
    },
    {
      question: '安装工具包后它会不会自动跑起来？',
      answer:
        '不会。所有安装路径都保持一致禁用且不执行包内代码。装完需要你自己核对 OS 行为声明、完成必需能力的授权、补齐必填环境变量，然后手动启用；启用时会有明确确认。另外安装新版本不会自动切换到新版本，旧版本仍是指向中的启用版本。',
    },
    {
      question: '工具包的 declaredOsEffects 会限制它访问文件或网络吗？',
      answer:
        '不会。declaredOsEffects 在代码里只用于落库、警告和启用确认，没有任何执行期拦截；官方口径是「进程具有当前用户权限；declaredOsEffects 是告知与启用确认，不是细粒度 OS 沙箱」。真正会被运行时强制拦截的是 Spark Capability（未声明或未授权会返回 CAPABILITY_NOT_DECLARED / CAPABILITY_NOT_AUTHORIZED），其中一部分高风险能力还会逐次弹确认框。',
    },
  ],
  aiSummary:
    '讲解 Spark Work 中两套彼此独立的自定义工具体系：Tool Studio（http / code / provider-vision 三种适配器、定义字段、risk 下限、输入 Schema 限制、密钥引用、草稿与发布、11 个 custom_tools_* 工具）与 Tool Package（spark-tool.json 的完整字段、五个 runtime.adapter、六条安装来源、受管工程与 install/build 步骤、OS 行为与 Spark Capability 权限模型、环境变量与密钥流程、启用与卸载约束）。所有字段、枚举、默认值与限制均按实际代码核对，并附常见坑与排查表。',
  quickReference: [
    {
      key: '界面入口',
      value: '扩展中心 → 自定义工具页签（顶部四个视图：工具 / 工具包 / 开发中 / 运行记录）',
    },
    {
      key: '可执行的适配器',
      value: 'http、code、provider-vision（sql/command/prompt 协议保留但未开放）',
    },
    { key: '工具 ID 规则', value: '^[a-z][a-z0-9_]{2,63}$，即小写字母开头、3–64 字符' },
    { key: '工具说明最短', value: '10 字符（给 Agent 看的，最长 4000）' },
    { key: '超时范围', value: '1000–300000 毫秒；界面默认图像理解 60s、其余 30s' },
    { key: '输入参数上限', value: '32 个；类型仅 string/number/integer/boolean/array' },
    { key: '密钥引用格式', value: 'custom-tool:<工具ID>:<密钥名>，最多 16 个，存系统 Keychain' },
    {
      key: '进 Agent 工具面的条件',
      value: 'enabled=1 + 已发布 + 类型非 provider-vision（下一轮生效）',
    },
    { key: '自定义工具组合深度', value: '最多 8 层，且做循环调用检测' },
    { key: 'manifest 文件名', value: 'spark-tool.json（schemaVersion 固定为 1）' },
    {
      key: 'runtime.adapter 取值',
      value: 'process、remote-http、declarative-http、mcp-import、legacy-custom-tool',
    },
    {
      key: '安装 source 取值',
      value: 'managed-project、local-directory、local-archive、registry、remote、mcp-import',
    },
    {
      key: '受管工程单文件上限',
      value: '2 MB；文件数上限 50000；创建工程时文件数 ≤100、总字节 ≤4 MB',
    },
    { key: 'step 超时', value: '默认 10 分钟，上限 30 分钟；输出上限 256 KB（保留尾部 64 KB）' },
    {
      key: 'install 命令推断',
      value:
        'pnpm-lock.yaml → pnpm，yarn.lock → yarn，bun.lockb → bun，package.json → npm；build 无推断',
    },
    {
      key: 'OS 行为枚举',
      value:
        'network、filesystem.read、filesystem.write、process.spawn、clipboard、browser（仅告知）',
    },
    { key: '密钥请求有效期', value: '默认 15 分钟（范围 1–60 分钟）；同一目标重复请求会复用' },
    { key: '运行记录保留', value: '自定义工具默认 30 天，可选 7/30/90/365 天' },
  ],
  howTo: {
    name: '从零做一个 HTTP 自定义工具并让 Agent 用上',
    description: '以接入一个 REST 查询接口为例，走完定义、测试、发布、验证的完整闭环。',
    totalTime: '约 10 分钟',
    steps: [
      '打开左侧「扩展中心」，切到「自定义工具」页签。',
      '在「工具」视图先搜一遍关键词，确认没有同名工具，避免重复创建。',
      '点「创建工具」，选「粘贴 cURL」最省事：把接口的 cURL 命令贴进去，会自动拆出方法、请求头、Body 与密钥引用；也可以选「从空白创建」手填。',
      '核对输入 Schema：给参数起合法的名字（字母或下划线开头），参数最多 32 个，模板里的占位符只能引用已声明的参数。',
      '如果是需要鉴权的接口，把 Authorization 之类的敏感请求头绑定密钥引用（不能写明文），保存后在「本机密钥」表单里填入实际值，它会直接进系统 Keychain。',
      '检查 risk：GET 会自动落到 read，POST 是 low-write，DELETE 是 destructive。只能上调不能下调，read 的工具会被模型自动放行。',
      '点「运行测试」：GET 直接跑，其他方法会先弹确认框。测试用正式执行器，会真实访问网络。',
      '测试通过后点「保存草稿」，再点「发布到本机」。注意首次发布会自动启用这个工具。',
      '开始新一轮对话，让 Agent 做一件需要这个能力的事，确认它被调用；如果没出现，先确认类型不是 provider-vision、且已经启用。',
      '后续要改，就回到「开发中」视图改草稿再发布；要临时停用，在列表行里关掉开关即可，稳定版本会被保留。',
    ],
  },
}

export default customTools
