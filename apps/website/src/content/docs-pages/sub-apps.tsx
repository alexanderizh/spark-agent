import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      子应用（Sub-App）是 SparkWork 里唯一允许你<strong>把界面装进平台</strong>的机制： 一段
      HTML/JS（V1）或一个受管多文件项目（V2），可以跑在内容区、侧面板、悬浮层里，
      数据和文件长期保存，与会话无关。管理入口是侧栏的
      <strong>「我的应用」</strong>（视图 id <code>sub-apps</code>，带 <code>Beta</code> 标记）， 但
      <strong>创建与改代码主要在对话里由 Agent 完成</strong>。
    </p>
    <p>
      这一页按真实代码讲清五件事：V1 与 V2 的区别、五个展示面里哪几个真的能跑、
      能力与运行时开关的实际强制力、<strong>归档为什么不可逆</strong>、 以及 39 个{' '}
      <code>spark_app_*</code> 工具分别做什么。
    </p>

    <h2 id="overview">1. 定位与入口</h2>
    <p>
      子应用是「长期资源」而不是会话内容：源码、发布版本、应用数据、文件空间都存在本机，
      删掉会话不会影响它。
    </p>

    <h3 id="entry">1.1 真实入口与文案</h3>
    <ul>
      <li>
        侧栏「<strong>我的应用</strong>」：导航项 id <code>sub-apps</code>、文案键{' '}
        <code>nav.subApps</code>
        （值为「我的应用」）、图标 <code>Icons.Grid</code>（
        <code>apps/desktop/src/renderer/App.tsx:287</code>、<code>design/i18n/locales.ts:324</code>
        ）。
      </li>
      <li>
        它是<strong>测试期功能</strong>：<code>BETA_NAV_IDS</code> 只含 <code>workflows</code> 与{' '}
        <code>sub-apps</code>， 导航文字后渲染 <code>Beta</code> 小标签（<code>App.tsx:297</code>、
        <code>:519</code>； 标签文案 <code>locales.ts:327</code> = <code>Beta</code>）。
      </li>
      <li>
        该视图渲染 <code>&lt;SubAppsView /&gt;</code>（<code>App.tsx:1971-1972</code>）；
        点「打开」后切到 <code>view === 'sub-app'</code>，渲染 <code>&lt;SubAppRunView /&gt;</code>
        （<code>App.tsx:1973-1974</code>），这才是应用的运行页。
      </li>
      <li>
        管理页头部有三个动作：<strong>刷新</strong>、<strong>导入</strong>、
        <strong>通过 Agent 创建</strong>（<code>design/views/SubAppsView.tsx:412-434</code>）；
        工具栏是「搜索应用名称 / 描述」+ 状态筛选（全部 / 已发布 / 草稿）+「显示已归档的应用」开关
        （<code>SubAppsView.tsx:437-482</code>）。
      </li>
      <li>
        「通过 Agent 创建」弹窗标题是<strong>「让 Agent 创建子应用」</strong>，
        正文明确写出强制命令：<code>/spark-app-create 记账工具</code>（
        <code>SubAppsView.tsx:808-831</code>）。该命令在命令注册表里是
        <code>builtin:spark-app-create</code>（
        <code>packages/agent-runtime/src/core/command-registry.ts:1304-1312</code>）， 同一族还有{' '}
        <code>/spark-app</code>、<code>/spark-app-list</code>、<code>/spark-app-publish</code>（
        <code>command-registry.ts:1388</code>）。
      </li>
      <li>
        空态文案是「还没有子应用 — 在任意对话中让 Agent 帮你创建，例如「帮我做一个读书打卡子应用」」
        （<code>SubAppsView.tsx:507-511</code>），和上面那句一起说明产品意图：
        <strong>管理页不做代码编辑</strong>。
      </li>
    </ul>

    <h3 id="not-confused">1.2 别和另外两个「应用/扩展」搞混</h3>
    <table>
      <thead>
        <tr>
          <th>东西</th>
          <th>是什么</th>
          <th>入口</th>
          <th>存储</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>子应用</td>
          <td>跑在宿主界面里的 HTML/JS 应用；有草稿、发布版本、数据、文件</td>
          <td>侧栏「我的应用」</td>
          <td>
            <code>sub_apps</code> 等 8 张表 + <code>&lt;userData&gt;</code> 下的目录
          </td>
        </tr>
        <tr>
          <td>插件型连接器</td>
          <td>给 Agent 加工具的运行时（GitHub / Google / Notion / Obsidian）</td>
          <td>扩展中心 → 连接器</td>
          <td>
            <code>plugins</code> / <code>connector_accounts</code>
          </td>
        </tr>
        <tr>
          <td>团队商店资产</td>
          <td>把子应用或 Skill 分享给团队，用「安装」而不是「运行」</td>
          <td>扩展中心 → 团队商店</td>
          <td>团队资产表 + 本地安装记录</td>
        </tr>
      </tbody>
    </table>
    <p>
      子应用卡片上的「发布到团队」走的是第三套（<code>TeamAssetPublishModal</code>，
      <code>SubAppsView.tsx:837-849</code>）。它发布的是<strong>包</strong>，不是运行实例： V2
      应用发到团队后以「新草稿」安装，连接槽绑定与发布版本不随包迁移 （
      <code>SubAppsView.tsx:842</code> 的 hint）。
    </p>

    <h2 id="model">2. 数据模型：V1 单文件与 V2 受管多文件</h2>
    <p>
      两种格式共用同一批表和同一个 <code>appId</code>，靠 <code>format</code> /{' '}
      <code>draft_format</code>
      区分。V1 是「一条源码字符串」，V2 是「一个目录 + 不可变制品」。
    </p>

    <h3 id="v1-fields">2.1 V1 的四个结构体</h3>
    <p>
      定义在 <code>packages/protocol/src/sub-app.ts</code>，字段与可选性如下 （<code>format</code>{' '}
      缺省 <code>v1</code>，见 <code>sub-app.ts:53-56</code>）。
    </p>
    <table>
      <thead>
        <tr>
          <th>结构体</th>
          <th>字段</th>
          <th>说明</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td rowSpan={6}>
            <code>SubAppManifest</code>
          </td>
          <td>
            <code>name: string</code>
          </td>
          <td>应用名</td>
        </tr>
        <tr>
          <td>
            <code>description: string</code>
          </td>
          <td>
            描述（创建时缺省 <code>''</code>）
          </td>
        </tr>
        <tr>
          <td>
            <code>icon: string | null</code>
          </td>
          <td>图标标识；未知标识回落默认图标</td>
        </tr>
        <tr>
          <td>
            <code>entry: string</code>
          </td>
          <td>
            入口文件名，建库缺省 <code>index.html</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>surface: SubAppSurface</code>
          </td>
          <td>
            展示面，建库缺省 <code>content</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>permissions: string[]</code>
          </td>
          <td>
            能力名数组，创建时缺省 <code>DEFAULT_SUB_APP_PERMISSIONS</code>
          </td>
        </tr>
        <tr>
          <td rowSpan={5}>
            <code>SubAppDraft</code>
          </td>
          <td>
            <code>format?: 'v1' | 'v2'</code>
          </td>
          <td>可缺省，兼容旧数据</td>
        </tr>
        <tr>
          <td>
            <code>revision: number</code>
          </td>
          <td>草稿 revision，所有写操作都要求 CAS 匹配</td>
        </tr>
        <tr>
          <td>
            <code>source: string</code>
          </td>
          <td>完整 HTML 源码（V1 唯一产物）</td>
        </tr>
        <tr>
          <td>
            <code>config: Record&lt;string, unknown&gt;</code>
          </td>
          <td>序列化后 ≤ 512 KB</td>
        </tr>
        <tr>
          <td>
            <code>manifest</code> / <code>updatedAt</code>
          </td>
          <td>清单与更新时间</td>
        </tr>
        <tr>
          <td rowSpan={3}>
            <code>SubAppRelease</code>
          </td>
          <td>
            <code>id</code> / <code>appId</code> / <code>version</code>
          </td>
          <td>发布快照主键、归属与递增版本号</td>
        </tr>
        <tr>
          <td>
            <code>source</code> / <code>config</code> / <code>manifest</code>
          </td>
          <td>发布时刻的完整拷贝，不可变</td>
        </tr>
        <tr>
          <td>
            <code>publishedAt: string</code>
          </td>
          <td>发布时间（ISO 字符串）</td>
        </tr>
        <tr>
          <td rowSpan={4}>
            <code>SubAppSummary</code>
          </td>
          <td>
            <code>publicationStatus</code>
          </td>
          <td>
            <code>draft</code> / <code>published</code> / <code>archived</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>enabled: boolean</code>
          </td>
          <td>是否出现在应用入口，与发布状态是两个维度</td>
        </tr>
        <tr>
          <td>
            <code>draftRevision: number</code>
          </td>
          <td>CAS 基线</td>
        </tr>
        <tr>
          <td>
            <code>publishedVersion: number | null</code>
          </td>
          <td>
            当前生效版本号，从未发布为 <code>null</code>
          </td>
        </tr>
      </tbody>
    </table>

    <h3 id="v2-manifest">
      2.2 V2 的 <code>spark-app.json</code>
    </h3>
    <p>
      V2 是「受管项目」：草稿是一个磁盘目录下的多文件树，发布时校验并打包成按内容寻址的制品。
      包清单固定叫 <code>spark-app.json</code>（
      <code>packages/storage/src/sub-app-package.service.ts:27</code>）， 由{' '}
      <code>SubAppPackageManifestSchema</code> 校验（
      <code>packages/protocol/src/sub-app-v2.ts:347-392</code>，<code>.strict()</code>
      ，多一个字段就报错）。
    </p>
    <table>
      <thead>
        <tr>
          <th>字段</th>
          <th>类型</th>
          <th>必填</th>
          <th>说明</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>schemaVersion</code>
          </td>
          <td>
            <code>2</code> 字面量
          </td>
          <td>是</td>
          <td>
            常量 <code>SUB_APP_PACKAGE_SCHEMA_VERSION</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>name</code>
          </td>
          <td>string，1~120</td>
          <td>是</td>
          <td>trim 后不得为空</td>
        </tr>
        <tr>
          <td>
            <code>description</code>
          </td>
          <td>string ≤ 400</td>
          <td>否</td>
          <td>
            缺省写入 <code>''</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>icon</code>
          </td>
          <td>string ≤ 240 / null</td>
          <td>否</td>
          <td>—</td>
        </tr>
        <tr>
          <td>
            <code>surface</code>
          </td>
          <td>五选一</td>
          <td>是</td>
          <td>与 V1 同一枚举</td>
        </tr>
        <tr>
          <td>
            <code>frontend.entry</code>
          </td>
          <td>包内相对路径</td>
          <td>是</td>
          <td>
            必须真实存在于包内，否则报 <code>PACKAGE_ENTRY_MISSING</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>service.runtime</code>
          </td>
          <td>
            <code>'node'</code> 字面量
          </td>
          <td>声明 service 时必填</td>
          <td>只支持 Node</td>
        </tr>
        <tr>
          <td>
            <code>service.lifecycle</code>
          </td>
          <td>
            <code>'on-demand' | 'application'</code>
          </td>
          <td>声明 service 时必填</td>
          <td>
            常量 <code>SUB_APP_SERVICE_LIFECYCLES</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>service.idleTimeoutSeconds</code>
          </td>
          <td>整数 30~86400</td>
          <td>否</td>
          <td>
            运行时缺省按 <strong>300 秒</strong> 回收（见 §8.1）
          </td>
        </tr>
        <tr>
          <td>
            <code>service.healthAction</code>
          </td>
          <td>string 1~120</td>
          <td>否</td>
          <td>健康检查调用的 action 名</td>
        </tr>
        <tr>
          <td>
            <code>permissions.sparkCapabilities</code>
          </td>
          <td>能力名数组 ≤ 64</td>
          <td>是</td>
          <td>
            枚举取自 <code>SUB_APP_CAPABILITIES</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>permissions.osEffects</code>
          </td>
          <td>
            <code>('network' | 'filesystem' | 'process')[]</code>
          </td>
          <td>是</td>
          <td>数组上限就是枚举长度 3</td>
        </tr>
        <tr>
          <td>
            <code>permissions.connections</code>
          </td>
          <td>string 数组 ≤ 32</td>
          <td>是</td>
          <td>
            每个值都必须在 <code>connections</code> 里有声明
          </td>
        </tr>
        <tr>
          <td>
            <code>connections[slot]</code>
          </td>
          <td>对象 record</td>
          <td>否</td>
          <td>
            见 §9.1；<code>allowedOrigins</code> 必须是纯 origin
          </td>
        </tr>
        <tr>
          <td>
            <code>contracts.backendActions</code>
          </td>
          <td>包内相对路径</td>
          <td>否</td>
          <td>声明后文件必须存在</td>
        </tr>
        <tr>
          <td>
            <code>contracts.jobs</code>
          </td>
          <td>包内相对路径</td>
          <td>否</td>
          <td>同上</td>
        </tr>
      </tbody>
    </table>
    <p>
      包体积三道上限是硬编码常量：<code>SUB_APP_PACKAGE_MAX_FILES = 1000</code>、
      <code>SUB_APP_PACKAGE_MAX_BYTES = 20 MB</code>、
      <code>SUB_APP_PACKAGE_MAX_FILE_BYTES = 5 MB</code>（<code>sub-app-v2.ts:6-8</code>），在{' '}
      <code>validatePackageFiles</code> 里逐条判定 （<code>sub-app-package.service.ts:749-768</code>
      ）。
    </p>
    <p>
      路径规则共用 <code>packagePath</code>：相对路径、≤ 240 字符、无盘符与协议前缀、
      分段中不得出现空串 / <code>.</code> / <code>..</code>（<code>sub-app-v2.ts:311-320</code>
      ）；落盘侧遍历时还会拒绝符号链接并二次校验 （<code>sub-app-package.service.ts:900-916</code>
      ）。
    </p>

    <h3 id="v1-v2-diff">2.3 两种格式的差异对照</h3>
    <table>
      <thead>
        <tr>
          <th>维度</th>
          <th>V1</th>
          <th>V2</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>草稿形态</td>
          <td>
            <code>sub_apps.draft_source</code> 一个字符串
          </td>
          <td>
            磁盘目录 <code>projects/&lt;appId&gt;/rev-&lt;n&gt;/</code> 多文件树
          </td>
        </tr>
        <tr>
          <td>草稿版本字段</td>
          <td>
            <code>draft_revision</code>
          </td>
          <td>
            另有 <code>draft_project_revision</code>（见迁移 <code>097</code>）
          </td>
        </tr>
        <tr>
          <td>清单来源</td>
          <td>UI/Agent 传的 manifest</td>
          <td>
            包内 <code>spark-app.json</code>（schema 严格校验）
          </td>
        </tr>
        <tr>
          <td>发布产物</td>
          <td>
            <code>sub_app_releases.source</code> 一行快照
          </td>
          <td>
            <code>sub_app_artifacts</code> 按 sha256 内容寻址 +{' '}
            <code>sub_app_release_artifacts</code> 关联
          </td>
        </tr>
        <tr>
          <td>后台服务</td>
          <td>无</td>
          <td>可声明受管 Node service，随 release 原子发布</td>
        </tr>
        <tr>
          <td>持久任务</td>
          <td>无</td>
          <td>
            <code>sparkApp.jobs.*</code>，固定在 release 上
          </td>
        </tr>
        <tr>
          <td>受管网络/连接槽</td>
          <td>无</td>
          <td>
            <code>connections</code> + <code>sparkApp.network/provider.request</code>
          </td>
        </tr>
        <tr>
          <td>运行沙箱</td>
          <td>
            合成文档 + <code>capability-asset://subapp-runtime/&lt;token&gt;</code>
          </td>
          <td>
            制品目录 + <code>capability-asset:</code> 资源根（<code>&lt;base href&gt;</code>）
          </td>
        </tr>
        <tr>
          <td>
            <code>ipc</code> 能力
          </td>
          <td>可信内部应用可用（legacy）</td>
          <td>
            <strong>发布期直接拒绝</strong>：<code>RAW_IPC_FORBIDDEN</code>
          </td>
        </tr>
        <tr>
          <td>发布后 enabled</td>
          <td>
            <strong>自动置 1</strong>（发布即启用）
          </td>
          <td>
            <strong>置 0</strong>，需再手动启用
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      V1 侧「发布即启用」写在 <code>sub-app.repository.ts:325-329</code>，注释也解释了原因
      （菜单只显示「已发布 + 已启用」，否则用户还得再开一次开关）。 V2 侧相反，
      <code>sub-app-platform.repository.ts:215-217</code> 明确写 <code>enabled = 0</code>， 与{' '}
      <code>spark_app_project_publish</code> 的文档口径一致： 「每次 V2 发布后都保持禁用，需用户查看
      OS effects 后显式重新启用」。 这是两套格式里最容易踩反的一条。
    </p>
    <h2 id="surfaces">3. 五个展示面里，只有三个真的能跑</h2>
    <p>
      <code>SUB_APP_SURFACES</code> 声明了五个值 （
      <code>packages/protocol/src/sub-app.ts:17-23</code>），但渲染路径只覆盖其中三个。
      这一节把「声明」和「实际」分开写，避免你按枚举去猜行为。
    </p>

    <h3 id="surfaces-real">3.1 每个面的真实宿主</h3>
    <table>
      <thead>
        <tr>
          <th>surface</th>
          <th>界面标签</th>
          <th>真实渲染路径</th>
          <th>状态</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>content</code>
          </td>
          <td>内容区</td>
          <td>
            切到 <code>view === 'sub-app'</code> 渲染 <code>&lt;SubAppRunView /&gt;</code>，主内容区
            iframe
          </td>
          <td>可用</td>
        </tr>
        <tr>
          <td>
            <code>panel</code>
          </td>
          <td>—</td>
          <td>
            <code>&lt;SubAppSurfaceHost /&gt;</code> 的侧面板页签
          </td>
          <td>可用</td>
        </tr>
        <tr>
          <td>
            <code>overlay</code>
          </td>
          <td>浮层</td>
          <td>
            <code>&lt;SubAppSurfaceHost /&gt;</code> 的透明悬浮层
          </td>
          <td>可用</td>
        </tr>
        <tr>
          <td>
            <code>global-window</code>
          </td>
          <td>全局窗口</td>
          <td>
            <strong>没有渲染路径</strong>
          </td>
          <td>仅声明</td>
        </tr>
        <tr>
          <td>
            <code>desktop-pet</code>
          </td>
          <td>桌面宠物</td>
          <td>
            <strong>没有渲染路径</strong>
          </td>
          <td>仅声明</td>
        </tr>
      </tbody>
    </table>
    <p>
      判定依据：<code>kindOfSurface()</code> 只对 <code>overlay</code> 与 <code>panel</code>{' '}
      返回类型， 其余一律返回 <code>null</code>（
      <code>design/sub-app/SubAppSurfaceHost.tsx:171-174</code>）； 主进程里
      <strong>没有任何</strong>为子应用创建 <code>BrowserWindow</code> 的代码 （在{' '}
      <code>apps/desktop/src/main/services/SubApp*.ts</code> 与相关 IPC 文件中检索
      <code>BrowserWindow</code> 为空）。<code>global-window</code> 与 <code>desktop-pet</code>
      只出现在协议枚举、建库 CHECK 约束、MCP 工具枚举、
      <code>SUB_APP_SURFACE_CONTRACTS</code>（<code>sub-app-developer-contract.mjs:30-51</code>）、
      一处 CSS 类和一个 <code>switch</code> 标签分支里。 写应用时如果把 <code>surface</code>{' '}
      设成这两个值，发布不会报错，但<strong>用户点「打开」看不到窗口</strong>。
    </p>

    <h3 id="surfaces-label">3.2 一个真实的标签 bug：panel 显示成英文</h3>
    <p>
      管理页的 <code>surfaceLabel()</code> 分支写的是 <code>case 'sidebar'</code>， 但合法枚举里
      <strong>
        没有 <code>sidebar</code>
      </strong>
      ，只有 <code>panel</code>（<code>SubAppsView.tsx:64-78</code> vs <code>sub-app.ts:17-23</code>
      ）。 于是 <code>surfaceLabel('panel')</code> 命中 <code>default</code>，卡片上直接显示英文
      <code>panel</code>；而 <code>sidebar</code> 那个分支永远不会被执行。
      这是显示层的小瑕疵，不影响运行，但你会以为它应该是「侧栏」。
    </p>

    <h3 id="surfaces-runtime">3.3 实例上限与入口</h3>
    <ul>
      <li>
        <code>content</code>：一次只运行一个，因为它就是当前视图本身。
      </li>
      <li>
        <code>overlay</code> / <code>panel</code>：这两类<strong>不进侧栏菜单</strong>，
        统一入口是主窗口<strong>右下角的胶囊启动器</strong>（
        <code>design/sub-app/SubAppSurfaceLauncher.tsx:59-69</code>）：
        任何视图（含画布模式）都常驻，指针移入即展开菜单、移出延迟收起， 胶囊本体可拖动摆放位置且用{' '}
        <code>localStorage</code> 记忆。
      </li>
      <li>
        同时运行的实例数有上限：<code>MAX_OVERLAY_INSTANCES = 3</code>、
        <code>MAX_PANEL_INSTANCES = 1</code>（<code>SubAppSurfaceHost.tsx:31-32</code>， 在{' '}
        <code>:255</code> 处按 kind 取用）。
      </li>
      <li>
        管理页卡片的「更多操作 → 以浮层运行 / 以侧栏运行」只对这两类面出现 （
        <code>SubAppsView.tsx:558-571</code>），文案按 surface 二选一。
      </li>
    </ul>

    <h3 id="sandbox">3.4 沙箱与 CSP</h3>
    <p>
      应用不直接加载你的 HTML，而是被宿主合成一份<strong>运行文档</strong>再注入 CSP （
      <code>design/sub-app/appRuntimeDocument.ts:34-62</code>）。关键指令：
    </p>
    <table>
      <thead>
        <tr>
          <th>指令</th>
          <th>值</th>
          <th>说明</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>default-src</code>
          </td>
          <td>
            <code>'none'</code>
          </td>
          <td>默认全禁，其余逐项放行</td>
        </tr>
        <tr>
          <td>
            <code>script-src</code>
          </td>
          <td>
            <code>'unsafe-inline'</code> + 可选 <code>'unsafe-eval'</code> +{' '}
            <code>capability-asset:</code> + <code>https:</code> <code>http:</code>
          </td>
          <td>
            <code>'unsafe-eval'</code> 由设置开关控制
          </td>
        </tr>
        <tr>
          <td>
            <code>connect-src</code>
          </td>
          <td>
            <code>https: http:</code> 或 <code>'none'</code>
          </td>
          <td>由「允许子应用访问外部网络」开关控制</td>
        </tr>
        <tr>
          <td>
            <code>frame-src</code> / <code>object-src</code> / <code>form-action</code>
          </td>
          <td>
            <code>'none'</code>
          </td>
          <td>固定值，代码注释说明「无场景需要」</td>
        </tr>
        <tr>
          <td>
            <code>img-src</code> / <code>media-src</code>
          </td>
          <td>
            <code>data: blob: https: http: safe-file:</code>（+ 包资源）
          </td>
          <td>允许内嵌与本地文件</td>
        </tr>
        <tr>
          <td>
            <code>base-uri</code>
          </td>
          <td>
            <code>capability-asset:</code> 或 <code>'none'</code>
          </td>
          <td>
            V2 用 <code>&lt;base href&gt;</code> 指向制品根
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      V1 的源码长度在合成文档时判定：<code>source.length &gt; SUB_APP_SOURCE_HARD_LIMIT</code>
      直接抛错（<code>appRuntimeDocument.ts:134-140</code>）；设置里的
      <code>sourceLengthLimit</code> 是<strong>另一层</strong>更早的校验（见 §4.5）。 V1 文档通过{' '}
      <code>sub-app:runtime:put-doc</code> 登记到主进程后以
      <code>capability-asset://subapp-runtime/&lt;token&gt;</code> 加载， 原因是 <code>srcdoc</code>{' '}
      会继承 renderer 的 CSP 而拦掉应用内联脚本 （<code>sub-app.ts:497-508</code> 的注释）。
    </p>

    <h2 id="capabilities">4. 能力与权限：哪里有真强制力</h2>

    <h3 id="capability-list">4.1 17 个能力名</h3>
    <p>
      <code>SUB_APP_CAPABILITIES</code> 共 <strong>17</strong> 个 （<code>sub-app.ts:30-48</code>
      ）：
    </p>
    <table>
      <thead>
        <tr>
          <th>能力</th>
          <th>能做什么（SDK 入口）</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>runtime</code>
          </td>
          <td>
            读只读运行信息 <code>sparkApp.runtime.getInfo()</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>theme</code>
          </td>
          <td>读宿主主题与语义 token、订阅变化</td>
        </tr>
        <tr>
          <td>
            <code>ui</code>
          </td>
          <td>宿主内 toast</td>
        </tr>
        <tr>
          <td>
            <code>data</code>
          </td>
          <td>
            应用隔离 JSON KV：<code>get/list/upsert/delete</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>navigation</code>
          </td>
          <td>
            <code>openApp</code> / <code>openView</code>（视图走白名单）
          </td>
        </tr>
        <tr>
          <td>
            <code>files</code>
          </td>
          <td>应用文件空间 UTF-8 文本读写</td>
        </tr>
        <tr>
          <td>
            <code>clipboard</code>
          </td>
          <td>
            <strong>保留未实现</strong>（无 SDK、无 Bridge 路由）
          </td>
        </tr>
        <tr>
          <td>
            <code>notifications</code>
          </td>
          <td>
            <strong>保留未实现</strong>（同上）
          </td>
        </tr>
        <tr>
          <td>
            <code>agent</code>
          </td>
          <td>
            <code>sparkApp.agent.send</code>：从应用调宿主 Agent
          </td>
        </tr>
        <tr>
          <td>
            <code>canvas</code>
          </td>
          <td>列出画布项目、追加文本</td>
        </tr>
        <tr>
          <td>
            <code>media</code>
          </td>
          <td>创建与查询文本生成媒体任务</td>
        </tr>
        <tr>
          <td>
            <code>browser</code>
          </td>
          <td>内置浏览器打开、媒体识别、下载及文件后续操作</td>
        </tr>
        <tr>
          <td>
            <code>network</code>
          </td>
          <td>
            受管 HTTP：<code>sparkApp.network.request</code>（需连接槽）
          </td>
        </tr>
        <tr>
          <td>
            <code>provider</code>
          </td>
          <td>
            受管 Provider 请求：<code>sparkApp.provider.request</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>backend</code>
          </td>
          <td>
            <code>sparkApp.backend.invoke/status/on</code>（V2 service）
          </td>
        </tr>
        <tr>
          <td>
            <code>jobs</code>
          </td>
          <td>
            <code>sparkApp.jobs.create/get/list/cancel</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>ipc</code>
          </td>
          <td>
            原始宿主 IPC 与 stream（<strong>legacy</strong>，V2 禁用）
          </td>
        </tr>
      </tbody>
    </table>

    <h3 id="permission-check">4.2 权限检查发生在哪一层</h3>
    <p>
      唯一的能力闸门在宿主 renderer 的 Bridge 里 （<code>design/sub-app/bridgeHost.ts:396-411</code>
      ），顺序是：
    </p>
    <ol>
      <li>
        如果该实例 <code>trusted === true</code>，<strong>直接放行</strong>—— manifest 的{' '}
        <code>permissions</code> 只作为旧数据兼容字段保留。
      </li>
      <li>
        否则 <code>runtime</code> 与 <code>theme</code>（只读宿主信息）免声明。
      </li>
      <li>
        其余能力必须出现在 <code>runtimeInfo.permissions</code> 里，否则返回
        <code>PERMISSION_DENIED</code>，提示是 「应用未声明 "&lt;capability&gt;" 权限，请在应用
        manifest permissions 中申请后重新发布。」
      </li>
    </ol>
    <p>
      MCP 工具侧也有一句必须对齐的口径：<code>spark_app_create</code> 的<code>permissions</code>{' '}
      参数说明写着它是「兼容旧版本的 manifest 字段…… 当前 SparkWork
      子应用按平台核心内部应用运行，宿主不会用它裁剪平台 IPC、MCP、 Plugin、Skill、Provider
      或模型能力」 （<code>sub-app-mcp-server.mjs:208-209</code>）。 也就是说：
      <strong>
        别把 <code>permissions</code> 当成安全边界来推理
      </strong>
      ， 它只影响非 trusted 实例的能力裁剪。
    </p>
    <p>
      那你的应用到底算不算 trusted？判定条件是<strong>格式</strong>，界面上没有任何开关：
      两个运行入口都写死 <code>trusted: !isV2</code>（<code>useSubAppRunner.ts:240</code>、
      <code>:319</code>），即
      <strong>V1 单 HTML 应用默认 trusted</strong>（permissions 不再裁剪能力，
      但宿主未实现的域仍会落到 <code>CAPABILITY_NOT_IMPLEMENTED</code>），
      <strong>V2 受管多文件应用默认非 trusted</strong>。 V2 的能力清单来自{' '}
      <code>spark-app.json</code> 的<code>permissions.sparkCapabilities</code>
      ，由存储层映射为运行时的
      <code>permissions</code>（<code>sub-app-package.service.ts:120</code>）；
      漏声明不会在启动时报错，而是在第一次调用该能力时返回
      <code>PERMISSION_DENIED</code>。因此同一份界面上，一个 V1 应用和一个 V2 应用
      可以表现出完全不同的权限行为——这是本节最容易踩空的一点。
    </p>
    <p>
      过了权限检查但宿主没实现的域，会落到兜底的
      <code>CAPABILITY_NOT_IMPLEMENTED</code>（<code>bridgeHost.ts:710-711</code>）。
      <code>clipboard</code> 与 <code>notifications</code> 就走这条路—— 连 SDK 符号都被标成{' '}
      <code>reserved</code>（<code>sub-app-developer-contract.mjs:337-346</code>）， V2 发布时还会被{' '}
      <code>CAPABILITY_RESERVED</code> 直接拦下。
    </p>

    <h3 id="v2-permissions">4.3 V2 的三类权限分开声明</h3>
    <ul>
      <li>
        <code>sparkCapabilities</code>：平台能力，取值同上面 17 个枚举。
      </li>
      <li>
        <code>osEffects</code>：<code>network</code> / <code>filesystem</code> /{' '}
        <code>process</code>。 这是<strong>告知性</strong>
        字段，不参与运行时拦截；它的作用是让启用前能向用户展示 「这个应用会碰系统」。
        <code>spark_app_set_enabled</code> 的说明要求： 含 service 或 OS effects
        时必须先向用户展示「以当前用户权限运行且非安全沙箱」， 得到同意才传{' '}
        <code>confirmTrustedLocal=true</code>。
      </li>
      <li>
        <code>connections</code>：连接槽名列表，每个名字都要在 <code>connections</code>{' '}
        里有声明对象， 否则 <code>CONNECTION_DECLARATION_MISSING</code>。
      </li>
      <li>
        另外：声明了 service 却不给 <code>backend</code> 能力会报
        <code>BACKEND_PERMISSION_MISSING</code>；声明 <code>ipc</code> 会报
        <code>RAW_IPC_FORBIDDEN</code>（两个校验都在
        <code>sub-app-package.service.ts:809-842</code>）。
      </li>
    </ul>

    <h3 id="runtime-settings">4.4 设置里的三个运行时开关</h3>
    <p>
      位置：<strong>设置 → 子应用 → 运行时限制</strong>
      （分类键 <code>sub-app</code>，卡片组件
      <code>design/sub-app/SubAppRuntimeSettingsCard.tsx</code>， 在{' '}
      <code>views/SettingsView.tsx:544</code> 注册）。 三个开关的默认值都是「放行」 （
      <code>appRuntimeDocument.ts:28-32</code>），卡片底部的说明区也直接写明「默认放行」。
    </p>
    <table>
      <thead>
        <tr>
          <th>开关</th>
          <th>默认</th>
          <th>关闭后的实际影响</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>允许子应用访问外部网络</td>
          <td>
            <code>true</code>
          </td>
          <td>
            <code>connect-src</code> 变为 <code>'none'</code>：应用不能直接 fetch/XHR 任意地址，
            只能用 <code>sparkApp</code> 桥交换数据
          </td>
        </tr>
        <tr>
          <td>允许运行时代码编译（unsafe-eval）</td>
          <td>
            <code>true</code>
          </td>
          <td>
            去掉 <code>script-src</code> 里的 <code>'unsafe-eval'</code>： babel-standalone
            这类实时编译不可用，React 需要预编译产物或 <code>createElement</code>
          </td>
        </tr>
        <tr>
          <td>源码长度上限（字符）</td>
          <td>
            <code>0</code>（不限制）
          </td>
          <td>
            <code>0</code> 表示不限制；&gt; 0 时超限源码在<strong>合成运行文档时</strong>被拒绝，
            报「子应用源码超过设置的限制（N 字符），请在设置「子应用」中调整或精简源码。」
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      这三项存在双层存储里：<code>localStorage</code>（键
      <code>spark-settings-sub-app</code>，用于首屏同步读取）+ 主进程
      <code>settings:get/set</code>（category <code>sub-app</code>、key <code>data</code>
      ，权威源）。 改动会广播 <code>spark-settings-updated</code>，正在运行的实例会按新设置
      <strong>重建运行文档</strong>（<code>sub-appRuntimeSettings.ts:1-10</code>、
      <code>SubAppRuntimeSettingsCard.tsx:22-24</code>）。
    </p>
    <p>
      注意上限是两层，别只记得一层：
      <code>sourceLengthLimit</code> 是用户可调的那层，
      <code>SUB_APP_SOURCE_HARD_LIMIT = 5_000_000</code>（5 MB）是 IPC/存储边界的硬上限，
      即使把设置调成「不限制」也不会消失 （<code>sub-app.ts:5-12</code>）。协议注释还留了历史值{' '}
      <code>200_000</code>， 说明这个默认值被刻意放开过。
    </p>

    <h2 id="lifecycle">5. 生命周期：归档是一条单行道</h2>

    <h3 id="status-machine">5.1 两个维度：发布状态 + enabled</h3>
    <p>
      <code>publicationStatus</code> 取 <code>draft</code> / <code>published</code> /{' '}
      <code>archived</code>（<code>sub-app.ts:25</code>，建库侧同样有 CHECK 约束，
      <code>migrations/083_sub_apps.sql:14-15</code>）；
      <code>enabled</code> 是独立布尔量，建库缺省 <code>0</code>。
    </p>
    <table>
      <thead>
        <tr>
          <th>操作</th>
          <th>publicationStatus</th>
          <th>enabled</th>
          <th>证据</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>创建</td>
          <td>
            <code>draft</code>
          </td>
          <td>
            <code>0</code>
          </td>
          <td>
            <code>sub-app.repository.ts:163-166</code>
          </td>
        </tr>
        <tr>
          <td>V1 发布</td>
          <td>
            <code>published</code>
          </td>
          <td>
            <strong>
              <code>1</code>
            </strong>
          </td>
          <td>
            <code>sub-app.repository.ts:325-329</code>
          </td>
        </tr>
        <tr>
          <td>V2 发布</td>
          <td>
            <code>published</code>
          </td>
          <td>
            <strong>
              <code>0</code>
            </strong>
          </td>
          <td>
            <code>sub-app-platform.repository.ts:215-217</code>
          </td>
        </tr>
        <tr>
          <td>启用 / 禁用</td>
          <td>不变</td>
          <td>按参数写 0/1</td>
          <td>
            <code>sub-app.repository.ts:336-352</code>
          </td>
        </tr>
        <tr>
          <td>归档</td>
          <td>
            <code>archived</code>
          </td>
          <td>
            <code>0</code>
          </td>
          <td>
            <code>sub-app.repository.ts:353-364</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      「出现在应用入口」的判定是<strong>两个条件同时成立</strong>：
      <code>list(&#123; menuOnly: true &#125;)</code> 会加上
      <code>publication_status = 'published'</code> <strong>且</strong>
      <code>enabled = 1</code>（<code>sub-app.repository.ts:205-208</code>）。
      所以「草稿但已启用」不会出现在菜单里；反过来，禁用只影响可见性、不动版本。
    </p>
    <p>
      另一个刻意的设计：<code>setEnabled</code> <strong>不</strong>限制「仅已发布可启用」。
      代码注释解释了原因——若只允许已发布启用，草稿态应用一旦禁用就再也恢复不了， 会形成状态死角（
      <code>sub-app.repository.ts:342-345</code>）。
    </p>

    <h3 id="archive-irreversible">5.2 归档之后没有回头路（重要）</h3>
    <p>
      这是本篇最需要你知道的一条：<strong>代码里不存在「取消归档 / 恢复」的路径</strong>。
      归档后应用会变成永久只读，所有能改状态的入口都会被同一条守卫拦下：
    </p>
    <table>
      <thead>
        <tr>
          <th>你想做的事</th>
          <th>结果</th>
          <th>证据</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>直接启用</td>
          <td>抛错「已归档的子应用不能直接启用，请先恢复到草稿或发布状态。」</td>
          <td>
            <code>sub-app.repository.ts:339-341</code>
          </td>
        </tr>
        <tr>
          <td>改草稿 / 发布 / 回滚</td>
          <td>抛错「已归档的子应用不能修改，请先恢复后再操作。」</td>
          <td>
            <code>sub-app.repository.ts:779-783</code>（<code>assertMutable</code>）
          </td>
        </tr>
        <tr>
          <td>写 V2 项目 / 发布 V2</td>
          <td>抛错「已归档的子应用不能修改或发布。」</td>
          <td>
            <code>sub-app-platform.repository.ts:74-78</code>（<code>assertAppRevision</code>）
          </td>
        </tr>
        <tr>
          <td>写应用数据</td>
          <td>抛错「已归档的子应用不能写入数据。」</td>
          <td>
            <code>sub-app.repository.ts:537-541</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      为什么说「没有回头路」：全仓只有<strong>三处</strong>写<code>publication_status</code> 的
      SQL——归档写 <code>'archived'</code>， V1 发布与 V2 发布写 <code>'published'</code>
      ，而这两处发布都被上面的守卫挡住。 也就是说
      <strong>
        没有任何代码会把 <code>archived</code> 改回 <code>draft</code> 或<code>published</code>
      </strong>
      。
    </p>
    <p>更要注意两处口径与代码不符，别被它们误导：</p>
    <ul>
      <li>
        <code>spark_app_archive</code> 的工具说明写「这是<strong>可逆</strong>的低风险收尾操作」 （
        <code>sub-app-mcp-server.mjs:781-783</code>）——按代码它不可逆。
      </li>
      <li>
        管理页的归档二次确认只提示「归档后从列表主视图隐藏，可在此页开启「归档」筛选后查看」 （
        <code>SubAppsView.tsx:297-301</code>），<strong>没有提示从此不能再改</strong>。
      </li>
    </ul>
    <p>
      唯一的「复活」办法是<strong>覆盖导入</strong>：<code>importApp</code> 会先删掉同 id 应用的
      关联行、再整条重插，并按包内是否有发布版本写成 <code>published</code> 或 <code>draft</code>、
      <code>enabled = 1</code>（<code>sub-app.repository.ts:606-635</code>）。
      代价是版本历史、数据、连接槽绑定都会被包内内容整体替换。 所以顺序上要先把应用「分享导出」成{' '}
      <code>.sparkapp</code>（导出不检查归档状态）， 归档后悔了再覆盖导入回来。 结论：
      <strong>归档适合「确实不要了但想留个存档」</strong>； 如果是暂时不用，用「禁用」（
      <code>enabled=0</code>）而不是归档。
    </p>

    <h3 id="delete-cascade">5.3 删除是真删</h3>
    <p>
      管理页的删除确认写得很清楚：「将永久删除源码、全部版本与应用数据，不可恢复。」 （
      <code>SubAppsView.tsx:310-315</code>）。 数据库侧靠外键级联：<code>sub_app_releases</code>、
      <code>sub_app_data</code> 等 都是 <code>ON DELETE CASCADE</code>；仓储层还显式补删一次，
      以兼容旧库没开 <code>foreign_keys</code> pragma 的情况 （
      <code>sub-app.repository.ts:424-440</code>）。 删除历史版本另有约束，见 §6.2。
    </p>

    <h2 id="releases">6. 版本与回滚</h2>

    <h3 id="version-number">6.1 版本号怎么涨</h3>
    <p>
      两种格式都是<strong>取当前最大值 +1</strong>：V1 在<code>sub-app.repository.ts:293-299</code>
      ，V2 在<code>sub-app-platform.repository.ts:190-196</code>，语句都是
      <code>SELECT COALESCE(MAX(version), 0) …</code>。 数据库对 <code>(app_id, version)</code>{' '}
      有唯一约束 （<code>083_sub_apps.sql:43</code>），所以并发发布不会产生重复版本号。
    </p>
    <p>
      发布同时是一次 CAS 写：<code>WHERE id = ? AND draft_revision = ?</code>， 影响行数不是 1 就抛{' '}
      <code>SubAppConflictError</code>（<code>sub-app.repository.ts:331-332</code>）。这意味着
      <strong>Agent 在对话里改了草稿之后，你手上的旧 revision 发布会失败</strong>，
      需要重新读一次草稿。
    </p>
    <p>
      V1 发布还有一道拦截：草稿源码 <code>trim()</code> 后为空直接拒绝，
      注释说明「空源码发布出去必然白屏」 （<code>sub-app.repository.ts:288-291</code>）。
    </p>

    <h3 id="delete-release">6.2 当前生效版本不能删</h3>
    <p>
      <code>deleteRelease</code> 先找出应用行与目标版本，若
      <code>release.id === app.published_release_id</code> 就抛错
      「当前生效版本不能删除，请先发布其他版本后再删除。」 （
      <code>sub-app.repository.ts:404-418</code>）。
      界面上也一致：版本历史抽屉里当前生效那一条不显示删除按钮，改成「当前生效」标记 （
      <code>SubAppsView.tsx:779-793</code>）；
      删除非当前版本的确认文案是「删除后不能恢复，但不会影响当前生效版本。」
      <code>SubAppsView.tsx:781-786</code>。
    </p>

    <h3 id="rollback">6.3 回滚不是切换指针</h3>
    <p>
      两套格式的回滚都把<strong>目标版本的内容写回草稿</strong>，而不是直接把
      <code>published_release_id</code> 指过去：
    </p>
    <ul>
      <li>
        V1：读出该 release 的 source/config/manifest/entry/surface，走一次
        <code>updateDraft</code> 语义把草稿整体替换，<code>draft_revision + 1</code>（
        <code>sub-app.repository.ts:455-492</code>）。
      </li>
      <li>
        V2：把该 release 的制品目录文件全部拷回草稿项目， 写成新的 <code>projectRevision</code>，再
        <code>markDraftAsV2</code>（<code>sub-app-package.service.ts:548-580</code>）。
      </li>
    </ul>
    <p>
      所以界面上「回滚」之后还要再发布一次才会生效；回滚本身不改
      <code>publishedVersion</code>。管理页的发布确认文案也从侧面说明这条链路： 「将以草稿 revision
      N 生成新版本，发布后不可修改。」 （<code>SubAppsView.tsx:694-699</code>）。
    </p>

    <h3 id="artifacts">6.4 V2 制品按内容去重</h3>
    <p>
      发布 V2 时会算一次目录摘要（<code>digestFiles</code>：把路径、字节数、内容按路径排序后
      哈希进同一个 sha256，<code>sub-app-package.service.ts:871-880</code>）， 落库时写{' '}
      <code>ON CONFLICT(sha256) DO NOTHING</code> 再回查真实 id （
      <code>sub-app-platform.repository.ts:154-170</code>）——
      同样内容的包只存一份。运行时会再校验一次摘要，
      不匹配直接抛「子应用发布制品完整性校验失败，已拒绝运行。」 （
      <code>sub-app-package.service.ts:733-738</code>）。 无引用的制品会被清理，
      <code>sub_app_release_artifacts.artifact_id</code> 用的是
      <code>ON DELETE RESTRICT</code>（<code>097_sub_app_platform_v2.sql:26</code>），
      防止误删仍被引用的制品。
    </p>

    <h2 id="data-files">7. 数据、文件与分享包</h2>

    <h3 id="kv-data">7.1 应用数据：KV + revision CAS</h3>
    <p>
      存储是 <code>sub_app_data</code>，主键 <code>(app_id, namespace, key)</code>（
      <code>083_sub_apps.sql:47-56</code>）。 约定与限制：
    </p>
    <ul>
      <li>
        命名空间与键都是 <code>text(120)</code> / <code>text(240)</code>： trim 后非空（
        <code>sub-app.ts</code> 的 IPC schema）。 Agent 侧工具的默认命名空间是 <code>app</code>（
        <code>sub-app-mcp-server.mjs:199</code>）。
      </li>
      <li>
        值必须是可序列化 JSON 且序列化后 <strong>≤ 512 KB</strong>， 否则抛{' '}
        <code>SubAppDataValidationError</code>（<code>sub-app.repository.ts:546-552</code>）。
      </li>
      <li>
        每条记录有 <code>revision</code>（建库 CHECK <code>&gt; 0</code>）。 写入可传{' '}
        <code>expectedRevision</code> 做乐观锁：键不存在却传了期望值会
        <code>SubAppDataConflictError</code>，版本不匹配同样冲突 （
        <code>sub-app.repository.ts:554-580</code>）。
      </li>
      <li>
        删除<strong>必须</strong>带 <code>expectedRevision</code>， IPC schema 里它是必填（
        <code>sub-app.ts</code> 的<code>'sub-app:data:delete'</code>），Agent 工具
        <code>spark_app_data_delete</code> 同样要求先 get 拿 revision。
      </li>
    </ul>

    <h3 id="file-space">7.2 文件空间</h3>
    <p>
      与 KV 互补的一套「应用专属目录」：根目录是
      <code>&lt;userData&gt;/sub-app-files/&lt;appId&gt;/</code>（
      <code>apps/desktop/src/main/ipc/registerSubAppIpc.ts:28</code>； V2 侧同样在{' '}
      <code>registerSubAppPlatformIpc.ts:20</code> 构造）。 路径由主进程规范化校验，越界抛
      <code>PERMISSION_DENIED</code>「文件路径超出应用专属目录。」 （
      <code>SubAppFileStore.ts:27</code>）。
    </p>
    <ul>
      <li>
        路径规则：正斜杠分隔、非空、≤ 240 字符、无 <code>..</code> 段、无盘符或协议前缀 （
        <code>sub-app.ts</code> 的 <code>filePath</code>），主进程还会再做一次 join+resolve
        二次校验（协议注释里明确写了这一点）。
      </li>
      <li>
        单文件写入上限 <strong>2 MB 文本</strong>（IPC schema 的
        <code>content: z.string().max(2_000_000)</code>），与分享包的导出上限一致。
      </li>
      <li>适合放导出快照、生成的 markdown、素材这类文件型内容；结构化小状态应该用 KV。</li>
    </ul>

    <h3 id="share-package">
      7.3 分享包 <code>.sparkapp</code>
    </h3>
    <p>
      分享是<strong>全量语义</strong>：manifest + 草稿 + 全部发布版本 + 全命名空间 data +
      文件空间，导入即可用，不做差量或选择性导入 （协议注释 <code>sub-app.ts:222-236</code>）。
      格式常量 <code>SUB_APP_SHARE_FORMAT_VERSION = 1</code>。
    </p>
    <table>
      <thead>
        <tr>
          <th>维度</th>
          <th>实际值</th>
          <th>证据</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>完整性校验</td>
          <td>
            <code>integrity.sha256</code> 针对「不含 integrity 字段的包体 JSON」
          </td>
          <td>
            <code>sub-app.ts:222-236</code>
          </td>
        </tr>
        <tr>
          <td>是否对抗性签名</td>
          <td>
            <strong>不是</strong>，注释明确说「用于拦截截断/误改的文件，不是对抗性签名」
          </td>
          <td>同上</td>
        </tr>
        <tr>
          <td>密钥</td>
          <td>任何 API Key 都不进包；源码/数据里疑似明文密钥只做启发式提示，包内保留原文</td>
          <td>
            <code>SubAppsView.tsx</code> 弹窗文案 <code>SubAppShareModals.tsx:115</code>
          </td>
        </tr>
        <tr>
          <td>导入时草稿源码上限</td>
          <td>
            <code>260_000</code> 字符 → 诊断为 <code>SOURCE_RUNTIME_LIMIT</code>
          </td>
          <td>
            <code>SubAppShareService.ts:39</code>、<code>:778-790</code>
          </td>
        </tr>
        <tr>
          <td>导入时单条数据上限</td>
          <td>
            <code>512_000</code> → <code>DATA_LIMIT</code>
          </td>
          <td>
            <code>SubAppShareService.ts:45</code>、<code>:812-818</code>
          </td>
        </tr>
        <tr>
          <td>导入时文件条数上限</td>
          <td>
            <code>500</code> → <code>FILE_LIMIT</code>
          </td>
          <td>
            <code>SubAppShareService.ts:43</code>、<code>:836-846</code>
          </td>
        </tr>
        <tr>
          <td>单文件内容上限</td>
          <td>
            <code>2_000_000</code> 字符
          </td>
          <td>
            <code>SubAppShareService.ts:41</code>
          </td>
        </tr>
        <tr>
          <td>包文件总大小上限</td>
          <td>
            <code>128_000_000</code> 字节
          </td>
          <td>
            <code>SubAppShareService.ts:47</code>、<code>:259</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      冲突处理有两种：包内 <code>appId</code> 在本机已存在是 <code>same-id</code>， 可以
      <strong>覆盖导入</strong>，覆盖前会自动把本机当前应用备份成
      <code>.sparkapp</code> 并回报 <code>backupPath</code>（<code>sub-app.ts</code> 的{' '}
      <code>SubAppShareImportApplyResponse</code>）； 只是同名不同 id 属于 <code>same-name</code>，
      界面提示「本机有同名但不同身份的应用：默认作为新应用导入，名称会自动加后缀以区分。」 （
      <code>SubAppShareModals.tsx:342</code>）。 覆盖导入后宿主会
      <strong>关掉该应用的运行中实例</strong>， 避免旧源码继续跑在旧数据结构上（
      <code>SubAppShareModals.tsx:209-212</code>）。
    </p>
    <p>
      导入前会先做一次能力与兼容性体检，检查码是固定枚举：
      <code>FORMAT_VERSION</code>、<code>PLATFORM_VERSION</code>、<code>INTEGRITY</code>、
      <code>IPC_CHANNELS</code>、<code>SOURCE_RUNTIME_LIMIT</code>、<code>SECRET_HINT</code>、
      <code>DATA_LIMIT</code>、<code>FILE_LIMIT</code>、<code>DRAFT_EMPTY</code>、
      <code>V2_BUNDLE</code>（<code>sub-app.ts</code> 的 <code>SubAppShareImportCheck</code>）。
      <code>formatVersion</code> 不识别时会直接拦下导入。
    </p>
    <p>
      V1 应用导出时还会静态扫一遍源码，产出
      <code>capabilities</code> 报告：可解析的宿主 IPC 通道、Provider 引用、
      疑似明文密钥的位置（只记位置不记内容）。 V2 另有可选的 <code>v2</code>{' '}
      段承载受管项目、全部制品与连接槽绑定； 老版本平台解析时忽略该字段，导入会退化成「空壳 V1
      草稿」。
    </p>

    <h2 id="service-jobs">8. V2 后台服务与持久任务</h2>
    <p>
      这两个能力<strong>只有 V2 有</strong>，也是 V2 相对 V1 的主要增量。
      它们共用一个前提：能力声明要对得上，否则发布就被拦。
    </p>

    <h3 id="service">8.1 受管 Node 服务</h3>
    <p>
      在 <code>spark-app.json</code> 里声明 <code>service</code> 即启用，字段见 §2.2。
      运行时行为由主进程管理（<code>apps/desktop/src/main/services/SubAppServiceManager.ts</code>
      ）：
    </p>
    <ul>
      <li>
        <code>lifecycle: 'application'</code>：应用启用后就常驻，重启平台时 由{' '}
        <code>restoreEnabledServices()</code> 重新拉起 （<code>SubAppServiceManager.ts:65</code>）；
        崩溃/退出在计数 <code>nextCount &lt;= 3</code> 时仍按常驻处理（<code>:403</code>）。
      </li>
      <li>
        <code>lifecycle: 'on-demand'</code>：有请求才起，空闲后按
        <code>idleTimeoutSeconds</code> 回收；<strong>缺省 300 秒</strong>（
        <code>SubAppServiceManager.ts:273</code> 的
        <code>(published.manifest.service.idleTimeoutSeconds ?? 300) * 1_000</code>）。
      </li>
      <li>
        未启用时启动会被拒：<code>PERMISSION_DENIED</code>「子应用未启用，不能启动后台服务。」 （
        <code>SubAppServiceManager.ts:231</code>）。
      </li>
      <li>
        状态枚举 <code>stopped / starting / running / degraded / crashed</code>（
        <code>sub-app-v2.ts</code> 的 <code>SubAppServiceRuntimeStatus</code>）， 建库侧同集合并带
        CHECK（<code>097_sub_app_platform_v2.sql:47-49</code>）。
      </li>
      <li>
        服务日志是<strong>有界内存日志</strong>，不落库、不分片： 查询上限 <code>limit ≤ 500</code>
        （IPC schema）， 管理界面的「开发与运维」抽屉读它渲染成 <code>&lt;pre&gt;</code>（
        <code>SubAppOperationsDrawer.tsx:203-213</code>）。
      </li>
    </ul>
    <p>
      服务入口模块的约定形态在脚手架里能直接看到： 默认导出一个{' '}
      <code>invoke(action, input, context)</code>，用
      <code>context.progress(...)</code> 报进度、未知 action 抛错 （
      <code>sub-app-package.service.ts</code> 的 <code>scaffoldService()</code>）。
    </p>

    <h3 id="jobs">8.2 持久任务固定在 release 上</h3>
    <p>
      任务表 <code>sub_app_jobs</code>，状态枚举
      <code>queued / running / succeeded / failed / cancelled / interrupted</code>（
      <code>SUB_APP_JOB_STATUSES</code>，<code>sub-app-v2.ts:255-263</code>），
      <code>progress</code> 是 <code>0..1</code> 的实数并带 CHECK （
      <code>097_sub_app_platform_v2.sql:63-69</code>）。
    </p>
    <ul>
      <li>
        <code>release_id</code> 是 <code>NOT NULL</code> 且外键
        <code>ON DELETE RESTRICT</code>，这就是「release pinning」：
        任务绑在具体某个发布版本上，只要还有任务就不允许删掉那个版本。
      </li>
      <li>
        <code>cancelRequested</code> 是单独标志位：取消先置位， 由执行侧在检查点把状态收敛成{' '}
        <code>cancelled</code>； 排队中取消会<strong>直接</strong>写成 <code>cancelled</code>（
        <code>SubAppJobManager.ts:49-60</code>）。
      </li>
      <li>
        平台启动时 <code>restore()</code> 会把上次残留的 <code>running</code> 任务 统一标成{' '}
        <code>interrupted</code>（<code>SubAppJobManager.ts:19-20</code> →{' '}
        <code>interruptRunningJobs()</code>）。 所以「重启后任务还在跑」是不成立的，需要你自己按
        checkpoint 续做。
      </li>
      <li>
        发布前会检查是否有排队/运行中的任务，有就直接拒绝：
        「子应用存在排队中或运行中的持久任务，为保持 release 一致性，
        请等待任务结束或取消后再发布。」 （<code>sub-app-package.service.ts:494-503</code>）。
        这条最容易在「刚触发一次长任务就想去点发布」时撞上。
      </li>
    </ul>

    <h3 id="diagnose">8.3 联合诊断</h3>
    <p>
      <code>spark_app_diagnose</code> / <code>sub-app:diagnose</code> 会把包校验结果、
      服务状态与运行时上报合并成一份结论，带一个
      <code>correlationId</code>，字段还包括
      <code>runtimeObservation</code>（最近一次运行上报的 status / errors / audit） （
      <code>sub-app-v2.ts</code> 的 <code>SubAppDiagnosticResult</code>）。
      管理页的「开发与运维」抽屉最后一节「联合诊断」展示的就绪/需处理状态、 Correlation ID
      与诊断条目就是它 （<code>SubAppOperationsDrawer.tsx:229-245</code>）。 排障时先看这里的{' '}
      <code>correlationId</code>，再对照日志，能少绕很多路。
    </p>

    <h2 id="connections">9. 连接槽与受管网络</h2>

    <h3 id="connection-declare">9.1 声明与绑定是两件事</h3>
    <p>
      先在 <code>spark-app.json</code> 的 <code>connections</code> 里<strong>声明槽位</strong>，
      再在运行时把槽位<strong>绑定</strong>到本机已有的 API Connection 或 Provider Profile。
      绑定记录存在 <code>sub_app_connection_bindings</code>， 主键 <code>(app_id, slot)</code>（
      <code>097_sub_app_platform_v2.sql:34-45</code>）。
    </p>
    <table>
      <thead>
        <tr>
          <th>层</th>
          <th>字段</th>
          <th>取值 / 规则</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>声明</td>
          <td>
            <code>kind</code>
          </td>
          <td>
            <code>http-api</code> 或 <code>provider</code>
          </td>
        </tr>
        <tr>
          <td>声明</td>
          <td>
            <code>displayName</code>
          </td>
          <td>1~120 字符</td>
        </tr>
        <tr>
          <td>声明</td>
          <td>
            <code>allowedOrigins</code>
          </td>
          <td>
            1~20 个<strong>纯 origin</strong>：必须是 http(s)、路径为 <code>/</code>、无查询与片段
          </td>
        </tr>
        <tr>
          <td>声明</td>
          <td>
            <code>allowPrivateNetwork</code>
          </td>
          <td>可选布尔量；不声明则解析到私网地址一律拒绝</td>
        </tr>
        <tr>
          <td>绑定</td>
          <td>
            <code>bindingKind</code>
          </td>
          <td>
            <code>api-connection</code> 或 <code>provider-profile</code>
          </td>
        </tr>
        <tr>
          <td>绑定</td>
          <td>
            <code>bindingId</code>
          </td>
          <td>
            必须是 uuid（IPC schema），且<strong>不能超出 manifest 的授权 origin</strong>
          </td>
        </tr>
        <tr>
          <td>绑定</td>
          <td>
            <code>grantedOrigins</code>
          </td>
          <td>可选，≤ 20，同样必须是纯 origin</td>
        </tr>
      </tbody>
    </table>
    <p>
      origin 的校验函数叫 <code>origin</code>，注释写明「必须是 http(s) origin，
      不得包含路径、查询或片段」（<code>sub-app-v2.ts:322-338</code>）。 绑定越界时主进程报
      <code>PERMISSION_DENIED</code>「授权 origin 超出 manifest 声明范围。」 （
      <code>apps/desktop/src/main/ipc/subAppBackend.ts:374</code>）。
    </p>

    <h3 id="network-gateway">9.2 受管请求的五道检查</h3>
    <p>
      <code>sparkApp.network.request</code> / <code>sparkApp.provider.request</code>
      都走同一个网关（<code>apps/desktop/src/main/services/SubAppNetworkGateway.ts</code>），
      依次校验：
    </p>
    <ol>
      <li>
        应用必须已启用，否则 <code>PERMISSION_DENIED</code>「子应用未启用，不能发起受管网络请求。」
        （<code>:126</code>）。
      </li>
      <li>
        slot 必须在 manifest 里声明过，否则「应用未声明连接权限：&lt;slot&gt;」（<code>:133</code>
        ）。
      </li>
      <li>
        授权 origin 不能为空，否则「连接没有可用的授权 origin。」（<code>:146</code>）。
      </li>
      <li>
        目标 URL 不得内嵌凭据，否则「受管请求仅允许无内嵌凭据的 HTTP(S) URL。」（<code>:211</code>
        ）。
      </li>
      <li>
        目标 origin 必须在授权集合内（<code>:214</code>），
        且解析到本地/私网地址时必须已获私网授权（<code>:221</code>）。
      </li>
    </ol>
    <p>
      这套检查的价值在于：<strong>密钥由宿主注入，不返回给子应用</strong>（
      <code>sub-app-developer-contract.mjs</code> 对<code>sparkApp.network.request</code> 的说明）。
      所以应用可以调用第三方 API 而自己看不到 Key——
      这是「受管请求」和「设置里直接开外网」的本质区别，后者是裸 fetch。 请求还有容量治理：
      <code>timeoutMs</code> 限制在 1~30 秒 （IPC schema，<code>sub-app-v2.ts</code> 的{' '}
      <code>'sub-app:network:request'</code>）。
    </p>

    <h2 id="agent-tools">10. 用 Agent 创建与维护</h2>
    <p>
      这是产品的主路径：管理页只管展示与生命周期，<strong>写代码靠对话</strong>。
    </p>

    <h3 id="mcp-server">10.1 工具从哪来</h3>
    <p>
      会话会把子应用 MCP server 以 <code>spark_app</code> 这个名字挂上 （
      <code>packages/agent-runtime/src/services/session.service.ts:4481-4482</code>），
      所以模型看到的工具名是 <code>mcp__spark_app__spark_app_*</code>。 服务实现是{' '}
      <code>packages/agent-runtime/src/tools/sub-app-mcp-server.mjs</code>， 共 <strong>39</strong>{' '}
      个工具。
    </p>
    <table>
      <thead>
        <tr>
          <th>分组</th>
          <th>工具</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>生命周期</td>
          <td>
            <code>spark_app_create</code>、<code>spark_app_get</code>、<code>spark_app_list</code>、
            <code>spark_app_update_draft</code>、<code>spark_app_publish</code>、
            <code>spark_app_set_enabled</code>、<code>spark_app_archive</code>、
            <code>spark_app_rollback</code>、<code>spark_app_delete</code>、
            <code>spark_app_list_releases</code>、<code>spark_app_delete_release</code>
          </td>
        </tr>
        <tr>
          <td>数据</td>
          <td>
            <code>spark_app_data_get</code>、<code>spark_app_data_list</code>、
            <code>spark_app_data_set</code>、<code>spark_app_data_delete</code>
          </td>
        </tr>
        <tr>
          <td>V2 受管项目</td>
          <td>
            <code>spark_app_scaffold</code>、<code>spark_app_project_status</code>、
            <code>spark_app_project_read_file</code>、<code>spark_app_project_write_file</code>、
            <code>spark_app_project_delete_file</code>、<code>spark_app_project_publish</code>、
            <code>spark_app_project_export</code>、<code>spark_app_project_import</code>
          </td>
        </tr>
        <tr>
          <td>运行与制品</td>
          <td>
            <code>spark_app_export_source</code>、<code>spark_app_service_status</code>、
            <code>spark_app_service_logs</code>、<code>spark_app_service_restart</code>、
            <code>spark_app_jobs_create</code>、<code>spark_app_jobs_get</code>、
            <code>spark_app_jobs_list</code>、<code>spark_app_jobs_cancel</code>
          </td>
        </tr>
        <tr>
          <td>连接与诊断</td>
          <td>
            <code>spark_app_connections_list</code>、<code>spark_app_connections_bind</code>、
            <code>spark_app_connections_unbind</code>、<code>spark_app_diagnose</code>
          </td>
        </tr>
        <tr>
          <td>契约与迁移</td>
          <td>
            <code>spark_app_developer_guide</code>、<code>spark_app_validate</code>、
            <code>spark_app_migration_report</code>、<code>spark_app_migrate_v1</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      两个对使用方式影响很大的工具说明值得原文记住：
      <code>spark_app_create</code> 明确写了「<strong>仅当用户明确要求平台内置子应用时</strong>」
      才调用，用户只是想开发个工具/网页时应走外部项目；拿不准要先问 （
      <code>sub-app-mcp-server.mjs:531-535</code>）。 另外 MCP 描述里有一条<strong>设计先行</strong>
      流程： 新建或大改必须先出界面预览给用户确认，确认前不要落地，更不要发布 （
      <code>sub-app-mcp-server.mjs:206-209</code> 的 <code>DESIGN_PREVIEW_WORKFLOW_GUIDE</code>）。
    </p>

    <h3 id="developer-guide">10.2 开发契约与 19 个查询主题</h3>
    <p>
      <code>spark_app_developer_guide</code> 不带参数只返回主题目录； 要拿具体内容得按{' '}
      <code>topic</code> / <code>symbol</code> / <code>surface</code> /<code>query</code>{' '}
      精确查（工具 schema 里 <code>includeExamples</code> 默认 <code>true</code>）。 主题共{' '}
      <strong>19</strong> 个 （<code>sub-app-developer-contract.mjs:431-465</code>）：
      <code>overview</code>、<code>surfaces</code>、<code>runtime-sdk</code>、<code>theme</code>、
      <code>data</code>、<code>files</code>、<code>network</code>、<code>provider</code>、
      <code>backend</code>、<code>jobs</code>、<code>agent</code>、<code>media</code>、
      <code>canvas</code>、<code>browser</code>、<code>security</code>、<code>lifecycle</code>、
      <code>publishing</code>、<code>troubleshooting</code>、<code>recipes</code>。
    </p>
    <p>
      契约里每个 SDK 符号都带 <code>status</code>：<code>implemented</code> /<code>legacy</code> /{' '}
      <code>reserved</code>，符号集合导出为
      <code>IMPLEMENTED_SPARK_APP_SYMBOLS</code> 与 <code>RESERVED_SPARK_APP_SYMBOLS</code>（
      <code>sub-app-developer-contract.mjs:481-489</code>），校验器就是拿这两集合判对错的。 legacy
      一族是原始 IPC 通道：
      <code>sparkApp.ipc.invoke</code>、<code>sparkApp.ipc.on</code>、
      <code>sparkApp.platform.ipc/invoke/on/trusted</code>， 契约里明确写了「参数契约不能从 channel
      名推断」， 并且 <code>ipc.on</code> 的 stream channel 必须以 <code>stream:</code> 开头、
      卸载时必须调用异步取消函数。
    </p>

    <h3 id="validate">
      10.3 <code>spark_app_validate</code> 的 17 条诊断
    </h3>
    <p>
      写完之后先跑校验比直接发布省事得多。校验器在
      <code>packages/agent-runtime/src/tools/sub-app-validator.mjs</code>， 可产出的诊断码有：
    </p>
    <table>
      <thead>
        <tr>
          <th>诊断码</th>
          <th>含义</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>SOURCE_EMPTY</code>
          </td>
          <td>源码为空</td>
        </tr>
        <tr>
          <td>
            <code>SOURCE_TOO_LARGE</code>
          </td>
          <td>源码超过硬上限</td>
        </tr>
        <tr>
          <td>
            <code>UNKNOWN_SDK_CAPABILITY</code>
          </td>
          <td>
            用了不存在的 <code>sparkApp.&lt;根&gt;</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>SDK_CAPABILITY_NOT_IMPLEMENTED</code>
          </td>
          <td>
            用了保留但未实现的能力（<code>clipboard</code> / <code>notifications</code>）
          </td>
        </tr>
        <tr>
          <td>
            <code>UNKNOWN_SDK_METHOD</code>
          </td>
          <td>能力域对了但方法名不存在</td>
        </tr>
        <tr>
          <td>
            <code>LEGACY_RAW_IPC</code>
          </td>
          <td>用了 legacy 原始 IPC</td>
        </tr>
        <tr>
          <td>
            <code>LEGACY_PROVIDER_SECRET_ACCESS</code>
          </td>
          <td>试图直接读 Provider 密钥</td>
        </tr>
        <tr>
          <td>
            <code>POSSIBLE_INLINE_SECRET</code>
          </td>
          <td>疑似把明文密钥写进源码</td>
        </tr>
        <tr>
          <td>
            <code>DIRECT_NETWORK_REQUEST</code>
          </td>
          <td>直接 fetch/XHR，未走受管请求</td>
        </tr>
        <tr>
          <td>
            <code>UNSAFE_EVAL_DEPENDENCY</code>
          </td>
          <td>
            依赖实时编译，需要 <code>unsafe-eval</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>NON_DURABLE_BROWSER_STORAGE</code>
          </td>
          <td>用 localStorage 之类存不该丢的数据</td>
        </tr>
        <tr>
          <td>
            <code>DATA_DELETE_REVISION_MISSING</code>
          </td>
          <td>
            <code>data.delete</code> 缺 <code>expectedRevision</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>OVERLAY_BACKGROUND_NOT_DECLARED</code>
          </td>
          <td>浮层应用没声明背景，会看到穿透</td>
        </tr>
        <tr>
          <td>
            <code>THEME_INTEGRATION_NOT_DETECTED</code>
          </td>
          <td>没接入宿主主题 token</td>
        </tr>
        <tr>
          <td>
            <code>JAVASCRIPT_URL</code>
          </td>
          <td>
            出现 <code>javascript:</code> URL
          </td>
        </tr>
        <tr>
          <td>
            <code>CSP_UNSUPPORTED_ELEMENT</code>
          </td>
          <td>用了被 CSP 拦掉的元素（如 iframe/object）</td>
        </tr>
        <tr>
          <td>
            <code>CSP_FORM_SUBMISSION_BLOCKED</code>
          </td>
          <td>
            表单提交会被 <code>form-action 'none'</code> 拦下
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      注意这些都是<strong>静态提示</strong>，不是发布闸门——真正的发布阻断在 §2.2 那套{' '}
      <code>PACKAGE_*</code> / <code>MANIFEST_*</code> 校验里。 两边代码不同、码表也不通用，别把{' '}
      <code>spark_app_validate</code> 当发布预检通过来看。
    </p>

    <h3 id="migrate">10.4 V1 → V2 迁移</h3>
    <p>
      <code>spark_app_migration_report</code> 先扫一遍 V1 应用，列出迁移前要处理的依赖 （原始
      IPC、Provider 明文密钥、相对资源、浏览器存储）；
      <code>spark_app_migrate_v1</code> 再把当前 V1 单文件草稿显式转成同
      <code>appId</code> 的 V2 多文件草稿。两者都<strong>不自动发布</strong>， 原 V1 历史 release
      也保留 （仓储侧就是 <code>SubAppPackageService.migrateV1</code>，
      <code>sub-app-package.service.ts:127</code>）。 迁移是显式操作（要求传当前{' '}
      <code>expectedRevision</code>），不会在你不知情时发生。
    </p>

    <h2 id="storage">11. 数据库与落盘位置</h2>

    <h3 id="tables">11.1 八张表</h3>
    <table>
      <thead>
        <tr>
          <th>表</th>
          <th>用途</th>
          <th>关键约束</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>sub_apps</code>
          </td>
          <td>应用主表（草稿、发布指针、状态、enabled）</td>
          <td>
            主键 <code>id</code>；<code>surface</code> 与 <code>publication_status</code> 有 CHECK；
            <code>draft_revision &gt; 0</code>；有{' '}
            <code>(publication_status, enabled, updated_at DESC)</code>与{' '}
            <code>name COLLATE NOCASE</code> 两个索引（<code>083:6-26</code>）
          </td>
        </tr>
        <tr>
          <td>
            <code>sub_app_releases</code>
          </td>
          <td>不可变发布快照</td>
          <td>
            <code>UNIQUE(app_id, version)</code>；<code>app_id</code> 外键 <code>CASCADE</code>（
            <code>083:28-45</code>）
          </td>
        </tr>
        <tr>
          <td>
            <code>sub_app_data</code>
          </td>
          <td>应用 KV 数据</td>
          <td>
            主键 <code>(app_id, namespace, key)</code>；<code>revision &gt; 0</code>；外键{' '}
            <code>CASCADE</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>sub_app_artifacts</code>
          </td>
          <td>V2 内容寻址制品</td>
          <td>
            <code>sha256</code> 唯一；记录 <code>schema_version</code>、路径、体积、文件数（
            <code>097:9-20</code>）
          </td>
        </tr>
        <tr>
          <td>
            <code>sub_app_release_artifacts</code>
          </td>
          <td>release ↔ 制品关联</td>
          <td>
            <code>release_id</code> 主键且 <code>CASCADE</code>；<code>artifact_id</code> 为{' '}
            <code>ON DELETE RESTRICT</code>；含 <code>permission_digest</code>（
            <code>097:22-32</code>）
          </td>
        </tr>
        <tr>
          <td>
            <code>sub_app_connection_bindings</code>
          </td>
          <td>连接槽绑定</td>
          <td>
            主键 <code>(app_id, slot)</code>；<code>binding_kind</code> 有 CHECK（
            <code>097:34-45</code>）
          </td>
        </tr>
        <tr>
          <td>
            <code>sub_app_service_state</code>
          </td>
          <td>后台服务最新状态</td>
          <td>
            <code>app_id</code> 主键；<code>release_id</code> 为 <code>ON DELETE SET NULL</code>；
            status 有 CHECK（<code>097:47-56</code>）
          </td>
        </tr>
        <tr>
          <td>
            <code>sub_app_jobs</code>
          </td>
          <td>持久任务</td>
          <td>
            <code>release_id</code> 为 <code>NOT NULL</code> + <code>RESTRICT</code>； status
            CHECK；<code>progress</code> 在 0~1（<code>097:58-75</code>）
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      迁移 <code>083</code> 的开头有一句设计说明值得引用：子应用
      <strong>故意没有 session 外键</strong>——会话只是操作入口， 删会话不应影响应用（
      <code>083_sub_apps.sql:1-4</code>）。
    </p>

    <h3 id="paths">11.2 磁盘目录</h3>
    <table>
      <thead>
        <tr>
          <th>内容</th>
          <th>路径</th>
          <th>证据</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>V2 受管项目与制品</td>
          <td>
            <code>&lt;SQLite 同级的&gt;/sub-app-platform/</code>
          </td>
          <td>
            <code>sub-app-package.service.ts:39</code>（<code>path.dirname(database.path)</code>）
          </td>
        </tr>
        <tr>
          <td>草稿项目（按 revision 分目录）</td>
          <td>
            <code>sub-app-platform/projects/&lt;appId&gt;/rev-&lt;n&gt;/</code>
          </td>
          <td>
            <code>sub-app-package.service.ts:744-746</code>
          </td>
        </tr>
        <tr>
          <td>V2 制品</td>
          <td>
            <code>sub-app-platform/artifacts/&lt;sha256&gt;/</code>
          </td>
          <td>
            <code>sub-app-package.service.ts:748-750</code>
          </td>
        </tr>
        <tr>
          <td>应用文件空间</td>
          <td>
            <code>&lt;userData&gt;/sub-app-files/&lt;appId&gt;/</code>
          </td>
          <td>
            <code>registerSubAppIpc.ts:28</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      删除应用后 <code>cleanupDeletedApp</code> 会删掉该项目目录并清理无引用制品 （
      <code>sub-app-package.service.ts:613-621</code>）；
      <code>cleanupOrphanedArtifacts</code> 也能单独清理孤儿制品 （<code>:623-628</code>）。
    </p>

    <h2 id="troubleshooting">12. 排查表</h2>
    <table>
      <thead>
        <tr>
          <th>现象</th>
          <th>先去哪看</th>
          <th>常见原因</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>应用不出现在应用入口</td>
          <td>「我的应用」卡片状态徽标</td>
          <td>
            需同时 <code>published</code> + <code>enabled=1</code>； V2 发布后
            <strong>默认禁用</strong>，要手动启用（§5.1）
          </td>
        </tr>
        <tr>
          <td>点「打开」没有窗口</td>
          <td>卡片上的 surface 标签</td>
          <td>
            surface 是 <code>global-window</code> / <code>desktop-pet</code>： 这两个面没有宿主，见
            §3.1
          </td>
        </tr>
        <tr>
          <td>
            卡片显示英文 <code>panel</code>
          </td>
          <td>—</td>
          <td>已知标签 bug，见 §3.2；不影响运行</td>
        </tr>
        <tr>
          <td>白屏</td>
          <td>应用内 console、开发与运维抽屉</td>
          <td>
            V1 常见是空源码发布（发布口已拦）；CSP 相关看
            <code>CSP_UNSUPPORTED_ELEMENT</code> / <code>CSP_FORM_SUBMISSION_BLOCKED</code>
          </td>
        </tr>
        <tr>
          <td>发布报「草稿源码为空，无法发布」</td>
          <td>—</td>
          <td>
            V1 草稿 <code>trim()</code> 后为空，见 §6.1
          </td>
        </tr>
        <tr>
          <td>
            发布报 <code>SubAppConflictError</code>
          </td>
          <td>重新读一次草稿 revision</td>
          <td>CAS 不匹配：Agent 在对话里改过草稿，见 §6.1</td>
        </tr>
        <tr>
          <td>发布报「存在排队中或运行中的持久任务」</td>
          <td>开发与运维 → 持久任务</td>
          <td>先等任务结束或取消，见 §8.2</td>
        </tr>
        <tr>
          <td>V2 发布报「V2 应用包校验失败」</td>
          <td>开发与运维 → 项目（诊断列表）</td>
          <td>
            对照 §2.2 各 <code>PACKAGE_*</code> / <code>MANIFEST_*</code> 码定位；
            常见是入口文件不存在、声明 service 没给 <code>backend</code>、用了 <code>ipc</code>
          </td>
        </tr>
        <tr>
          <td>启用后改不动、也没法重新启用</td>
          <td>卡片徽标是否「已归档」</td>
          <td>
            <strong>归档不可逆</strong>：所有写入口都被拦，唯一出路是覆盖导入备份的
            <code>.sparkapp</code>，见 §5.2
          </td>
        </tr>
        <tr>
          <td>应用读不到数据 / 写数据报错</td>
          <td>—</td>
          <td>
            archived 拒绝写入（§5.2）；值超过 512 KB 报<code>SubAppDataValidationError</code>
            （§7.1）
          </td>
        </tr>
        <tr>
          <td>
            受管请求报 <code>PERMISSION_DENIED</code>
          </td>
          <td>
            manifest 的 <code>connections</code> 与绑定记录
          </td>
          <td>
            五道检查逐个对照 §9.2；最常见是 slot 没声明、目标 origin 不在授权集合、
            或目标解析到私网而未声明 <code>allowPrivateNetwork</code>
          </td>
        </tr>
        <tr>
          <td>
            应用能力报 <code>PERMISSION_DENIED</code>
          </td>
          <td>实例是否 trusted</td>
          <td>
            非 trusted 实例必须显式声明能力，见 §4.2； 但 MCP 口径是平台子应用不靠{' '}
            <code>permissions</code> 裁剪平台能力
          </td>
        </tr>
        <tr>
          <td>
            能力报 <code>CAPABILITY_NOT_IMPLEMENTED</code>
          </td>
          <td>—</td>
          <td>
            <code>clipboard</code> / <code>notifications</code> 等保留未实现的域（§4.2）
          </td>
        </tr>
        <tr>
          <td>后台服务反复崩</td>
          <td>开发与运维 → 后台服务（最近错误 + 日志）</td>
          <td>
            看 <code>restartCount</code> 与 <code>lastError</code>；<code>application</code>{' '}
            生命周期在计数 ≤ 3 时仍会常驻（§8.1）
          </td>
        </tr>
        <tr>
          <td>重启后任务没了</td>
          <td>开发与运维 → 持久任务</td>
          <td>
            启动时 <code>running</code> 会被标成 <code>interrupted</code>，见 §8.2
          </td>
        </tr>
        <tr>
          <td>删不掉某个版本</td>
          <td>版本历史抽屉</td>
          <td>当前生效版本不允许删除，见 §6.2</td>
        </tr>
        <tr>
          <td>导入分享包被阻断</td>
          <td>导入预览的能力检查报告</td>
          <td>
            按 §7.3 的十个检查码定位；<code>formatVersion</code> 不识别会直接拦
          </td>
        </tr>
        <tr>
          <td>Agent 不去创建子应用</td>
          <td>—</td>
          <td>
            这是刻意的：<code>spark_app_create</code> 只在用户明确要求「平台内置子应用」时才用；
            你可以用 <code>/spark-app-create</code> 强制，见 §10.1
          </td>
        </tr>
      </tbody>
    </table>
  </>
)

const subApps: DocsPageContent = {
  slug: 'sub-apps',
  toc: [
    { id: 'overview', title: '1. 定位与入口', level: 2 },
    { id: 'entry', title: '1.1 真实入口与文案', level: 3 },
    { id: 'not-confused', title: '1.2 别和另外两个「应用/扩展」搞混', level: 3 },
    { id: 'model', title: '2. 数据模型：V1 单文件与 V2 受管多文件', level: 2 },
    { id: 'v1-fields', title: '2.1 V1 的四个结构体', level: 3 },
    { id: 'v2-manifest', title: '2.2 V2 的 spark-app.json', level: 3 },
    { id: 'v1-v2-diff', title: '2.3 两种格式的差异对照', level: 3 },
    { id: 'surfaces', title: '3. 五个展示面里，只有三个真的能跑', level: 2 },
    { id: 'surfaces-real', title: '3.1 每个面的真实宿主', level: 3 },
    { id: 'surfaces-label', title: '3.2 一个真实的标签 bug：panel 显示成英文', level: 3 },
    { id: 'surfaces-runtime', title: '3.3 实例上限与入口', level: 3 },
    { id: 'sandbox', title: '3.4 沙箱与 CSP', level: 3 },
    { id: 'capabilities', title: '4. 能力与权限：哪里有真强制力', level: 2 },
    { id: 'capability-list', title: '4.1 17 个能力名', level: 3 },
    { id: 'permission-check', title: '4.2 权限检查发生在哪一层', level: 3 },
    { id: 'v2-permissions', title: '4.3 V2 的三类权限分开声明', level: 3 },
    { id: 'runtime-settings', title: '4.4 设置里的三个运行时开关', level: 3 },
    { id: 'lifecycle', title: '5. 生命周期：归档是一条单行道', level: 2 },
    { id: 'status-machine', title: '5.1 两个维度：发布状态 + enabled', level: 3 },
    { id: 'archive-irreversible', title: '5.2 归档之后没有回头路（重要）', level: 3 },
    { id: 'delete-cascade', title: '5.3 删除是真删', level: 3 },
    { id: 'releases', title: '6. 版本与回滚', level: 2 },
    { id: 'version-number', title: '6.1 版本号怎么涨', level: 3 },
    { id: 'delete-release', title: '6.2 当前生效版本不能删', level: 3 },
    { id: 'rollback', title: '6.3 回滚不是切换指针', level: 3 },
    { id: 'artifacts', title: '6.4 V2 制品按内容去重', level: 3 },
    { id: 'data-files', title: '7. 数据、文件与分享包', level: 2 },
    { id: 'kv-data', title: '7.1 应用数据：KV + revision CAS', level: 3 },
    { id: 'file-space', title: '7.2 文件空间', level: 3 },
    { id: 'share-package', title: '7.3 分享包 .sparkapp', level: 3 },
    { id: 'service-jobs', title: '8. V2 后台服务与持久任务', level: 2 },
    { id: 'service', title: '8.1 受管 Node 服务', level: 3 },
    { id: 'jobs', title: '8.2 持久任务固定在 release 上', level: 3 },
    { id: 'diagnose', title: '8.3 联合诊断', level: 3 },
    { id: 'connections', title: '9. 连接槽与受管网络', level: 2 },
    { id: 'connection-declare', title: '9.1 声明与绑定是两件事', level: 3 },
    { id: 'network-gateway', title: '9.2 受管请求的五道检查', level: 3 },
    { id: 'agent-tools', title: '10. 用 Agent 创建与维护', level: 2 },
    { id: 'mcp-server', title: '10.1 工具从哪来', level: 3 },
    { id: 'developer-guide', title: '10.2 开发契约与 19 个查询主题', level: 3 },
    { id: 'validate', title: '10.3 spark_app_validate 的 17 条诊断', level: 3 },
    { id: 'migrate', title: '10.4 V1 → V2 迁移', level: 3 },
    { id: 'storage', title: '11. 数据库与落盘位置', level: 2 },
    { id: 'tables', title: '11.1 八张表', level: 3 },
    { id: 'paths', title: '11.2 磁盘目录', level: 3 },
    { id: 'troubleshooting', title: '12. 排查表', level: 2 },
  ],
  faq: [
    {
      question: '子应用在哪里创建？管理页里为什么没有编辑代码的入口？',
      answer:
        '在任意对话里让 Agent 创建，或直接用强制命令 /spark-app-create <需求>。管理页（侧栏「我的应用」）刻意只做展示、启动与生命周期操作——它的文档注释写明「创建与修改主要通过 Agent 会话完成」，空态文案也是引导你去对话。',
    },
    {
      question: '我设了 global-window 或 desktop-pet，为什么点「打开」没反应？',
      answer:
        '因为这两个展示面在代码里只有声明、没有宿主：渲染层只实现了 content（运行页）、panel 与 overlay（浮层/侧板），主进程也没有为子应用创建独立窗口的代码。发布不会报错，但用户看不到窗口。要能跑就用这三个面。',
    },
    {
      question: 'V2 应用发布成功后，为什么没出现在应用入口？',
      answer:
        '这是刻意的：V2 发布时写的是 enabled = 0（而 V1 发布写 enabled = 1）。菜单可见性要求「已发布 + 已启用」两个条件同时成立，所以 V2 发布后需要你确认过 OS effects 再手动启用一次。',
    },
    {
      question: '归档之后还能恢复吗？',
      answer:
        '按代码不能。归档会写 publication_status = archived 且 enabled = 0，之后启用、改草稿、发布、回滚、写数据全部被守卫拦下；全仓没有任何代码把 archived 改回 draft/published。唯一的「复活」方式是覆盖导入之前导出的 .sparkapp 分享包，但那会整体替换版本历史、数据与连接绑定。所以暂时不用请用「禁用」，不要用「归档」。',
    },
    {
      question: '为什么 Agent 明明能删掉某个版本，却删不掉当前生效的那一个？',
      answer:
        '因为 published_release_id 必须始终有指向，否则已发布应用会变成没有可运行版本的空壳。deleteRelease 在目标等于当前生效版本时直接抛错「当前生效版本不能删除，请先发布其他版本后再删除。」',
    },
    {
      question: '应用重启后，之前跑着的持久任务为什么变成 interrupted？',
      answer:
        '平台启动时 restore() 会把上一次残留的 running 任务统一标成 interrupted（interruptRunningJobs），避免出现没有任何进程在跑、状态却显示运行中的假象。要做长任务就得用 checkpoint 字段自己续做。',
    },
  ],
  aiSummary:
    '子应用（Sub-App）是 SparkWork 里把界面装进平台的机制：V1 是单 HTML 源码，V2 是受管多文件项目 + 内容寻址制品 + 可选 Node 后台服务与持久任务。本页讲清五个展示面里只有 content / panel / overlay 真有宿主、17 个能力名与权限检查的真实位置、draft/published/archived 状态机（重点：归档在代码里不可逆）、版本号递增与「当前生效版本不能删」的保护、应用数据 512 KB 上限与 revision CAS、文件空间与 .sparkapp 分享包的十项导入检查，以及 39 个 spark_app_* 工具与 19 个 developer_guide 查询主题。',
  Body,
  quickReference: [
    { key: '入口', value: '侧栏「我的应用」（view id sub-apps，带 Beta 标记）；创建走对话 / 命令' },
    {
      key: '强制命令',
      value: '/spark-app-create <需求>；同族 /spark-app、/spark-app-list、/spark-app-publish',
    },
    {
      key: '展示面',
      value: 'content / panel / overlay 可真跑；global-window / desktop-pet 只有声明',
    },
    { key: '实例上限', value: 'overlay 3 个、panel 1 个；浮层与侧板走右下角胶囊启动器' },
    { key: '能力数', value: '17 个（含 clipboard / notifications 两个保留未实现）' },
    { key: '权限闸门', value: 'renderer 的 bridgeHost.checkPermission；trusted 实例直接放行' },
    {
      key: '运行时开关',
      value: '设置 → 子应用；allowNetworkAccess / allowUnsafeEval / sourceLengthLimit 默认全放行',
    },
    {
      key: '源码长度上限',
      value: '设置里可调（0 = 不限制）；硬上限 SUB_APP_SOURCE_HARD_LIMIT = 5,000,000 字符',
    },
    {
      key: '状态机',
      value: 'draft / published / archived + enabled；菜单要求 published 且 enabled',
    },
    { key: '发布对 enabled 的影响', value: 'V1 置 1（发布即启用）；V2 置 0（需手动启用）' },
    { key: '归档', value: '不可逆；唯一出路是覆盖导入 .sparkapp' },
    { key: '版本号', value: 'MAX(version) + 1；当前生效版本不能删；回滚是把内容写回草稿' },
    { key: 'V2 包清单', value: 'spark-app.json，schemaVersion 2，字段严格校验（多字段即报错）' },
    { key: 'V2 包上限', value: '1000 文件 / 20 MB 总量 / 单文件 5 MB；拒绝符号链接' },
    {
      key: '应用数据',
      value: 'sub_app_data，主键 (app_id, namespace, key)，值 ≤ 512 KB，带 revision CAS',
    },
    { key: '文件空间', value: '<userData>/sub-app-files/<appId>/；单文件 ≤ 2 MB 文本' },
    {
      key: '受管网络',
      value:
        '五道检查：启用 / slot 已声明 / origin 非空 / URL 无凭据 / origin 已授权（私网需显式授权）',
    },
    { key: 'service 生命周期', value: 'on-demand / application；idleTimeout 缺省 300 秒' },
    {
      key: '任务状态',
      value:
        'queued / running / succeeded / failed / cancelled / interrupted；restart 后 running → interrupted',
    },
    {
      key: '工具面',
      value: 'MCP server 名 spark_app，39 个 spark_app_* 工具；developer_guide 19 个主题',
    },
    { key: '分享包', value: '.sparkapp（formatVersion 1），全量语义，integrity 只防截断不是签名' },
    {
      key: '数据库',
      value:
        'sub_apps / releases / data（083）+ artifacts / release_artifacts / connection_bindings / service_state / jobs（097）',
    },
  ],
  howTo: {
    name: '从零做一个子应用并让它出现在应用入口',
    description:
      '走一遍「让 Agent 创建 → 预览 → 发布 → 启用」的完整链路，并避开归档、全局窗口这类坑。',
    totalTime: '约 10 分钟',
    steps: [
      '在任意对话里描述需求，例如「帮我做一个读书打卡子应用，能按周统计」。也可以用强制命令 /spark-app-create 读书打卡。',
      '先确认展示面：要能跑就用 content（内容区）、panel（侧板）或 overlay（浮层）之一。不要选 global-window 或 desktop-pet——它们没有宿主，打开不会有窗口。',
      '让 Agent 先给界面设计预览并确认。这是契约要求：新建或大幅改版必须先出预览，你确认后才开发完整实现。',
      '让 Agent 用 spark_app_validate 自检。17 条诊断里最常见的是 UNKNOWN_SDK_METHOD（方法名不存在）、LEGACY_RAW_IPC（V2 禁用原始 IPC）、POSSIBLE_INLINE_SECRET（源码里有明文密钥）。',
      '如果要 V2（多文件 + 后台服务 + 持久任务），让 Agent 用 spark_app_scaffold 建骨架，再用 spark_app_project_write_file 写文件。需要后台服务就选 fullstack 模板。',
      '发布前先跑 spark_app_project_validate。要过 PACKAGE_* / MANIFEST_* 那套校验：入口文件必须存在、声明 service 必须同时给 backend 能力、V2 不得声明 ipc、clipboard、notifications。',
      '确认没有排队中或运行中的持久任务，否则发布会被「为保持 release 一致性」拒绝。',
      '发布。V1 发布后自动启用、直接进应用入口；V2 发布后是禁用状态，需要下一步。',
      '打开侧栏「我的应用」，找到卡片。V2 应用先看卡片上的状态，确认按需启用；含 service 或 OS effects 时要先确认它以当前用户权限运行、不是沙箱。',
      '点「打开」进入运行页。运行页可以在「发布版 / 草稿预览」之间切换：调试用草稿，验收用发布版。',
      '之后要改动就在对话里改草稿，再回管理页发布。改完发现不满意可以用版本历史里的「回滚」把某个旧版本内容写回草稿——注意回滚后仍要再发布一次才生效。',
      '暂时不用了请用「更多操作 → 禁用」（enabled=0），不要用归档：归档在代码里不可逆，之后改不了也启用不了。确实要清掉就用「删除」，它会连版本和数据一起永久删除。',
    ],
  },
}

export default subApps
