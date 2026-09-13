import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      Spark Work 通过「远程连接」让你从 Telegram / 飞书 / QQ / 微信 Claw 继续与本地 Agent
      通信。设计参考 TeamAgentX 的桥接 Bot 流程：外部消息由平台适配器规范化，
      <code>/bind CODE</code> 配对，配对后所有消息路由进 Spark Work 会话或内置远程命令。
    </p>

    <h2 id="channels">1. 通道</h2>
    <ul>
      <li>Telegram Bot</li>
      <li>飞书 Bot</li>
      <li>QQ Bot</li>
      <li>微信 Claw</li>
    </ul>
    <p>每条通道可独立启用；可以同时配置并配对多个通道。</p>
    <p>
      每个远程连接默认使用独立会话。一个会话已被其他远程连接绑定时，新连接不能直接复用；
      只有所有相关连接都显式开启“跨连接共享会话”才允许共享。共享会话会同时共享对话历史和会话级
      模型、Agent、推理强度及权限状态。
    </p>

    <h2 id="model">2. 配置模型</h2>
    <p>
      远程连接数据存在 <code>app_settings</code> 的 <code>remote-connections</code> 分类、
      <code>data</code> key 下：
    </p>
    <pre>{`{
  "global": { "defaultProvider": "...", "defaultModel": "...", "defaultAgent": "..." },
  "connections": [
    {
      "id": "tg-main",
      "channel": "telegram",
      "name": "Personal Bot",
      "enabled": true,
      "credentials": { "botToken": "..." },
      "commandPrefix": "/",
      "allowList": [...],
      "defaultSession": "...",
      "capabilities": [...],
      "pairing": { "code": "...", "expiresAt": "..." },
      "pairedDevices": [...]
    }
  ]
}`}</pre>
    <p>主进程在 IPC handler 注册时自动启动本地桥接运行时，暴露：</p>
    <ul>
      <li>
        <code>GET /remote/health</code>
      </li>
      <li>
        <code>POST /remote/webhook/:channel/:connectionId</code>
      </li>
    </ul>
    <p>
      默认监听 <code>127.0.0.1:32178</code>；端口被占则随机回退，并在「设置 → 远程连接」显示真实
      URL。
    </p>
    <p>
      Telegram 在「已启用 + botToken 有效」时启动本地长轮询；飞书在「已启用 + AppID/AppSecret
      有效」时启动官方 WebSocket 长连接。这两条通道<strong>不需要公网 webhook URL</strong>。
    </p>

    <h2 id="pairing">3. 配对</h2>
    <ol>
      <li>保存通道凭据。</li>
      <li>生成配对码或 QR 负载。</li>
      <li>
        在外部聊天里发 <code>/bind CODE</code>。
      </li>
      <li>桥接校验码，把外部聊天存为已配对设备，并在同通道回复。</li>
    </ol>
    <p>
      QR 配对产出 <code>spark-agent://remote-pair</code> 负载（包含 connectionId / channel / code /
      过期时间）。 能打开这个 URL 的客户端仍走同一配对流程。
    </p>

    <h2 id="commands">4. 内置远程命令</h2>
    <p>所有通道共用同一套命令：</p>
    <ul>
      <li>
        <code>/help</code>
      </li>
      <li>
        <code>/sessions [all|idle|running|error] [页码]</code>
      </li>
      <li>
        <code>/use-session &lt;序号|名称|sessionId&gt;</code>
      </li>
      <li>
        <code>/projects [页码]</code> / <code>/use-project</code> / <code>/add-project</code>
      </li>
      <li>
        <code>/channels [页码]</code>
      </li>
      <li>
        <code>/use-channel &lt;序号|名称|渠道ID&gt;</code>
      </li>
      <li>
        <code>/agents</code>
      </li>
      <li>
        <code>/use-agent &lt;agentId&gt;</code>
      </li>
      <li>
        <code>/models [页码]</code> / <code>/use-model</code>
      </li>
      <li>
        <code>/new-session [workspaceId]</code>
      </li>
      <li>
        <code>/reasoning</code> / <code>/use-reasoning</code>
      </li>
      <li>
        <code>/permissions</code> / <code>/use-permission</code>
      </li>
      <li>
        <code>/send &lt;message&gt;</code>
      </li>
      <li>
        <code>/status</code>
      </li>
    </ul>
    <p>已配对的入站消息处理流程：</p>
    <ol>
      <li>以配置的前缀开头的消息 → 跑命令处理器。</li>
      <li>
        普通消息 → 通过 <code>SessionService.sendTurn</code> 发到该连接的默认会话。
      </li>
      <li>
        没配置默认会话 → Spark 在默认项目中自动创建会话；选择“不使用项目”时立即创建 no-project
        会话。
      </li>
      <li>配置了 default provider / model / agent → 在发送时应用。</li>
      <li>Telegram 和飞书的列表响应使用分页按钮，不再回传大段列表文本。</li>
      <li>新建远程会话默认使用各执行器的自动审批模式；完全访问仍受高危操作权限保护。</li>
    </ol>
    <p>
      设置页提供「默认会话」选择器，确保普通消息有明确去处。 Telegram 命令会在轮询启动时通过{' '}
      <code>setMyCommands</code> 同步给 Telegram。
    </p>

    <h2 id="ui">5. 设置 UI</h2>
    <p>「设置 → 远程连接」是一块紧凑的管理工作区：</p>
    <ul>
      <li>顶部运行态条：本地 webhook base URL、已启用通道数、已连接通道数。</li>
      <li>平台入口卡：用 Telegram / 飞书的真实图标，点击进入对应平台控制台或搭建入口。</li>
      <li>
        连接列表卡：平台图标、连接名、通道、状态、启用状态、已配对设备数、默认会话（位置始终一致）。
      </li>
      <li>
        编辑模态：固定头 + 段导航 + 可滚动内容 + 固定底栏（保存 / 测试 / 删除）。长设置按 Basics /
        Credentials / Authorization / Pairing / Commands 分组。
      </li>
      <li>窄窗口自动切单列布局，段导航折叠。</li>
    </ul>

    <h2 id="platform-runtime">6. 平台运行时要点</h2>
    <p>远程消息附带的内置运行说明只提供给 Agent；软件会话中展示用户原话，不展示内置提示词。</p>
    <ul>
      <li>
        <strong>Telegram</strong>：<code>getUpdates</code> 轮询；文本走 <code>sendMessage</code>。
        收到已配对用户的消息后，优先在原消息添加 👀 反应确认接收（若该聊天不允许反应则静默跳过）；
        长任务期间每 4 秒续期 <code>sendChatAction(typing)</code>；产生正文后通过{' '}
        <code>sendMessage</code> 与 <code>editMessageText</code> 在同一条消息中增量展示，
        最终回复尽量原位收口；常用 Markdown 会转换为 Telegram HTML
        富文本，解析失败时自动回退纯文本； 发送或编辑失败时退回持续输入状态与正常回复。
        开启“传输文件”能力后，回复中的 Markdown 图片会通过 <code>sendPhoto</code> 发送。本地图片优先
        multipart 直传 Telegram；若图片模式被拒绝则以文件模式发送，直传失败时上传到 Spark
        临时存储，再由 Telegram 拉取临时 URL。用户发送的 Telegram 图片或图片文件会通过{' '}
        <code>getFile</code> 下载到本机持久附件目录，并作为图片附件提交给当前会话识别；单张图片限制
        20 MB。同一图片同时出现在 Markdown 引用和文件卡片时，发送前会按文件路径或 URL 去重。
      </li>
      <li>
        <strong>飞书</strong>：通过 <code>@larksuiteoapi/node-sdk</code> 的官方 WebSocket
        长连接，只需 App ID / App Secret。 推荐用{' '}
        <code>https://open.feishu.cn/page/openclaw?form=multiAgent</code>{' '}
        作为搭建入口（自建机器人应用 + 常用能力勾选）。 回复走 <code>im/v1/messages</code>，
        <code>chat_id</code> 默认作为接收 ID 类型。 Spark Work 在收到配对消息后会给源消息加{' '}
        <code>Typing</code> 表情反应。开启“传输文件”后，收到的图片从消息资源接口下载并提交给会话；
        回复图片先上传到 <code>im/v1/images</code>，再用 <code>image_key</code> 发送原生图片消息。
      </li>
      <li>
        <strong>QQ</strong>：单聊、群聊及频道消息中的图片附件从腾讯图片 CDN 下载并提交给会话。
        单聊和群聊的回复图片先上传到 <code>/files</code> 获取 <code>file_info</code>，再通过
        <code>msg_type=7</code> 发送富媒体消息；频道使用 <code>file_image</code> 字段发送图片。
        单聊和群聊的大图上传失败时，可使用 Spark 临时存储 URL 中转。
      </li>
    </ul>
    <p>
      三种渠道的入站图片均在配对鉴权后下载，限制为 20
      MB，并按图片文件签名校验。此能力需要连接中开启“传输文件”。
    </p>

    <h2 id="bot-creation">7. 一键创建 Bot</h2>
    <p>设置页为每个通道提供「一键起草」：</p>
    <ul>
      <li>Telegram：BotFather</li>
      <li>飞书：openclaw 快捷页</li>
    </ul>
    <p>外部平台仍需你手动授权或复制凭据；「一键起草」仅创建本地草稿并打开目标平台控制台。</p>

    <h2 id="startup">8. 启动项集成</h2>
    <p>
      「设置 → 通用」通过 <code>app:get-startup-settings</code> /{' '}
      <code>app:set-startup-settings</code>
      读写 Electron 登录项；启动时同步持久化的 <code>general.autoStart</code> 到系统登录项状态。
    </p>
  </>
)

export const remoteConnections: DocsPageContent = {
  slug: 'remote-connections',
  toc: [
    { id: 'channels', title: '1. 通道', level: 2 },
    { id: 'model', title: '2. 配置模型', level: 2 },
    { id: 'pairing', title: '3. 配对', level: 2 },
    { id: 'commands', title: '4. 内置远程命令', level: 2 },
    { id: 'ui', title: '5. 设置 UI', level: 2 },
    { id: 'platform-runtime', title: '6. 平台运行时要点', level: 2 },
    { id: 'bot-creation', title: '7. 一键创建 Bot', level: 2 },
    { id: 'startup', title: '8. 启动项集成', level: 2 },
  ],
  faq: [
    {
      question: '需要公网 IP 吗？',
      answer:
        'Telegram / 飞书均不需要公网 IP（Telegram 走本地长轮询，飞书走官方 WebSocket 长连接）。',
    },
    {
      question: '配对码过期怎么办？',
      answer: '重新生成即可。每个连接可随时生成新码，旧码立即失效。',
    },
    {
      question: '可以同时挂多个 Telegram 通道吗？',
      answer: '可以。每个连接是独立的 botToken，独立轮询。',
    },
    {
      question: '配对消息会被路由到哪个会话？',
      answer:
        '该连接的 defaultSession；如果没设，Spark 会自动创建一个 no-project 会话并设为本连接默认。',
    },
  ],
  quickReference: [
    { key: '通道', value: 'Telegram / 飞书 / QQ / 微信 Claw' },
    { key: '配置分类', value: 'app_settings.remote-connections.data' },
    { key: '本地 webhook', value: '127.0.0.1:32178（端口占用时随机回退）' },
    { key: '端点', value: 'GET /remote/health · POST /remote/webhook/:channel/:connectionId' },
    {
      key: '内置命令',
      value:
        '/help · /projects · /sessions · /channels · /models · /reasoning · /permissions · /send · /status',
    },
    { key: 'QR 配对', value: 'spark-agent://remote-pair (含 connectionId/channel/code/expiry)' },
  ],
  howTo: {
    name: '用 Telegram 远程控制 Spark Work',
    description: '从创建 Bot 到发第一条 /send 消息',
    totalTime: 'PT8M',
    steps: [
      '在 Telegram 用 BotFather 创建 Bot，拿到 botToken',
      'Spark 「设置 → 远程连接」点 Telegram 图标，新建连接',
      '粘贴 botToken，保存并「测试」',
      '在 Bot 私聊发 /bind CODE 完成配对',
      '配对成功后在 Bot 里发 /send 你的任务，或 /sessions 查看会话',
    ],
  },
  aiSummary:
    'Spark Work 远程连接（Telegram / 飞书）：配置存在 app_settings.remote-connections.data，包含 global pairing defaults 与 connection 列表；' +
    '本地桥接运行时暴露 GET /remote/health、POST /remote/webhook/:channel/:connectionId，默认监听 127.0.0.1:32178（端口占用时随机回退）。' +
    'Telegram 走 getUpdates 轮询并使用分页 inline keyboard；飞书走 @larksuiteoapi/node-sdk 官方 WebSocket 长连接并使用交互卡片，' +
    '可通过 https://open.feishu.cn/page/openclaw?form=multiAgent 一键搭建。配对流程：保存凭据 → 生成 CODE → 外部聊天 /bind CODE → ' +
    'spark-agent://remote-pair QR。内置命令覆盖项目、会话、渠道、模型、Agent、推理强度、权限模式与运行时操作；' +
    '新建远程会话默认自动审批，完全访问需高危操作授权。设置 UI 顶部运行态条 + 平台图标卡 + 列表卡 + 段导航编辑模态。' +
    '启动项集成：app:get-startup-settings / app:set-startup-settings 同步 general.autoStart。',
  Body,
}

export default remoteConnections
