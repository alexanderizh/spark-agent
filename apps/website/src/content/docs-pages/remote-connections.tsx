import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      远程连接让你从手机或另一台设备继续与本地 SparkWork 里的 Agent 对话。当前真实支持{' '}
      <strong>Telegram、飞书、QQ 三个通道</strong>：Telegram 走本地长轮询，飞书与 QQ 走官方
      WebSocket 长连接，三者都<strong>不需要公网地址</strong>；同时保留一个本机 HTTP webhook 服务，
      用于本地调试与自建网关（微信 Claw 协议类型仍在，但界面没有新建入口）。 所有配置存在{' '}
      <code>app_settings</code> 的 <code>remote-connections/data</code> 里， 配对、隔离与转发逻辑在{' '}
      <code>apps/desktop/src/main/services/RemoteConnectionService.ts</code>。
    </p>

    <h2 id="channels">1. 支持的通道</h2>
    <table>
      <thead>
        <tr>
          <th>通道</th>
          <th>必填凭据</th>
          <th>连接方式</th>
          <th>搭建入口</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>telegram</code> Telegram
          </td>
          <td>
            <code>botToken</code>
          </td>
          <td>
            本机 <code>getUpdates</code> 长轮询（不需要公网 webhook）
          </td>
          <td>
            <code>https://t.me/BotFather</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>feishu</code> 飞书机器人
          </td>
          <td>
            <code>appId</code>、<code>appSecret</code>
          </td>
          <td>
            <code>@larksuiteoapi/node-sdk</code> 官方 WebSocket 长连接
          </td>
          <td>
            <code>https://open.feishu.cn/page/openclaw?form=multiAgent</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>qq</code> QQ 机器人
          </td>
          <td>
            <code>qqBotAppId</code>、<code>qqBotSecret</code>
          </td>
          <td>
            官方 WebSocket 网关（<code>api.sgroup.qq.com</code> / <code>bots.qq.com</code>）
          </td>
          <td>
            <code>https://q.qq.com/#/app/bot</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>wechat-claw</code> 微信 Claw
          </td>
          <td>
            <code>clawEndpoint</code>、<code>clawAccessToken</code>
          </td>
          <td>
            自建网关协议：本地 webhook 收消息，出站调 <code>&lt;endpoint&gt;/send</code>（失败回退{' '}
            <code>/message</code>）
          </td>
          <td>
            协议与解析器仍在，但新建连接的平台卡片里<strong>不提供该通道</strong>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      可以同时配置并启用多个连接（每个 Telegram 连接是独立的 botToken 与独立轮询）；
      界面上的平台入口只有三个：
      <code>AVAILABLE_REMOTE_CHANNELS = ['telegram', 'feishu', 'qq']</code>。
    </p>

    <h2 id="model">2. 配置模型：字段、默认值与存储位置</h2>
    <p>
      存储位置是 <code>app_settings</code> 的 <code>remote-connections</code> 分类、key 为{' '}
      <code>data</code>，值形如{' '}
      <code>
        {'{'}global, connections{'}'}
      </code>
      。
    </p>
    <p>
      <strong>global（全局运行设置）</strong>，括号内是代码里的默认值：
    </p>
    <ul>
      <li>
        <code>enabled</code>（<code>true</code>）：总开关，关闭时运行时会整体停止。
      </li>
      <li>
        <code>requirePairing</code>（<code>true</code>）：未配对用户的消息不会被处理。
      </li>
      <li>
        <code>allowQrPairing</code>（<code>true</code>）：是否允许生成二维码配对负载。
      </li>
      <li>
        <code>pairingTtlMinutes</code>（<code>10</code>）：配对码有效期。
      </li>
      <li>
        <code>localWebhookPort</code>（<code>32178</code>）：本机 HTTP 服务端口。
      </li>
      <li>
        <code>publicBaseUrl</code>（未设置）：需要外部回调时使用的基础地址。
      </li>
    </ul>
    <p>
      <strong>connection（每条连接）</strong>：
    </p>
    <table>
      <thead>
        <tr>
          <th>字段</th>
          <th>说明</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>id</code> / <code>channel</code> / <code>name</code> / <code>enabled</code>
          </td>
          <td>
            身份与开关；<code>id</code> 形如 <code>remote-xxx</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>status</code>
          </td>
          <td>
            <code>disabled</code> / <code>draft</code> / <code>pending-pairing</code> /{' '}
            <code>connected</code> / <code>error</code>（界面文案：已停用 / 草稿 / 等待配对 / 已连接
            / 错误）
          </td>
        </tr>
        <tr>
          <td>
            <code>credentials</code>
          </td>
          <td>按通道取不同字段（见上一节的必填项）</td>
        </tr>
        <tr>
          <td>
            <code>commandPrefix</code>
          </td>
          <td>
            命令前缀，默认 <code>/</code>（Telegram 会同步为 bot command）
          </td>
        </tr>
        <tr>
          <td>
            <code>allowedUserIds</code> / <code>allowedChatIds</code>
          </td>
          <td>允许名单（最多各 200 项）</td>
        </tr>
        <tr>
          <td>
            <code>routeBindings</code>
          </td>
          <td>按「外部聊天」各自保存的默认会话/项目/Provider/模型/Agent/权限模式/推理强度</td>
        </tr>
        <tr>
          <td>
            <code>defaultSessionId</code> / <code>defaultWorkspaceId</code> /{' '}
            <code>defaultProviderProfileId</code> / <code>defaultModelId</code> /{' '}
            <code>defaultAgentId</code> / <code>defaultPermissionMode</code> /{' '}
            <code>defaultReasoningEffort</code>
          </td>
          <td>连接级默认值；有 routeBinding 时以聊天级为准</td>
        </tr>
        <tr>
          <td>
            <code>allowSharedSession</code>
          </td>
          <td>是否允许与其他远程连接共享同一会话（默认关闭）</td>
        </tr>
        <tr>
          <td>
            <code>telegramCommands</code> / <code>qqCommands</code>
          </td>
          <td>要同步到 Telegram 命令菜单 / QQ 指令面板的命令名清单（默认 14 条，最多 80 条）</td>
        </tr>
        <tr>
          <td>
            <code>capabilities</code>
          </td>
          <td>能力开关，见下表</td>
        </tr>
        <tr>
          <td>
            <code>pairing</code> / <code>pairedDevices</code>
          </td>
          <td>
            当前配对码与已配对设备（<code>remoteUserId</code>、<code>displayName</code>、
            <code>channelThreadId</code>、<code>pairedAt</code>、<code>lastSeenAt</code>）
          </td>
        </tr>
        <tr>
          <td>
            <code>lastConnectedAt</code> / <code>lastError</code>
          </td>
          <td>
            最近连接时间与最近错误（「测试配置」会写 <code>lastError</code>）
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      能力开关（<code>capabilities</code>）的界面标签与默认值：
    </p>
    <table>
      <thead>
        <tr>
          <th>字段</th>
          <th>界面标签</th>
          <th>默认</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>sendMessages</code>
          </td>
          <td>发送消息到会话</td>
          <td>
            <code>true</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>switchModel</code>
          </td>
          <td>切换模型 / Provider</td>
          <td>
            <code>true</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>switchSession</code>
          </td>
          <td>切换会话</td>
          <td>
            <code>true</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>switchAgent</code>
          </td>
          <td>切换 Agent</td>
          <td>
            <code>true</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>manageWorkspace</code>
          </td>
          <td>查看工作区</td>
          <td>
            <code>true</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>runCommands</code>
          </td>
          <td>运行内置命令</td>
          <td>
            <code>true</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>approvePermissions</code>
          </td>
          <td>远程审批权限</td>
          <td>
            <code>true</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>observeDesktop</code>
          </td>
          <td>观察桌面</td>
          <td>
            <code>true</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>controlDesktop</code>
          </td>
          <td>控制桌面</td>
          <td>
            <code>false</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>useInternalBrowser</code>
          </td>
          <td>使用内置浏览器窗口</td>
          <td>
            <code>false</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>transferFiles</code>
          </td>
          <td>传输文件</td>
          <td>
            <code>false</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>manageRuntime</code>
          </td>
          <td>管理运行时</td>
          <td>
            <code>true</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>dangerousActions</code>
          </td>
          <td>高危动作确认</td>
          <td>
            <code>false</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      安全提醒：远程连接的凭据（bot token / AppSecret 等）以<strong>明文 JSON</strong>存在{' '}
      <code>app_settings</code> 里，不在系统的 Keychain/vault 中；
      <strong>界面用的是普通文本输入框</strong>，已保存的值会明文显示，不做掩码。
      共享这台机器数据库的人可以看到这些凭据。
    </p>

    <h2 id="runtime">3. 本地运行时与两个 HTTP 端点</h2>
    <ul>
      <li>
        主进程注册远程连接 IPC 时会启动运行时：先跑 <code>startRuntime</code>（要求{' '}
        <code>global.enabled</code> 为真），再按每条启用连接启动对应通道的接收端 （Telegram 轮询 /
        飞书与 QQ 长连接）。
      </li>
      <li>
        本机 HTTP 服务监听 <code>127.0.0.1:&lt;localWebhookPort&gt;</code>，默认 32178；
        如果端口被占用（<code>EADDRINUSE</code>），会退化为让操作系统分配随机端口，
        真实端口通过运行态接口回传并在设置页顶部显示。
      </li>
      <li>
        <code>GET /remote/health</code>：返回{' '}
        <code>
          {'{'}ok: true, ...运行态{'}'}
        </code>
        。
      </li>
      <li>
        <code>POST /remote/webhook/:channel/:connectionId</code>：找不到连接返回 404；
        否则按渠道解析请求体（Telegram 支持 <code>callback_query</code> 与 <code>message</code>；
        飞书支持 URL 校验 challenge；QQ 走 dispatch 事件；其余按通用 <code>chatId</code> +{' '}
        <code>text</code> 结构解析）。
      </li>
      <li>
        运行态查询用 <code>remote:runtime-status</code>，返回 <code>running</code>、
        <code>port</code>、<code>localBaseUrl</code>、<code>polling[]</code>（Telegram）与{' '}
        <code>longConnections[]</code>（飞书/QQ，带 <code>lastError</code>）。
      </li>
      <li>
        IPC 全景：<code>remote:list</code> / <code>remote:save</code> / <code>remote:delete</code> /{' '}
        <code>remote:test</code> / <code>remote:create-bot-draft</code> /{' '}
        <code>remote:generate-pairing</code> / <code>remote:confirm-pairing</code> /{' '}
        <code>remote:command-catalog</code> / <code>remote:execute-command</code> /{' '}
        <code>remote:runtime-status</code>；配置变化会通过 <code>stream:remote:changed</code>{' '}
        推给界面。
      </li>
    </ul>

    <h2 id="pairing">4. 配对：6 位数字码与 QR 负载</h2>
    <ol>
      <li>在设置页填好凭据并保存（保存后状态通常是「草稿」或「等待配对」）。</li>
      <li>
        点「生成配对码」或「生成二维码配对」：调用 <code>remote:generate-pairing</code>， 服务端生成
        6 位数字码（<code>randomInt(100000, 999999)</code>），有效期由{' '}
        <code>pairingTtlMinutes</code> 决定（默认 10 分钟），并把连接状态置为{' '}
        <code>pending-pairing</code>、自动启用该连接。
      </li>
      <li>
        QR 负载格式是{' '}
        <code>
          spark-agent://remote-pair?connectionId=..&amp;channel=..&amp;code=..&amp;expiresAt=..
        </code>
        ； 界面上的「复制配对命令」复制的则是 <code>/bind &lt;code&gt;</code>。
      </li>
      <li>
        在外部聊天里发送 <code>/bind &lt;code&gt;</code>（正则接受 6~12 位大写字母数字，实际生成为 6
        位数字）。 服务端校验码相等且未过期，然后把该聊天写入 <code>pairedDevices</code>、清掉{' '}
        <code>pairing</code>、 状态置为 <code>connected</code>，并在同通道回复结果。
      </li>
      <li>
        也可以走 <code>remote:confirm-pairing</code> 手动确认（设置页的配对区支持手工填入远程用户
        ID/名称）， 适合自建网关等拿不到入站消息的场景。
      </li>
      <li>
        重新生成配对码会让旧码立即失效；<code>requirePairing</code>{' '}
        为真时，未配对聊天发来的消息会被直接忽略。
      </li>
    </ol>

    <h2 id="commands">5. 内置命令清单（按能力分组）</h2>
    <p>
      命令目录来自服务端的 <code>COMMAND_CATALOG</code>，可通过 <code>remote:command-catalog</code>{' '}
      查询；每条命令都绑定一个能力开关，能力关闭时执行会返回被拒绝的说明。 前缀默认是 <code>/</code>
      ，可用 <code>commandPrefix</code> 改。
    </p>
    <table>
      <thead>
        <tr>
          <th>用到的能力</th>
          <th>命令</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>system</code>
          </td>
          <td>
            <code>/start</code>、<code>/help</code>、<code>/status</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>sendMessages</code>
          </td>
          <td>
            <code>/send &lt;message&gt;</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>switchSession</code>
          </td>
          <td>
            <code>/sessions [all|idle|running|error] [页码]</code>、
            <code>/use-session &lt;序号|名称|sessionId&gt;</code>、
            <code>/new-session [序号|名称|workspaceId]</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>switchModel</code>
          </td>
          <td>
            <code>/models [页码]</code>、<code>/use-model &lt;序号|名称|modelId&gt;</code>、
            <code>/providers [页码]</code>、
            <code>/use-provider &lt;序号|名称|providerProfileId&gt;</code>、
            <code>/channels [页码]</code>、<code>/use-channel &lt;序号|名称|渠道ID&gt;</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>switchAgent</code>
          </td>
          <td>
            <code>/agents [页码]</code>、<code>/use-agent &lt;序号|名称|agentId&gt;</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>manageWorkspace</code>
          </td>
          <td>
            <code>/workspaces [页码]</code>、<code>/projects [页码]</code>、
            <code>/use-project &lt;序号|名称|项目ID&gt;</code>、
            <code>/open-workspace &lt;path&gt;</code>、<code>/add-project &lt;path&gt;</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>manageRuntime</code>
          </td>
          <td>
            <code>/reasoning</code>、
            <code>/use-reasoning &lt;minimal|low|medium|high|xhigh|max&gt;</code>、
            <code>/progress</code>、<code>/queue</code>、<code>/history</code>、<code>/cancel</code>
            、<code>/stop</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>approvePermissions</code>
          </td>
          <td>
            <code>/permissions</code>、<code>/use-permission &lt;manual|auto|plan|full&gt;</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>observeDesktop</code>
          </td>
          <td>
            <code>/screen</code>、<code>/windows</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>controlDesktop</code>（默认关闭）
          </td>
          <td>
            <code>/focus &lt;序号|窗口标题&gt;</code>、<code>/click &lt;x&gt; &lt;y&gt;</code>、
            <code>/type &lt;text&gt;</code>、<code>/hotkey &lt;keys&gt;</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>dangerousActions</code>（默认关闭）
          </td>
          <td>
            <code>/confirm &lt;code&gt;</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      新连接默认同步 14 条命令到平台原生菜单：<code>start</code>、<code>help</code>、
      <code>status</code>、<code>projects</code>、<code>sessions</code>、<code>new-session</code>、
      <code>channels</code>、<code>models</code>、<code>agents</code>、<code>reasoning</code>、
      <code>permissions</code>、<code>progress</code>、<code>queue</code>、<code>cancel</code>
      。Telegram 走 <code>setMyCommands</code>（清单为空时改调 <code>deleteMyCommands</code>）； QQ
      注册为「指令面板」，<strong>单条面板名超过 14 字符会被跳过</strong>。
    </p>

    <h2 id="inbound">6. 入站消息：命令、普通消息与会话隔离</h2>
    <p>已配对聊天的消息按下面的顺序处理：</p>
    <ol>
      <li>
        <strong>以命令前缀开头的消息</strong> → 走内置命令目录；先检查该命令所需能力是否开启，
        再执行会话/项目/模型/Agent/推理/权限等操作。Telegram 与 QQ 支持分页与按钮式选择，
        点击按钮会原位更新消息（Telegram 用 <code>editMessageText</code>）而不是刷屏。
      </li>
      <li>
        <strong>普通消息</strong> → 包装成一次远程 turn 后提交给 <code>SessionService</code>。
        包装内容是【本轮远程渠道：X】+ 渠道约束 + 文件能力说明（开启「传输文件」时要求用{' '}
        <code>mcp__spark_files__present_files</code>{' '}
        提交真实文件，未开启时明确禁止声称已发送文件）； 会话与桌面端界面里
        <strong>只显示你的原话</strong>，不显示这段内置说明。
      </li>
      <li>
        <strong>新聊天没有绑定会话</strong> → 用 <code>defaultWorkspaceId</code>（或该聊天的
        routeBinding） 在对应项目里新建会话；没有项目时创建「不使用项目」的会话，
        并把这个绑定写回该聊天的 routeBinding。
      </li>
      <li>
        <strong>新建会话的权限模式</strong>：优先用连接/聊天配置的{' '}
        <code>defaultPermissionMode</code>， 否则按适配器取默认的自动审批档（Claude{' '}
        <code>claude-auto</code>、Codex <code>codex-auto-review</code>、Spark{' '}
        <code>spark-auto</code>）。 「完全访问」档仍需在连接里显式配置，并且高危操作仍受权限层保护。
      </li>
      <li>
        配置了默认 Provider / 模型 / Agent / 推理强度时，这些值在发送时应用； 每条远程回复只会发回
        <strong>本轮来源渠道</strong>，历史消息里提到的其他渠道不会改变发送目标。
      </li>
    </ol>
    <p>
      <strong>会话隔离的真实规则</strong>：
    </p>
    <ul>
      <li>
        同一条机器人下的私聊与群聊是不同聊天（<code>connectionId</code> + <code>externalId</code>{' '}
        组成唯一路由键），各自保存默认会话、项目、模型与选择状态，互不覆盖。
      </li>
      <li>
        一个会话已被其他连接/聊天绑定时，新连接不能直接复用：<code>/use-session</code> 会返回
        「会话已绑定到其他远程聊天」或「会话已被其他远程连接占用」。
      </li>
      <li>
        只有所有相关连接都显式开启「跨连接共享会话」（<code>allowSharedSession</code>）时，
        才允许共享；<code>/status</code> 会明示「会话隔离：独立 / 与 X、Y 显式共享」。
      </li>
      <li>
        定时任务的结果只在「该会话恰好由一个已启用聊天拥有」时回传 （
        <code>resolveScheduledRemoteRoute</code>：路由数不等于 1 就返回 null，不猜接收者）。
      </li>
    </ul>

    <h2 id="platform-runtime">7. 平台运行时要点</h2>
    <p>
      <strong>Telegram</strong>
    </p>
    <ul>
      <li>
        接收：<code>getUpdates</code> 长轮询，<code>timeout=25</code>，
        <code>allowed_updates=["message","callback_query"]</code>；按 offset 递增确认。
      </li>
      <li>
        收到已配对用户消息后优先给原消息加 👀 反应（<code>setMessageReaction</code>）；
        群组禁用反应时静默跳过，不影响后续处理。
      </li>
      <li>
        输入状态：长任务期间每 4 秒续期一次 <code>sendChatAction(typing)</code>；
        正文以「草稿」形式在同一条消息里增量编辑，编辑节流 1 秒，单条最长 3900
        字符（超出保留尾部）。
      </li>
      <li>
        Markdown 会转换为 Telegram HTML 富文本，解析失败自动回退纯文本； 出站文本按 3900
        字符分片发送。
      </li>
      <li>
        图片：入站图片经 <code>getFile</code> 下载到{' '}
        <code>{'{userData}'}/attachments/remote/telegram/&lt;日期&gt;/</code> 后作为附件提交给会话；
        出站先尝试 <code>sendPhoto</code>（本地文件走 multipart 直传），被拒或失败时改用{' '}
        <code>sendDocument</code>，直传失败还会经临时存储中转。
      </li>
    </ul>
    <p>
      <strong>飞书</strong>
    </p>
    <ul>
      <li>
        用 App ID / App Secret 换 <code>tenant_access_token</code>（带缓存与过期时间）。
      </li>
      <li>
        回复走 <code>im/v1/messages</code>，<code>receive_id_type</code> 由会话 id 形态推导 （
        <code>chat_id</code> / <code>open_id</code>）；消息体是 interactive 卡片，文本按 10000
        字符分片。
      </li>
      <li>
        收到配对消息后给源消息加 <code>Typing</code> 表情反应。
      </li>
      <li>
        图片：入站从消息资源接口下载并提交会话；出站先上传到 <code>im/v1/images</code>， 再用{' '}
        <code>image_key</code> 发送原生图片消息。
      </li>
    </ul>
    <p>
      <strong>QQ</strong>
    </p>
    <ul>
      <li>
        鉴权：<code>POST https://bots.qq.com/app/getAppAccessToken</code> 取{' '}
        <code>access_token</code>， 后续请求头是 <code>Authorization: QQBot &lt;token&gt;</code>。
      </li>
      <li>
        长连接：先取网关地址再连 WebSocket，支持 Resume；当服务端拒绝订阅（<code>op:9</code>{' '}
        或关闭码 4013/4014）时会<strong>逐级降低 intents 后重连</strong>。
      </li>
      <li>
        消息 API：频道用 <code>/channels/&lt;id&gt;/messages</code>，群聊用{' '}
        <code>/v2/groups/&lt;id&gt;/messages</code>，单聊用{' '}
        <code>/v2/users/&lt;id&gt;/messages</code>； 文本 <code>msg_type: 0</code>，按字节分片（频道
        1900、群聊/单聊 1000），优先被动回复（引用 <code>msg_id</code> + 递增 <code>msg_seq</code>
        ）， 超窗后退化为主动消息。
      </li>
      <li>
        图片：入站从腾讯图片 CDN 下载；频道出站用 multipart 的 <code>file_image</code> 字段，
        单聊/群聊先上传拿到 <code>file_info</code> 再发 <code>msg_type: 7</code> 富媒体消息。
      </li>
      <li>
        配对的 QQ 机器人会把 <code>qqCommands</code> 同步为指令面板（超 14 字符的面板名跳过）。
      </li>
    </ul>
    <p>
      三个渠道的入站图片都在配对鉴权之后下载，统一限制 20 MB，并按文件头（magic bytes）校验， 只接受
      PNG / JPEG / WebP；不合法会报「仅支持 PNG、JPEG 或 WebP 图片」。 出站图片如果给的是网络
      URL，会先做公开地址校验再下载。此能力需要连接里开启「传输文件」。
    </p>

    <h2 id="ui">8. 设置 UI 结构</h2>
    <ul>
      <li>
        <strong>入口</strong>：设置 → 远程连接（左栏「生态」分组）。页面说明文案是 「通过
        Telegram、飞书、QQ 从远程桌面或移动端与 SparkWork 通信」。
      </li>
      <li>
        <strong>运行态条</strong>：左侧显示 <code>localBaseUrl</code>（未启动时显示「本地 webhook
        服务未启动」）， 下方提示「N
        个渠道已启用，远程消息会进入各聊天独立绑定的会话」或「启用任一渠道后，远程消息才会被接收」；
        右上角徽标显示「运行中 / 未运行」与「已连接 / 总数」。右侧有「刷新」。
      </li>
      <li>
        <strong>平台入口卡</strong>：Telegram / 飞书 / QQ
        三个图标卡，点头部按钮会创建草稿并打开对应平台控制台。
      </li>
      <li>
        <strong>连接列表卡</strong>
        ：平台图标、名称、通道、状态标签、启用状态、已配对设备数、默认会话。
      </li>
      <li>
        <strong>编辑模态</strong>：宽 980、高度 <code>min(68dvh, 680px)</code>，左侧段导航固定五段——
        <strong>基础</strong>、<strong>凭证</strong>、<strong>授权</strong>、<strong>配对</strong>、
        <strong>命令</strong>；右侧可滚动内容，底部固定操作栏：
        <strong>删除</strong>、<strong>取消</strong>、<strong>测试配置</strong>、
        <strong>保存连接</strong>
        （未保存过的新连接不能测试/生成配对）。
      </li>
      <li>窄窗口下自动切单列布局。</li>
    </ul>
    <p>
      注意：<strong>远程连接页不控制开机自启</strong>。开机自启动在设置 →
      通用页（开关文案「开机自启动 · 登录系统后自动启动 SparkWork」）， 底层走{' '}
      <code>app:get-startup-settings</code> / <code>app:set-startup-settings</code>（
      <code>openAtLogin</code> + <code>openAsHidden</code>
      ），平台不支持时会提示「当前系统环境不支持读取登录项」。
    </p>

    <h2 id="bot-creation">9. 一键创建 Bot</h2>
    <p>
      每个通道都有 <code>remote:create-bot-draft</code>：创建一个草稿连接（
      <code>status: draft</code>）， 返回 <code>consoleUrl</code> 与 <code>instructions</code>
      ，需要时同时打开控制台。 真实返回内容：
    </p>
    <table>
      <thead>
        <tr>
          <th>通道</th>
          <th>默认名称</th>
          <th>控制台地址</th>
          <th>要点摘录</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>telegram</code>
          </td>
          <td>Telegram Bot</td>
          <td>
            <code>https://t.me/BotFather</code>
          </td>
          <td>创建 bot 复制 token → 填回 SparkWork → 生成配对码发给 bot</td>
        </tr>
        <tr>
          <td>
            <code>feishu</code>
          </td>
          <td>飞书机器人</td>
          <td>
            <code>https://open.feishu.cn/page/openclaw?form=multiAgent</code>
          </td>
          <td>用 openclaw 快捷入口创建自建应用并预选机器人能力，复制 App ID / App Secret</td>
        </tr>
        <tr>
          <td>
            <code>qq</code>
          </td>
          <td>QQ 机器人</td>
          <td>
            <code>https://q.qq.com/#/app/bot</code>
          </td>
          <td>
            在 QQ 开放平台申请「群聊」与「单聊」消息能力；单聊加好友即可，群聊需
            @机器人；保存后命令自动注册为指令面板
          </td>
        </tr>
        <tr>
          <td>
            <code>wechat-claw</code>
          </td>
          <td>微信 Claw</td>
          <td>远程连接文档页</td>
          <td>自建网关协议，没有官方统一搭建入口（界面也不提供新建）</td>
        </tr>
      </tbody>
    </table>
    <p>
      平台侧授权、审核与复制凭据仍然要你手动完成；「一键」只做本地草稿 + 打开控制台。
      保存后务必点「测试配置」：它会校验必填字段是否齐全， 缺少字段会把状态置为 <code>error</code>
      、停用连接，并写入 <code>lastError</code>（形如「缺少字段：appId, appSecret」）。
    </p>

    <h2 id="pitfalls">10. 常见坑与排查</h2>
    <ul>
      <li>
        <strong>需要公网 IP 吗？</strong>不需要。Telegram 是本机出站长轮询，飞书/QQ 是官方 WebSocket
        长连接；本地 HTTP 服务只监听 <code>127.0.0.1</code>，用于本地调试与自建网关。
      </li>
      <li>
        <strong>发消息没反应</strong>：先看设置页顶部是否「运行中」，再看该连接状态是不是
        <code>connected</code>；如果状态是 <code>pending-pairing</code>，说明还没完成{' '}
        <code>/bind</code>。QQ 群聊还需要 @机器人（或走指令面板）。
      </li>
      <li>
        <strong>「会话已绑定到其他远程聊天」</strong>：这是有意的隔离。选择另一个会话、
        <code>/new-session</code> 新建，或在所有相关连接里都开启「跨连接共享会话」。
      </li>
      <li>
        <strong>配对码过期</strong>：默认 10 分钟，重新生成即可（旧码立即失效）。
      </li>
      <li>
        <strong>图片发不出去 / 收不到</strong>：确认连接里开启了「传输文件」能力； 入站图片限 20 MB
        且只支持 PNG/JPEG/WebP；出站图片被平台拒绝时会自动降级（Telegram 图片→文件、
        飞书上传失败会报错、QQ 大图可用临时 URL 中转）。
      </li>
      <li>
        <strong>
          改了 <code>localWebhookPort</code> 但 URL 还是老的
        </strong>
        ： 端口被占用时会退化成随机端口，以运行态回传的 <code>localBaseUrl</code>{' '}
        为准；改端口后要重启运行时 （保存配置会触发运行态同步）。
      </li>
      <li>
        <strong>想让远程只能发消息、不能切模型/看桌面</strong>：在「授权」段关掉对应能力开关即可——
        命令目录里每条命令都绑定能力，关闭后会直接返回拒绝说明。
      </li>
      <li>
        <strong>安全提醒</strong>：凭据在 SQLite 里是明文；<code>requirePairing</code>{' '}
        建议保持开启； 桌面控制类能力（<code>controlDesktop</code>、<code>dangerousActions</code>
        ）默认关闭，开启前请确认你信任这些聊天的使用者。
      </li>
      <li>
        <strong>微信 Claw 找不到入口</strong>：协议类型与 webhook 解析仍然存在（
        <code>clawEndpoint</code> + <code>clawAccessToken</code>），但当前界面白名单只有 Telegram /
        飞书 / QQ；它依赖一个外部自建网关， 目前不在新建入口里暴露。
      </li>
    </ul>
  </>
)

export const remoteConnections: DocsPageContent = {
  slug: 'remote-connections',
  toc: [
    { id: 'channels', title: '1. 支持的通道', level: 2 },
    { id: 'model', title: '2. 配置模型：字段、默认值与存储位置', level: 2 },
    { id: 'runtime', title: '3. 本地运行时与两个 HTTP 端点', level: 2 },
    { id: 'pairing', title: '4. 配对：6 位数字码与 QR 负载', level: 2 },
    { id: 'commands', title: '5. 内置命令清单（按能力分组）', level: 2 },
    { id: 'inbound', title: '6. 入站消息：命令、普通消息与会话隔离', level: 2 },
    { id: 'platform-runtime', title: '7. 平台运行时要点', level: 2 },
    { id: 'ui', title: '8. 设置 UI 结构', level: 2 },
    { id: 'bot-creation', title: '9. 一键创建 Bot', level: 2 },
    { id: 'pitfalls', title: '10. 常见坑与排查', level: 2 },
  ],
  faq: [
    {
      question: '需要公网 IP 或反向代理吗？',
      answer:
        '不需要。Telegram 用本机 getUpdates 长轮询，飞书与 QQ 用官方 WebSocket 长连接；本地 HTTP 服务只监听 127.0.0.1（默认 32178，端口占用时退化为随机端口），供本地调试与自建网关使用。',
    },
    {
      question: '配对码怎么生成、多久过期？',
      answer:
        '在设置页点「生成配对码」或「生成二维码配对」，服务端生成 6 位数字码，有效期由 global.pairingTtlMinutes 决定（默认 10 分钟）。在外部聊天发送 /bind 加配对码完成配对，也可以用手动确认入口。',
    },
    {
      question: '一个 Telegram 机器人能同时给多个人用吗？',
      answer:
        '可以，但每个聊天是独立路由（connectionId + externalId），各自绑定自己的会话、项目、模型与选择状态。只有所有相关连接都开启「跨连接共享会话」时才会共用一个会话。',
    },
    {
      question: '远程会话默认什么权限？',
      answer:
        '优先用连接或聊天级的 defaultPermissionMode；未配置时按适配器取自动审批档：Claude claude-auto、Codex codex-auto-review、Spark spark-auto。完全访问档需要显式配置，且高危操作仍受权限层保护。',
    },
    {
      question: '凭据存在哪里？安全吗？',
      answer:
        '远程连接的 botToken / AppSecret 以明文 JSON 存在 SQLite 的 app_settings（remote-connections/data）里，不在系统 Keychain 或加密 vault 中，设置页用的是普通文本输入框，已保存的值会明文显示。请确保只有你信任的人能访问这台机器的用户数据目录。',
    },
    {
      question: '支持微信吗？',
      answer:
        '协议里保留 wechat-claw（clawEndpoint + clawAccessToken，可经本地 webhook 收发），但当前新建连接的平台卡片只提供 Telegram / 飞书 / QQ，因为微信通道依赖一个尚未内置的自建网关。',
    },
  ],
  quickReference: [
    { key: '可新建通道', value: 'telegram / feishu / qq（wechat-claw 协议保留但无界面入口）' },
    { key: '配置存储', value: 'app_settings → remote-connections/data（凭据为明文 JSON）' },
    { key: '本地服务', value: '127.0.0.1:32178（占用则随机端口），仅本机可访问' },
    { key: '端点', value: 'GET /remote/health · POST /remote/webhook/:channel/:connectionId' },
    {
      key: '配对',
      value:
        '6 位数字码，默认 10 分钟；QR 负载 spark-agent://remote-pair?connectionId&channel&code&expiresAt',
    },
    { key: '命令前缀', value: '默认 /（commandPrefix 可改）' },
    {
      key: '默认同步命令',
      value:
        'start help status projects sessions new-session channels models agents reasoning permissions progress queue cancel',
    },
    { key: '图片限制', value: '20 MB，仅 PNG / JPEG / WebP，需要开启「传输文件」能力' },
    {
      key: '桌面控制',
      value:
        'observeDesktop 默认开；controlDesktop / useInternalBrowser / transferFiles / dangerousActions 默认关',
    },
    { key: '运行态接口', value: 'remote:runtime-status（polling[] 与 longConnections[]）' },
    { key: '变化推送', value: 'stream:remote:changed' },
  ],
  howTo: {
    name: '用 Telegram 远程控制 SparkWork',
    description: '从创建 Bot 到完成配对并发第一条消息',
    totalTime: 'PT8M',
    steps: [
      '在 Telegram 里用 BotFather（https://t.me/BotFather）创建 Bot，复制 bot token',
      '打开设置 → 远程连接，点 Telegram 平台卡创建草稿，进入「凭证」段粘贴 Bot Token',
      '在「授权」段按需开关能力（默认已开：发送消息、切换会话/模型/Agent、观察桌面；默认关闭：控制桌面、传输文件、高危动作确认）',
      '保存连接并点「测试配置」，确认状态不再是「错误」且没有缺少字段的提示',
      '在「配对」段点「生成配对码」（或二维码配对），然后在 Telegram 里给 Bot 发 /bind <配对码>',
      '状态变为「已连接」后，直接发普通消息即可提交任务；也可以用 /sessions 选会话、/models 换模型、/status 看当前绑定',
      '如果列表很长，用消息下方的分页/选择按钮而不是手动输入序号；需要清空当前任务时发 /cancel',
    ],
  },
  aiSummary:
    'SparkWork 远程连接支持三个可新建通道：Telegram（本机 getUpdates 长轮询，timeout=25，typed 输入每 4 秒续期，👀 反应确认，图片 20MB 且只接受 PNG/JPEG/WebP）、' +
    '飞书（App ID/Secret 换 tenant_access_token，官方 WebSocket 长连接，im/v1/messages 交互卡片，Typing 表情，im/v1/images 上传图片）、' +
    'QQ（bots.qq.com 取 token，官方 WebSocket 网关支持 Resume 与 intents 降级，频道/群聊/单聊三套消息 API，图片走 file_image 或 msg_type=7，命令注册为指令面板且单名超 14 字符跳过）；' +
    'wechat-claw 协议保留但没有新建入口。配置存在 app_settings 的 remote-connections/data（global 默认 32178 端口、10 分钟配对码、requirePairing=true；connection 含 credentials、routeBindings、13 项 capabilities 等），凭据为明文 JSON。' +
    '本地运行时只监听 127.0.0.1，提供 GET /remote/health 与 POST /remote/webhook/:channel/:connectionId；配对用 6 位数字码或 spark-agent://remote-pair 二维码，外部聊天发送 /bind 加配对码完成。' +
    '内置命令按能力开关分组（sessions/use-session、models/use-model、projects/add-project、reasoning、permissions、screen/windows、click/type、confirm、send、status 等），每个聊天独立绑定会话与默认值，跨连接共享会话需双方显式开启 allowSharedSession。',
  Body,
}

export default remoteConnections
