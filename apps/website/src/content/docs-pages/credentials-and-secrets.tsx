import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      凭据与密钥管理是 SparkWork 里最容易被误解的一块：官方文档、MCP 工具描述、界面文案
      三处都在说「密钥进系统 Keychain」，但真实代码里<strong>一共有四种互不相同的落点</strong>，
      其中两种是<b>明文</b>的。这一页按代码把每个密钥「谁写的、写到哪、谁能读、什么时候删」
      逐个讲清楚。
    </p>
    <p>
      <strong>先给四条最容易被写错的结论</strong>：
    </p>
    <ul>
      <li>
        <strong>keystore 不是唯一的 keytar 入口</strong>。包注释写着「唯一合法的 keytar 调用入口」，
        但登录态用的是另一个独立实现 <code>TokenStore</code>，它自己直连 keytar， service 名是{' '}
        <code>SparkAgent.CloudAuth</code>，与集中 vault 完全不相干。
      </li>
      <li>
        <strong>macOS 上「系统 Keychain」的说法不准确</strong>。macOS 独有一条集中 vault 路径： 所有
        ref 合并成一个 JSON，由 Electron <code>safeStorage</code> 加密后写成
        <code>credential-vault-v1.enc</code>（权限 0600）。Keychain 只在<em>首次导入</em>
        时被读一次。
      </li>
      <li>
        <strong>有两处密钥是明文存进 SQLite 的</strong>：IM 机器人凭据（存
        <code>app_settings</code>）和会话/项目环境变量（也存 <code>app_settings</code>）。
        前者还会通过 IPC 明文回传给渲染进程，并在设置页用<em>普通输入框</em>展示。
      </li>
      <li>
        <strong>Spark CLI 与桌面端完全不共用凭据</strong>。CLI 把账号 token 与 refresh token 以明文
        JSON 写在 <code>~/.spark/credentials.json</code>，只靠 POSIX 0600 保护；
        <code>spark-engine</code> 里没有任何 keytar / safeStorage 代码。
      </li>
    </ul>
    <p>
      如果你只想知道「我的某一个密钥在哪」，直接跳第 2 节的落点总表；
      想知道「为什么删了工具密钥还在」，看第 12 节；想排查具体故障，看第 14 节的 24 行排查表。
    </p>

    <h2 id="taxonomy">1. 四种落点：先建立正确的心理模型</h2>
    <p>代码里出现的「凭据」实际上落在四个地方。分清它们，后面所有疑问都能自解。</p>
    <table>
      <thead>
        <tr>
          <th>落点</th>
          <th>典型内容</th>
          <th>保护方式</th>
          <th>代码位置</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <strong>① 共享 keystore</strong>
          </td>
          <td>
            Provider API Key、连接器账号、自定义工具密钥、工具包 secret、快照库主密钥、平台模型令牌
          </td>
          <td>macOS：safeStorage 加密的集中 vault 文件（0600）；其他平台：keytar 后端</td>
          <td>
            <code>packages/shared/src/keystore/index.ts</code>
          </td>
        </tr>
        <tr>
          <td>
            <strong>② TokenStore（另一个 keytar 实现）</strong>
          </td>
          <td>
            Spark 账号 access / refresh token、userId、每个 MCP 服务器的 OAuth 令牌与 client secret
          </td>
          <td>
            keytar + 一份 safeStorage 加密的备份文件 <code>cloud-auth-session.enc</code>
          </td>
          <td>
            <code>apps/desktop/src/main/services/Auth/TokenStore.ts</code>
          </td>
        </tr>
        <tr>
          <td>
            <strong>
              ③ SQLite <code>app_settings</code> 明文
            </strong>
          </td>
          <td>
            IM 机器人凭据（bot token / app secret）、会话与项目环境变量、MCP 服务器{' '}
            <code>config_json</code>
          </td>
          <td>
            <strong>无加密</strong>，与其它设置项同样以 JSON 文本入库
          </td>
          <td>
            <code>packages/storage/src/repositories/settings.repository.ts</code>
          </td>
        </tr>
        <tr>
          <td>
            <strong>④ CLI 的 credentials.json</strong>
          </td>
          <td>CLI 登录态（token + refreshToken + userId）</td>
          <td>
            <strong>无加密</strong>，仅文件权限 0600 + 目录 0700
          </td>
          <td>
            <code>spark-engine/src/platform/credentials.ts</code>
          </td>
        </tr>
      </tbody>
    </table>
    <h3 id="why-four">1.1 为什么会有四种，而不是一种</h3>
    <p>这不是疏漏叠加，而是三个真实约束的产物：</p>
    <ul>
      <li>
        <strong>凭据形态不同</strong>。Provider 是「一个渠道一个 Key」，适合按 ref 分片；
        账号登录态是「一次登录、一个会话」，天然是一个整体，所以走独立的 TokenStore。
      </li>
      <li>
        <strong>进程边界不同</strong>。CLI 在终端里跑，没有 Electron，也没有 keytar 的可用保证 （
        <code>spark-engine</code> 全目录无 keytar 引用），所以只能退到 0600 的明文文件。
      </li>
      <li>
        <strong>历史选择不同</strong>。IM 机器人凭据是跟着「设置项」这套机制长出来的，
        而设置项统一明文入库；后来接入的连接器才改用 keystore 引用。
      </li>
    </ul>
    <p>
      这三条不是「设计就这样」的托词——第 9 节会把明文落点的具体风险面写清楚，
      你可以据此决定要不要把环境变量里的密钥迁到别处。
    </p>

    <h3 id="which-one">1.2 我怎么知道自己某个密钥在哪</h3>
    <p>按「你在哪填的」反查最快：</p>
    <table>
      <thead>
        <tr>
          <th>你在哪里填的</th>
          <th>落在哪</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>模型页 → 添加 Provider → API Key</td>
          <td>
            ① 共享 keystore，ref 形如 <code>openai-&lt;uuid&gt;</code>
          </td>
        </tr>
        <tr>
          <td>扩展中心 → 连接器 → 连接账号</td>
          <td>
            ① 共享 keystore，ref 形如{' '}
            <code>plugin-runtime-&lt;pluginId&gt;-&lt;runtimeId&gt;-&lt;base64url&gt;</code>
          </td>
        </tr>
        <tr>
          <td>自定义工具 Studio → 本机密钥</td>
          <td>
            ① 共享 keystore，ref 形如 <code>custom-tool:&lt;工具 id&gt;:&lt;密钥名&gt;</code>
          </td>
        </tr>
        <tr>
          <td>工具包密钥 → 「配置工具密钥」弹窗</td>
          <td>
            ① 共享 keystore，ref 形如{' '}
            <code>tool-package:&lt;包 id&gt;:&lt;变量名&gt;:&lt;sha256 前 20 位&gt;</code>
          </td>
        </tr>
        <tr>
          <td>设置 → 生态 → 远程连接 → Bot Token / App Secret</td>
          <td>
            ③ <code>app_settings</code> 明文
          </td>
        </tr>
        <tr>
          <td>会话配置面板 / 项目配置 → 环境变量</td>
          <td>
            ③ <code>app_settings</code> 明文
          </td>
        </tr>
        <tr>
          <td>MCP 服务器配置里的 headers / env（明文写）</td>
          <td>
            ③ <code>mcp_servers.config_json</code> 明文
          </td>
        </tr>
        <tr>
          <td>
            终端里 <code>spark login</code>
          </td>
          <td>
            ④ <code>~/.spark/credentials.json</code> 明文
          </td>
        </tr>
      </tbody>
    </table>

    <h2 id="keystore">2. 共享 keystore：唯一入口与它的真实边界</h2>
    <p>
      <code>packages/shared/src/keystore/index.ts</code> 只有 244 行，但它是绝大多数密钥的落点。
      它的模块头注释写着一句需要修正的话：
    </p>
    <pre>
      <code>
        Spark Agent 凭证存储模块 — 唯一合法的 keytar 调用入口。 macOS 敏感凭据集中存入一个
        vault，并可由桌面端注入加密应用存储， 避免按 Provider 条目或每次启动重复请求 Keychain 授权。
      </code>
    </pre>
    <p>
      「唯一合法的 keytar 调用入口」在<strong>模块自身</strong>的意义上成立（这个包是集中 vault
      的唯一实现）， 但它<em>不是</em>全应用唯一：<code>TokenStore</code> 用动态{' '}
      <code>import('keytar')</code>
      绕开了它（第 6 节）。写文档时若照抄这句，会让读者以为「所有凭据都在这一个 vault 里」，
      而实际上登录态和 MCP OAuth 令牌都不在。
    </p>

    <h3 id="keystore-constants">2.1 常量与平台分支</h3>
    <table>
      <thead>
        <tr>
          <th>常量</th>
          <th>值</th>
          <th>作用</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>SERVICE_PREFIX</code>
          </td>
          <td>
            <code>spark-agent</code>
          </td>
          <td>非 macOS 平台 keytar 的 service 名</td>
        </tr>
        <tr>
          <td>
            <code>VAULT_ACCOUNT</code>
          </td>
          <td>
            <code>credential-vault-v1</code>
          </td>
          <td>集中 vault 在 Keychain 里的条目名（仅作一次性导入源）</td>
        </tr>
        <tr>
          <td>
            <code>VAULT_VERSION</code>
          </td>
          <td>
            <code>1</code>
          </td>
          <td>
            vault JSON 的 <code>version</code>；不匹配直接抛错
          </td>
        </tr>
        <tr>
          <td>
            <code>USE_CONSOLIDATED_VAULT</code>
          </td>
          <td>
            <code>process.platform === 'darwin'</code>
          </td>
          <td>
            <strong>只有 macOS 走集中 vault</strong>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      所以「Windows 上密钥在凭据管理器、macOS 上在一个加密文件里」这个区分是从
      <code>USE_CONSOLIDATED_VAULT</code> 这一行直接推出来的，不是平台惯例的猜测。
    </p>

    <h3 id="keystore-api">2.2 五个函数与它们的语义差异</h3>
    <table>
      <thead>
        <tr>
          <th>函数</th>
          <th>macOS 行为</th>
          <th>非 macOS 行为</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>setSecret(ref, secret)</code>
          </td>
          <td>
            在副本上修改 vault，<strong>持久化成功后</strong>
            才替换内存缓存；值与旧值相同且已迁移过则直接返回
          </td>
          <td>
            直写 keytar，并写进程内 <code>directSecretCache</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>getSecret(ref)</code>
          </td>
          <td>
            先读 vault；未命中且该 ref 未探测过旧条目时，<strong>按需</strong>从旧 Keychain
            条目迁移一次
          </td>
          <td>读缓存 → 未命中读 keytar，并对并发同 ref 读取做去重</td>
        </tr>
        <tr>
          <td>
            <code>deleteSecret(ref)</code>
          </td>
          <td>
            删 vault 条目，<strong>同时</strong>真的调 <code>keytar.deletePassword</code> 清理旧条目
          </td>
          <td>删 keytar 条目并清缓存</td>
        </tr>
        <tr>
          <td>
            <code>hasSecret(ref)</code>
          </td>
          <td colSpan={2}>
            <code>(await getSecret(ref)) !== null</code> —— 注意这会触发迁移逻辑
          </td>
        </tr>
        <tr>
          <td>
            <code>preloadSecrets(refs)</code>
          </td>
          <td>
            只加载一次集中 vault，<strong>绝不</strong>逐条探测旧 Keychain
          </td>
          <td>并发预读所有 ref</td>
        </tr>
      </tbody>
    </table>
    <p>
      <code>mutateVault</code> 有个容易被忽略的细节：注释明确写了「始终在副本上修改。 只有{' '}
      <code>persistVault</code> 成功后才会替换 <code>vaultCache</code>，
      避免持久化失败时内存暴露未提交的凭据或意外丢失旧值」。 这意味着
      <strong>写失败不会污染内存态</strong>，但反过来也意味着你必须检查 <code>setSecret</code>{' '}
      是否抛错—— 它是会抛的。
    </p>

    <h3 id="vault-format">2.3 集中 vault 的文件格式与写入协议</h3>
    <p>vault 本体是一个极简 JSON：</p>
    <pre>
      <code>
        &#123; "version": 1, "secrets": &#123; "&lt;ref&gt;": "&lt;明文密钥&gt;" &#125;,
        "legacyChecked": ["&lt;已探测过的旧 ref&gt;"] &#125;
      </code>
    </pre>
    <p>
      <code>legacyChecked</code> 是一个容易被忽略但很关键的设计：它记录「这个 ref 已经探测过旧
      Keychain 条目了」， 避免每次启动都去读不存在的条目、反复触发 macOS 授权弹窗。
    </p>
    <p>
      落盘实现是 <code>CredentialVaultPersistence.ts</code>，它的门控条件写得非常显式：
    </p>
    <pre>
      <code>
        if (process.platform !== 'darwin' || !safeStorage.isEncryptionAvailable()) return null
      </code>
    </pre>
    <p>
      返回 <code>null</code> 意味着<strong>退回纯 Keychain</strong>（即每个 ref 一条 keytar 条目），
      也就是旧布局。写入过程是：
    </p>
    <ul>
      <li>
        文件路径：<code>&#123;userData&#125;/credential-vault-v1.enc</code>；
      </li>
      <li>
        先写 <code>&lt;file&gt;.&lt;pid&gt;.tmp</code>，<code>mode: 0o600</code>，再{' '}
        <code>rename</code> 覆盖 —— 原子替换；
      </li>
      <li>
        <code>finally</code> 里无条件 <code>rm</code> 临时文件（<code>force: true</code> +{' '}
        <code>catch</code> 吞错）；
      </li>
      <li>
        读不到文件时只在 <code>ENOENT</code> 返回 <code>null</code>
        ，其他错误照抛（不会静默把一个损坏的 vault 当空的）。
      </li>
    </ul>
    <p>
      注入点是 <code>registerAuthIpc.ts</code>，注释写明「应在第一次凭据访问前调用」。
      另外安装版首次会弹一次 <code>KEYCHAIN_DISCLOSURE_VERSION = 1</code> 的说明框——
      这就是你可能见过的那次「为什么会访问钥匙串」的解释。
    </p>

    <h3 id="vault-migration">2.4 从「一个 Provider 一条 Keychain 项」迁移</h3>
    <p>
      迁移是<strong>惰性</strong>的，只在真正读某个 ref 时发生：
    </p>
    <ol>
      <li>
        启动时 <code>preloadSecrets</code> 只加载集中 vault，不探测旧条目；
      </li>
      <li>
        某次 <code>getSecret(ref)</code> 在 vault 里没命中、且 <code>legacyChecked</code> 里也没有该
        ref 时， 才去读旧 Keychain 条目；
      </li>
      <li>
        读到就写进 vault，并把 ref 记入 <code>legacyChecked</code>（即使没读到也记，避免重复探测）；
      </li>
      <li>
        <strong>旧条目保留不删</strong>
        ——注释说得很直白：「旧条目保留但不再访问，避免删除动作再次触发系统授权窗口」；
      </li>
      <li>
        只有<em>显式删除</em>（<code>deleteSecret</code>）或用户退出登录时，才真正清掉旧条目。
      </li>
    </ol>
    <p>
      这解释了两个常见现象：为什么升级后第一次用某个 Provider 会弹一次授权（迁移），
      以及为什么「用了新版本之后旧条目还在钥匙串里」（设计如此）。
    </p>

    <h3 id="keystore-consumers">2.5 十三个消费者</h3>
    <p>共享 keystore 的 import 点共 13 处，覆盖了除登录态与 CLI 之外的全部密钥：</p>
    <table>
      <thead>
        <tr>
          <th>消费者</th>
          <th>用途</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>provider.service.ts</code>
          </td>
          <td>Provider API Key 的增删改查、健康检查、导出</td>
        </tr>
        <tr>
          <td>
            <code>provider-credential-resolver.ts</code>
          </td>
          <td>运行时统一取 Key（含受管 Provider 的恢复）</td>
        </tr>
        <tr>
          <td>
            <code>PlatformModel/PlatformCredentialStore.ts</code>
          </td>
          <td>平台账号 access token / api key / 待支付态</td>
        </tr>
        <tr>
          <td>
            <code>custom-tool.service.ts</code>
          </td>
          <td>自定义工具密钥位的读写删</td>
        </tr>
        <tr>
          <td>
            <code>tool-package.service.ts</code>
          </td>
          <td>工具包 secret 环境变量、一次性安全输入</td>
        </tr>
        <tr>
          <td>
            <code>plugin-runtime/token-service.ts</code>
          </td>
          <td>连接器账号 OAuth 令牌包</td>
        </tr>
        <tr>
          <td>
            <code>plugins/plugin-manager.service.ts</code>
          </td>
          <td>卸载插件时清理密钥</td>
        </tr>
        <tr>
          <td>
            <code>github-connector.service.ts</code>
          </td>
          <td>平台 GitHub 连接器的 PAT</td>
        </tr>
        <tr>
          <td>
            <code>team-registry-config.ts</code>
          </td>
          <td>团队注册表凭据</td>
        </tr>
        <tr>
          <td>
            <code>platform-bridge.service.ts</code>
          </td>
          <td>Agent 侧 Provider 工具的密钥解析</td>
        </tr>
        <tr>
          <td>
            <code>SubAppNetworkGateway.ts</code>
          </td>
          <td>子应用连接槽背后的凭据注入</td>
        </tr>
        <tr>
          <td>
            <code>computer-use/SnapshotVaultKeyProvider.ts</code>
          </td>
          <td>截图快照库的加密主密钥</td>
        </tr>
        <tr>
          <td>
            <code>main/ipc/index.ts</code>
          </td>
          <td>预读与集中访问入口</td>
        </tr>
      </tbody>
    </table>

    <h2 id="refs">3. 引用与明文：SQLite 里到底存了什么</h2>
    <p>
      这一节回答一个非常具体的问题：<strong>数据库里有没有可能读到我的密钥？</strong>
      对走 keystore 的那批，答案是「没有，只有引用」；但有三处例外（第 9 节）。
    </p>

    <h3 id="ref-columns">3.1 keystore_ref 列清单</h3>
    <table>
      <thead>
        <tr>
          <th>表</th>
          <th>列</th>
          <th>迁移文件里的原话</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>provider_profiles</code>
          </td>
          <td>
            <code>keystore_ref TEXT</code>
          </td>
          <td>
            <code>001_initial_schema.sql</code> 注释：「API Key 不在此表，通过 keychain_ref 引用系统
            Keychain」
          </td>
        </tr>
        <tr>
          <td>
            <code>connector_connections</code>
          </td>
          <td>
            <code>keystore_ref TEXT</code>
          </td>
          <td>
            <code>039_connector_connections.sql:3</code>：「明文 secret 绝不入库，只保存
            keystore_ref。」
          </td>
        </tr>
        <tr>
          <td>
            <code>plugin_runtime_accounts</code>
          </td>
          <td>
            <code>credential_ref TEXT</code>
          </td>
          <td>
            <code>069_plugin_runtime_accounts.sql:1-2</code>：「Secrets remain in the OS keystore;
            SQLite stores only credential_ref.」
          </td>
        </tr>
        <tr>
          <td>
            <code>tool_package_config</code>
          </td>
          <td>
            <code>keystore_ref TEXT</code> / <code>value_json TEXT</code>
          </td>
          <td>
            <code>090_tool_packages.sql</code> 用 CHECK 约束强制二者互斥（见 3.2）
          </td>
        </tr>
        <tr>
          <td>
            <code>custom_tools</code>
          </td>
          <td>
            存 <code>secretRefs</code> 声明（JSON）
          </td>
          <td>
            密钥值不落库；表注释与 <code>secretNames</code> 协议注释都写明「值永不外出」
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      注意 <code>provider_profiles.keystore_ref</code> 本身是<strong>会下发给渲染进程</strong>的：
      <code>rowToProfile</code> 里 <code>keystoreRef: row.keystore_ref ?? ''</code>，
      协议字段注释是「Keychain 引用 ID（非明文 Key）」。 渲染端把它当「有没有配
      Key」的判据用（例如快速创建面板）。 这不是泄漏——ref 只是{' '}
      <code>&lt;providerType&gt;-&lt;uuid&gt;</code> 这类字符串，猜不出密钥。
    </p>

    <h3 id="check-constraint">3.2 唯一一处数据库级强制：tool_package_config</h3>
    <p>整个 schema 里只有这张表用 CHECK 约束把「引用」与「明文」钉死：</p>
    <pre>
      <code>
        CHECK ( (is_secret = 0 AND value_json IS NOT NULL AND keystore_ref IS NULL) OR (is_secret =
        1 AND value_json IS NULL AND keystore_ref IS NOT NULL) )
      </code>
    </pre>
    <p>
      读法：
      <strong>
        非密钥行只能有 <code>value_json</code>，密钥行只能有 <code>keystore_ref</code>
      </strong>
      ， 两者不可能同时存在，也不可能都为空。这是全仓最强的一道「密钥不入库」保证——
      它不依赖应用层自觉，写错直接 INSERT 失败。 对照之下，<code>provider_profiles</code>{' '}
      的「不入库」只是靠代码不放字段，没有 DB 兜底。
    </p>

    <h3 id="ref-naming">3.3 ref 命名规则总表</h3>
    <table>
      <thead>
        <tr>
          <th>来源</th>
          <th>ref 形态</th>
          <th>构造代码</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>普通 Provider</td>
          <td>
            <code>&lt;providerType&gt;-&lt;uuid&gt;</code>
          </td>
          <td>
            <code>makeKeystoreRef(providerType, id)</code>，即{' '}
            <code>`$&#123;provider&#125;-$&#123;profileId&#125;`</code>
          </td>
        </tr>
        <tr>
          <td>平台受管 Provider</td>
          <td>
            <code>newapi-spark-user-&lt;userId&gt;-api-key</code>
          </td>
          <td>
            唯一非 uuid 形态；<code>PlatformCredentialStore.ref(kind)</code> 生成
          </td>
        </tr>
        <tr>
          <td>平台账号其它字段</td>
          <td>
            <code>newapi-spark-user-&lt;userId&gt;-access-token</code>
          </td>
          <td>
            <code>kind ∈ &#123;access-token, api-key, pending-payment&#125;</code>
          </td>
        </tr>
        <tr>
          <td>连接器账号</td>
          <td>
            <code>plugin-runtime-&lt;pluginId&gt;-&lt;runtimeId&gt;-&lt;base64url&gt;</code>
          </td>
          <td>
            <code>token-service.createRef()</code>，外部账号 id 先 base64url 再截 80 字符
          </td>
        </tr>
        <tr>
          <td>自定义工具</td>
          <td>
            <code>custom-tool:&lt;工具 id&gt;:&lt;密钥名&gt;</code>
          </td>
          <td>
            <code>secretKeystoreRef(id, name)</code>；
            <strong>
              用 id+name 重新拼，不读 <code>secretRefs</code> 的值
            </strong>
          </td>
        </tr>
        <tr>
          <td>工具包 secret</td>
          <td>
            <code>tool-package:&lt;包 id&gt;:&lt;变量名&gt;:&lt;sha256 前 20 位&gt;</code>
          </td>
          <td>
            哈希输入含 <code>scope</code>/<code>scopeId</code>/<code>toolName</code>
            ，所以不同作用域是不同槽位
          </td>
        </tr>
      </tbody>
    </table>
    <p>两个值得记住的推论：</p>
    <ul>
      <li>
        自定义工具的 <code>secretRefs</code> <strong>值</strong>只是「声明留痕」—— 它用于 Agent
        侧校验（必须是 canonical 形态）和界面展示，运行期解析走的是重新拼出来的 ref。 所以改{' '}
        <code>secretRefs</code> 里的值不会改变真实读取位置。
      </li>
      <li>
        工具包的 ref 带 <code>scope</code> 哈希，意味着
        <strong>同一个密钥名在不同作用域是不同密钥</strong>。 「我在 package
        作用域填了，为什么没生效」通常是因为配置写在 session 作用域。
      </li>
    </ul>

    <h2 id="mask">4. 脱敏：两份同名函数，和它们各自泄露了什么</h2>
    <p>
      仓里有两个都叫 <code>maskSecret</code> 的函数，行为不同，用途也不同。混淆它们会写错文档。
    </p>
    <table>
      <thead>
        <tr>
          <th>实现</th>
          <th>规则</th>
          <th>用途</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>packages/shared/src/keystore/index.ts</code>
          </td>
          <td>
            长度 ≤ 4 → <code>****</code>；否则<strong>前 4 个字符原样</strong> + 最多 12 个星号
          </td>
          <td>
            <strong>只用在日志</strong>：Provider 创建/更新时各一行 info 日志
          </td>
        </tr>
        <tr>
          <td>
            <code>packages/agent-runtime/src/services/runtime-composition.service.ts</code>
          </td>
          <td>
            空 → <code>(空)</code>；长度 &lt; 4 → <code>****</code>；否则{' '}
            <code>首字***尾字 (N 字符)</code>
          </td>
          <td>构建注入系统提示词的「环境变量」段</td>
        </tr>
      </tbody>
    </table>
    <p>
      <strong>两者都会泄露一部分明文</strong>：前者泄露前 4 位（<code>sk-a****</code> 这种），
      后者泄露首尾各 1 位<em>以及长度</em>。写进日志的那份意味着
      <strong>日志文件里能读到密钥前缀</strong>—— 如果日志被收集或分享，要考虑这一点。
    </p>
    <h3 id="logger-redaction">4.1 日志器本身还有一层脱敏</h3>
    <p>
      <code>packages/shared/src/logger/index.ts</code> 在写入前对消息文本与结构化参数做两层处理：
    </p>
    <ul>
      <li>
        <strong>文本清洗</strong>：<code>Bearer &lt;8+位&gt;</code> → <code>Bearer [redacted]</code>
        ；<code>sk-&lt;8+位&gt;</code> → <code>sk-[redacted]</code>； 以及{' '}
        <code>authorization / api_key / secret / token / password / pwd</code> 后跟{' '}
        <code>: 或 =</code> 的值 → <code>[redacted]</code>。
      </li>
      <li>
        <strong>结构化参数</strong>：对象里键名命中
        <code>
          /^(authorization|api[_-]?key|secret|token|password|pwd|bearer)$/i
        </code> 的值替换为 <code>&#39;****&#39;</code>。
      </li>
    </ul>
    <p>
      代码里自己写了边界：「仅覆盖最常见场景，<strong>不做递归深扫</strong>」——
      只处理顶层键，嵌套对象里的密钥不会被这一层拦住。 另外 <code>spark-engine</code> 自己的 CLI
      日志器（<code>observability/logger.ts</code>）<strong>完全不做脱敏</strong>
      ，终端里看到的就是原文。
    </p>

    <h2 id="provider">5. Provider 凭据：从表单到真实请求</h2>
    <p>这是最完整的一条链路，看懂它就理解了其余所有 keystore 用法。</p>

    <h3 id="provider-write">5.1 写入：什么进 keystore，什么进数据库</h3>
    <p>在「模型」页添加或编辑 Provider 时，API Key 的落点是：</p>
    <pre>
      <code>
        ref = keystore.makeKeystoreRef(providerType, id) // 形如 openai-&lt;uuid&gt; await
        keystore.setSecret(ref, apiKey) // 明文唯一落点 // provider_profiles 只写 config_json /
        keystore_ref / enabled…
      </code>
    </pre>
    <p>三条容易踩错的语义：</p>
    <ul>
      <li>
        <strong>空串不等于「不传」</strong>。<code>createProvider</code> 用
        <code>apiKey != null &amp;&amp; apiKey.length &gt; 0</code> 判断，空串走「没配 Key」分支
        （日志是 <code>Created provider without API key (local CLI / pending key)</code>）； 但{' '}
        <code>updateProvider</code> 只判断 <code>apiKey !== undefined</code>， 所以
        <strong>
          传 <code>''</code> 会把空串写进 keystore 并把 <code>keystore_ref</code> 落库
        </strong>
        ， 造成「界面显示有 Key、实际发请求时无凭据」的状态。渲染端靠 <code>apiKeyDirty</code>
        避免误传空串，但 MCP 桥路径没有这层保护。
      </li>
      <li>
        <strong>更新时复用旧 ref</strong>：
        <code>existing.keystore_ref || makeKeystoreRef(...)</code>， 所以轮换 Key 不会换
        ref，旧值被覆盖。
      </li>
      <li>
        <strong>本地 CLI 类型的 Provider 不写 keystore</strong>：<code>keystoreRef</code>{' '}
        留空字符串， 走本机已登录的 Claude Code / Codex。
      </li>
    </ul>

    <h3 id="provider-read">5.2 读取：resolver 的真实返回值</h3>
    <p>
      <code>provider-credential-resolver.ts</code> 只有 73 行，但它是所有运行期取 Key 的唯一入口
      （会话执行、媒体路由、标题抽取、provider-vision 工具、工具包内建能力都走它）。逻辑是：
    </p>
    <ol>
      <li>
        有 ref 就 <code>getSecret(ref)?.trim() || null</code>，否则 <code>null</code>；
      </li>
      <li>
        解析 <code>config_json</code> 判断是不是平台受管（<code>managed</code> +{' '}
        <code>managedType:'newapi'</code>）；
      </li>
      <li>
        <strong>
          非受管：直接返回 <code>currentSecret ?? ''</code>——不抛错
        </strong>
        ；
      </li>
      <li>
        受管且有恢复器：调恢复器，拿到新值就回写 keystore，最后返回{' '}
        <code>recovered?.trim() ?? ''</code>。
      </li>
    </ol>
    <p>
      第 3 步的「不抛错」很关键：<strong>缺 Key 不会在 resolver 报错</strong>，而是层层向上，
      由各调用方自己决定怎么处理，而它们的行为并不统一：
    </p>
    <table>
      <thead>
        <tr>
          <th>调用方</th>
          <th>缺 Key 时的行为</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>会话执行器</td>
          <td>
            抛错：<code>API key not found for provider &lt;id&gt;</code>（ref 都缺时更早抛{' '}
            <code>has no keystore ref</code>）
          </td>
        </tr>
        <tr>
          <td>媒体路由</td>
          <td>
            <strong>catch 后跳过该 Provider</strong> 并 warn，不中断其它渠道
          </td>
        </tr>
        <tr>
          <td>会话内图片工具上下文</td>
          <td>
            只判空返回 <code>null</code>，不 try/catch
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      第 4 步有个实现细节值得知道：返回的是 <code>recovered ?? ''</code>，<strong>不是</strong>
      <code>recovered ?? currentSecret ?? ''</code>。所以平台受管 Provider 在恢复器返回 null 时，
      即使 keystore
      里有一份可用值也会被当成空——这解释了「平台模型偶发报凭据不可用，重试又好」的一部分现象。
    </p>

    <h3 id="provider-echo">5.3 明文回显：provider:get-api-key 是刻意的</h3>
    <p>
      这是最需要准确表述的一点。渲染进程<strong>确实能拿到明文 Key</strong>：
    </p>
    <pre>
      <code>
        typedIpcHandle('provider:get-api-key', async (req) =&gt; &#123; const apiKey = await
        getProviderService().getProviderApiKey(req.id) return &#123; apiKey &#125; &#125;)
      </code>
    </pre>
    <p>
      服务层注释写明了用途与约束： 「按需返回单个可编辑 Provider 的明文
      Key，供受信任的编辑界面回显。
      <strong>调用方不得记录、持久化或批量请求返回值。</strong>」 协议层注释同样限定：「仅供
      Provider 编辑界面按需回显当前凭据。
      <strong>
        不得并入 <code>provider:list</code>
      </strong>
      」。
    </p>
    <p>
      也就是说：<code>provider:list</code> 只回 <code>keystoreRef</code>（引用，不是密钥）， 只有
      <em>打开某个 Provider 的编辑抽屉</em>时才会单独拉一次明文，用来回填输入框 （渲染端把它存在
      React state 里，靠 <code>apiKeyDirty</code> 决定是否回写，
      模块注释写明「明文只作为返回值短暂进入编辑表单状态，不在本模块持久化」）。
    </p>
    <p>
      <strong>两条边界</strong>：
    </p>
    <ul>
      <li>
        受管 Provider 被硬拒：
        <code>
          if (isManagedProviderRow(row)) throw new Error(&#39;平台官方 Provider
          由系统管理，不能读取凭据&#39;)
        </code>
        ， 且受管 Provider 也禁止手动编辑与删除。测试把这三条都锁死了。
      </li>
      <li>
        但渲染端<em>不是</em>唯一能调到它的地方。V1 子应用默认 <code>trusted</code>， 其 IPC 桥在{' '}
        <code>checkPermission</code> 里对 trusted 直接放行、并把任意通道转发给宿主
        <code>window.spark.invoke</code>；仓里的测试用例正是拿 <code>provider:get-api-key</code>{' '}
        做的示例。 换言之，<strong>一个 V1 子应用跑起来就能读到 Provider 明文 Key</strong>——
        这条链路两段都有代码证据，是否算问题取决于你怎么看「V1 子应用 = 一等内部应用」这个前提。
      </li>
    </ul>

    <h3 id="provider-export">5.4 导出会把明文 Key 写进普通文件</h3>
    <p>
      <code>exportProviders</code> 的文档注释直说：「apiKey 从 Keychain 读取后附带到导出 profile
      中」。 导出 schema 里 <code>apiKey</code> 是合法字段，导出格式版本{' '}
      <code>PROVIDER_EXPORT_VERSION = 2</code>， 注释标注「v2（含 apiKey）」。
    </p>
    <p>
      「导出到文件」的 IPC 处理是：弹保存对话框（默认文件名
      <code>spark-agent-providers-YYYY-MM-DD.json</code>，标题「导出 Provider 配置」）→
      <code>JSON.stringify(payload, null, 2)</code> → <code>fs.writeFile</code>。
      <strong>整个过程没有任何「该文件包含明文密钥」的提示</strong>，界面上只 toast 一句「已导出 N
      个 Provider」。
    </p>
    <p>
      所以：
      <em>把 Provider 配置导出成 JSON 再发给别人 / 提交进仓库 / 放进网盘，等于直接泄露 API Key</em>
      。 要分享配置，用第 13 节的 <code>.sparkflow</code> 工作流包（它会把密钥替换成占位符），
      而不是 Provider 导出。受管 Provider 会被导出逻辑跳过，不会进文件。
    </p>

    <h3 id="provider-test">5.5 测试连接会真的发请求</h3>
    <p>
      <code>testConnection</code> 会从 keystore 取真实 Key 并发一次最小请求：
    </p>
    <ul>
      <li>
        Anthropic 系：<code>POST &#123;endpoint&#125;/v1/messages</code>，头带{' '}
        <code>x-api-key</code> 与 <code>anthropic-version: 2023-06-01</code>，body 是{' '}
        <code>
          &#123;model, max_tokens:1,
          messages:[&#123;role:&#39;user&#39;,content:&#39;ping&#39;&#125;]&#125;
        </code>
        ；
      </li>
      <li>
        OpenAI 系：<code>Authorization: Bearer &lt;key&gt;</code>，按 <code>codexApiKind</code> 走{' '}
        <code>/chat/completions</code> / <code>/responses</code> / <code>/embeddings</code>；
      </li>
      <li>
        超时 <code>PROVIDER_CONNECTION_TIMEOUT_MS = 15_000</code>
        ，超时文案「连接测试超时（&gt;15s）…」，其余错误经 <code>describeNetworkError</code> 归一；
      </li>
      <li>
        受管 Provider <strong>不发请求</strong>，只判断解析出的 Key
        是否非空，失败文案是「平台模型凭据尚未就绪」。
      </li>
    </ul>
    <p>
      「获取模型」走同一套凭据解析（无 Key 抛 <code>API Key is required to fetch models</code>），
      失败时会把响应体里出现的 Key 替换成 <code>[REDACTED]</code>。 IPC 层日志只打 provider / id /
      model / healthy / latency，不打 Key。
    </p>

    <h2 id="tokenstore">6. TokenStore：第二个 keytar 实现</h2>
    <p>
      <code>Auth/TokenStore.ts</code> 是「唯一 keytar 入口」这句话的实际例外。 它用{' '}
      <code>import(&#39;keytar&#39;)</code> 动态引入，自己定义 service 与三个条目，不走共享
      keystore。
    </p>
    <table>
      <thead>
        <tr>
          <th>项</th>
          <th>值</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>keytar service（登录态）</td>
          <td>
            <code>SparkAgent.CloudAuth</code>，可用环境变量 <code>SPARK_AUTH_KEYTAR_SERVICE</code>{' '}
            覆盖（E2E 实例借此隔离）
          </td>
        </tr>
        <tr>
          <td>keytar service（MCP OAuth）</td>
          <td>
            <code>spark-mcp-oauth:&lt;serverId&gt;</code>
          </td>
        </tr>
        <tr>
          <td>keytar account</td>
          <td>
            <code>auth_token</code> / <code>refresh_token</code> / <code>user_id</code>（
            <strong>三条独立条目</strong>，不是一条 JSON）
          </td>
        </tr>
        <tr>
          <td>加密备份文件</td>
          <td>
            <code>&#123;userData&#125;/cloud-auth-session.enc</code>，safeStorage 加密
          </td>
        </tr>
        <tr>
          <td>keytar 操作超时</td>
          <td>
            <code>3_000</code> ms，超时按「keytar 不可用」处理
          </td>
        </tr>
      </tbody>
    </table>

    <h3 id="ts-order">6.1 读写顺序与文件头注释相反</h3>
    <p>文件头注释说「Primary storage is keytar」，但实现是：</p>
    <ul>
      <li>
        <strong>
          <code>load()</code> 先读加密备份
        </strong>
        ，命中即返回；只有备份不存在/校验失败才回落 keytar；
      </li>
      <li>
        <code>save()</code> 先写备份，再写 keytar；keytar 不可用时直接 return；
      </li>
      <li>
        <code>clear()</code> 先删备份，再删 keytar 三条。
      </li>
    </ul>
    <p>
      这个顺序的实际后果是好的（keytar 出问题时仍能保住登录态），但要知道
      <strong>keytar 与备份可能不一致</strong>，而读优先级站在备份这边。 另外全新安装会传{' '}
      <code>allowLegacyKeytarFallback: databaseExistedBeforeInitialization</code>，
      避免为不存在的旧条目弹一次钥匙串授权。
    </p>

    <h3 id="ts-two-bugs">6.2 备份文件被两个命名空间共用（含一个可复现的缺陷）</h3>
    <p>
      备份文件名是常量 <code>cloud-auth-session.enc</code>，
      <code>getEncryptedBackupPersistence()</code>
      只用它拼路径，<strong>不带 service</strong>。而 <code>load()</code> 又要求
      <code>payload.service === this.service</code> 才算命中。两者叠加产生两个后果：
    </p>
    <ol>
      <li>
        <strong>互相覆盖</strong>：登录态的 TokenStore 与 MCP OAuth 的 TokenStore
        写的是同一个文件，后写的赢；被覆盖的一方下次启动读回来是「service 不匹配 → null」， 静默退回
        keytar。
      </li>
      <li>
        <strong>删除会误伤</strong>：<code>deleteEncryptedBackup()</code> 直接
        <code>rm(join(userData, &#39;cloud-auth-session.enc&#39;))</code>，
        <strong>不校验 service</strong>。 而 <code>mcp:deauthorize</code> →{' '}
        <code>McpOAuthService.deauthorize</code> →<code>DesktopMcpOAuthStore.clearAll</code> →{' '}
        <code>TokenStore.clear()</code>。 也就是
        <strong>取消授权一个 MCP 服务器，会连带删掉云端登录会话的加密备份</strong>。
      </li>
    </ol>
    <p>
      影响范围有限（登录态通常同时在 keytar 里，且下次 <code>save()</code> 会重建备份），
      但如果恰好叠加 keytar 不可用，就会走到「登录态只剩内存、重启即丢」。 另外这个备份文件的写入
      <strong>没有 mode、也没有 tmp+rename 原子替换</strong>—— 与同目录的 vault 文件（
      <code>0o600</code> + rename）标准不一致。
    </p>

    <h3 id="ts-refresh">6.3 续期与「一条没人收的明文广播」</h3>
    <p>
      客户端<strong>没有过期时间判定</strong>（会话结构里就没有 expiresAt），续期完全由 401 驱动：
      401 → 刷新并重试 → 再 401 允许再刷一次；刷新有模块级单飞锁避免并发。
    </p>
    <p>
      刷新成功后 <code>handleTokenRefreshed</code> 会发一条流式事件：
    </p>
    <pre>
      <code>
        this.emitStream('stream:auth:token-refreshed', &#123; token: session.token, refreshToken:
        session.refreshToken, userId: session.userId, &#125;)
      </code>
    </pre>
    <p>
      <strong>
        这条广播携带完整明文 token 与 refreshToken，而渲染端与 preload 里没有任何订阅者
      </strong>
      （全仓检索该通道名，只有主进程的定义与发射点）。
      目前它不构成泄露（没人接收），但它的存在意味着任何后续添加的订阅者都会直接拿到明文凭据——
      要接这条流的话，应当先把它改成只发「已刷新」信号。
    </p>

    <h3 id="ts-logout">6.4 退出登录删了什么、没删什么</h3>
    <p>
      <code>AuthService.logout()</code> 会先尝试 POST <code>/auth/logout</code>（失败继续）， 再跑
      logout hooks，最后 <code>tokenStore.clear()</code>。 但全仓 <code>addLogoutHook</code>{' '}
      <strong>只有一个调用方</strong>：<code>PlatformModelService</code>。
    </p>
    <table>
      <thead>
        <tr>
          <th>密钥</th>
          <th>退出登录时</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Spark 账号 access / refresh token</td>
          <td>
            <strong>删除</strong>（备份 + keytar 三条）
          </td>
        </tr>
        <tr>
          <td>
            平台模型凭据（<code>newapi-spark-user-&lt;id&gt;-access-token</code> /{' '}
            <code>-api-key</code>）
          </td>
          <td>
            <strong>删除</strong>（唯一的 logout hook）
          </td>
        </tr>
        <tr>
          <td>Provider API Key</td>
          <td>
            <strong>保留</strong>——没有对应 hook
          </td>
        </tr>
        <tr>
          <td>平台 GitHub 连接器 PAT</td>
          <td>
            <strong>保留</strong>
          </td>
        </tr>
        <tr>
          <td>连接器账号 OAuth 令牌包</td>
          <td>
            <strong>保留</strong>
          </td>
        </tr>
        <tr>
          <td>MCP OAuth 令牌</td>
          <td>
            <strong>保留</strong>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      还有两个边界情况：如果 keytar 在本进程曾被判定为不可用，
      <code>clear()</code> 会在删完备份后<strong>提前 return</strong>，把 keytar
      里那三条留在系统中； 另外 <code>keytarUnavailable</code> 一旦置位，本进程内不会再重试写
      keytar。
    </p>

    <h2 id="accounts">7. 账号类凭据：连接器、平台连接器、团队注册表</h2>

    <h3 id="connector-accounts">7.1 连接器账号（plugin-runtime）</h3>
    <p>
      在扩展中心 →「连接器」里连接 GitHub / Notion / Google / Obsidian 账号时， 凭据的写法与
      Provider 不同：<strong>渲染端把明文 secret 通过 IPC 交给主进程</strong>（
      <code>plugin-runtime:accounts:connect</code> 的 <code>request.secrets</code>），
      主进程侧再校验长度上限（最多 32 条、名 ≤120、值 ≤16_000）后写 keystore。 唯一的例外是 OAuth
      路径（<code>accounts:authorize</code>）——它在主进程里跑 PKCE + loopback，请求结构里
      <strong>根本没有 secrets 字段</strong>，token 不经过渲染进程。
    </p>
    <p>
      落库的只有一个引用：<code>plugin_runtime_accounts.credential_ref</code>。
      连接成功后返回的账号对象<strong>不含任何密钥字段</strong>（<code>toAccount()</code> 只映射
      <code>token_expires_at</code> 等非敏感列，完全不碰 <code>credential_ref</code>）。
    </p>
    <p>
      存储内容是<strong>一个 JSON 字符串</strong>（<code>StoredCredentialBundle</code>：
      <code>accessToken</code> 必填，<code>refreshToken</code>/<code>tokenType</code>/
      <code>expiresAt</code>/<code>clientId</code>/<code>scopes</code> 可选）。 取用时若{' '}
      <code>expiresAt</code> 距现在不足 30 秒会先刷新，刷新有同 ref 单飞锁； JSON
      损坏会被当成「需要重新授权」（<code>AUTH_REQUIRED</code>）。
    </p>
    <p>
      <strong>两个边界</strong>：断开账号只删本地密文，<em>不做 provider 侧撤销</em>
      （四个内置 adapter 都没有实现可选的 <code>disconnect</code>）， 所以「断开」后你仍应去 GitHub
      侧手动吊销那个 token； 另外如果 adapter 的 disconnect 抛错，删除密文这一步不会执行，
      会出现「界面提示断开失败但账号行还在、密文也还在」的状态。
    </p>

    <h3 id="github-connector">7.2 平台 GitHub 连接器</h3>
    <p>
      这是与 7.1 同名但完全不同的另一套（第 3 轮「连接器」页讲过两套实现并存）。 它的 ref 是固定形态{' '}
      <code>github-connector-&lt;id&gt;</code>（id 默认
      <code>github-primary</code>，即常态是 <code>github-connector-github-primary</code>），
      已存在则复用旧 ref，所以轮换 PAT 不换 ref。
    </p>
    <ul>
      <li>
        写入：<code>connect()</code> 先 <code>setSecret</code> 再 upsert DB；
      </li>
      <li>
        <strong>更新不碰 token</strong>：<code>updateConnection</code> 的参数类型里根本没有 token
        字段， 换 PAT 走的是 <code>connect</code>（界面文案「更新 PAT 并重新验证」与实现一致）；
      </li>
      <li>
        读取：每次工具调用前取一次，错误分三档——ref 缺失 → <code>KEYSTORE_KEY_NOT_FOUND</code>
        （「缺少凭证引用」）、 读抛错 → <code>KEYSTORE_UNAVAILABLE</code>
        （「系统凭证库不可用」）、读到空 → 「GitHub PAT 不存在，请重新连接」；
      </li>
      <li>
        <strong>没有掩码字段</strong>：协议里没有 token / mask 字段，界面就是一个空白的密码输入框 +
        提示文案， 不存在「回显已保存 PAT」的路径。
      </li>
    </ul>

    <h3 id="team-registry">7.3 团队注册表（Nacos）</h3>
    <p>
      存的是团队注册中心的账号密码，ref 是字面量形态
      <code>team-registry-nacos-password</code>（服务器地址 / namespace / username 走
      settings，只有密码进 keystore）。 保存语义有个细节：<code>password</code> 仅在
      <em>显式提供</em>时才动—— 传空串等于「清除密码」（调 <code>deleteSecret</code>
      ），不传则保持原值。 界面侧只能拿到一个布尔 <code>hasPassword</code>， 「测试连接」用的是
      <strong>未保存的表单值</strong>直接试连，不会把密码写进去。
    </p>

    <h2 id="declaration">8. 「只声明引用、不填值」的三条面</h2>
    <p>
      这三处是官方设计里最讲究的部分：Agent 只能<em>声明需要一个密钥</em>，
      值必须由人在受保护的界面里输入。它们各自用不同的机制实现同一目标。
    </p>

    <h3 id="decl-custom-tools">8.1 自定义工具：secretRefs</h3>
    <p>协议层的声明约束是：</p>
    <pre>
      <code>
        const CustomToolSecretRefsSchema = z
        .record(z.string().regex(/^[A-Za-z0-9_-]&#123;1,64&#125;$/), z.string().min(1).max(512))
        .refine((refs) =&gt; Object.keys(refs).length &lt;= 16, '密钥引用数量超过上限 16')
      </code>
    </pre>
    <p>
      拆开读：<strong>键</strong>（逻辑密钥名）受 <code>^[A-Za-z0-9_-]&#123;1,64&#125;$</code>{' '}
      约束；
      <strong>值</strong>只要求 1–512 字符、无正则——因为规范化后的值形如
      <code>custom-tool:&lt;id&gt;:&lt;name&gt;</code>，含冒号，作为「值」合法但作为敏感头的
      <code>secretRef</code> 就非法（那里同样要求 <code>^[A-Za-z0-9_-]&#123;1,64&#125;$</code>）。
    </p>
    <p>
      Agent 侧只接受规范化引用：authoring facade 会逐条比对
      <code>ref !== canonicalSecretRef(id, name)</code>，不符即报 「Agent
      接口只接受规范化密钥引用，不接受密钥值或自定义存储位置」。 它的模块注释写明了设计意图：
      <em>
        「It deliberately exposes no secret-write API. Agents may declare secretRef slots, while the
        actual values must still be entered through the trusted desktop Keychain form.」
      </em>
    </p>
    <p>
      类型专属封禁两条：<code>code</code> 工具<strong>不允许</strong> <code>secretRefs</code>
      （「代码工具不接收 Keychain 明文；请通过受管 HTTP 工具组合外部能力」），
      <code>provider-vision</code> 同样不允许（「图像处理工具复用 Provider Keychain
      凭据，不允许另存工具密钥」）。
      另外「声明了必须用上」也被强制：声明了却没有任何请求头引用的密钥名会报 「密钥 &lt;name&gt;
      未被任何请求头引用」。
    </p>
    <p>
      还有一道<strong>明文形态黑名单</strong>：spec 模板里出现
      <code>sk-…</code> / <code>AKIA…</code> / <code>ghp_…</code> / <code>gho_…</code> /
      <code>xox[baprs]-…</code> / 硬编码 <code>Bearer …</code> / PEM 私钥，直接拒绝，
      提示「模板中检测到疑似密钥明文，请改用密钥库（secretRefs）存储」。 敏感请求头（键名命中{' '}
      <code>token/secret/password/authorization/cookie/credential/api_key/private_key</code> 这类）
      必须绑定 <code>secretRef</code>，且<strong>不能</strong>与 <code>valueTemplate</code>{' '}
      同时出现。
    </p>
    <p>
      生命周期门控（都基于 <code>hasSecret()</code> 判断）：
    </p>
    <table>
      <thead>
        <tr>
          <th>时机</th>
          <th>行为</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>创建</td>
          <td>
            声明了密钥的工具<strong>默认禁用</strong>（<code>enabled: !hasToolSecrets</code>
            ），等界面写完密钥再开
          </td>
        </tr>
        <tr>
          <td>发布</td>
          <td>
            缺密钥直接抛 <code>SECRET_MISSING</code>：「工具 &lt;id&gt; 缺少密钥：&lt;名字&gt;」
          </td>
        </tr>
        <tr>
          <td>启用</td>
          <td>
            同样拒绝；判据用的是<em>已发布版本</em>的声明，未发布草稿新增的密钥不影响当前版本启停
          </td>
        </tr>
        <tr>
          <td>回滚</td>
          <td>目标历史版本缺密钥则拒绝：「工具 &lt;id&gt; 的历史版本 v&lt;n&gt; 缺少密钥：…」</td>
        </tr>
        <tr>
          <td>草稿引入新密钥</td>
          <td>
            若工具当前已启用，<strong>自动停用</strong>，防止未填值的版本进入工具面
          </td>
        </tr>
        <tr>
          <td>执行期</td>
          <td>取不到值报「工具 &lt;id&gt; 的密钥 &lt;name&gt; 尚未写入密钥库」</td>
        </tr>
      </tbody>
    </table>
    <p>
      写入的唯一入口是 <code>custom-tools:write-secret</code>，服务层用
      <code>if (!(name in refs))</code> 把可写范围钉死在该工具已声明的密钥位上—— 它不能被当成通用
      keystore 写接口滥用。 界面在 Studio 的「本机密钥」区块，用 <code>InputPassword</code>，
      旁注文案是「密钥写入系统 Keychain，不进入 SQLite、导出文件或工具描述」， 已保存时 placeholder
      变成「留空则保持原值」。 密钥名不是单独添加的，而是从请求头声明里倒推（
      <code>secretNamesFromHeaders</code>）。
    </p>
    <p>
      一个<strong>值得知道的角落</strong>：发布新版本时移除了某个密钥位 X， 孤儿清理会把它从
      keystore 删掉。此后你要回滚到旧版本会先被
      <code>missingSecrets</code> 拦住（报 <code>SECRET_MISSING</code>）， 而重填 X 的入口又要求「X
      必须在当前声明里」——于是报 「工具 &lt;id&gt; 未声明密钥位 &lt;X&gt;」。
      <strong>解法是先在草稿里把 X 重新声明出来，再补值。</strong>
      另外孤儿清理失败只记 warn，不阻断已完成的发布/回滚，所以 keystore
      里可能残留不再被引用的密钥位。
    </p>

    <h3 id="decl-tool-packages">8.2 工具包：环境变量与一次性安全输入</h3>
    <p>
      工具包<strong>没有</strong> <code>secretRefs</code> 字段——它的声明面是
      <code>spark-tool.json</code> 的 <code>environment[]</code>：
    </p>
    <pre>
      <code>
        &#123; "name": "EXTERNAL_API_TOKEN", // 必须 ^[A-Z_][A-Z0-9_]&#123;0,127&#125;$ "title":
        "外部接口令牌", "type": "string", "required": true, "secret": true, // ← 关键位
        "agentConfigurable": false &#125;
      </code>
    </pre>
    <p>
      schema 对 secret 变量有两条额外约束：
      <strong>
        不能声明 <code>default</code>
      </strong>
      （「Secret environment variables cannot declare defaults」）、
      <strong>只能用 string 类型</strong>（「must use string type」）。
    </p>
    <p>
      值落在 <code>tool_package_config</code>，受第 3.2 节那条 CHECK 约束保护。 Agent 侧
      <strong>结构性地无法传明文</strong>，双重保证：
    </p>
    <ol>
      <li>
        <code>tool_packages_request_secret</code> 的 inputSchema 里
        <strong>根本没有 value 属性</strong>， 且 <code>additionalProperties: false</code>
        ，工具描述写明「密钥由用户在应用内受保护表单填写， 绝不进入 Agent 参数或消息记录」；
      </li>
      <li>
        即便走 <code>tool_packages_configure_environment</code> 的 <code>value</code> 通道，
        服务层硬拒：
        <code>
          if (variable.secret) throw new Error(&#39;... is secret and requires secure input&#39;)
        </code>
        ， 并且对 <code>actor === &#39;agent&#39;</code> 还要求 <code>agentConfigurable</code>{' '}
        为真。
      </li>
    </ol>
    <p>一次性安全输入的完整机制：</p>
    <table>
      <thead>
        <tr>
          <th>项</th>
          <th>值</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>状态枚举</td>
          <td>
            <code>pending</code> / <code>completed</code> / <code>cancelled</code> /{' '}
            <code>expired</code>
          </td>
        </tr>
        <tr>
          <td>TTL</td>
          <td>默认 15 分钟，钳制在 1 分钟 ~ 1 小时之间</td>
        </tr>
        <tr>
          <td>过期判定</td>
          <td>
            <strong>惰性</strong>——枚举时把过期行置为 <code>expired</code> 并跳过，没有定时器
          </td>
        </tr>
        <tr>
          <td>同目标重复请求</td>
          <td>复用同一条 pending 请求，不重复创建</td>
        </tr>
        <tr>
          <td>完成时的写入顺序</td>
          <td>先写 keystore → 再写 DB；DB 失败则把 keystore 回滚到旧值（或删除）</td>
        </tr>
        <tr>
          <td>并发完成</td>
          <td>
            单飞去重，重复完成报 <code>Secure input request is already being fulfilled</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      界面是 <code>ToolPackageSecretRequestHost</code>（挂在 App 根部），弹窗标题
      「配置工具密钥」，按钮「保存到 Keychain」/「取消」，输入用 <code>InputPassword</code>，
      说明文案：「密钥不会发送给 Agent，也不会写入会话记录或 SQLite； 主进程收到后会直接保存到系统
      Keychain。请求将在 &lt;到期时间&gt; 失效。」 它有一个值得点赞的细节：切换请求时会清空输入框，
      注释写着 <em>「Never carry a secret typed for one request into another request.」</em>
      刷新走事件流而非轮询。工具包面板里也有入口，secret 变量带 <code>Keychain</code> 标签，
      按钮文案是「安全配置」/「更新密钥」。
    </p>
    <p>
      卸载时会清理密钥，但顺序与边界要知道：先停用 → 收集 ref（<strong>在删库之前</strong>）→
      删包目录 → 删 DB 行 → 逐个删 keystore，返回 <code>removedSecrets</code> 计数； 删除失败是
      <strong>静默</strong>的（<code>.catch(() =&gt; false)</code>，只影响计数，卸载仍报成功）。
      另外<strong>删单个版本不会删密钥</strong>——只有整体卸载才删， 所以 <code>delete_version</code>{' '}
      之后 package 级的 secret 会留在 keystore 里。
    </p>
    <p>
      子进程侧还有一层保护：注入 secret 变量后，工具进程的 stderr 会把<strong>已知明文</strong>
      替换成
      <code>[REDACTED]</code>（按值做 <code>split/join</code> 替换，不是靠正则猜）。
      检查器也会警告「敏感环境变量不会从工具包读取，必须由安全配置流程写入 Keychain」。
    </p>

    <h3 id="decl-sub-apps">8.3 子应用连接槽：只能声明槽，不能声明值</h3>
    <p>V2 子应用 manifest 里的连接声明是：</p>
    <pre>
      <code>
        export interface SubAppConnectionDeclaration &#123; kind: 'http-api' | 'provider'
        displayName: string allowedOrigins: string[] allowPrivateNetwork?: boolean &#125;
      </code>
    </pre>
    <p>
      <strong>没有 secret / token / value 字段</strong>，而且 schema 是 <code>.strict()</code>——
      往连接槽里塞 <code>"secret": "..."</code> 会被 zod 拒绝，转成{' '}
      <code>level:&#39;error&#39;</code>的 <code>MANIFEST_INVALID</code> 诊断，并阻断发布与预览。
    </p>
    <p>
      绑定工具 <code>spark_app_connections_bind</code> 只接受<strong>引用 id</strong>（
      <code>bindingKind</code> + <code>bindingId</code>，没有 secret 参数）， 相邻的{' '}
      <code>spark_app_connections_list</code> 描述写着「不返回密钥」。 落库的{' '}
      <code>sub_app_connection_bindings</code> 表也只有引用列。 委托的 origin 必须落在槽声明的{' '}
      <code>allowedOrigins</code> 内，服务端会校验 「授权 origin 超出 manifest 声明范围」。
      <code>allowPrivateNetwork</code> 是 <strong>AND 语义</strong>：声明为真且请求也为真才生效——
      <strong>声明能否决请求，请求不能放宽声明</strong>。
    </p>
    <p>
      运行时真正的密钥注入在主进程：<code>SubAppNetworkGateway</code> 按绑定取出凭据， 从连接行或
      Provider 解析，然后<strong>在宿主侧注入请求头</strong>。 子应用提交的头会先过黑名单（
      <code>authorization</code> / <code>x-api-key</code> /<code>x-goog-api-key</code> /{' '}
      <code>api-key</code> / <code>cookie</code> / <code>host</code> … 一律丢弃），
      允许注入的凭据头被限制在四项， 响应体还会做按值替换脱敏、响应头只回传少数几个白名单项。
      也就是说<strong>受管请求路径本身不会把密钥交给子应用</strong>—— 除非子应用是 V1
      trusted（那就是另一回事，见第 14 节）。
    </p>

    <h2 id="plaintext">9. 明文落点：三处密钥真的没加密</h2>
    <p>
      前面所有机制都建立在 keystore 之上。这一节讲清楚三处<strong>不走 keystore</strong> 的落点，
      以及它们各自的真实暴露面。
    </p>

    <h3 id="pt-im">9.1 IM 机器人凭据：明文入库，且明文回显</h3>
    <p>
      设置 → 生态 → 远程连接里填的 Bot Token / App Secret，落点是
      <code>app_settings</code> 表的{' '}
      <code>(category=&#39;remote-connections&#39;, key=&#39;data&#39;)</code>， 值是一整棵{' '}
      <code>&#123; global, connections &#125;</code> 的 JSON。 逐跳证据链是：
    </p>
    <ol>
      <li>
        凭据原样保留：<code>sanitizeConnection</code> 里{' '}
        <code>
          credentials: isRecord(input.credentials) ? &#123; ...input.credentials &#125; :
          &#123;&#125;
        </code>
        ，不做任何掩码；
      </li>
      <li>
        保存时{' '}
        <code>
          credentials: &#123; ...base.credentials, ...(patch.credentials ?? &#123;&#125;) &#125;
        </code>
        ；
      </li>
      <li>
        <code>writeStore</code> →{' '}
        <code>settingsService.set(&#39;remote-connections&#39;, &#39;data&#39;, store)</code>；
      </li>
      <li>
        <code>SettingsService</code> 是纯转发到 <code>SettingsRepository.set</code>；
      </li>
      <li>
        仓储层 <code>this.toJson(value)</code> 后写进 <code>app_settings.value</code> 文本列——
        <strong>没有任何加密</strong>。
      </li>
    </ol>
    <p>
      涉及字段（<code>RemoteConnectionCredentials</code>）：<code>botToken</code>、
      <code>appId</code>、<code>appSecret</code>、<code>webhookUrl</code>、<code>qqBotAppId</code>、
      <code>qqBotToken</code>、<code>qqBotSecret</code>、<code>clawEndpoint</code>、
      <code>clawAccessToken</code>。
    </p>
    <p>
      <strong>它与 Provider 的两点差别，比「加密与否」更值得注意</strong>：
    </p>
    <ul>
      <li>
        <strong>明文会回传到渲染进程</strong>：<code>remote:list</code> 直接返回
        <code>store.connections</code>（就是 <code>readStore()</code>，只做形状归一），
        <code>credentials</code> 原样带出去。渲染端把它塞进 <code>draft</code>。
      </li>
      <li>
        <strong>界面用的是普通输入框，不是密码框</strong>：<code>RemoteCredentialFields</code> 里
        Bot Token / App Secret / 机器人 AppSecret / Access Token 用的都是 <code>Input</code>，整个{' '}
        <code>SettingsView.tsx</code> 里<code>InputPassword</code> 与 <code>type="password"</code>{' '}
        的出现次数是 <strong>0</strong>。 所以已保存的 bot token 会以明文显示在设置页输入框里。
      </li>
    </ul>
    <p>
      <strong>需要更正既有文档</strong>：<code>connectors</code>、<code>desktop-guide</code> 与{' '}
      <code>remote-connections</code> 三页原先都写了 「远程连接凭据是 <code>app_settings</code>{' '}
      里的明文 JSON，<strong>界面只做掩码显示</strong>」 （其中 <code>remote-connections</code>{' '}
      出现了两处）。 前半句正确，<strong>后半句与代码不符</strong>
      ——本轮已把这四处措辞统一改为如实描述。
    </p>
    <p>
      怎么降低风险：这个通道本来就是给本机 bot 用的，建议用<strong>权限最小化的 bot</strong>
      （只给必要的群/命令），并注意 <code>userData</code> 目录与数据库备份会被完整复制 （第 13
      节）——那不是「只有密钥文件」的问题，而是整库带走。
    </p>

    <h3 id="pt-env">9.2 环境变量：明文入库 + 脱敏后进系统提示词</h3>
    <p>
      会话配置面板与项目配置里的「环境变量」是另一处明文落点。 存储走{' '}
      <code>RuntimeCompositionService</code> → <code>settingsRepo</code>：
    </p>
    <pre>
      <code>
        const ENV_CATEGORY = 'runtime.env' settingsRepo.set(ENV_CATEGORY,
        `$&#123;scope&#125;:$&#123;scopeRef&#125;`, layer)
      </code>
    </pre>
    <p>
      即 <code>app_settings</code> 里 <code>project:&lt;workspaceId&gt;</code> 与
      <code>session:&lt;sessionId&gt;</code> 两行，值含<strong>真实明文</strong>。
      合并规则是「会话级覆盖项目级，同名键后者胜」。
    </p>
    <p>这些真实值有两个去向：</p>
    <ul>
      <li>
        <strong>注入子进程 env</strong>（<code>result.customEnv = effectiveEnv</code>）——
        这是它存在的目的，也意味着
        <strong>你在这里放的 API Key 会进入 Agent 起的所有工具子进程</strong>；
      </li>
      <li>
        <strong>脱敏后进系统提示词</strong>：<code>buildEnvSystemPrompt</code> 把键名、描述与
        <code>maskSecret</code> 后的值（<code>首字***尾字 (N 字符)</code>）拼成
        <code>[Environment Variables]</code> 段落，并明确要求模型
        「通过变量名引用真实值……不要在回复或日志中打印真实值，也不要要求用户重新提供这些敏感信息」。
      </li>
    </ul>
    <p>
      所以模型的系统提示词里能看到「存在 KEY_A，长度 40」，但看不到值。
      这比「什么都不告诉模型」更好用，但<strong>长度与首尾字符确实进了上下文</strong>——
      如果你介意，就别把密钥放在这里，改用自定义工具的 secretRefs 或 Provider。
    </p>

    <h3 id="pt-mcp">9.3 MCP 配置：明文入库，并随工作流包被脱敏</h3>
    <p>
      MCP 服务器的 <code>config_json</code> 在 <code>mcp_servers</code> 表里是明文 TEXT， 你手写的{' '}
      <code>headers</code> / <code>env</code> 原样入库。 这一处是<strong>唯一有自动脱敏保护</strong>
      的明文落点：导出工作流包时，
      <code>redactMcpConfig</code> 会把
    </p>
    <ul>
      <li>
        <code>headers.*</code> 与 <code>env.*</code> 下的<strong>所有</strong>字符串值，以及
      </li>
      <li>
        任意层级里<strong>键名命中敏感模式</strong>的字符串值 （
        <code>
          /(token|secret|password|credential|authorization|(?:api|access|private)[_.-]?key)/i
        </code>
        ）
      </li>
    </ul>
    <p>
      替换成 <code>&#123;&#123;secret:&lt;路径&gt;&#125;&#125;</code> 占位符，并把路径登记进
      <code>requiredSecrets</code>。注释写着「安全优先，宁多勿漏」。 但要注意
      <strong>它只覆盖 MCP 配置</strong>：同一份工作流包里的技能文件与 Agent 提示词是原样打包的，
      没有扫描——把 Key 写进 <code>SKILL.md</code> 或脚本里，导出时会一起带走。
    </p>

    <h3 id="pt-cli">9.4 Spark CLI：完全独立的一套（明文）</h3>
    <p>
      CLI 与桌面端<strong>不共用任何凭据存储</strong>。两个方向都能证明：
      <code>spark-engine</code> 全目录没有 <code>keytar</code> / <code>safeStorage</code> /
      <code>credential-vault</code> 的任何引用（CLI 打不开桌面端 vault）， 而{' '}
      <code>credentials.json</code> 这个名字在 <code>apps/desktop</code> 里零命中 （桌面端从不读 CLI
      文件）。
    </p>
    <p>
      CLI 的账号会话落在 <code>~/.spark/credentials.json</code>（<code>SPARK_HOME</code> 可改）：
    </p>
    <pre>
      <code>
        &#123; "version": 1, "serverUrl": "https://…", "session": &#123; "token": "…",
        "refreshToken": "…", // 注意：refresh token 也是明文 "userId": "…" &#125;, "account": &#123;
        "id": 1, "account": "…", "nickname": "…", "role": "…" &#125;, "updatedAt": "2026-…" &#125;
      </code>
    </pre>
    <p>保护措施只有文件系统层面，但做得比较扎实：</p>
    <ul>
      <li>
        文件 <code>0o600</code>、目录 <code>0o700</code>；
      </li>
      <li>
        <strong>原子写</strong>：先写 <code>.credentials.json.&lt;pid&gt;.tmp</code> 再
        rename，写入失败不会截断一个可用会话；
      </li>
      <li>
        <strong>读时修复权限</strong>：发现组/其他可读会 chmod 回 0600 并 warn 「platform
        credentials at &lt;path&gt; were group/world readable; tightening to 0600」；
      </li>
      <li>
        首次写入失败抛 <code>PlatformCredentialError</code>（不会静默丢会话）。
      </li>
    </ul>
    <p>三个子命令的行为边界：</p>
    <table>
      <thead>
        <tr>
          <th>命令</th>
          <th>行为</th>
          <th>注意</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>spark login</code>
          </td>
          <td>
            浏览器 PKCE 登录 → 存文件；<code>--json</code> 只回{' '}
            <code>
              &#123;authenticated, userId, serverUrl, loginUrl, openedInBrowser, credentialPath,
              account&#125;
            </code>
          </td>
          <td>
            <strong>不打印 token</strong>；切换服务器会提示「Note: replacing the stored session for
            &lt;old&gt; with a session for &lt;new&gt;」
          </td>
        </tr>
        <tr>
          <td>
            <code>spark logout</code>
          </td>
          <td>
            <strong>只删本地文件</strong>
          </td>
          <td>
            <strong>不做服务端撤销</strong>——CLI 的 server client 里没有任何 logout / revoke
            端点。所以被复制走的 refresh token 在 logout 后仍然有效，需要去账号侧吊销
          </td>
        </tr>
        <tr>
          <td>
            <code>spark whoami</code>
          </td>
          <td>
            显示身份；会话过期则<strong>删除本地文件</strong>并提示「Your Spark account session
            expired. Run <code>spark login</code> again.」
          </td>
          <td>存储的 serverUrl 与当前配置不一致会提示归属错位</td>
        </tr>
      </tbody>
    </table>
    <p>
      <strong>CLI 不存模型 API Key</strong>。它只记「该去哪个环境变量取 Key」：
      <code>~/.spark/config.toml</code> 里写 <code>api_key_env = "MY_KEY_VAR"</code>，
      变量名必须匹配 <code>^[A-Z_][A-Z0-9_]*$</code>，否则报 「Invalid credential environment
      variable …: use UPPER_SNAKE_CASE (<strong>the key itself is never stored</strong>)」。
      运行时从 <code>process.env</code> 取，缺失时报 「Provider &lt;x&gt; requires credential
      environment variable &lt;VAR&gt;」。 这一条与桌面端的差异值得记住：
      <em>桌面端把 Key 存起来，CLI 要求你自己 export 出来。</em>
    </p>
    <p>
      当 CLI 用桌面端托管的渠道时，它的「api key」是桌面 bridge 的一次性 token： 32 字节随机
      base64url，写在 <code>~/.spark/hosts/sparkwork/bridge-&lt;实例 id&gt;.json</code>
      （0600，目录 0700，原子写，bridge 停止时删除）。 它不会被复制进 <code>config.toml</code>
      ，也被测试锁定不得出现在配置快照里。
    </p>

    <h2 id="mask-coverage">10. 脱敏覆盖面：哪些地方会打码，哪些不会</h2>
    <p>「会不会被脱敏」这个问题没有统一答案，下表是逐处核实的结果。</p>
    <table>
      <thead>
        <tr>
          <th>位置</th>
          <th>是否脱敏</th>
          <th>机制</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>桌面端控制台 / 文件日志</td>
          <td>
            <strong>是</strong>
          </td>
          <td>
            logger 的 <code>sanitizeLogText</code> + <code>sanitizeArgs</code>（Bearer / sk- /{' '}
            <code>key=value</code> / 敏感键名）
          </td>
        </tr>
        <tr>
          <td>Provider 创建与更新的日志</td>
          <td>
            <strong>部分</strong>
          </td>
          <td>
            <code>maskSecret</code>，<strong>保留前 4 个字符</strong>
          </td>
        </tr>
        <tr>
          <td>会话环境变量进系统提示词</td>
          <td>
            <strong>是</strong>
          </td>
          <td>保留首尾各 1 字 + 长度</td>
        </tr>
        <tr>
          <td>Hooks 运行记录</td>
          <td>
            <strong>是</strong>
          </td>
          <td>
            <code>hook-redaction.ts</code>：敏感键名的值替换为 <code>***</code>，字符串截断到 512
            字符，深度 6
          </td>
        </tr>
        <tr>
          <td>媒体调试日志</td>
          <td>
            <strong>是</strong>
          </td>
          <td>
            键名正则 + URL 只留 <code>?redacted=1</code> + 请求体变成{' '}
            <code>[REDACTED content chars=N]</code>
          </td>
        </tr>
        <tr>
          <td>工具包子进程 stderr</td>
          <td>
            <strong>是</strong>
          </td>
          <td>
            按已知明文值做 <code>split/join</code> 替换为 <code>[REDACTED]</code>
          </td>
        </tr>
        <tr>
          <td>子应用网络网关的响应体</td>
          <td>
            <strong>是</strong>
          </td>
          <td>
            按已知明文值替换为 <code>[REDACTED]</code>
          </td>
        </tr>
        <tr>
          <td>自定义工具的测试输出</td>
          <td>
            <strong>是</strong>
          </td>
          <td>
            <code>redactTestOutput</code>：先按 keystore 真值替换，再叠加 <code>Bearer</code>/
            <code>sk-</code> 等正则
          </td>
        </tr>
        <tr>
          <td>媒体渠道诊断返回值</td>
          <td>
            <strong>是</strong>
          </td>
          <td>
            <code>sanitizeDiagnosticValue</code> + <code>redactHeaders</code> +{' '}
            <code>redactUrl</code> + <code>redactKnownSecrets</code>
          </td>
        </tr>
        <tr>
          <td>
            <strong>会话记录里的工具调用入参</strong>
          </td>
          <td>
            <strong>未发现脱敏层</strong>
          </td>
          <td>会话/事件持久化路径上没有对应的脱敏包装</td>
        </tr>
        <tr>
          <td>
            <strong>CLI 终端日志</strong>
          </td>
          <td>
            <strong>否</strong>
          </td>
          <td>
            <code>observability/logger.ts</code> 直接写{' '}
            <code>[spark:&lt;ns&gt;] &lt;level&gt;: &lt;message&gt;</code>，无任何替换
          </td>
        </tr>
        <tr>
          <td>Provider 错误信息（CLI 侧）</td>
          <td>
            <strong>部分</strong>
          </td>
          <td>
            <code>error-detail.ts</code> 按<em>键名</em>脱敏且只保留白名单字段，但
            <strong>
              不对字符串内的 <code>sk-…</code> 做子串清洗
            </strong>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      最后两行的写法是刻意的：<strong>「未发现脱敏层」不等于「已被证明不脱敏」</strong>。
      我们的检索覆盖了会话持久化、事件写入与 logger，没有找到包装点；
      但如果你要把密钥打印进工具输出，最安全的假设仍然是「它会原样留在会话记录里」。
    </p>

    <h2 id="deletion">11. 删除与清理：谁能删掉密钥</h2>
    <table>
      <thead>
        <tr>
          <th>操作</th>
          <th>会删什么</th>
          <th>边界</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>删除 Provider</td>
          <td>
            先 <code>deleteSecret(row.keystore_ref)</code>，再删 DB 行
          </td>
          <td>受管 Provider 与内置 Provider / Auto Router 直接拒绝删除</td>
        </tr>
        <tr>
          <td>退出登录</td>
          <td>账号 token（keytar 三条 + 备份）、平台模型凭据</td>
          <td>
            <strong>不动</strong> Provider Key / GitHub PAT / 连接器 OAuth / MCP OAuth；keytar
            曾不可用时会提前 return，把 keytar 里的条目留下
          </td>
        </tr>
        <tr>
          <td>删除自定义工具</td>
          <td>先禁用（跨 SQLite/Keychain 边界前的保护），再删该工具声明的全部密钥</td>
          <td>
            删除失败时报「工具已停用，但 Keychain 密钥清理失败；请稍后重试删除」——工具仍可见可重试
          </td>
        </tr>
        <tr>
          <td>自定义工具移除密钥位</td>
          <td>孤儿清理删掉不再被引用的 ref</td>
          <td>
            失败<strong>静默</strong>（只 warn），且会造成第 8.1 节那个「无法直接回滚」的角落
          </td>
        </tr>
        <tr>
          <td>卸载工具包</td>
          <td>
            逐条删 <code>tool-package:*</code>，返回删除计数
          </td>
          <td>
            必须先停用；删除失败静默；<strong>删单个版本不删密钥</strong>
          </td>
        </tr>
        <tr>
          <td>断开连接器账号</td>
          <td>
            删 <code>connect_accounts.credential_ref</code> 指向的密文
          </td>
          <td>
            <strong>不做 provider 侧撤销</strong>；adapter 抛错时删除不执行
          </td>
        </tr>
        <tr>
          <td>平台 GitHub 连接器断开</td>
          <td>
            <code>deleteSecret(keystore_ref)</code> 后删行
          </td>
          <td>同样不做 GitHub 侧吊销</td>
        </tr>
        <tr>
          <td>卸载插件</td>
          <td>
            遍历该插件的账号删各自 <code>credential_ref</code>，再删资源行与安装目录
          </td>
          <td>
            <strong>无事务</strong>：删密钥抛错会中断卸载；<code>rm</code>{' '}
            失败则密钥已不可恢复。且不清理 <code>spark-mcp-oauth:*</code> 与{' '}
            <code>connector_connections.keystore_ref</code>
          </td>
        </tr>
        <tr>
          <td>删除 MCP 服务器</td>
          <td>只删 DB 行</td>
          <td>
            <strong>不清理</strong> <code>spark-mcp-oauth:&lt;serverId&gt;</code> 的 token →
            孤儿密钥长期留存
          </td>
        </tr>
        <tr>
          <td>显式删某个 ref</td>
          <td>
            macOS 下同时删 vault 条目<strong>与</strong>旧 Keychain 条目
          </td>
          <td>这是唯一会真正清掉旧条目的路径；自动迁移阶段故意保留旧条目以免反复弹授权</td>
        </tr>
      </tbody>
    </table>

    <h2 id="portability">12. 备份、导出与同步：密钥会不会跟着走</h2>
    <p>这是最实际的一组问题——「我把配置分享/备份出去，会带上密钥吗？」</p>
    <table>
      <thead>
        <tr>
          <th>路径</th>
          <th>会带密钥吗</th>
          <th>说明</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <strong>Provider 导出 JSON / 导出到文件</strong>
          </td>
          <td>
            <strong>会，明文</strong>
          </td>
          <td>从 keystore 读出并写入普通 JSON；无任何「含密钥」提示。分享配置请改用工作流包</td>
        </tr>
        <tr>
          <td>
            工作流包 <code>.sparkflow</code>
          </td>
          <td>
            MCP 配置不会；<strong>技能与 Agent 提示词会</strong>
          </td>
          <td>
            MCP 的 <code>headers.*</code>/<code>env.*</code> 与敏感键名被替换为{' '}
            <code>&#123;&#123;secret:路径&#125;&#125;</code>，但技能文件与提示词原样打包、不扫描
          </td>
        </tr>
        <tr>
          <td>团队包</td>
          <td>不会（同套脱敏）</td>
          <td>
            且比工作流包更好的一点：更新已存在 MCP 时会<strong>保留接收方已填的密钥</strong>（
            <code>mergePreserveSecrets</code>），不会用占位符覆盖回去
          </td>
        </tr>
        <tr>
          <td>
            子应用分享包 <code>.sparkapp</code>
          </td>
          <td>
            Provider Key 不会；<strong>源码/data 里的明文会</strong>
          </td>
          <td>
            设计如此：疑似明文密钥只做「位置提示」（<code>secretHints</code> 只含
            location，不含值），包内保留原文以保证可用性
          </td>
        </tr>
        <tr>
          <td>Agent / 团队资产导出</td>
          <td>
            <code>hookConfig</code> 原样写出
          </td>
          <td>
            没有扫描或清理；hook 动作类型本身只有 <code>builtin.sound</code> /{' '}
            <code>tool.invoke</code>，所以是否藏密钥取决于你写了什么
          </td>
        </tr>
        <tr>
          <td>自定义工具导出</td>
          <td>不会</td>
          <td>
            只导出 <code>secretNames</code>（名字）。注意导出物里含 <code>secretRefs</code> 的
            <em>规范化引用字符串</em>，那不是密钥值
          </td>
        </tr>
        <tr>
          <td>账号同步</td>
          <td>不会</td>
          <td>三重过滤，见下</td>
        </tr>
        <tr>
          <td>
            <strong>
              整个 <code>userData</code> 目录 / 数据库备份
            </strong>
          </td>
          <td>
            <strong>会，且包含明文那几处</strong>
          </td>
          <td>
            升级前自动备份是<strong>整库拷贝</strong>，因此 <code>app_settings</code> 里的 IM
            凭据、环境变量、MCP <code>config_json</code> 都会进备份目录；keystore
            里的密钥不会（它们不在库里）
          </td>
        </tr>
        <tr>
          <td>
            CLI <code>credentials.json</code>
          </td>
          <td>
            <strong>会，明文</strong>
          </td>
          <td>
            含 refresh token；备份/同步 <code>~/.spark</code> 等于带走登录态
          </td>
        </tr>
      </tbody>
    </table>
    <p>账号同步的过滤值得单独说，因为它是全仓最严格的一处。三重机制：</p>
    <ul>
      <li>
        <strong>分类白名单</strong>：只同步 <code>customCommands</code>、<code>prompts</code>、
        <code>memory</code>、<code>assistants</code>、<code>workflows</code>、
        <code>appearance</code>、<code>promptLibrary</code> 七类；
      </li>
      <li>
        <strong>字段白名单</strong>：每个分类只允许列出的顶层字段（<code>assistants</code> 明确排除
        <code>providerProfileId</code>/<code>modelId</code>/<code>agentAdapter</code>/
        <code>mcpServerIds</code>/<code>hookConfig</code> 等本地字段），<code>metadata</code> 只允许{' '}
        <code>avatar</code> 一个键；
      </li>
      <li>
        <strong>键名与值双重扫描</strong>：键名命中
        <code>
          /(api.?key|access.?token|refresh.?token|token|password|secret|credential|authorization|cookie|headers?|env…|keystore|provider.?profile|mcp|hooks?)/i
        </code>
        即拒；值命中 PEM 私钥 / <code>Bearer &lt;16+&gt;</code> / JWT /
        <code>sk-/rk-/pk-/ghp_/xox…</code> / <code>https://user:pass@host</code> 即拒。 违规项整条
        <em>跳过</em>而不是上传。
      </li>
    </ul>
    <p>
      一个副作用值得知道：那条键名正则包含裸 <code>mcp</code>， 而工作流图的节点可以合法携带{' '}
      <code>mcpServerIds</code>，图又是整体上传的—— 于是
      <strong>绑定了 MCP 服务器的工作流会被静默跳过同步</strong>（原因码{' '}
      <code>SYNC_FORBIDDEN_FIELD</code>），
      并被加入保护列表以免云端版本覆盖本地。这是安全过滤的连带效果，不是
      bug，但你会觉得「这个工作流怎么没同步」。
    </p>

    <h2 id="troubleshooting">13. 排查表</h2>
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
          <td>保存 Provider 后提示「有 Key」但调用报无凭据</td>
          <td>
            更新时传了空串：<code>updateProvider(&#123;apiKey: ''&#125;)</code> 会把空串写进
            keystore 并把 <code>keystore_ref</code> 落库
          </td>
          <td>
            重新填一次 Key 并保存；判断依据是 <code>hasApiKey = Boolean(keystoreRef)</code>，它只看
            ref 存在与否
          </td>
        </tr>
        <tr>
          <td>平台官方 Provider 读取 Key 报「不能读取凭据」</td>
          <td>受管 Provider 被硬拒——这是设计</td>
          <td>受管 Provider 也不能手改、不能删除，只能在偏好弹窗里调模型</td>
        </tr>
        <tr>
          <td>平台模型偶发「凭据尚未就绪」</td>
          <td>
            受管恢复器返回 null 时会丢弃 keystore 里已有的值（返回 <code>recovered ?? ''</code>）
          </td>
          <td>触发一次平台模型 bootstrap / 重新验证即可回写 keystore</td>
        </tr>
        <tr>
          <td>macOS 上每次启动都弹钥匙串授权</td>
          <td>vault 文件写入失败（vault 无法缓存），于是每次都回落到读 Keychain</td>
          <td>
            检查 <code>&#123;userData&#125;/credential-vault-v1.enc</code>{' '}
            是否存在、可写；日志里会有 <code>failed to cache credential vault in app storage</code>
          </td>
        </tr>
        <tr>
          <td>升级后第一次用某个 Provider 弹了一次授权</td>
          <td>旧 Keychain 条目的惰性迁移（正常行为）</td>
          <td>
            迁移后该 ref 记入 <code>legacyChecked</code>，不会重复弹；旧条目会在显式删除时清掉
          </td>
        </tr>
        <tr>
          <td>
            钥匙串里还能看到旧的 <code>spark-agent</code> 条目
          </td>
          <td>迁移策略故意保留旧条目，避免删除动作反复触发授权</td>
          <td>要清就显式删除该 ref，或退出登录</td>
        </tr>
        <tr>
          <td>
            自定义工具发布报 <code>SECRET_MISSING</code>
          </td>
          <td>
            声明的密钥位还没写值（<code>hasSecret</code> 为假）
          </td>
          <td>在 Studio 的「本机密钥」里填；判据用的是已发布版本的声明</td>
        </tr>
        <tr>
          <td>回滚自定义工具报「未声明密钥位 &lt;X&gt;」</td>
          <td>旧版本用过的密钥位 X 已被孤儿清理删掉，而当前声明里没有 X</td>
          <td>
            <strong>先在草稿里重新声明 X 并补值</strong>，再回滚
          </td>
        </tr>
        <tr>
          <td>新建的自定义工具默认是禁用的</td>
          <td>
            声明了密钥的工具创建时 <code>enabled: !hasToolSecrets</code>
          </td>
          <td>写完密钥后手动启用，这是刻意的安全默认</td>
        </tr>
        <tr>
          <td>工具包密钥「填了但没生效」</td>
          <td>ref 带作用域哈希，不同 scope 是不同槽位</td>
          <td>确认你填的是哪个 scope（package / tool / project / agent / workflow / session）</td>
        </tr>
        <tr>
          <td>Agent 试图用工具包传密钥值被拒</td>
          <td>
            服务层硬拒：<code>is secret and requires secure input</code>
          </td>
          <td>
            正确路径是 Agent 调 <code>tool_packages_request_secret</code> 发起请求，你在弹窗里填
          </td>
        </tr>
        <tr>
          <td>工具包密钥弹窗一直不出现</td>
          <td>请求可能已过期（TTL 默认 15 分钟，惰性判定）或已被完成/取消</td>
          <td>
            重新发起请求；列表只在 <code>secret-requested</code> / <code>configured</code>{' '}
            事件时刷新
          </td>
        </tr>
        <tr>
          <td>卸载工具包后密钥还在</td>
          <td>
            删除失败是静默的（只影响 <code>removedSecrets</code> 计数）
          </td>
          <td>
            看卸载返回的 <code>removedSecrets</code> 是否符合预期
          </td>
        </tr>
        <tr>
          <td>只删了工具包的一个版本，密钥还在钥匙串</td>
          <td>设计如此：只有整体卸载才删密钥</td>
          <td>要清就走完整卸载</td>
        </tr>
        <tr>
          <td>断开连接器账号后，GitHub 侧的授权仍然有效</td>
          <td>断开只删本地密文，四个内置 adapter 都没实现 provider 侧 revoke</td>
          <td>去 GitHub / Notion 控制台手动吊销那个 token</td>
        </tr>
        <tr>
          <td>点「断开」提示失败但账号还在</td>
          <td>
            <code>adapter.disconnect</code> 抛错时，删除密文这一步不会执行
          </td>
          <td>重试断开；必要时先修好网络/权限</td>
        </tr>
        <tr>
          <td>删除 MCP 服务器后钥匙串里还有 token</td>
          <td>
            <code>mcp:delete</code> 只删 DB 行，不清理 <code>spark-mcp-oauth:&lt;serverId&gt;</code>
          </td>
          <td>
            先 <code>mcp:deauthorize</code> 再删除，可避免孤儿密钥
          </td>
        </tr>
        <tr>
          <td>重启后要求重新登录，但钥匙串里明明有凭据</td>
          <td>
            可能踩到备份文件的跨命名空间问题（取消 MCP 授权删掉了登录态备份）+ keytar 同时不可用
          </td>
          <td>重新登录即可；若频繁出现，检查是否有 MCP OAuth 的取消授权操作</td>
        </tr>
        <tr>
          <td>退出登录后 Provider Key 还在</td>
          <td>只有平台模型注册了 logout hook，Provider 密钥不随退出登录清除</td>
          <td>这是现状；要清就逐个删除 Provider</td>
        </tr>
        <tr>
          <td>IM 机器人 token 在设置页明文显示</td>
          <td>
            该表单用的是普通 <code>Input</code>，且 <code>remote:list</code> 明文回传
          </td>
          <td>现状如此（本轮已更正官网旧文案）；不要在有旁观者/录屏时打开该页面</td>
        </tr>
        <tr>
          <td>导出的 Provider JSON 里有明文 Key</td>
          <td>
            <code>exportProviders</code> 会从 keystore 读出并附带
          </td>
          <td>不要分享该文件；分享配置用工作流包</td>
        </tr>
        <tr>
          <td>工作流包导入后 MCP 连不上</td>
          <td>
            占位符 <code>&#123;&#123;secret:…&#125;&#125;</code> 还没补；导入时 MCP 是
            <strong>禁用</strong>状态
          </td>
          <td>
            在工作流包面板点「激活」，弹窗里逐项补密钥，按钮是「补齐并激活」；未补全时激活会被拒
          </td>
        </tr>
        <tr>
          <td>
            <code>spark logout</code> 后旧 token 仍能用
          </td>
          <td>CLI 的 logout 只删本地文件，不做服务端撤销</td>
          <td>
            去账号侧吊销；并注意 <code>credentials.json</code> 是明文，别同步到云盘
          </td>
        </tr>
        <tr>
          <td>CLI 报「requires credential environment variable &lt;VAR&gt;」</td>
          <td>CLI 不存模型 Key，只记环境变量名</td>
          <td>
            在 shell 里 export 该变量，或在 <code>config.toml</code> 改 <code>api_key_env</code>{' '}
            指向已 export 的变量
          </td>
        </tr>
      </tbody>
    </table>

    <h2 id="boundaries">14. 事实边界与本次未核实项</h2>
    <p>
      按「实事求是」的要求，以下内容本轮<strong>没有</strong>在代码里找到证据，已从结论中排除：
    </p>
    <ul>
      <li>
        <strong>
          不存在 <code>apiKeyMask</code> 字段或函数
        </strong>
        。 全仓检索 <code>apiKeyMask</code> / <code>apiKey_masked</code> /{' '}
        <code>apiKeyPreview</code> 零命中。 外部资料里「列表接口只返回 <code>apiKeyMask</code>
        」的说法与当前代码不符—— Provider 链路给渲染端的要么是明文（编辑回显）、要么是布尔（
        <code>hasApiKey</code>）、 要么是引用（<code>keystoreRef</code>）。
      </li>
      <li>
        <strong>macOS 上的「系统 Keychain」不是最终落点</strong>，而是安全存储加密后的 vault 文件；
        只有 Windows / Linux 才直达 keytar 后端。多处工具描述（例如「API Key 进入系统 Keychain」）
        在 macOS 上是不准确的简化说法，本文按代码描述。
      </li>
      <li>
        <strong>「不进消息记录」这类承诺不成立</strong>： Provider / 媒体渠道的 <code>apiKey</code>{' '}
        是 MCP 工具的<em>入参</em>， 它会随 tool call
        参数进入会话与模型上下文。成立的说法只有「不出现在返回值与日志中」。
      </li>
      <li>
        <strong>无法验证服务端是否回传 token</strong>：微信轮询接口的响应类型里允许
        <code>token</code>/<code>refreshToken</code> 字段且主进程原样透传，
        但服务端实现不在本仓，因此不能断言它一定会或一定不会返回凭据。
      </li>
      <li>
        <strong>「会话记录一定不脱敏」不是已被证明的结论</strong>： 我们是在会话持久化路径上
        <em>没有找到</em>脱敏包装，而不是验证了它不可能存在。
        涉及具体合规判断时请按更保守的假设处理。
      </li>
      <li>
        <strong>快照库主密钥的丢失语义</strong>：<code>getSecret</code> 返回 null
        时会直接生成一把新钥并覆写 ref （旧 <code>.svb</code> 全部解不开，且解密失败统一报{' '}
        <code>Snapshot blob authentication failed</code>，无法与「被篡改」区分）。 该密钥是 32
        字节随机值、非派生，全程只在 keytar / vault 里以 base64 保存。
      </li>
    </ul>
    <p>
      关于「哪些密钥算敏感、要不要迁移」这类判断，本文只陈述代码事实与影响面，不替你决定。
      如果你的威胁模型包含「同机其它进程」或「<code>userData</code> 会被备份到别处」， 优先关注第 9
      节的三处明文落点与第 12 节的导出路径。
    </p>
  </>
)

export default {
  slug: 'credentials-and-secrets',
  toc: [
    { id: 'taxonomy', title: '1. 四种落点：先建立正确的心理模型', level: 2 },
    { id: 'why-four', title: '1.1 为什么会有四种，而不是一种', level: 3 },
    { id: 'which-one', title: '1.2 我怎么知道自己某个密钥在哪', level: 3 },
    { id: 'keystore', title: '2. 共享 keystore：唯一入口与它的真实边界', level: 2 },
    { id: 'keystore-constants', title: '2.1 常量与平台分支', level: 3 },
    { id: 'keystore-api', title: '2.2 五个函数与它们的语义差异', level: 3 },
    { id: 'vault-format', title: '2.3 集中 vault 的文件格式与写入协议', level: 3 },
    { id: 'vault-migration', title: '2.4 从「一个 Provider 一条 Keychain 项」迁移', level: 3 },
    { id: 'keystore-consumers', title: '2.5 十三个消费者', level: 3 },
    { id: 'refs', title: '3. 引用与明文：SQLite 里到底存了什么', level: 2 },
    { id: 'ref-columns', title: '3.1 keystore_ref 列清单', level: 3 },
    { id: 'check-constraint', title: '3.2 唯一一处数据库级强制：tool_package_config', level: 3 },
    { id: 'ref-naming', title: '3.3 ref 命名规则总表', level: 3 },
    { id: 'mask', title: '4. 脱敏：两份同名函数，和它们各自泄露了什么', level: 2 },
    { id: 'logger-redaction', title: '4.1 日志器本身还有一层脱敏', level: 3 },
    { id: 'provider', title: '5. Provider 凭据：从表单到真实请求', level: 2 },
    { id: 'provider-write', title: '5.1 写入：什么进 keystore，什么进数据库', level: 3 },
    { id: 'provider-read', title: '5.2 读取：resolver 的真实返回值', level: 3 },
    { id: 'provider-echo', title: '5.3 明文回显：provider:get-api-key 是刻意的', level: 3 },
    { id: 'provider-export', title: '5.4 导出会把明文 Key 写进普通文件', level: 3 },
    { id: 'provider-test', title: '5.5 测试连接会真的发请求', level: 3 },
    { id: 'tokenstore', title: '6. TokenStore：第二个 keytar 实现', level: 2 },
    { id: 'ts-order', title: '6.1 读写顺序与文件头注释相反', level: 3 },
    { id: 'ts-two-bugs', title: '6.2 备份文件被两个命名空间共用（含一个可复现的缺陷）', level: 3 },
    { id: 'ts-refresh', title: '6.3 续期与「一条没人收的明文广播」', level: 3 },
    { id: 'ts-logout', title: '6.4 退出登录删了什么、没删什么', level: 3 },
    { id: 'accounts', title: '7. 账号类凭据：连接器、平台连接器、团队注册表', level: 2 },
    { id: 'connector-accounts', title: '7.1 连接器账号（plugin-runtime）', level: 3 },
    { id: 'github-connector', title: '7.2 平台 GitHub 连接器', level: 3 },
    { id: 'team-registry', title: '7.3 团队注册表（Nacos）', level: 3 },
    { id: 'declaration', title: '8. 「只声明引用、不填值」的三条面', level: 2 },
    { id: 'decl-custom-tools', title: '8.1 自定义工具：secretRefs', level: 3 },
    { id: 'decl-tool-packages', title: '8.2 工具包：环境变量与一次性安全输入', level: 3 },
    { id: 'decl-sub-apps', title: '8.3 子应用连接槽：只能声明槽，不能声明值', level: 3 },
    { id: 'plaintext', title: '9. 明文落点：三处密钥真的没加密', level: 2 },
    { id: 'pt-im', title: '9.1 IM 机器人凭据：明文入库，且明文回显', level: 3 },
    { id: 'pt-env', title: '9.2 环境变量：明文入库 + 脱敏后进系统提示词', level: 3 },
    { id: 'pt-mcp', title: '9.3 MCP 配置：明文入库，并随工作流包被脱敏', level: 3 },
    { id: 'pt-cli', title: '9.4 Spark CLI：完全独立的一套（明文）', level: 3 },
    { id: 'mask-coverage', title: '10. 脱敏覆盖面：哪些地方会打码，哪些不会', level: 2 },
    { id: 'deletion', title: '11. 删除与清理：谁能删掉密钥', level: 2 },
    { id: 'portability', title: '12. 备份、导出与同步：密钥会不会跟着走', level: 2 },
    { id: 'troubleshooting', title: '13. 排查表', level: 2 },
    { id: 'boundaries', title: '14. 事实边界与本次未核实项', level: 2 },
  ],
  faq: [
    {
      question: '我的 API Key 到底存在哪里？',
      answer:
        '看你是在哪填的：模型页添加的 Provider、扩展中心的连接器账号、自定义工具的密钥、工具包的 secret 环境变量，都走共享 keystore（在 macOS 上是一个由 safeStorage 加密的文件 credential-vault-v1.enc，其它平台走 keytar）。但设置页里「远程连接」的 Bot Token / App Secret 和会话、项目环境变量是明文存在 SQLite 的 app_settings 表里的，CLI 的登录态则是 ~/.spark/credentials.json 明文。第 1.2 节有一张「你在哪填的 → 落在哪」的对照表。',
    },
    {
      question: '为什么我在设置里能直接看到机器人的 Bot Token 明文？',
      answer:
        '因为那条链路没有走 keystore：remote:list 会把 app_settings 里的 credentials 原样回传给渲染进程，而设置页用的是普通 Input 而不是密码框（整个 SettingsView 里没有 InputPassword）。官方网站连接器页与桌面端架构页原先写的「界面只做掩码显示」与代码不符，本轮已更正。',
    },
    {
      question: '我把 Provider 配置导出成 JSON 分享给同事，里面会有 Key 吗？',
      answer:
        '会有，而且是明文。exportProviders 会从 keystore 读出明文 Key 并附带到导出 profile 里（导出格式 v2 的注释就写着「含 apiKey」），导出到文件时也没有任何「包含密钥」的提示。要分享配置请改用工作流包 .sparkflow，它会把 MCP 配置里的密钥替换成 {{secret:路径}} 占位符。注意工作流包只脱敏 MCP 配置，技能文件与 Agent 提示词是原样打包的。',
    },
    {
      question: '退出登录会删掉我配的 Provider Key 吗？',
      answer:
        '不会。全仓只有 PlatformModelService 注册了 logout hook，所以退出登录只清 Spark 账号 token 和平台模型凭据；Provider API Key、平台 GitHub 连接器 PAT、连接器 OAuth 令牌、MCP OAuth 令牌都保留。要清这些得逐个删除对应配置。',
    },
    {
      question: '我是 CLI 用户，~/.spark/credentials.json 里有明文 token 吗？',
      answer:
        '有，access token 与 refresh token 都是明文 JSON，保护只有文件权限 0600（目录 0700）加原子写与权限自修复。spark-engine 里没有任何 keytar / safeStorage 代码，CLI 与桌面端不共用凭据。另外 spark logout 只删本地文件、不做服务端撤销，所以别把 ~/.spark 同步到云盘或打进 CI 缓存。',
    },
    {
      question: '取消某个 MCP 服务器的授权，会影响我的登录状态吗？',
      answer:
        '会删掉登录会话的加密备份文件。TokenStore 的备份文件名是常量 cloud-auth-session.enc、不带 service，而删除时又只按这个固定路径 rm、不校验 service；MCP OAuth 用的正是同一个 TokenStore 类（service 是 spark-mcp-oauth:<serverId>），所以取消授权会连带删掉云端登录的备份。影响通常有限（登录态同时在 keytar 里），但如果 keytar 恰好不可用就会走到「重启即掉登录」。',
    },
  ],
  aiSummary:
    'SparkWork 凭据与密钥管理完整指南：先建立正确心理模型——密钥实际有四种落点，其中两种是明文。逐层讲清共享 keystore 的 macOS 集中 vault（safeStorage 加密的 credential-vault-v1.enc、legacyChecked 惰性迁移、deleteSecret 才清旧条目）、第二个 keytar 实现 TokenStore（SparkAgent.CloudAuth、备份文件被两个命名空间共用导致取消 MCP 授权会删掉登录备份、退出登录只有一个 hook）、以及 SQLite app_settings 里三处明文落点（IM 机器人凭据还会明文回显到普通输入框、会话与项目环境变量、MCP config_json）。覆盖 Provider 凭据从表单到真实请求的全链路（keystore_ref 契约、空串写库的语义坑、provider:get-api-key 的明文回显与受管 Provider 硬拒、导出会把明文 Key 写盘）、声明与填值分离的三条面（自定义工具 secretRefs 的完整生命周期、工具包 secret 环境变量与一次性安全输入、子应用连接槽的 strict schema 与 CDN 无关的宿主侧注入）、ref 命名规则总表、两份同名 maskSecret 的差异与脱敏覆盖面、删除与清理的边界、以及备份导出同步各路径会不会带密钥。附 24 行排查表与事实边界。',
  quickReference: [
    { key: '共享 keystore 模块', value: 'packages/shared/src/keystore/index.ts（244 行）' },
    { key: 'keytar service 前缀', value: 'spark-agent' },
    { key: 'macOS 集中 vault 账号名', value: 'credential-vault-v1' },
    {
      key: 'vault 落盘文件',
      value: '{userData}/credential-vault-v1.enc（safeStorage 加密，0600）',
    },
    { key: '非 macOS 落点', value: 'keytar 后端（Keychain / 凭据管理器 / libsecret）' },
    {
      key: '平台账号 keytar service',
      value: 'SparkAgent.CloudAuth（可用 SPARK_AUTH_KEYTAR_SERVICE 覆盖）',
    },
    { key: 'MCP OAuth keytar service', value: 'spark-mcp-oauth:<serverId>' },
    { key: '登录态加密备份', value: '{userData}/cloud-auth-session.enc' },
    { key: 'Provider ref 形态', value: '<providerType>-<uuid>' },
    { key: '平台受管 Provider ref', value: 'newapi-spark-user-<userId>-api-key' },
    { key: '连接器账号 ref', value: 'plugin-runtime-<pluginId>-<runtimeId>-<base64url>' },
    { key: '自定义工具 ref', value: 'custom-tool:<工具 id>:<密钥名>' },
    { key: '工具包 secret ref', value: 'tool-package:<包 id>:<变量名>:<sha256 前 20 位>' },
    { key: '平台 GitHub 连接器 ref', value: 'github-connector-github-primary' },
    { key: '团队注册表 ref', value: 'team-registry-nacos-password' },
    {
      key: '快照库主密钥 ref',
      value: 'snapshot-vault-installation-key-v1（32 字节随机，AES-256-GCM）',
    },
    { key: 'CLI 凭据文件', value: '~/.spark/credentials.json（明文，0600）' },
    { key: 'CLI 模型 Key', value: '不存值，只存环境变量名 api_key_env' },
    { key: 'IM 机器人凭据落点', value: 'app_settings(remote-connections/data) 明文' },
    { key: '环境变量落点', value: 'app_settings(runtime.env) 明文' },
    { key: '工作流包密钥占位符', value: '{{secret:<点分路径>}}' },
    { key: '工具包 secret DB 约束', value: 'is_secret 与 keystore_ref/value_json 互斥 CHECK' },
    { key: '日志脱敏覆盖', value: 'Bearer / sk- / key=value / 敏感键名（仅顶层，不递归）' },
    { key: 'Provider 日志掩码', value: 'maskSecret 保留前 4 个字符' },
  ],
  howTo: {
    name: '安全管理 SparkWork 里的密钥',
    description:
      '按「先分清楚在哪、再决定怎么放、最后确认不会跟着文件跑出去」三步处理凭据，避免把明文密钥放进会被分享或备份的地方。',
    totalTime: 'PT10M',
    steps: [
      '先在「模型」页用「测试连接」确认 Key 可用；这一步会真的发一次最小请求，能区分「Key 错」与「BaseURL/模型名错」。',
      '优先把密钥放在走共享 keystore 的位置：Provider 的 API Key、自定义工具的「本机密钥」、工具包的 secret 环境变量、连接器账号。这四处都不会写进 SQLite。',
      '避免把长期密钥放进「远程连接」的 Bot Token / App Secret 与「环境变量」——这两处是 app_settings 里的明文，且前者的值会明文显示在设置页输入框里。',
      '如果确实要用环境变量给 Agent 传密钥，知道它会被注入子进程 env，也会以「首字***尾字 (N 字符)」的形式进系统提示词；不要在同一个变量里同时放密钥与可公开内容。',
      '需要分享 Provider 配置时不要用「导出到文件」——它含明文 Key。改用工作流包 .sparkflow，并把密钥写进 MCP 配置的 headers/env（导出时会被替换成占位符），导入方在激活时补齐。',
      '分享前自查两类不会被自动脱敏的内容：写进 SKILL.md 或脚本里的密钥（工作流包不扫描技能文件）、以及子应用源码或数据里的明文密钥（.sparkapp 只给位置提示）。',
      '收尾检查：把 ~/.spark/credentials.json 排除在云盘与 CI 缓存之外；取消 MCP 授权后如果发现要重新登录，回想一下第 6.2 节那个共用备份文件的问题。',
    ],
  },
  Body,
} satisfies DocsPageContent
