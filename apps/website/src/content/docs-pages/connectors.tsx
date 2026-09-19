import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      「连接器」是 SparkWork 里最容易被混淆的一个词：它在代码里同时指向三套互不相同的子系统，
      而这三套的入口、存储表、鉴权方式和排查手段都不一样。这一页先把三者分开， 然后重点讲
      <strong>扩展中心里的插件型连接器</strong>（含 GitHub / Google / Notion / Obsidian
      四个内置运行时）， 以及
      <strong>
        平台管理 MCP 那套 15 个 <code>github_*</code> 工具
      </strong>
      。 IM 机器人（Telegram / 飞书 / QQ）属于第三套，本文只做概览，细节见
      <a href="/docs/remote-connections">远程连接</a>。
    </p>

    <h2 id="overview">1. 先分清「连接器」在 SparkWork 里的三种含义</h2>
    <p>
      同一个中文词对应三套代码，混用会导致「工具名对得上但存储表对不上」这类错误，
      所以先看一张对照表。
    </p>

    <h3 id="entry">1.1 入口：扩展中心 → 连接器</h3>
    <ul>
      <li>
        左侧导航栏的<strong>「扩展中心」</strong>（视图 id <code>mcp</code>，文案键{' '}
        <code>nav.extensions</code>， 见 <code>apps/desktop/src/renderer/App.tsx:283</code> 与
        <code>design/i18n/locales.ts:319</code>）。快捷键是 <code>⌘5</code> / <code>Ctrl+5</code>（
        <code>design/hooks/useKeyboard.ts:136-144</code>），命令面板里叫「连接器与 MCP 视图」。
      </li>
      <li>
        扩展中心有四个页签，定义在 <code>design/views/McpView.tsx:255-262</code>：<code>MCP</code> /{' '}
        <code>自定义工具</code> /{' '}
        <strong>
          <code>连接器</code>
        </strong>{' '}
        / <code>团队商店</code>。
      </li>
      <li>
        点「连接器」页签渲染的是 <code>&lt;PluginMarketplaceView embedded /&gt;</code>（
        <code>McpView.tsx:562-563</code>）——这是本文的主角。
      </li>
      <li>
        注意 <code>locales.ts</code> 里还有 <code>nav.mcp</code> 与 <code>nav.plugins</code>{' '}
        两条词条， 值都是「连接器」，但代码里<strong>没有任何渲染点</strong>
        引用它们；侧边栏实际用的是
        <code>nav.extensions</code>。别照词条名猜菜单路径。
      </li>
    </ul>

    <h3 id="three-kinds">1.2 三者对照</h3>
    <table>
      <thead>
        <tr>
          <th>维度</th>
          <th>插件型连接器</th>
          <th>平台管理 MCP 的 GitHub 连接器</th>
          <th>远程连接（IM 机器人）</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>界面入口</td>
          <td>扩展中心 →「连接器」页签</td>
          <td>
            代码里有一个 GitHub 面板，但<strong>没有被挂载</strong>（见 §10.3）
          </td>
          <td>设置 → 远程连接</td>
        </tr>
        <tr>
          <td>核心代码</td>
          <td>
            <code>services/plugins/</code> + <code>services/plugin-runtime/</code>
          </td>
          <td>
            <code>services/github-connector.service.ts</code>
          </td>
          <td>
            <code>apps/desktop/src/main/services/RemoteConnectionService.ts</code>
          </td>
        </tr>
        <tr>
          <td>存储表</td>
          <td>
            <code>plugins</code> / <code>connector_accounts</code>
          </td>
          <td>
            <code>connector_connections</code>
          </td>
          <td>
            <code>app_settings</code> 的 <code>remote-connections/data</code>
          </td>
        </tr>
        <tr>
          <td>凭据存放</td>
          <td>
            系统 keystore（表里只留 <code>credential_ref</code>）
          </td>
          <td>
            系统 keystore（表里只留 <code>keystore_ref</code>）
          </td>
          <td>
            <strong>明文 JSON</strong>（不在 keystore）
          </td>
        </tr>
        <tr>
          <td>Agent 侧工具名</td>
          <td>
            <code>mcp__spark_plugins__&lt;runtime&gt;_&lt;tool&gt;</code>
          </td>
          <td>
            <code>mcp__spark_platform__github_*</code>
          </td>
          <td>无工具；走聊天消息驱动</td>
        </tr>
        <tr>
          <td>本文覆盖</td>
          <td>§2 – §9 详述</td>
          <td>§10 详述</td>
          <td>§11 概览 + 跳转</td>
        </tr>
      </tbody>
    </table>

    <h2 id="page">2. 连接器页面上有什么</h2>
    <p>
      页面根容器是 <code>PluginMarketplaceView</code>（
      <code>design/views/PluginMarketplaceView.tsx</code>），
      自顶向下只有两个区块，界面文案如下（均为逐字引用）：
    </p>
    <table>
      <thead>
        <tr>
          <th>位置</th>
          <th>文案 / 控件</th>
          <th>代码位置</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>页头说明</td>
          <td>
            <code>安装、连接并控制 Agent 可以使用的外部服务。</code>
          </td>
          <td>
            <code>PluginMarketplaceView.tsx:803</code>
          </td>
        </tr>
        <tr>
          <td>页头右侧按钮</td>
          <td>
            <code>导入本地连接器</code>
          </td>
          <td>
            <code>:804-811</code>
          </td>
        </tr>
        <tr>
          <td>区块一标题</td>
          <td>
            <code>已安装连接器</code> + 计数胶囊 <code>N 个连接器</code>
          </td>
          <td>
            <code>:814-819</code>
          </td>
        </tr>
        <tr>
          <td>区块一空态</td>
          <td>
            <code>还没有连接器</code> / <code>从本地导入，或从已验证的市场来源安装。</code>
          </td>
          <td>
            <code>:821-831</code>
          </td>
        </tr>
        <tr>
          <td>区块二标题</td>
          <td>
            <code>连接器市场</code> + 副标题 <code>来自已配置的可信市场源</code>
          </td>
          <td>
            <code>:903-904</code>
          </td>
        </tr>
        <tr>
          <td>区块二搜索框</td>
          <td>
            placeholder <code>搜索名称或能力</code>
          </td>
          <td>
            <code>:906-913</code>
          </td>
        </tr>
        <tr>
          <td>区块二加载 / 空 / 错误</td>
          <td>
            <code>正在同步市场目录…</code> / <code>当前来源没有匹配的连接器。</code> /{' '}
            <code>无法连接连接器市场</code> + <code>重新加载</code>
          </td>
          <td>
            <code>:915-930</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      <strong>出厂状态下你看不到「连接器市场」这一整块。</strong>它被{' '}
      <code>{'{marketConfigured && (…)}'}</code>
      包住（<code>:899</code>），而 <code>marketConfigured</code>{' '}
      要求至少有一个「已启用且配置了指纹」的市场源。 默认注册表 <code>spark-official</code>{' '}
      指向占位地址 <code>https://plugins.spark-agent.com/v1</code>， 已被迁移脚本
      <strong>主动停用</strong>（<code>071_disable_placeholder_plugin_marketplace.sql</code>）， 且{' '}
      <code>configured = enabled === 1 &amp;&amp; trustedKeyFingerprints.length &gt; 0</code>（
      <code>plugin-manager.service.ts:42</code>）。所以默认情况下这块是
      <strong>整块消失、没有空态文案</strong>， 不是加载失败。详见 §8.2。
    </p>
    <p>已安装卡片上会出现这些元素：</p>
    <ul>
      <li>
        副标题 <code>{'{插件作者} · v{版本}'}</code>，状态徽标 <code>已启用</code> /{' '}
        <code>已停用</code>。
      </li>
      <li>
        来源徽标三选一：<code>已验证</code>（verified）/ <code>内置</code>（bundled）/{' '}
        <code>本地</code>（unverified）； 同名插件合并时多一枚 <code>已合并 N 个来源</code>。
      </li>
      <li>
        贡献计数 chips，固定顺序且为 0 则不显示：<code>Skill N</code>、<code>MCP N</code>、
        <code>连接器 N</code>、<code>运行时 N</code>；全为 0 时显示 <code>未声明能力</code>（
        <code>:75-95</code>）。
      </li>
      <li>
        权限计数 <code>权限 &#123;已授权&#125;/&#123;总数&#125;</code>；有未授权项时底部追加一条{' '}
        <code>待授权：…</code>。
      </li>
      <li>
        卸载按钮的 <code>title</code> 是 <code>移除非内置连接器</code>——纯内置插件不渲染这个按钮。
      </li>
    </ul>

    <h2 id="runtimes">3. 内置的四个运行时</h2>
    <p>
      「运行时」是连接器真正干活的执行体：一个运行时可连接多个账号，并对外暴露一组工具。 宿主内置了
      <strong>四个</strong>，注册点在 <code>services/plugin-runtime/builtin-runtimes.ts:8-11</code>
      ， 对应四个 adapter 文件。<strong>没有</strong> Slack / Jira / Linear / Zoom / Teams / 通用
      REST 运行时。
    </p>
    <table>
      <thead>
        <tr>
          <th>runtime id</th>
          <th>显示名</th>
          <th>pluginId</th>
          <th>工具前缀</th>
          <th>账号模式</th>
          <th>工具数</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>github</code>
          </td>
          <td>GitHub</td>
          <td>
            <code>spark.github</code>
          </td>
          <td>
            <code>github_</code>
          </td>
          <td>
            <code>multiple</code>
          </td>
          <td>15</td>
        </tr>
        <tr>
          <td>
            <code>google</code>
          </td>
          <td>Google Workspace</td>
          <td>
            <code>spark.google</code>
          </td>
          <td>
            <code>google_</code>
          </td>
          <td>
            <code>multiple</code>
          </td>
          <td>16</td>
        </tr>
        <tr>
          <td>
            <code>notion</code>
          </td>
          <td>Notion</td>
          <td>
            <code>spark.notion</code>
          </td>
          <td>
            <code>notion_</code>
          </td>
          <td>
            <code>multiple</code>
          </td>
          <td>8</td>
        </tr>
        <tr>
          <td>
            <code>obsidian</code>
          </td>
          <td>Obsidian Vault</td>
          <td>
            <code>spark.obsidian</code>
          </td>
          <td>
            <code>obsidian_</code>
          </td>
          <td>
            <code>multiple</code>
          </td>
          <td>8</td>
        </tr>
      </tbody>
    </table>

    <h3 id="runtime-github">3.1 GitHub</h3>
    <p>
      <code>github-runtime.adapter.ts</code>。能力 id 与界面标签：
      <code>identity</code>→身份、<code>repositories</code>→仓库、<code>contents</code>→文件、
      <code>issues</code>→Issue、<code>pull_requests</code>→Pull Request，五个默认全开 （
      <code>:36-62</code>）。
    </p>
    <table>
      <thead>
        <tr>
          <th>
            工具（前缀 <code>github_</code>）
          </th>
          <th>所需能力</th>
          <th>风险</th>
          <th>作用</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>get_status</code>
          </td>
          <td>
            <code>identity</code>
          </td>
          <td>read</td>
          <td>读取已连接的 GitHub 身份</td>
        </tr>
        <tr>
          <td>
            <code>list_repositories</code>
          </td>
          <td>
            <code>repositories</code>
          </td>
          <td>read</td>
          <td>列出账号可访问的仓库</td>
        </tr>
        <tr>
          <td>
            <code>get_repository</code>
          </td>
          <td>
            <code>repositories</code>
          </td>
          <td>read</td>
          <td>读单个仓库元数据</td>
        </tr>
        <tr>
          <td>
            <code>read_file</code>
          </td>
          <td>
            <code>contents</code>
          </td>
          <td>read</td>
          <td>读仓库文件（base64 自动解码）</td>
        </tr>
        <tr>
          <td>
            <code>list_issues</code>
          </td>
          <td>
            <code>issues</code>
          </td>
          <td>read</td>
          <td>列仓库 Issue</td>
        </tr>
        <tr>
          <td>
            <code>get_issue</code>
          </td>
          <td>
            <code>issues</code>
          </td>
          <td>read</td>
          <td>读单个 Issue</td>
        </tr>
        <tr>
          <td>
            <code>list_pull_requests</code>
          </td>
          <td>
            <code>pull_requests</code>
          </td>
          <td>read</td>
          <td>列 PR</td>
        </tr>
        <tr>
          <td>
            <code>get_pull_request</code>
          </td>
          <td>
            <code>pull_requests</code>
          </td>
          <td>read</td>
          <td>读单个 PR</td>
        </tr>
        <tr>
          <td>
            <code>create_issue</code>
          </td>
          <td>
            <code>issues</code>
          </td>
          <td>high-write</td>
          <td>创建 Issue</td>
        </tr>
        <tr>
          <td>
            <code>comment_issue</code>
          </td>
          <td>
            <code>issues</code>
          </td>
          <td>high-write</td>
          <td>给 Issue 加评论</td>
        </tr>
        <tr>
          <td>
            <code>update_issue</code>
          </td>
          <td>
            <code>issues</code>
          </td>
          <td>high-write</td>
          <td>改 Issue 标题 / 正文 / 状态</td>
        </tr>
        <tr>
          <td>
            <code>comment_pull_request</code>
          </td>
          <td>
            <code>pull_requests</code>
          </td>
          <td>high-write</td>
          <td>给 PR 加评论</td>
        </tr>
        <tr>
          <td>
            <code>create_branch</code>
          </td>
          <td>
            <code>contents</code>
          </td>
          <td>high-write</td>
          <td>从 SHA 或默认分支建分支</td>
        </tr>
        <tr>
          <td>
            <code>create_pull_request</code>
          </td>
          <td>
            <code>pull_requests</code>
          </td>
          <td>high-write</td>
          <td>创建 PR</td>
        </tr>
        <tr>
          <td>
            <code>upsert_file</code>
          </td>
          <td>
            <code>contents</code>
          </td>
          <td>high-write</td>
          <td>创建或更新仓库文件</td>
        </tr>
      </tbody>
    </table>
    <p>
      写操作另有一道 adapter 私有闸门 <code>requireWrite</code>：要求账号配置里
      <code>allowWrites === true</code>，否则报 <code>CAPABILITY_DISABLED</code>（
      <code>:436-442</code>）。
      <strong>只有 GitHub 有这个账号级写开关</strong>，Google / Notion / Obsidian 都没有。 另外{' '}
      <code>invokeTool</code> 接受一个未暴露的别名 <code>status</code>（等同 <code>get_status</code>
      ）。
    </p>

    <h3 id="runtime-google">3.2 Google Workspace</h3>
    <p>
      <code>google-runtime.adapter.ts</code>，16 个工具，覆盖 Gmail 与 Calendar：
    </p>
    <table>
      <thead>
        <tr>
          <th>能力</th>
          <th>默认</th>
          <th>工具</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>gmail_read</code> → Gmail 读取
          </td>
          <td>开</td>
          <td>
            <code>gmail_search_messages</code>、<code>gmail_get_message</code>、
            <code>gmail_get_thread</code>、<code>gmail_get_attachment</code>、
            <code>gmail_list_labels</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>gmail_write</code> → Gmail 写入
          </td>
          <td>关</td>
          <td>
            <code>gmail_create_draft</code>、<code>gmail_update_draft</code>
            （low-write，不触发确认）
          </td>
        </tr>
        <tr>
          <td>
            <code>gmail_send</code> → Gmail 发送
          </td>
          <td>关</td>
          <td>
            <code>gmail_send_draft</code>（high-write，需确认）
          </td>
        </tr>
        <tr>
          <td>
            <code>gmail_manage</code> → Gmail 标签管理
          </td>
          <td>关</td>
          <td>
            <code>gmail_modify_labels</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>calendar_read</code> → 日历读取
          </td>
          <td>开</td>
          <td>
            <code>calendar_list_calendars</code>、<code>calendar_list_events</code>、
            <code>calendar_get_event</code>、<code>calendar_query_freebusy</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>calendar_write</code> → 日历写入
          </td>
          <td>关</td>
          <td>
            <code>calendar_create_event</code>、<code>calendar_update_event</code>、
            <code>calendar_cancel_event</code>（destructive）
          </td>
        </tr>
      </tbody>
    </table>

    <h3 id="runtime-notion">3.3 Notion</h3>
    <p>
      <code>notion-runtime.adapter.ts</code>，8 个工具。读取能力 <code>notion_read</code>
      →读取默认开； 写入能力 <code>notion_write</code>→写入默认关。工具：
      <code>search</code>、<code>get_page</code>、<code>get_block_children</code>、
      <code>query_data_source</code>、<code>create_page</code>、<code>update_page</code>、
      <code>append_block_children</code>、<code>archive_page</code>。
    </p>
    <p>
      两点容易误解：<code>query_data_source</code> 用的是新版 data source 概念，不是旧版 database；
      <code>archive_page</code> 是归档，<strong>运行时不提供永久删除</strong>（<code>:177-179</code>
      ）。
    </p>

    <h3 id="runtime-obsidian">3.4 Obsidian Vault</h3>
    <p>
      <code>obsidian-runtime.adapter.ts</code>，8 个工具，直接操作本地 Vault 目录，不走网络。
      读取能力 <code>vault_read</code>→读取笔记默认开；写入能力 <code>vault_write</code>
      →编辑笔记默认关。 工具：<code>list_vaults</code>、<code>search_notes</code>、
      <code>get_backlinks</code>、<code>get_note</code>、<code>create_note</code>、
      <code>update_note</code>、<code>move_note</code>、<code>trash_note</code>。
    </p>
    <p>沙箱约束比较硬，值得单独记：</p>
    <ul>
      <li>
        路径逃逸或访问隐藏目录 → <code>RESOURCE_OUT_OF_SCOPE</code>（<code>:344-363</code>）。
      </li>
      <li>
        符号链接逃逸同样被拦（<code>:371-391</code>）。
      </li>
      <li>
        单文件上限 <strong>2 MiB</strong>（<code>:17</code>、<code>:409-414</code>）。
      </li>
      <li>
        写盘是原子写 + <code>0600</code> 权限（<code>:419-436</code>）。
      </li>
      <li>
        <code>update_note</code> 用 <code>expectedHash</code> 做乐观锁，hash 不匹配报{' '}
        <code>CONFLICT</code>；<code>create_note</code> 目标已存在也报 <code>CONFLICT</code>（
        <code>:254-273</code>）。
      </li>
      <li>
        <code>trash_note</code> 只是移到 <code>.trash/Spark</code>，<strong>不做永久删除</strong>（
        <code>:299-306</code>）。
      </li>
    </ul>
    <p>
      另外 <code>search_notes</code> 最多返回 100 条（<code>:207</code>）；
      <code>invokeTool</code> 还接受 <code>list_files</code>、<code>search</code>、
      <code>read_note</code>
      三个别名，但它们不出现在工具列表里。
    </p>

    <h2 id="accounts">4. 连接账号</h2>
    <p>
      运行时本身不等于可用：必须连上至少一个账号，Agent 才会拿到它的工具。 卡片上的入口按钮文案是{' '}
      <code>连接账号</code>（已有账号时变成 <code>账号设置</code>，<code>:204</code>）。
    </p>

    <h3 id="auth-methods">4.1 各运行时的认证方式与凭据字段</h3>
    <table>
      <thead>
        <tr>
          <th>运行时</th>
          <th>
            声明的 <code>authMethods</code>
          </th>
          <th>界面实际走哪条</th>
          <th>凭据字段名</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>github</code>
          </td>
          <td>
            <code>['pat', 'device-code', 'github-app']</code>
          </td>
          <td>
            只有 <code>pat</code>
          </td>
          <td>
            <code>token</code>（输入框标签 <code>Fine-grained PAT</code>，placeholder{' '}
            <code>github_pat_…</code>）
          </td>
        </tr>
        <tr>
          <td>
            <code>google</code>
          </td>
          <td>
            <code>['oauth2']</code>
          </td>
          <td>
            <code>oauth2</code>
          </td>
          <td>
            <code>accessToken</code>、<code>refreshToken</code>、<code>expiresAt</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>notion</code>
          </td>
          <td>
            <code>['oauth2', 'api-key']</code>
          </td>
          <td>两条都能走（界面有「OAuth 授权 / 手动令牌」切换）</td>
          <td>
            <code>token</code> 或 <code>accessToken</code>、<code>expiresAt</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>obsidian</code>
          </td>
          <td>
            <code>['none']</code>
          </td>
          <td>
            <code>none</code>（选目录，不填令牌）
          </td>
          <td>
            无；配置项是 <code>config.vaultPath</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      <strong>
        <code>device-code</code> 与 <code>github-app</code> 只是声明，没有实现。
      </strong>
      这两个值在全仓库只出现在协议枚举与 <code>github-runtime.adapter.ts:28</code>，
      没有设备码轮询、也没有 App JWT / installation token 的代码。别把它们当成可选项。
    </p>
    <p>
      界面按运行时分支构造请求（<code>PluginMarketplaceView.tsx:261-290</code>）： obsidian →{' '}
      <code>authMethod: 'none'</code> + <code>config.vaultPath</code>； github → <code>'pat'</code>{' '}
      + <code>secrets.token</code>； notion → <code>'api-key'</code> + <code>secrets.token</code>；
      其余 → <code>'oauth2'</code> + <code>secrets.accessToken</code>。
      密钥字段有两道服务端约束：最多 32 个字段、字段名 ≤120 字符、值 ≤16,000 字符； 且{' '}
      <code>config</code> 里出现疑似密钥的键名会被直接拒绝，报
      <code>Secret-like field must be sent through secrets</code>（
      <code>runtime-broker.ts:618-661, 694-698</code>）。
    </p>

    <h3 id="credential-storage">4.2 凭据存在哪里</h3>
    <p>
      凭据<strong>只进系统 keystore，不进 SQLite</strong>。整包
      <code>StoredCredentialBundle</code>（<code>accessToken</code> / <code>refreshToken</code> /
      <code>tokenType</code> / <code>expiresAt</code> / <code>clientId</code> / <code>scopes</code>
      ） 序列化后写入 keystore（<code>token-service.ts:10-46</code>）； 迁移脚本的注释写得很直白：
      <em>Secrets remain in the OS keystore; SQLite stores only credential_ref.</em>（
      <code>069_plugin_runtime_accounts.sql:1-2</code>）。
    </p>
    <ul>
      <li>
        表里只有一列引用：<code>connector_accounts.credential_ref</code>。
      </li>
      <li>
        ref 的形状是{' '}
        <code>plugin-runtime-&lt;pluginId&gt;-&lt;runtimeId&gt;-&lt;base64url(账号id)&gt;</code>，
        例如 <code>plugin-runtime-spark.github-github-…</code>（<code>token-service.ts:36-39</code>
        ）。
      </li>
      <li>
        断开账号会连带删除 keystore 里的 secret（<code>runtime-broker.ts:178</code>）。
      </li>
      <li>
        刷新令牌是并发单飞的：同一 ref 的并发刷新只真正执行一次并复用同一个 Promise （
        <code>token-service.ts:112-128</code>）。触发条件是 <code>expiresAt</code> 距今不足
        <strong>30 秒</strong>（<code>:90-93</code>）。
      </li>
      <li>
        高风险工具的确认令牌只存在<strong>进程内存</strong>（<code>runtime-broker.ts:49</code>
        ），不持久化， 默认 TTL 60 秒并裁剪到 <code>[1 秒, 5 分钟]</code>；且
        <strong>用掉即失效</strong>， 重复使用同一 token 会再次报 <code>CONFIRMATION_REQUIRED</code>
        （<code>:327-338, 550-564</code>）。
      </li>
    </ul>

    <h3 id="oauth-flow">4.3 OAuth 授权流程</h3>
    <p>
      点「打开授权页」后走的是标准 <strong>Authorization Code + PKCE</strong>， 实现集中在{' '}
      <code>services/plugin-runtime/oauth-broker.ts</code>：
    </p>
    <ol>
      <li>
        生成随机 <code>state</code>（24 字节）与 <code>verifier</code>（48 字节），
        <code>challenge = sha256(verifier)</code>；授权 URL 带<code>response_type=code</code>、
        <code>client_id</code>、<code>redirect_uri</code>、<code>scope</code>、<code>state</code>、
        <code>code_challenge</code>、<code>code_challenge_method=S256</code>（<code>:24-39</code>
        ）。
      </li>
      <li>
        回调服务器只监听 <code>127.0.0.1:&lt;随机端口&gt;</code>，默认路径{' '}
        <code>/oauth/callback</code>， 超时 5 分钟，回调只能被消费一次；<code>state</code>{' '}
        校验失败报
        <code>OAuth state validation failed</code>（<code>:43-44, 124-186</code>）。
      </li>
      <li>
        用 <code>grant_type=authorization_code</code> + <code>code_verifier</code> 换令牌，
        表单编码、30 秒超时（<code>:51-65, 80-91</code>）。
      </li>
      <li>
        浏览器由宿主打开：桌面端调 <code>shell.openExternal(url)</code>， 拿到令牌后以{' '}
        <code>authMethod: 'oauth2'</code> 调 <code>runtime.connect(...)</code>（
        <code>registerPluginRuntimeIpc.ts:84, 96-108</code>）。
      </li>
    </ol>
    <p>
      Google 会额外带 <code>extraAuthorizationParams: &#123; access_type: 'offline' &#125;</code>
      以便拿到 refresh token（<code>PluginMarketplaceView.tsx:618-620</code>）。 刷新时如果 provider
      没有回新的 refresh token，<strong>会保留旧值</strong>而不是清空 （
      <code>oauth-broker.ts:67-78</code>）。
    </p>

    <h3 id="account-status">4.4 账号状态与断开</h3>
    <p>账号状态枚举（协议里六个）与界面文案的对应关系：</p>
    <table>
      <thead>
        <tr>
          <th>状态值</th>
          <th>界面文案</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>connected</code> 且 <code>enabled</code>
          </td>
          <td>
            <code>Agent 可用</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>needs_auth</code>
          </td>
          <td>
            <code>需要重新授权</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>syncing</code>
          </td>
          <td>
            <code>同步中</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>disabled</code> 或 <code>enabled=false</code>
          </td>
          <td>
            <code>已停用</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>error</code>
          </td>
          <td>
            <code>连接异常</code>
          </td>
        </tr>
        <tr>
          <td>
            其他（含 <code>not_configured</code>）
          </td>
          <td>
            <code>尚未连接</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      这些文案来自 <code>PluginMarketplaceView.tsx:252-259</code>。 连接成功提示{' '}
      <code>{'{运行时名} 已连接 {账号名}'}</code>； 断开按钮<strong>没有二次确认弹窗</strong>
      ，点一下就直接断开并提示
      <code>{'已断开 {账号名}'}</code>（<code>:649-659</code>）。
    </p>

    <h2 id="capabilities">5. 能力开关</h2>
    <p>
      账号级能力开关在「账号设置」弹窗底部的<strong>「默认能力」</strong>小节 （
      <code>PluginMarketplaceView.tsx:432-453</code>）。每个能力显示中文 <code>label</code>，
      鼠标悬停显示 <code>description</code>；<strong>账号还没连上时所有按钮都是禁用的</strong>。
      点击后调 <code>plugin-runtime:accounts:update</code>，只提交 <code>enabledCapabilities</code>
      一个字段（<code>:663-681</code>）；失败提示 <code>能力开关更新失败</code>。
    </p>
    <p>
      能力关闭的后果是<strong>双重的</strong>，这点必须理解清楚：
    </p>
    <ul>
      <li>
        <strong>工具直接不出现。</strong>工具目录会要求「至少有一个已连接账号满足该工具的全部
        requiredCapabilities」，不满足就整条不进目录（<code>runtime-broker.ts:248-275</code>）。
      </li>
      <li>
        <strong>即使硬调也会被拒。</strong>调用路径上逐个 requiredCapability 校验， 不通过报{' '}
        <code>CAPABILITY_DISABLED</code>（<code>runtime-policy.ts:42-64</code>）。
      </li>
    </ul>
    <p>
      能力校验一共三层：① 该能力必须在<strong>账号的</strong> <code>enabledCapabilities</code> 里；
      ② 该能力必须存在于<strong>运行时的</strong> <code>descriptor.capabilities</code> 里； ③ 能力的{' '}
      <code>requiredScopes</code> 必须是账号 <code>grantedScopes</code> 的子集， 否则报{' '}
      <code>SCOPE_REQUIRED</code>。第 ③ 条解释了为什么 OAuth 授权时没勾的 scope，
      事后怎么开能力开关都没用——得重新授权。
    </p>
    <p>界面上的两个已知限制，避免你误判成 bug：</p>
    <ul>
      <li>
        <strong>能力开关只作用于第一个账号。</strong>代码取的是 <code>accounts[0]</code>（
        <code>:436</code>），而四个内置运行时的 <code>accountMode</code> 都是 <code>multiple</code>
        。 连了多个 GitHub 账号时，这个开关只反映和修改第一个账号的能力。
      </li>
      <li>
        <strong>连接时的初始能力不由你选。</strong>首次连接提交的是各能力自己的
        <code>enabledByDefault</code>（<code>:279-282, 603-605</code>），
        因为此时开关按钮还是禁用状态。想改只能连上之后再点。
      </li>
    </ul>

    <h2 id="plugin-manifest">6. plugin.json：连接器的清单契约</h2>
    <p>
      一个可安装的「连接器包」就是一个含 <code>plugin.json</code> 的目录。 清单的权威定义
      <strong>
        只在 <code>packages/protocol/src/plugin.ts</code>
      </strong>
      （<code>PluginManifestSchema</code>，<code>:135-225</code>）——
      <code>packages/plugin-sdk</code> 里没有清单类型或解析器，它只提供
      <code>defineTool</code> / <code>defineConnectorRuntime</code> 之类的编写辅助。 协议版本常量是{' '}
      <code>PLUGIN_PROTOCOL_VERSION = 2</code>，接受 <code>[1, 2]</code> 两版 （<code>:18-19</code>
      ）。
    </p>

    <h3 id="manifest-fields">6.1 清单字段</h3>
    <table>
      <thead>
        <tr>
          <th>字段</th>
          <th>约束</th>
          <th>必填</th>
          <th>默认</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>schemaVersion</code>
          </td>
          <td>
            <code>1</code> 或 <code>2</code>
          </td>
          <td>是</td>
          <td>—</td>
        </tr>
        <tr>
          <td>
            <code>id</code>
          </td>
          <td>
            <code>^[a-z0-9][a-z0-9._-]{'{2,95}'}$</code>
          </td>
          <td>是</td>
          <td>—</td>
        </tr>
        <tr>
          <td>
            <code>version</code>
          </td>
          <td>
            语义化版本，可带 <code>-pre</code> / <code>+build</code>
          </td>
          <td>是</td>
          <td>—</td>
        </tr>
        <tr>
          <td>
            <code>displayName</code>
          </td>
          <td>1–160 字符</td>
          <td>是</td>
          <td>—</td>
        </tr>
        <tr>
          <td>
            <code>description</code>
          </td>
          <td>1–8000 字符</td>
          <td>是</td>
          <td>—</td>
        </tr>
        <tr>
          <td>
            <code>author</code>
          </td>
          <td>
            <code>{'{ id?, name, url? }'}</code>，<code>name</code> 必填
          </td>
          <td>是</td>
          <td>—</td>
        </tr>
        <tr>
          <td>
            <code>license</code> / <code>homepageUrl</code> / <code>repositoryUrl</code> /{' '}
            <code>icon</code>
          </td>
          <td>字符串或 URL</td>
          <td>否</td>
          <td>—</td>
        </tr>
        <tr>
          <td>
            <code>runtime</code>
          </td>
          <td>
            <code>{"{ type: 'builtin', id }"}</code>，旧式单运行时绑定
          </td>
          <td>否</td>
          <td>—</td>
        </tr>
        <tr>
          <td>
            <code>categories</code> / <code>tags</code>
          </td>
          <td>字符串数组，上限 20 / 50</td>
          <td>否</td>
          <td>
            <code>[]</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>permissions.required</code> / <code>.optional</code>
          </td>
          <td>权限名数组，各上限 32；required 不得重复</td>
          <td>否</td>
          <td>
            <code>[]</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>activation</code>
          </td>
          <td>
            <code>manual</code> / <code>on-startup</code> / <code>on-demand</code>
          </td>
          <td>否</td>
          <td>
            <code>manual</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>contributions</code>
          </td>
          <td>见 6.2</td>
          <td>否</td>
          <td>
            三个键为空数组，
            <strong>
              不含 <code>runtimes</code>
            </strong>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      有个容易踩的坑：<code>contributions</code> 的默认对象
      <strong>
        没有 <code>runtimes</code> 键
      </strong>
      （<code>plugin.ts:199</code>），所以 <code>manifest.contributions.runtimes</code> 默认是
      <code>undefined</code>，代码里到处用 <code>?? []</code> 兜底。自己写清单时建议显式写出来。
    </p>
    <p>
      还有两条跨字段校验（<code>superRefine</code>，<code>:201-225</code>）：
      <code>mcpServers[].permissions</code> 与 <code>connectors[].permissions</code>
      请求的权限，必须已经出现在 <code>permissions.required ∪ optional</code> 里， 否则分别报{' '}
      <code>MCP contribution requests undeclared permission</code> 与
      <code>Connector contribution requests undeclared permission</code>。
    </p>

    <h3 id="contributions">6.2 四类 contribution</h3>
    <p>
      清单只能贡献四类东西，没有 <code>commands</code> / <code>agents</code> / <code>hooks</code> /{' '}
      <code>tools</code>：
    </p>
    <table>
      <thead>
        <tr>
          <th>键</th>
          <th>用途</th>
          <th>上限</th>
          <th>必需字段</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>skills</code>
          </td>
          <td>随包提供的 Skill</td>
          <td>100</td>
          <td>
            <code>id</code>、<code>path</code>（包内相对路径，目录需含 <code>SKILL.md</code>）
          </td>
        </tr>
        <tr>
          <td>
            <code>mcpServers</code>
          </td>
          <td>随包提供的 MCP 服务</td>
          <td>50</td>
          <td>
            <code>id</code>、<code>name</code>、<code>config</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>connectors</code>
          </td>
          <td>连接器能力声明</td>
          <td>50</td>
          <td>
            <code>id</code>、<code>manifest</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>runtimes</code>
          </td>
          <td>连接器运行时</td>
          <td>50</td>
          <td>
            <code>id</code>、<code>kind: 'connector'</code>、<code>execution</code>、
            <code>toolNamespace</code>、<code>provider</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      <code>path</code> 用的是 <code>RelativePackagePathSchema</code>：不得超过 240 字符， 不得以{' '}
      <code>/</code> 开头、不得含 <code>\</code>、不得含 <code>..</code> 段 （<code>:41-50</code>
      ）。
    </p>
    <p>
      要特别注意 <code>contributions.connectors</code> 的<strong>实际作用很有限</strong>：
      它唯一的消费点是写一行 <code>plugin_resources</code> 记录、 外加安装前检查时的一条提示
      <em>「连接器只声明接入能力，首次使用账号前仍需单独授权。」</em>（
      <code>plugin-manager.service.ts:626-640</code>、<code>plugin-package.ts:115-117</code>）。
      真正能用的 provider 能力来自宿主代码里注册的内置 adapter。
      <strong>写一个 connector contribution 并不会自动接通任何东西。</strong>
    </p>
    <p>
      <code>execution</code> 有三种取值：<code>{"{type:'builtin', adapter}"}</code>、
      <code>{"{type:'remote-mcp', url}"}</code>、
      <code>{"{type:'worker', entrypoint, packageSha256}"}</code>。 但宿主只把 <code>builtin</code>{' '}
      当成可运行（<code>plugin-manager.service.ts:398</code>）， 另外两种的 runtime 行会写成{' '}
      <code>enabled = 0</code> 并附
      <code>unavailableReason: 'isolated-runtime-host-required'</code>（<code>:641-654</code>）。
      另外 <code>worker</code> 的 <code>packageSha256</code> 必须是 64 位 hex。
    </p>

    <h3 id="source-trust">6.3 source 与 trust</h3>
    <p>
      这两个枚举存的是不同维度，<code>source</code> 是「从哪来」，<code>trust</code> 是「信不信」：
    </p>
    <table>
      <thead>
        <tr>
          <th>
            <code>source</code>
          </th>
          <th>谁写入</th>
          <th>
            对应 <code>trust</code>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>bundled</code>
          </td>
          <td>内置清单初始化</td>
          <td>
            <code>bundled</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>local</code>
          </td>
          <td>本地目录导入</td>
          <td>
            <code>unverified</code>（硬编码，本地包不做签名校验）
          </td>
        </tr>
        <tr>
          <td>
            <code>marketplace</code>
          </td>
          <td>市场安装</td>
          <td>
            <code>verified</code>（要求签名指纹匹配）
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      <code>trust</code> 的类型里还有 <code>blocked</code>，DB 的 CHECK 也允许它， 但
      <strong>没有任何写入方</strong>——别指望靠它表达「拉黑」。同理
      <code>state</code> 枚举里的 <code>error</code> 也没有写入方； 实际只写 <code>installed</code>{' '}
      与 <code>blocked</code>，而且用户主动停用时写的仍然是
      <code>installed</code>（<code>plugin-manager.service.ts:334</code>）—— 也就是说「停用」不会把{' '}
      <code>state</code> 变成 <code>blocked</code>，看 <code>state</code>
      判断不出用户是否停用过，要看 <code>enabled</code>。
    </p>

    <h2 id="permissions">7. 权限模型</h2>
    <p>
      连接器包在安装时要申请权限。这里的模型比想象中粗：它是
      <strong>插件级的一次性授权（全有或全无），不是细粒度的运行时能力控制</strong>。
      理解这一点能省掉很多排查时间。
    </p>

    <h3 id="permission-labels">7.1 九个权限与界面标签</h3>
    <p>
      权限名是协议固定的九个（<code>packages/protocol/src/plugin.ts:21-31</code>）， 界面标签表在{' '}
      <code>PluginMarketplaceView.tsx:22-32</code>：
    </p>
    <table>
      <thead>
        <tr>
          <th>权限 id</th>
          <th>界面标签</th>
          <th>安装前检查里的风险等级</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>network</code>
          </td>
          <td>访问网络</td>
          <td>
            <code>medium</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>filesystem.read</code>
          </td>
          <td>读取本地文件</td>
          <td>
            <code>medium</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>filesystem.write</code>
          </td>
          <td>写入本地文件</td>
          <td>
            <code>high</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>process.spawn</code>
          </td>
          <td>启动本地进程</td>
          <td>
            <code>critical</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>secrets.read</code>
          </td>
          <td>读取凭据</td>
          <td>
            <code>critical</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>clipboard</code>
          </td>
          <td>访问剪贴板</td>
          <td>
            <code>low</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>browser</code>
          </td>
          <td>控制浏览器</td>
          <td>
            <code>high</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>mcp.connect</code>
          </td>
          <td>连接 MCP 服务</td>
          <td>
            <code>high</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>connector.account</code>
          </td>
          <td>访问连接器账户</td>
          <td>
            <code>high</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      风险映射在 <code>plugin-package.ts:93-103</code>；遇到清单里未登记的权限名会
      <strong>
        回落成
        <code>high</code>
      </strong>
      （<code>:111</code>），这个回落只影响展示颜色，不影响判定。 每个权限的持久化状态只有三种：
      <code>granted</code> / <code>denied</code> / <code>pending</code>
      （表 <code>plugin_permissions</code>，DB CHECK 同集合）。
    </p>

    <h3 id="permission-enforcement">7.2 权限实际被强制到什么程度</h3>
    <p>
      只有<strong>一个聚合闸门</strong>是真正在执行期生效的： 「<code>permissions.required</code>{' '}
      是否全部 granted」。它影响三处：
    </p>
    <ol>
      <li>
        <strong>安装与启用。</strong>以 <code>enable=true</code> 安装、或启用时若 required
        没授权齐， 直接抛 <code>PluginPermissionError</code>，消息形如
        <code>Plugin requires explicit permission: &lt;ids&gt;</code>（
        <code>plugin-manager.service.ts:326-333, 488-492</code>）。
      </li>
      <li>
        <strong>资源开关。</strong>所有贡献资源的 <code>enabled</code> 都会乘上这个判定； MCP 与
        connector contribution 还额外要求它<strong>自己声明的</strong>
        <code>permissions</code> 数组全部 granted（<code>:596-597, 628-629</code>）。
      </li>
      <li>
        <strong>运行时可用性。</strong>
        <code>isRuntimeEnabled(runtimeId)</code> 的定义是
        <code>enabled === true &amp;&amp; state === 'installed' &amp;&amp; permissionsReady</code>（
        <code>:408-411</code>），而所有连接器调用都要过这一关，不通过报
        <code>PLUGIN_DISABLED</code>。
      </li>
    </ol>
    <p>
      反过来说，<strong>没有任何一处代码在「要执行某个动作」时去检查对应的权限</strong>。 对{' '}
      <code>process.spawn</code>、<code>filesystem.write</code>、<code>clipboard</code>、
      <code>browser</code>、<code>network</code>、<code>secrets.read</code>、
      <code>mcp.connect</code>
      这七个名字做全仓检索，除了协议定义、风险映射表、内置清单和界面标签表之外
      <strong>没有消费者</strong>：不存在「检查了 <code>process.spawn</code> 才允许起进程」的代码。
      甚至启用插件里的 MCP 服务时，看的也只是那个 MCP contribution 自己声明的
      <code>permissions</code>，而不是 <code>mcp.connect</code>。
    </p>
    <p>
      所以准确的口径是：<strong>权限是给用户在安装前看的风险清单 + 一个聚合开关</strong>，
      不是操作系统级的沙箱。真正细粒度的控制发生在运行时能力层（§5）与
      工具包/自定义工具的权限层，那是另一套机制。
    </p>
    <p>
      顺带一个界面缺口：主进程注册了 <code>plugin:set-permission</code> 通道， 但
      <strong>整个渲染进程没有任何调用点</strong>。也就是说界面上只能看到
      <code>待授权：…</code> 与 <code>权限 N/M</code>，<strong>无法逐项授予或拒绝权限</strong>——
      安装时是全量批准 required 列表（<code>PluginMarketplaceView.tsx:750-757</code>）。 另有{' '}
      <code>plugin-marketplace:update</code> 同样只有主进程 handler、界面无入口，
      所以市场源也只能靠预置配置，见 §8.2。
    </p>

    <h2 id="install">8. 安装、启用与卸载</h2>

    <h3 id="install-local">8.1 本地目录导入</h3>
    <ol>
      <li>
        点页头（或空态里）的 <code>导入本地连接器</code>。
      </li>
      <li>
        弹出系统目录选择器，标题 <code>选择连接器目录</code>；取消则直接返回。
      </li>
      <li>
        调 <code>plugin:inspect-local</code> 做预检，成功后弹出<strong>「安装前检查」</strong>弹窗：
        显示插件名与版本、描述、<code>作者</code>、<code>内容</code>（
        <code>N 个文件 · SHA-256 …</code>）、
        <strong>必需权限</strong>标签列表，以及预检告警。
      </li>
      <li>
        点 <code>授权并安装</code>，调 <code>plugin:install-local</code>， 载荷里的{' '}
        <code>approvedPermissions</code> 是<strong>必需权限的全量</strong>
        （没有逐项勾选 UI），<code>enable: true</code>。
      </li>
      <li>
        成功提示 <code>连接器已安装并启用</code>。
      </li>
    </ol>
    <p>
      预检本身做得比较严（<code>plugin-package.ts:69-120</code>），失败信息也直接可读：
    </p>
    <table>
      <thead>
        <tr>
          <th>检查项</th>
          <th>限制 / 报错</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>必须是目录</td>
          <td>
            <code>Plugin source must be a directory</code>
          </td>
        </tr>
        <tr>
          <td>
            根目录必须有 <code>plugin.json</code>
          </td>
          <td>
            <code>Plugin package is missing plugin.json</code>
          </td>
        </tr>
        <tr>
          <td>文件数上限</td>
          <td>20,000 个</td>
        </tr>
        <tr>
          <td>包体积上限</td>
          <td>250 MiB</td>
        </tr>
        <tr>
          <td>符号链接</td>
          <td>直接拒绝</td>
        </tr>
        <tr>
          <td>路径逃逸</td>
          <td>直接拒绝</td>
        </tr>
        <tr>
          <td>
            Skill 的 <code>path</code>
          </td>
          <td>
            必须在包内且含 <code>SKILL.md</code>
          </td>
        </tr>
        <tr>
          <td>源目录位置</td>
          <td>
            不能位于受管插件目录内：
            <code>Plugin source must be outside the managed plugin directory</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      安装会做<strong>原子替换</strong>：先复制到 <code>.&lt;id&gt;.&lt;uuid&gt;.staging</code>，
      把旧目录备份成 <code>.&lt;id&gt;.&lt;uuid&gt;.backup</code>，再 <code>rename</code> 上位；
      出错时回滚备份（<code>plugin-package.ts:126-155</code>）。 受管目录在桌面端是{' '}
      <code>{'&lt;userData&gt;/plugins'}</code>（<code>registerPluginIpc.ts:17</code>），临时目录是{' '}
      <code>&lt;系统临时目录&gt;/spark-plugin-installs</code>。
    </p>
    <p>
      <strong>「升级」就是重新安装同一个 id</strong>：DB 走 <code>upsert</code> 覆盖， 但不改{' '}
      <code>installed_at</code>。没有 update / upgrade / 回滚方法，
      也没有自动检查更新——只改版本号不会被识别为升级，必须重新导入一次。
    </p>

    <h3 id="install-marketplace">8.2 市场安装（默认不可用）</h3>
    <p>
      市场相关代码是完整的：能列出市场源、搜索（<code>plugin-marketplace:search</code>，默认
      <code>limit: 24</code>）、下载 zip 校验 <code>sha256</code>、 用系统 <code>tar</code>{' '}
      解包并校验每个条目路径、要求包内<strong>恰好一个</strong>
      <code>plugin.json</code>、校验清单 <code>id</code>/<code>version</code> 与市场条目一致。
      安装要求市场条目的 <code>trust === 'verified'</code>，否则报
      <code>Marketplace plugin is not signed by a trusted registry key</code>。
    </p>
    <p>
      <strong>但默认状态下一个市场源都不可用：</strong>
    </p>
    <ul>
      <li>
        迁移脚本种下的唯一注册表 <code>spark-official</code>（名称「Spark 官方插件市场」）
        指向占位地址 <code>https://plugins.spark-agent.com/v1</code>， 并且被{' '}
        <code>071_disable_placeholder_plugin_marketplace.sql</code>
        在满足「地址与指纹都是占位值」时
        <strong>
          主动置为 <code>enabled = 0</code>
        </strong>
        。 脚本注释写明：<em>不是已部署的服务，保留该行供将来显式配置，但不要把它呈现为可用。</em>
      </li>
      <li>
        即便启用，<code>configured</code> 还要求 <code>trustedKeyFingerprints</code> 非空 （
        <code>plugin-manager.service.ts:42</code>），而种子行的指纹是 <code>[]</code>。
      </li>
      <li>
        只有 <code>configured</code> 的市场源才会真正发请求（<code>:439-443</code>）。
      </li>
    </ul>
    <p>
      结论：<strong>出厂状态下无法搜索或安装任何市场连接器，界面也不显示市场区块</strong>（§2）。
      要真正用市场，得先有可用的市场源并配置 API 地址与签名指纹—— 而配置用的{' '}
      <code>plugin-marketplace:update</code> 通道<strong>界面里没有入口</strong>（§7.2），
      目前只能走代码或数据库预置。
    </p>

    <h3 id="enable-uninstall">8.3 启用、停用与卸载</h3>
    <ul>
      <li>
        <strong>启用 / 停用</strong>用卡片上的开关。启用时若 required 权限没授齐会直接报错；
        停用会把该插件的所有贡献资源 <code>enabled</code> 置 0， 于是它的
        Skill、MCP、运行时工具全部从 Agent 侧消失。 停用<strong>不会删除</strong>任何配置或凭据。
      </li>
      <li>
        <strong>卸载</strong>按钮的 <code>title</code> 是 <code>移除非内置连接器</code>，
        只有组里存在非内置成员时才渲染。确认弹窗文案： 多个非内置时是{' '}
        <code>将移除该名称下的 N 个非内置连接器；内置运行时会保留。</code>， 单个时是{' '}
        <code>移除非内置连接器后，它提供的 Skill、MCP 和账号配置将不再可用。</code>
      </li>
      <li>
        <strong>
          内置的四个（<code>spark.github</code> 等）不能卸载，只能停用。
        </strong>
        后端硬拦截，报 <code>内置能力包不能移除，只能停用</code>；
        界面上纯内置插件根本不显示卸载按钮，所以这条错误在正常操作下碰不到。
      </li>
    </ul>
    <p>
      卸载实际做了四件事（<code>plugin-manager.service.ts:360-378</code>）：
    </p>
    <ol>
      <li>逐个删除该插件所有账号在 keystore 里的 secret。</li>
      <li>删除它贡献的 Skill 行与 MCP 行。</li>
      <li>
        硬删除 <code>plugins</code> 行；<code>plugin_permissions</code>、
        <code>plugin_resources</code>、<code>connector_accounts</code> 靠{' '}
        <code>ON DELETE CASCADE</code> 连带清掉。
      </li>
      <li>递归删除磁盘上的安装目录。</li>
    </ol>
    <p>
      注意第 2 步只覆盖 <code>skill</code> 与 <code>mcp-server</code> 两类资源；
      <code>connector</code> 与 <code>runtime</code> 资源<strong>没有额外的清理动作</strong>
      （它们的凭据在第 1 步已经被删了）。
    </p>
    <p>
      另外安装时有个不对称行为：<strong>清单未声明的权限会被静默丢弃</strong>，
      因为写权限行时只遍历清单声明过的 required ∪ optional （<code>:513-524</code>）。传了多余的
      approved 权限不会报错，但也不会写进库。
    </p>

    <h2 id="agent-tools">9. 运行时的工具如何进入 Agent</h2>
    <p>
      连接器工具不是直接塞进系统提示词的，而是通过一个按会话/按轮次建立的本地 MCP 桥接：
      <code>PluginRuntimeMcpBridge</code> 起一个
      <code>StreamableHTTPServerTransport</code>，监听
      <code>127.0.0.1:&lt;随机端口&gt;</code> 的 <code>/mcp</code> 路径， MCP server 名是{' '}
      <code>spark_plugins</code>、版本 <code>2.0.0</code>。
    </p>
    <p>命名规则要记牢，它是你排查「工具没出现」的第一把钥匙：</p>
    <pre>{`qualifiedName = <runtime.toolNamespace>_<tool.name>
              ↓
注入到 Agent 工具面的名字 = mcp__spark_plugins__<qualifiedName>

例：github runtime 的 read_file
  → qualifiedName  github_read_file
  → Agent 看到的   mcp__spark_plugins__github_read_file

对比：平台管理 MCP 的 GitHub 工具是另一套命名
  → mcp__spark_platform__github_read_repository_file`}</pre>
    <p>工具要出现在 Agent 面前，必须同时满足：</p>
    <ol>
      <li>
        该运行时对应的插件已<strong>启用</strong>且 required 权限齐备。
      </li>
      <li>
        该运行时<strong>至少有一个已连接账号</strong>；没有账号的运行时整条跳过。
      </li>
      <li>
        工具的每个 <code>requiredCapability</code> 都被某个已连接账号满足。
      </li>
      <li>桥接能收集到至少一个工具定义，否则直接不启动 server（会话侧拿不到）。</li>
    </ol>
    <p>桥接还有几条运行时约束，出问题时对照着看：</p>
    <table>
      <thead>
        <tr>
          <th>约束</th>
          <th>表现</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>轮次结束</td>
          <td>
            调用返回 <code>Plugin MCP turn is no longer active</code>
          </td>
        </tr>
        <tr>
          <td>同一租约重复占用</td>
          <td>直接抛错；工具指纹相同则复用会话，不同则关掉旧会话</td>
        </tr>
        <tr>
          <td>结果过大</td>
          <td>
            超过 2 MiB 截断并追加 <code>[truncated by Spark runtime]</code>
          </td>
        </tr>
        <tr>
          <td>参数不是对象</td>
          <td>
            <code>Runtime tool arguments must be an object</code>
          </td>
        </tr>
        <tr>
          <td>HTTP 鉴权</td>
          <td>
            需要 <code>Authorization: Bearer &lt;会话令牌&gt;</code>，未知令牌返回 401
          </td>
        </tr>
        <tr>
          <td>高风险工具</td>
          <td>
            输入 schema 会额外注入 <code>accountId</code> 与 <code>confirmationToken</code>{' '}
            两个字段，调用时被剥离后转发给 broker
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      最后一条值得展开：<code>read</code> 与 <code>low-write</code> 风险的工具会被放进
      「引擎预批准」列表，模型可直接调用；而 <code>high-write</code> 与 <code>destructive</code>
      <strong>必须带一个有效的 confirmation token</strong>，否则报
      <code>CONFIRMATION_REQUIRED</code>（<code>runtime-policy.ts:81-93</code>）。
      连接器工具与自定义工具在这点上策略不同：连接器条目<strong>一律</strong>进预批准列表，
      自定义工具/工具包则只有 <code>risk === 'read'</code> 才进。
    </p>
    <p>
      工具调用会写审计：表 <code>plugin_runtime_audit</code>，字段含
      <code>plugin_id</code> / <code>runtime_id</code> / <code>account_id</code> /
      <code>tool_name</code> / <code>risk</code> / <code>effect</code> /<code>outcome</code>(
      <code>success|error|denied</code>) / <code>duration_ms</code> /<code>error_code</code>
      。但要知道两个当前事实：
      <code>resource_ids_json</code> 实际
      <strong>
        恒为 <code>[]</code>
      </strong>
      （写入方从不传这个值）， 并且这张表<strong>只有写入没有查询接口</strong>
      ——界面上没有审计查看页。
    </p>

    <h2 id="github-two-ways">10. GitHub 的两套实现</h2>
    <p>
      GitHub 是唯一一个<strong>在代码里被实现了两遍</strong>的 provider，
      而且两遍的工具名、能力名、存储表、鉴权方式都不一样。写文档或排查问题时
      必须先确定你说的是哪一套，否则会出现「工具名对得上、表对不上」的错误。
    </p>
    <table>
      <thead>
        <tr>
          <th>维度</th>
          <th>插件运行时那套</th>
          <th>平台管理 MCP 那套</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>实现文件</td>
          <td>
            <code>services/plugin-runtime/adapters/github-runtime.adapter.ts</code>
          </td>
          <td>
            <code>services/github-connector.service.ts</code>
          </td>
        </tr>
        <tr>
          <td>Agent 侧工具名</td>
          <td>
            <code>mcp__spark_plugins__github_*</code>
          </td>
          <td>
            <code>mcp__spark_platform__github_*</code>
          </td>
        </tr>
        <tr>
          <td>工具名样式</td>
          <td>
            <code>get_status</code>、<code>read_file</code>、<code>upsert_file</code>
          </td>
          <td>
            <code>github_status</code>、<code>github_read_repository_file</code>、
            <code>github_upsert_repository_file</code>
          </td>
        </tr>
        <tr>
          <td>工具数</td>
          <td>15</td>
          <td>15</td>
        </tr>
        <tr>
          <td>存储表</td>
          <td>
            <code>connector_accounts</code>（多账号，键含 <code>plugin_id</code>/
            <code>runtime_id</code>）
          </td>
          <td>
            <code>connector_connections</code>（<strong>单连接</strong>，<code>provider</code>{' '}
            上有唯一索引）
          </td>
        </tr>
        <tr>
          <td>连接 id</td>
          <td>按账号生成</td>
          <td>
            固定 <code>github-primary</code>
          </td>
        </tr>
        <tr>
          <td>能力 id</td>
          <td>
            <code>identity</code>/<code>repositories</code>/<code>contents</code>/
            <code>issues</code>/<code>pull_requests</code>
          </td>
          <td>
            <code>identity</code>/<code>repositories</code>/<code>issues</code>/
            <code>pull_requests</code>/<code>mcp_tools</code>
          </td>
        </tr>
        <tr>
          <td>鉴权</td>
          <td>
            声明 <code>pat</code>/<code>device-code</code>/<code>github-app</code>，实际只有{' '}
            <code>pat</code>
          </td>
          <td>
            只有 <code>pat</code>
          </td>
        </tr>
        <tr>
          <td>写入门控</td>
          <td>
            <code>allowWrites</code> + 风险分级（<code>high-write</code> 需确认令牌）
          </td>
          <td>
            只有布尔 <code>allowWrites</code>，无风险分级、无确认令牌
          </td>
        </tr>
        <tr>
          <td>界面可达</td>
          <td>
            <strong>可达</strong>（扩展中心 → 连接器 → GitHub）
          </td>
          <td>
            <strong>不可达</strong>，见 §10.3
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      换句话说：<strong>你在界面上能连的 GitHub，是插件运行时那套</strong>， 它给 Agent 的是{' '}
      <code>mcp__spark_plugins__github_*</code> 工具。 而 <a href="/docs/builtin-tools">内置工具</a>{' '}
      页里列的「GitHub 15 个工具」 指的是平台管理 MCP 那套{' '}
      <code>mcp__spark_platform__github_*</code>。 两套都是 15 个，数量相同纯属巧合，别互相印证。
    </p>

    <h3 id="github-platform-tools">10.1 平台管理 MCP 的 15 个 github_* 工具</h3>
    <p>
      工具 schema 定义在 <code>platform-management-mcp-server.mjs:1926-2146</code>， handler 在{' '}
      <code>platform-bridge.service.ts:2066-2262</code>。 工具列表是<strong>静态返回</strong>
      的，不会因为没连接就连工具都看不到—— 未连接时会调用失败并返回错误文本。
    </p>
    <table>
      <thead>
        <tr>
          <th>工具</th>
          <th>必填参数</th>
          <th>可选参数</th>
          <th>实际打的端点</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>github_status</code>
          </td>
          <td>—</td>
          <td>—</td>
          <td>
            <strong>不发请求</strong>，只读本地状态
          </td>
        </tr>
        <tr>
          <td>
            <code>github_list_repositories</code>
          </td>
          <td>—</td>
          <td>
            <code>query</code>
          </td>
          <td>
            白名单非空时逐个 <code>GET repos/&#123;owner&#125;/&#123;repo&#125;</code>；为空时{' '}
            <code>
              GET
              user/repos?per_page=100&amp;sort=updated&amp;affiliation=owner,collaborator,organization_member
            </code>
          </td>
        </tr>
        <tr>
          <td>
            <code>github_get_repository</code>
          </td>
          <td>
            <code>owner</code>、<code>repo</code>
          </td>
          <td>—</td>
          <td>
            <code>GET repos/&#123;owner&#125;/&#123;repo&#125;</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>github_read_repository_file</code>
          </td>
          <td>
            <code>owner</code>、<code>repo</code>、<code>path</code>
          </td>
          <td>
            <code>ref</code>
          </td>
          <td>
            <code>GET repos/&#123;owner&#125;/&#123;repo&#125;/contents/&#123;path&#125;</code>（
            <code>path</code> 逐段 URL 编码）
          </td>
        </tr>
        <tr>
          <td>
            <code>github_create_branch</code>
          </td>
          <td>
            <code>owner</code>、<code>repo</code>、<code>branch</code>
          </td>
          <td>
            <code>sourceBranch</code>、<code>sourceSha</code>
          </td>
          <td>
            先 <code>GET repos/&#123;owner&#125;/&#123;repo&#125;</code> 取默认分支，再{' '}
            <code>GET .../git/ref/heads/&#123;sourceBranch&#125;</code>，最后{' '}
            <code>POST .../git/refs</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>github_upsert_repository_file</code>
          </td>
          <td>
            <code>owner</code>、<code>repo</code>、<code>path</code>、<code>content</code>、
            <code>message</code>
          </td>
          <td>
            <code>branch</code>、<code>sha</code>
          </td>
          <td>
            <code>PUT repos/&#123;owner&#125;/&#123;repo&#125;/contents/&#123;path&#125;</code>
            （内容按 UTF-8 再 base64）
          </td>
        </tr>
        <tr>
          <td>
            <code>github_list_issues</code>
          </td>
          <td>
            <code>owner</code>、<code>repo</code>
          </td>
          <td>
            <code>state</code>、<code>labels</code>、<code>assignee</code>、<code>page</code>、
            <code>perPage</code>
          </td>
          <td>
            <code>GET repos/&#123;owner&#125;/&#123;repo&#125;/issues</code>，本地再滤掉带{' '}
            <code>pull_request</code> 的条目
          </td>
        </tr>
        <tr>
          <td>
            <code>github_get_issue</code>
          </td>
          <td>
            <code>owner</code>、<code>repo</code>、<code>issueNumber</code>
          </td>
          <td>—</td>
          <td>
            <code>GET repos/&#123;owner&#125;/&#123;repo&#125;/issues/&#123;n&#125;</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>github_create_issue</code>
          </td>
          <td>
            <code>owner</code>、<code>repo</code>、<code>title</code>
          </td>
          <td>
            <code>body</code>、<code>labels</code>、<code>assignees</code>
          </td>
          <td>
            <code>POST repos/&#123;owner&#125;/&#123;repo&#125;/issues</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>github_update_issue</code>
          </td>
          <td>
            <code>owner</code>、<code>repo</code>、<code>issueNumber</code>、<code>patch</code>
          </td>
          <td>
            <code>patch</code> 内可有 <code>title</code>/<code>body</code>/<code>state</code>/
            <code>labels</code>/<code>assignees</code>
          </td>
          <td>
            <code>PATCH repos/&#123;owner&#125;/&#123;repo&#125;/issues/&#123;n&#125;</code>
            ，只透传这五个键
          </td>
        </tr>
        <tr>
          <td>
            <code>github_comment_issue</code>
          </td>
          <td>
            <code>owner</code>、<code>repo</code>、<code>issueNumber</code>、<code>body</code>
          </td>
          <td>—</td>
          <td>
            <code>POST repos/&#123;owner&#125;/&#123;repo&#125;/issues/&#123;n&#125;/comments</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>github_list_pull_requests</code>
          </td>
          <td>
            <code>owner</code>、<code>repo</code>
          </td>
          <td>
            <code>state</code>、<code>head</code>、<code>base</code>、<code>page</code>、
            <code>perPage</code>
          </td>
          <td>
            <code>GET repos/&#123;owner&#125;/&#123;repo&#125;/pulls</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>github_get_pull_request</code>
          </td>
          <td>
            <code>owner</code>、<code>repo</code>、<code>pullNumber</code>
          </td>
          <td>—</td>
          <td>
            <code>GET repos/&#123;owner&#125;/&#123;repo&#125;/pulls/&#123;n&#125;</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>github_create_pull_request</code>
          </td>
          <td>
            <code>owner</code>、<code>repo</code>、<code>title</code>、<code>head</code>、
            <code>base</code>
          </td>
          <td>
            <code>body</code>、<code>draft</code>
          </td>
          <td>
            <code>POST repos/&#123;owner&#125;/&#123;repo&#125;/pulls</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>github_comment_pull_request</code>
          </td>
          <td>
            <code>owner</code>、<code>repo</code>、<code>pullNumber</code>、<code>body</code>
          </td>
          <td>—</td>
          <td>
            <code>POST repos/&#123;owner&#125;/&#123;repo&#125;/issues/&#123;n&#125;/comments</code>
            ——注意<strong>走的是 issue 评论端点</strong>，不是 PR review comment
          </td>
        </tr>
      </tbody>
    </table>
    <p>请求头与超时是固定的：</p>
    <pre>{`Accept: application/vnd.github+json
Authorization: Bearer <PAT>
X-GitHub-Api-Version: 2022-11-28
Content-Type: application/json          // 仅在有 body 时

超时：15 秒（AbortSignal.timeout）`}</pre>
    <p>
      分页要留意：<code>github_list_issues</code> 与 <code>github_list_pull_requests</code>
      默认 <code>page=1</code>、<code>perPage=50</code>，靠你显式传参翻页；
      <code>user/repos</code> 那条路径硬编码 <code>per_page=100</code>且
      <strong>没有 page 参数</strong>。整个服务
      <strong>
        不解析 <code>Link</code> 响应头
      </strong>
      、 没有自动翻页、没有 ETag 缓存、没有重试退避。
    </p>
    <p>
      在仓库白名单语义上有一个特别容易写错的点，这里给准确结论：
      <code>selectedRepos</code> <strong>为空数组 = 不限制</strong>（放行账号可见的全部仓库），
      不是「全部禁止」。判断条件是
      <code>if (options?.repo != null &amp;&amp; normalizedRepoScope.size &gt; 0)</code>（
      <code>github-connector.service.ts:719-728</code>）。 匹配是
      <strong>忽略大小写的整串相等</strong>，不支持 <code>*</code>、前缀或 org 级通配； 写入时会把{' '}
      <code>https://github.com/owner/repo</code>、<code>owner/repo.git</code>、 末尾斜杠都归一化成{' '}
      <code>owner/repo</code>，<strong>非法项静默丢弃</strong>而不报错。
      界面上的输入提示也印证了这点：<em>留空表示允许访问 PAT 授权范围内的全部仓库</em>。
    </p>
    <p>还有两个「看起来有、其实没有」的字段，值得单独提醒：</p>
    <ul>
      <li>
        <strong>
          <code>syncIssues</code> 与 <code>syncPullRequests</code> 是空开关。
        </strong>
        它们默认 <code>true</code>，但全仓库除了默认值构造和 <code>connect()</code> 里写死
        <code>true</code> 之外<strong>没有任何读取点</strong>——没有同步任务、没有同步游标、 没有把
        GitHub Issue/PR 落到本地表。相关的基础设施 （<code>connector_sync_cursors</code> 表、
        <code>ExternalSource</code> 类型）存在但<strong>零引用</strong>。
      </li>
      <li>
        <strong>
          <code>last_sync_at</code> 不是同步时间。
        </strong>
        任何一次成功的 API 请求都会把 <code>status</code> 重置为 <code>connected</code>、 清空{' '}
        <code>last_error</code>、把 <code>last_sync_at</code> 更新为当前时间 （<code>:824-830</code>
        ）。把它当「最近一次成功请求时间」理解才对。
      </li>
    </ul>

    <h3 id="github-gating">10.2 三重门控</h3>
    <p>
      每个 GitHub 工具调用都要依次穿过三道闸门（<code>github-connector.service.ts:672-737</code>）：
    </p>
    <ol>
      <li>
        <strong>插件运行时闸门。</strong>
        <code>runtimeGuard()</code> 返回 false 就报
        <code>GitHub 连接器未启用，Agent 暂时不能使用 GitHub 工具</code>。 这个回调注入的是{' '}
        <code>pluginManager.isRuntimeEnabled('github')</code>（
        <code>session-mcp-tooling.ts:221-224</code>）—— 也就是说
        <strong>即使你用平台管理那套工具，也必须先在扩展中心启用 GitHub 连接器</strong>。
      </li>
      <li>
        <strong>连接与凭据闸门。</strong>要求 <code>connector_connections</code> 里存在
        <code>provider = 'github'</code> 的行、<code>enabled = 1</code>、且
        <code>keystore_ref</code> 指向的 PAT 能被读出来。对应报错依次是
        <code>GitHub 连接尚未建立</code>、<code>GitHub 连接已禁用</code>、
        <code>GitHub 连接缺少凭证引用</code>、<code>系统凭证库不可用，无法读取 GitHub PAT：…</code>
        、<code>GitHub PAT 不存在，请重新连接 GitHub</code>。
      </li>
      <li>
        <strong>能力 / 写入 / 仓库范围闸门。</strong>能力不满足报
        <code>GitHub 连接未启用能力：&lt;capability&gt;</code>；写入未开报
        <code>GitHub 连接当前未开启写入权限</code>；仓库越权报
        <code>仓库 &lt;owner/repo&gt; 不在当前 GitHub 连接的授权范围内</code>。
      </li>
    </ol>
    <p>
      能力与工具的对应关系有个反直觉之处：
      <strong>
        除 <code>github_status</code> 外的 14 个工具 全部额外要求 <code>mcp_tools</code>
      </strong>
      。所以关掉 <code>mcp_tools</code>
      会让所有数据类工具一起失效，哪怕 <code>repositories</code> / <code>issues</code> 还开着。 而{' '}
      <code>identity</code> 虽然在默认启用集合里，<strong>却没有任何工具要求它</strong>——
      它只在状态展示里有意义。
    </p>
    <table>
      <thead>
        <tr>
          <th>工具组</th>
          <th>要求的能力</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            仓库类（<code>list_repositories</code> / <code>get_repository</code> /{' '}
            <code>read_repository_file</code> / <code>create_branch</code> /{' '}
            <code>upsert_repository_file</code>）
          </td>
          <td>
            <code>repositories</code> + <code>mcp_tools</code>
          </td>
        </tr>
        <tr>
          <td>Issue 类（5 个）</td>
          <td>
            <code>issues</code> + <code>mcp_tools</code>
          </td>
        </tr>
        <tr>
          <td>PR 类（4 个）</td>
          <td>
            <code>pull_requests</code> + <code>mcp_tools</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>github_status</code>
          </td>
          <td>不校验任何能力</td>
        </tr>
      </tbody>
    </table>
    <p>
      错误最终暴露给模型时的形状也值得知道：bridge 把错误序列化成
      <code>{'{ ok: false, error: message }'}</code>（HTTP 状态仍是 200）， MCP 侧再包装成{' '}
      <code>isError: true</code> 的文本。
      <strong>
        <code>SparkError</code> 的 code 不会传出去
      </strong>
      —— 模型只看到 <code>message</code>，看不到 <code>PERMISSION_DENIED</code> 这类错误码。
      排查时以消息文本为准。
    </p>
    <p>HTTP 状态到错误码的映射是这样切的：</p>
    <table>
      <thead>
        <tr>
          <th>HTTP 状态</th>
          <th>错误码</th>
          <th>消息</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>401 / 403</td>
          <td>
            <code>PROVIDER_AUTH_FAILED</code>
          </td>
          <td>
            <code>GitHub 认证失败：…</code>
          </td>
        </tr>
        <tr>
          <td>404</td>
          <td>
            <code>PROVIDER_UNAVAILABLE</code>
          </td>
          <td>
            <code>GitHub 资源不存在：…</code>
          </td>
        </tr>
        <tr>
          <td>422</td>
          <td>
            <code>PROVIDER_UNAVAILABLE</code>
          </td>
          <td>
            <code>GitHub 请求参数无效：…</code>
          </td>
        </tr>
        <tr>
          <td>429</td>
          <td>
            <code>PROVIDER_RATE_LIMITED</code>
          </td>
          <td>
            <code>GitHub API 请求过于频繁，请稍后重试</code>
          </td>
        </tr>
        <tr>
          <td>其他非 2xx</td>
          <td>
            <code>PROVIDER_UNAVAILABLE</code>
          </td>
          <td>
            <code>GitHub API 错误：HTTP &lt;status&gt; - …</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      两个容易误判的点：<strong>403 被归成认证失败</strong>（不会区分「403 也可能是限流」）， 以及{' '}
      <strong>
        429 不读 <code>Retry-After</code>、不重试
      </strong>
      ，只有一句固定文案。 任何非 2xx 都会写 <code>last_error</code>；其中 401/403 还会把{' '}
      <code>status</code> 置成
      <code>error</code>（<code>:791-797</code>）。
    </p>

    <h3 id="github-ui-gap">10.3 这套工具的界面入口实际不可达</h3>
    <p>
      这是一个必须讲清楚的事实，否则你会一直在界面里找不到配置入口。
      <code>McpView.tsx:1251</code> 确实定义了一个完整的
      <code>ConnectorsPanel()</code>：包含 PAT 输入框、仓库范围、
      「连接启用」开关、「写入能力」开关、能力勾选、保存 / 断开按钮， 调的是{' '}
      <code>github-connector:get|connect|update|disconnect</code> 四个通道。
    </p>
    <p>
      <strong>但这个组件在全仓库里只出现这一次——它是定义，没有任何地方渲染它。</strong>对{' '}
      <code>apps/desktop/src</code> 做 <code>&lt;ConnectorsPanel</code> 的检索结果是空。 也就是说：
    </p>
    <ul>
      <li>
        <code>github-connector:*</code> 与别名 <code>plugin-runtime:github:*</code>
        这两组 IPC 通道<strong>都已注册</strong>（<code>registerGitHubConnectorIpc.ts:59-68</code>
        ）， 但唯一的调用点在被抛弃的组件里，所以界面上没有可达路径。
      </li>
      <li>
        因此 <code>mcp__spark_platform__github_*</code> 这 15 个工具需要的
        <code>connector_connections</code> 行，<strong>无法通过界面创建</strong>。
      </li>
      <li>
        配套的 <code>mv_connectors</code> / <code>mv_connector_*</code> 样式规则仍然留在
        <code>McpView.less:572</code> 起的一段里，属于同一批未挂载的代码。
      </li>
    </ul>
    <p>
      所以实际可用的 GitHub 路径只有一条：
      <strong>扩展中心 →「连接器」页签 → GitHub 卡片 →「连接账号」→ 填入 Fine-grained PAT</strong>。
      连上之后 Agent 拿到的是 <code>mcp__spark_plugins__github_*</code>。 如果你确实需要平台管理 MCP
      那 15 个工具，得先把连接行准备好 （例如通过测试环境或直接构造数据），再在扩展中心启用 GitHub
      连接器。
    </p>
    <p>
      顺便记一个陈旧文案：<code>McpView.tsx:1313-1325</code> 里对非 PAT 认证方式会提示
      <em>「需要主进程 OAuth/Device/GitHub App 接线；已打开配置入口。」</em>， 而渲染端只认{' '}
      <code>GITHUB_SUPPORTED_AUTH_METHODS = ['pat']</code>（<code>:1121</code>）。 这句提示与 §4.1
      的结论一致：另外两种认证方式没有实现。
    </p>

    <h2 id="im-bots">11. IM 机器人</h2>
    <p>
      第三套「连接器」是远程连接：让你从手机上的 IM 继续和本地 Agent 对话。 它
      <strong>不注册任何 Agent 工具</strong>，走的是消息驱动，和上面两套没有代码交集，
      本文只做概览。
    </p>
    <table>
      <thead>
        <tr>
          <th>通道</th>
          <th>连接方式</th>
          <th>必填凭据</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>telegram</code>
          </td>
          <td>
            本机 <code>getUpdates</code> 长轮询，不需要公网地址
          </td>
          <td>
            <code>botToken</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>feishu</code>
          </td>
          <td>官方 WebSocket 长连接</td>
          <td>
            <code>appId</code>、<code>appSecret</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>qq</code>
          </td>
          <td>官方 WebSocket 网关</td>
          <td>
            <code>qqBotAppId</code>、<code>qqBotSecret</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>三个关键差异，避免和插件型连接器混淆：</p>
    <ul>
      <li>
        <strong>
          凭据存储在 <code>app_settings</code> 里是明文 JSON
        </strong>
        ，不在系统 keystore， 界面用的是普通文本输入框，已保存的值会明文显示，不做掩码。这与 §4.2
        的连接器凭据策略完全不同。
      </li>
      <li>
        配置与配对状态存放在 <code>app_settings</code> 的 <code>remote-connections/data</code>{' '}
        分类下，不是独立表。
      </li>
      <li>
        它有自己的本机 HTTP 服务（默认 <code>127.0.0.1:32178</code>）与 6 位配对码 / QR 配对流程。
      </li>
    </ul>
    <p>
      通道清单、字段默认值、配对流程、内置命令与能力开关的完整说明见
      <a href="/docs/remote-connections">远程连接</a> 一文，这里不再重复。
    </p>

    <h2 id="troubleshooting">12. 排查表</h2>
    <table>
      <thead>
        <tr>
          <th>现象</th>
          <th>最可能的原因</th>
          <th>怎么办</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>连接器页签里没有「连接器市场」区块，也没有任何提示</td>
          <td>
            没有一个<strong>已启用且配了指纹</strong>的市场源，整块被条件渲染隐藏
          </td>
          <td>这是默认状态，见 §8.2；用本地目录导入，或先配置市场源</td>
        </tr>
        <tr>
          <td>
            卡片显示 <code>待授权：…</code>
          </td>
          <td>required 权限没批</td>
          <td>重新走一次安装（安装时是全量批准），或停用后重新启用</td>
        </tr>
        <tr>
          <td>
            启用开关打不开 / 报 <code>Plugin requires explicit permission: …</code>
          </td>
          <td>required 权限未授予</td>
          <td>同上；界面没有逐项授权入口（§7.2）</td>
        </tr>
        <tr>
          <td>Agent 看不到连接器工具</td>
          <td>① 插件没启用；② 没有已连接账号；③ 能力被关；④ 桥接没收集到工具</td>
          <td>按 §9 的四条依次核对，先用卡片上的状态确认账号是不是「Agent 可用」</td>
        </tr>
        <tr>
          <td>
            工具调用报 <code>Plugin MCP turn is no longer active</code>
          </td>
          <td>跨轮次复用了上一轮的工具句柄</td>
          <td>在当轮重新调用；桥接按轮次建立</td>
        </tr>
        <tr>
          <td>
            报 <code>CONFIRMATION_REQUIRED</code>
          </td>
          <td>
            调用了 <code>high-write</code> 或 <code>destructive</code>{' '}
            工具但没带确认令牌，或令牌被用过
          </td>
          <td>
            用 <code>plugin-runtime:issue-confirmation</code> 取新令牌（默认 TTL 60 秒、一次性）
          </td>
        </tr>
        <tr>
          <td>
            报 <code>SCOPE_REQUIRED</code>
          </td>
          <td>
            能力的 <code>requiredScopes</code> 不在账号 <code>grantedScopes</code> 内
          </td>
          <td>OAuth 授权时少勾了 scope，只能重新授权账号</td>
        </tr>
        <tr>
          <td>
            报 <code>RESOURCE_OUT_OF_SCOPE</code>
          </td>
          <td>
            目标不在账号的 <code>resourceScope</code> 里（如越权仓库、越权日历、Vault 外路径）
          </td>
          <td>改账号的范围配置，或选范围内的目标</td>
        </tr>
        <tr>
          <td>
            报 <code>AUTH_EXPIRED</code> / 状态显示「需要重新授权」
          </td>
          <td>refresh token 缺失或过期</td>
          <td>
            重新连接账号；刷新要求 config 里同时有 <code>oauthClientId</code> 与{' '}
            <code>oauthTokenUrl</code>
          </td>
        </tr>
        <tr>
          <td>能力开关点了没反应 / 改了不是想要的账号</td>
          <td>
            开关只作用于 <code>accounts[0]</code>（§5）
          </td>
          <td>多账号场景下先确认第一个账号是你要改的</td>
        </tr>
        <tr>
          <td>卸载按钮不见了</td>
          <td>该组全是内置插件</td>
          <td>内置包只能停用，不能卸载（§8.3）</td>
        </tr>
        <tr>
          <td>
            卸载时报 <code>内置能力包不能移除，只能停用</code>
          </td>
          <td>同上</td>
          <td>改用卡片开关停用</td>
        </tr>
        <tr>
          <td>
            导入时 <code>Plugin package is missing plugin.json</code>
          </td>
          <td>选错的目录层级（选到了包的父目录）</td>
          <td>
            选到含 <code>plugin.json</code> 的那一层
          </td>
        </tr>
        <tr>
          <td>
            <code>Plugin source must be outside the managed plugin directory</code>
          </td>
          <td>源目录在受管插件目录里</td>
          <td>把包挪到受管目录之外再导入（受管目录见 §8.1）</td>
        </tr>
        <tr>
          <td>界面里找不到 GitHub PAT 配置面板</td>
          <td>
            <code>ConnectorsPanel</code> 没有被挂载（§10.3）
          </td>
          <td>用扩展中心 →「连接器」→ GitHub →「连接账号」；那是另一套实现</td>
        </tr>
        <tr>
          <td>
            平台管理那 15 个 <code>github_*</code> 工具全部报「连接尚未建立」
          </td>
          <td>
            <code>connector_connections</code> 里没有行，而界面无法创建
          </td>
          <td>预期行为，见 §10.3；改用插件运行时的 GitHub 工具</td>
        </tr>
        <tr>
          <td>Agent 报「GitHub 连接器未启用，Agent 暂时不能使用 GitHub 工具」</td>
          <td>插件运行时闸门没过</td>
          <td>到扩展中心 →「连接器」启用 GitHub，并确认 required 权限齐备</td>
        </tr>
        <tr>
          <td>Issue 列表里混进了 PR</td>
          <td>GitHub 的 issues 端点本身会返回 PR（平台管理那套会本地过滤，适配器那套不会）</td>
          <td>
            用 <code>mcp__spark_platform__github_list_issues</code>；或自行按有无{' '}
            <code>pull_request</code> 字段过滤
          </td>
        </tr>
        <tr>
          <td>PR 评论没有出现在 review 里</td>
          <td>
            <code>github_comment_pull_request</code> 打的是 issue 评论端点
          </td>
          <td>预期行为，见 §10.1；需要 review comment 得另想办法</td>
        </tr>
        <tr>
          <td>
            改了 <code>syncIssues</code> 没有任何效果
          </td>
          <td>该字段是空开关，没有消费方</td>
          <td>预期行为，见 §10.1</td>
        </tr>
      </tbody>
    </table>
  </>
)

const connectors: DocsPageContent = {
  slug: 'connectors',
  Body,
  toc: [
    { id: 'overview', title: '1. 先分清「连接器」在 SparkWork 里的三种含义', level: 2 },
    { id: 'entry', title: '1.1 入口：扩展中心 → 连接器', level: 3 },
    { id: 'three-kinds', title: '1.2 三者对照', level: 3 },
    { id: 'page', title: '2. 连接器页面上有什么', level: 2 },
    { id: 'runtimes', title: '3. 内置的四个运行时', level: 2 },
    { id: 'runtime-github', title: '3.1 GitHub', level: 3 },
    { id: 'runtime-google', title: '3.2 Google Workspace', level: 3 },
    { id: 'runtime-notion', title: '3.3 Notion', level: 3 },
    { id: 'runtime-obsidian', title: '3.4 Obsidian Vault', level: 3 },
    { id: 'accounts', title: '4. 连接账号', level: 2 },
    { id: 'auth-methods', title: '4.1 各运行时的认证方式与凭据字段', level: 3 },
    { id: 'credential-storage', title: '4.2 凭据存在哪里', level: 3 },
    { id: 'oauth-flow', title: '4.3 OAuth 授权流程', level: 3 },
    { id: 'account-status', title: '4.4 账号状态与断开', level: 3 },
    { id: 'capabilities', title: '5. 能力开关', level: 2 },
    { id: 'plugin-manifest', title: '6. plugin.json：连接器的清单契约', level: 2 },
    { id: 'manifest-fields', title: '6.1 清单字段', level: 3 },
    { id: 'contributions', title: '6.2 四类 contribution', level: 3 },
    { id: 'source-trust', title: '6.3 source 与 trust', level: 3 },
    { id: 'permissions', title: '7. 权限模型', level: 2 },
    { id: 'permission-labels', title: '7.1 九个权限与界面标签', level: 3 },
    { id: 'permission-enforcement', title: '7.2 权限实际被强制到什么程度', level: 3 },
    { id: 'install', title: '8. 安装、启用与卸载', level: 2 },
    { id: 'install-local', title: '8.1 本地目录导入', level: 3 },
    { id: 'install-marketplace', title: '8.2 市场安装（默认不可用）', level: 3 },
    { id: 'enable-uninstall', title: '8.3 启用、停用与卸载', level: 3 },
    { id: 'agent-tools', title: '9. 运行时的工具如何进入 Agent', level: 2 },
    { id: 'github-two-ways', title: '10. GitHub 的两套实现', level: 2 },
    { id: 'github-platform-tools', title: '10.1 平台管理 MCP 的 15 个 github_* 工具', level: 3 },
    { id: 'github-gating', title: '10.2 三重门控', level: 3 },
    { id: 'github-ui-gap', title: '10.3 这套工具的界面入口实际不可达', level: 3 },
    { id: 'im-bots', title: '11. IM 机器人', level: 2 },
    { id: 'troubleshooting', title: '12. 排查表', level: 2 },
  ],
  faq: [
    {
      question: '为什么我的「连接器」页签里看不到「连接器市场」这一块？',
      answer:
        '这是默认状态，不是故障。市场区块被 marketConfigured 条件包住，要求至少有一个「已启用 + 配了签名指纹」的市场源；随包种下的 spark-official 指向占位地址，且被迁移脚本 071 主动置为 enabled = 0。所以出厂状态下整块隐藏、连空态文案都不会出现。要装连接器请用「导入本地连接器」。',
    },
    {
      question: '我明明装了连接器，为什么 Agent 还是看不到它的工具？',
      answer:
        '四个条件缺一不可：① 插件的 required 权限全批且已启用；② 对应运行时至少连了一个账号；③ 工具的 requiredCapabilities 都被该账号满足；④ 桥接能收集到至少一个工具定义。最常见的漏项是第 ② 条——只装了插件但没点「连接账号」，卡片上会显示「等待连接账号」而不是「Agent 可用」。',
    },
    {
      question: '我在界面上找不到 GitHub PAT 的配置面板，文档里提到的 github_* 工具也没出现。',
      answer:
        '因为 GitHub 有两套实现。界面可达的是插件运行时那套（扩展中心 →「连接器」→ GitHub →「连接账号」），给 Agent 的是 mcp__spark_plugins__github_* 工具。另一套平台管理 MCP 的 mcp__spark_platform__github_* 需要一个 connector_connections 行，而它的配置面板 ConnectorsPanel 在代码里定义了却从未被渲染，所以无法通过界面创建连接。',
    },
    {
      question: '连接器申请的权限（比如 process.spawn）到底会不会被拦？',
      answer:
        '不会逐项拦。权限只用来做一件事：判断 permissions.required 是否全部 granted，然后决定插件能不能安装、能不能启用、运行时是否可用（isRuntimeEnabled）。全仓库没有任何「执行前检查 process.spawn 等具体权限」的代码，所以它是给用户看的风险清单 + 一个聚合开关，不是操作系统级沙箱。',
    },
    {
      question: '连接器的账号凭据存在哪里？数据库里能看到吗？',
      answer:
        '凭据只进系统 keystore，不进 SQLite。表 connector_accounts 里只有一列 credential_ref 保存引用，形如 plugin-runtime-spark.github-github-<base64>；断开账号会连带删除 keystore 里的 secret。这一点和远程连接（IM 机器人）相反——后者的 bot token 是明文存在 app_settings 里的。',
    },
    {
      question: '连接器能升级或自动更新吗？',
      answer:
        '没有升级机制。PluginManager 上没有 update/upgrade 方法，也没有定时检查更新的代码；「升级」的唯一方式是用同一个 id 重新安装一次，DB 走 upsert 覆盖（不改 installed_at）。只改 plugin.json 里的版本号而不重新导入，系统不会识别为升级。',
    },
    {
      question: '内置的 GitHub / Google / Notion / Obsidian 能卸载吗？',
      answer:
        '不能，只能停用。后端在 uninstall 里硬拦截 source === bundled，报「内置能力包不能移除，只能停用」；界面也不会给纯内置插件渲染卸载按钮。停用会把它的所有贡献资源 enabled 置 0，配置与凭据都保留。',
    },
  ],
  aiSummary:
    'SparkWork 的「连接器」其实由三套不同子系统共用：扩展中心里的插件型连接器（含 GitHub / Google Workspace / Notion / Obsidian 四个内置运行时）、平台管理 MCP 的 15 个 github_* 工具、以及远程连接（IM 机器人）。本文详述前两套：plugin.json 完整字段与四类 contribution、source/trust 枚举、九个权限与「只有聚合闸门、无逐权限强制」的真实强制力、本地目录导入与「默认不可用」的市场、凭据只进系统 keystore、能力开关的三层校验、以及运行时工具如何以 mcp__spark_plugins__<runtime>_<tool> 注入 Agent。并明确指出 GitHub 存在两套实现、以及平台管理那套的配置面板 ConnectorsPanel 虽然写好了却从未被挂载，因此界面上不可达。',
  quickReference: [
    { key: '界面入口', value: '左侧「扩展中心」(视图 id mcp，⌘5/Ctrl+5) →「连接器」页签' },
    {
      key: '内置运行时',
      value:
        'github(15 工具) / google(16) / notion(8) / obsidian(8)，没有 Slack/Jira/Linear/通用 REST',
    },
    { key: '贡献类型', value: '只有 4 类：skills / mcpServers / connectors / runtimes' },
    {
      key: '插件来源',
      value: 'source: bundled | local | marketplace；trust 里的 blocked 无写入方',
    },
    {
      key: '权限清单',
      value:
        'network、filesystem.read/write、process.spawn、secrets.read、clipboard、browser、mcp.connect、connector.account',
    },
    { key: '权限强制力', value: '只有「required 全 granted」聚合闸门，无逐权限运行时检查' },
    { key: '凭据存储', value: '系统 keystore；SQLite 只存 connector_accounts.credential_ref' },
    { key: '工具命名', value: 'mcp__spark_plugins__<toolNamespace>_<tool.name>' },
    { key: '高风险确认令牌', value: '默认 TTL 60 秒（裁剪 1s–5min），一次性，仅存进程内存' },
    { key: 'token 刷新阈值', value: 'expiresAt 距今不足 30 秒触发；并发刷新单飞' },
    {
      key: 'OAuth 流程',
      value: 'Authorization Code + PKCE(S256) + 127.0.0.1 随机端口回调，超时 5 分钟',
    },
    { key: '受管插件目录', value: '<userData>/plugins；临时目录 <tmp>/spark-plugin-installs' },
    { key: '安装体积/文件上限', value: '单包 250 MiB、20,000 个文件；拒绝符号链接与路径逃逸' },
    {
      key: '市场源默认状态',
      value: 'spark-official 是占位地址，被迁移 071 置为 enabled=0 → 市场区块整块隐藏',
    },
    {
      key: '平台 GitHub 连接',
      value: 'connector_connections 单行、id 固定 github-primary、provider 上有唯一索引',
    },
    {
      key: '平台 GitHub 默认值',
      value: 'allowWrites=false、selectedRepos=[]（空=不限制）、enabledCapabilities 五项全开',
    },
    {
      key: '平台 GitHub 请求',
      value: 'api.github.com，API 版本 2022-11-28，超时 15 秒，不解析 Link、无重试',
    },
    {
      key: '审计表',
      value: 'plugin_runtime_audit；resource_ids_json 恒为 []，且只有写入没有查询接口',
    },
    { key: 'IM 机器人存储', value: 'app_settings 的 remote-connections/data，凭据为明文 JSON' },
  ],
  howTo: {
    name: '接入一个内置连接器并让 Agent 用上它的工具',
    description: '以 GitHub 为例，从扩展中心连上账号、打开能力、验证 Agent 真能调用工具。',
    totalTime: '约 8 分钟',
    steps: [
      '按下 ⌘5 / Ctrl+5 打开「扩展中心」，切到「连接器」页签。',
      '在「已安装连接器」里找到 GitHub 卡片。四个内置包默认就在列表里，来源徽标显示「内置」。',
      '确认卡片开关是开启状态；如果之前停用过，先打开开关（required 权限未齐会报 Plugin requires explicit permission）。',
      '点卡片上的「连接账号」。如果显示的是「账号设置」，说明已经有账号了，可直接跳到第 7 步。',
      '在弹窗里选「手动令牌」，输入框标签是「Fine-grained PAT」。到 GitHub 的 personal-access-tokens 页面建一个只有你要的仓库和最小权限的 PAT，粘进去。',
      '点「验证并连接」。成功会提示「GitHub 已连接 <账号名>」，账号状态变成「Agent 可用」。令牌只进系统 keystore，输入框会立即清空。',
      '在弹窗底部「默认能力」里按需关掉不用的能力（例如只要读代码就关掉 pull_requests）。注意这个开关只作用于第一个账号。',
      '回到主界面对话，让 Agent 做一件需要 GitHub 的事，比如「列出 owner/repo 最近 5 个 open issue」。',
      '如果 Agent 没调用工具：先确认卡片状态是「Agent 可用」（只装插件不连账号时是「等待连接账号」）；再确认目标能力是开的。',
      '如果 Agent 报 CAPABILITY_DISABLED，说明该工具要求的某个能力被关了；报 SCOPE_REQUIRED 则是 OAuth 授权时少勾了 scope，需要重新授权。',
      '要停用：关掉卡片开关即可，配置和凭据都保留。要彻底断开：进「账号设置」点「断开」（没有二次确认，点了就生效）。',
    ],
  },
}

export default connectors
