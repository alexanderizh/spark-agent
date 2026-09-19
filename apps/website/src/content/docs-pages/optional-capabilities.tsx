import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      可选功能组件（Optional Capabilities）是 SparkWork 里「按需下载、不进基础安装包」的那批资源：
      Codex 原生运行时、Office 离线预览、本地深度处理、FFmpeg、Chromium 和语音输入资源。
      它们加起来有几百 MB，如果塞进安装包，每个用户都要为可能永远用不到的能力付费。
    </p>
    <p>
      这一页按真实代码讲清四件事：<strong>六个能力其实走两条完全不同的安装通道</strong>、 四个
      external 能力真正的探测与安装实现在哪、<strong>「修复」按钮到底做了什么</strong>、 以及{' '}
      <code>capability-asset://</code> 这个自定义协议怎么把 Office 预览器喂起来。
    </p>
    <p>
      <strong>先给三条最容易搞错的结论</strong>：第一，<code>definitions.ts</code> 里那个{' '}
      <code>source: 'external'</code> 并<strong>不</strong>意味着「不来自 Spark 仓库」——
      它指的是「不走本文档第 6 节的通用归档流水线」，四个 external 能力里有三个照样从 Spark
      自建制品仓库下载； 第二，界面上「安装 / 更新 / 修复」三个按钮
      <strong>调用的是同一个函数</strong>，<code>repair(id)</code> 的实现就是{' '}
      <code>enqueueInstall(id)</code>； 第三，「卸载」只删元数据状态目录，不动那些落在别处的二进制。
    </p>

    <h2 id="overview">1. 这套子系统解决什么问题</h2>
    <p>
      可选功能组件是一层<strong>资源按需分发</strong>的薄管理层：它自己不做下载实现，
      而是把「有没有装、该装哪个版本、下载到哪、装完怎么校验」这四个问题， 分派给 capabilities
      目录下的通用流水线或四个专用完整性服务。
    </p>

    <h3 id="why">1.1 为什么基础安装包不带这些资源</h3>
    <p>
      代码里的注释把动机写得很直白。Office 那条（构建期资源外部化插件）写的是： 「File Viewer
      渲染器通过 <code>import.meta.url</code> 附带大型默认 PPT/PPTX 资源。 Spark 在安装
      office-viewer 后总是提供 <code>capability-asset://</code> URL， 因此保留这些默认资源会在{' '}
      <code>app.asar</code> 里重复一份 Worker/WASM/字体文件。」
    </p>
    <p>
      语音那条例外更具体：识别模型约 219 MB，弱网下不能沿用通用归档的 2 分钟超时， 所以单独给了{' '}
      <code>VOICE_ARCHIVE_DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000</code>（30 分钟）。
    </p>
    <p>
      Chromium 那条则是「体积换独立性」：
      <code>CHROMIUM_ESTIMATED_DOWNLOAD_SIZE = 150 * 1024 * 1024</code>， 下载它是因为 Playwright
      需要一个独立的浏览器，而不是借用你系统里的 Chrome。
    </p>

    <h3 id="two-planes">1.2 「可选功能组件」与「完整性」是什么关系</h3>
    <p>
      在界面上它们是同一块地方——<strong>设置 → 系统 → 完整性</strong>（该设置分区的项 id 是{' '}
      <code>integrity</code>， 图标 <code>Icons.Shield</code>，关键词含「校验 / 修复 / Chromium /
      下载 / 完整性」）。 这一块从上到下依次渲染五张卡片：
    </p>
    <ul>
      <li>
        SDK 完整性（内联在 <code>SettingsView</code> 的 <code>IntegritySection</code>{' '}
        里，不是独立组件）；
      </li>
      <li>
        <code>FfmpegStatusCard</code>（FFmpeg 专项卡片）；
      </li>
      <li>
        <code>CodexRuntimeDiagnosticsCard</code>（Codex 运行时诊断，见第 11 节）；
      </li>
      <li>
        <code>VoiceIntegritySettingsItem</code>（语音输入 ASR 专项卡片）；
      </li>
      <li>
        <code>OptionalCapabilitiesSettingsCard</code>（六个能力的统一列表，见第 3.1 节）。
      </li>
    </ul>
    <p>
      所以「完整性」是<strong>一个界面分区</strong>，不是一套服务；它下面既有统一的能力列表，
      也有历史遗留下来的三个专项卡片（FFmpeg、语音、Codex 诊断）。
    </p>
    <p>
      <strong>一个容易被误解的点</strong>：Chromium 虽然属于可选功能组件、也能从这个列表里安装，
      但它的独立状态卡片并不在「完整性」里，而是在<strong>设置 → 系统 → 浏览器自动化</strong>
      （设置分区「系统」下的项 id <code>playwright</code>，组件 <code>PlaywrightStatusCard</code>
      ）。
    </p>

    <h3 id="inventory">1.3 六个能力清单</h3>
    <p>
      能力定义在 <code>apps/desktop/src/main/services/optional-capabilities/definitions.ts</code> 的{' '}
      <code>OPTIONAL_CAPABILITY_DEFINITIONS</code> 数组里，一共六项。 每项的字段类型如下：
    </p>
    <table>
      <thead>
        <tr>
          <th>字段</th>
          <th>类型</th>
          <th>含义</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>id</code>
          </td>
          <td>
            <code>OptionalCapabilityId</code>
          </td>
          <td>六选一的联合类型（见第 12 节）</td>
        </tr>
        <tr>
          <td>
            <code>displayName</code>
          </td>
          <td>
            <code>string</code>
          </td>
          <td>界面显示名</td>
        </tr>
        <tr>
          <td>
            <code>description</code>
          </td>
          <td>
            <code>string</code>
          </td>
          <td>界面副标题</td>
        </tr>
        <tr>
          <td>
            <code>source</code>
          </td>
          <td>
            <code>'archive' | 'external'</code>
          </td>
          <td>安装通道，二选一</td>
        </tr>
        <tr>
          <td>
            <code>cancellable</code>
          </td>
          <td>
            <code>boolean</code>
          </td>
          <td>安装过程中能否取消</td>
        </tr>
        <tr>
          <td>
            <code>supportsUninstall</code>
          </td>
          <td>
            <code>boolean</code>
          </td>
          <td>能否在应用内卸载</td>
        </tr>
        <tr>
          <td>
            <code>selectArtifacts</code>
          </td>
          <td>
            <code>(manifest, platform, arch) =&gt; SparkInstallArtifact[]</code>
          </td>
          <td>从安装清单里挑出要下载的制品</td>
        </tr>
      </tbody>
    </table>
    <p>六个能力的实际取值：</p>
    <table>
      <thead>
        <tr>
          <th>id</th>
          <th>显示名</th>
          <th>source</th>
          <th>cancellable</th>
          <th>supportsUninstall</th>
          <th>制品选择</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>codex-runtime</code>
          </td>
          <td>Codex 本地运行环境</td>
          <td>
            <code>external</code>
          </td>
          <td>false</td>
          <td>false</td>
          <td>
            <code>() =&gt; []</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>office-viewer</code>
          </td>
          <td>离线 Office 预览</td>
          <td>
            <code>archive</code>
          </td>
          <td>true</td>
          <td>true</td>
          <td>
            前缀 <code>archive.optional-office-viewer-</code>，取最新一个
          </td>
        </tr>
        <tr>
          <td>
            <code>local-depth</code>
          </td>
          <td>本地深度处理</td>
          <td>
            <code>archive</code>
          </td>
          <td>true</td>
          <td>true</td>
          <td>
            前缀 <code>runtime.optional-depth-</code> +{' '}
            <code>model.depth-anything-v2-small-int8-</code>，两个都要有
          </td>
        </tr>
        <tr>
          <td>
            <code>ffmpeg</code>
          </td>
          <td>FFmpeg</td>
          <td>
            <code>external</code>
          </td>
          <td>false</td>
          <td>false</td>
          <td>
            <code>() =&gt; []</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>chromium</code>
          </td>
          <td>Chromium 浏览器运行环境</td>
          <td>
            <code>external</code>
          </td>
          <td>false</td>
          <td>false</td>
          <td>
            <code>() =&gt; []</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>voice-pack</code>
          </td>
          <td>语音输入资源</td>
          <td>
            <code>external</code>
          </td>
          <td>false</td>
          <td>false</td>
          <td>
            <code>() =&gt; []</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      <strong>注意这个分布</strong>：六个能力里只有两个（<code>office-viewer</code>、
      <code>local-depth</code>） 走通用归档通道，另外四个走 external
      通道。而「能在应用内取消」和「能在应用内卸载」这两个能力，
      <strong>只有那两个 archive 能力有</strong>。
    </p>
    <p>
      <code>archive</code> 与 <code>external</code> 的差异在 <code>performInstall</code>{' '}
      的第一行体现： 只要 <code>definition.source === 'external'</code>，立刻转向{' '}
      <code>performExternalInstall</code>， 完全不碰后面那套 manifest 解析、暂存、备份、激活的代码。
    </p>

    <h2 id="channels">2. 两条安装通道</h2>
    <p>
      <code>OptionalCapabilityManager.performInstall</code> 是个分叉点： 它按 <code>source</code>{' '}
      把请求送给两条互不相干的实现。
    </p>

    <h3 id="archive-channel">2.1 source: archive —— 通用归档流水线</h3>
    <p>
      这条通道完全由 <code>OptionalCapabilityManager</code> 自己实现，特点是<strong>统一性</strong>
      ： 两个 archive 能力共享同一套「解析清单 → 校验制品 → 下载 → 校验包内文件 → 暂存 → 备份 → 激活
      → 写状态」 流程，所有路径都在{' '}
      <code>&#123;userData&#125;/optional-capabilities/&lt;capabilityId&gt;/</code> 之下。 细节见第
      6 节。
    </p>
    <p>
      归档格式有硬性限制：<code>validateArtifacts</code> 要求 <code>artifact.archive.format</code>{' '}
      必须是 <code>tar.gz</code> 或 <code>zip</code>，其它一律拒绝。制品 URL 也必须是{' '}
      <code>https:</code>，这是在同一处显式检查的。
    </p>

    <h3 id="external-channel">2.2 source: external —— 四个专用完整性服务</h3>
    <p>
      四个 external 能力的真正实现不在 <code>optional-capabilities/</code> 目录里， 而在{' '}
      <code>apps/desktop/src/main/services/</code> 下的四个独立服务：
    </p>
    <table>
      <thead>
        <tr>
          <th>能力</th>
          <th>服务文件</th>
          <th>行数</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>codex-runtime</code>
          </td>
          <td>
            <code>services/CodexRuntimeIntegrityService.ts</code>
          </td>
          <td>507</td>
        </tr>
        <tr>
          <td>
            <code>ffmpeg</code>
          </td>
          <td>
            <code>services/FfmpegIntegrityService.ts</code>
          </td>
          <td>492</td>
        </tr>
        <tr>
          <td>
            <code>chromium</code>
          </td>
          <td>
            <code>services/PlaywrightIntegrityService.ts</code>
          </td>
          <td>442</td>
        </tr>
        <tr>
          <td>
            <code>voice-pack</code>
          </td>
          <td>
            <code>services/VoiceIntegrityService.ts</code>
          </td>
          <td>615</td>
        </tr>
      </tbody>
    </table>
    <p>
      桥接层是 <code>optional-capabilities/externalCapabilityAdapters.ts</code>
      ：它把每个服务包成一个
      <code>ExternalCapabilityAdapter</code>，只有两个方法——<code>describe()</code>（读状态）和{' '}
      <code>install()</code>（执行安装）。管理器只认这两个方法，不认识底下的服务。
    </p>
    <p>
      <code>getExternalCapabilityAdapters()</code> 在 <code>registerOptionalCapabilityIpc.ts</code>{' '}
      里 被传给管理器构造函数，这就是四个能力的装配点。
    </p>

    <h3 id="empty-select">2.3 为什么 external 的 selectArtifacts 返回空数组</h3>
    <p>
      这是最容易读错的一处：<code>selectArtifacts: () =&gt; []</code>{' '}
      看起来像「这个能力不需要制品」， 实际含义是「
      <strong>这个能力不使用通用通道的制品选择器</strong>」。
    </p>
    <p>
      证据是调用关系：<code>selectArtifacts</code> 只在 archive 分支里被调用 （
      <code>performInstall</code> 里 <code>definition.selectArtifacts(manifest, ...)</code>{' '}
      那几行）， 而 external 分支在它之前就 return 了。四个 external
      能力各自在适配器里用自己的选择器直接读清单：
    </p>
    <table>
      <thead>
        <tr>
          <th>能力</th>
          <th>真正的选择器</th>
          <th>过滤条件</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>codex-runtime</code>
          </td>
          <td>
            <code>selectCodexRuntimeArtifact(artifacts, triple, sdkVersion, platform, arch)</code>
          </td>
          <td>
            <code>runtime === 'codex'</code> 或 id 前缀 <code>runtime.codex</code>
            ，再按平台/架构/协议基线筛
          </td>
        </tr>
        <tr>
          <td>
            <code>ffmpeg</code>
          </td>
          <td>
            <code>selectFfmpegArtifact(artifacts, platform, arch)</code>
          </td>
          <td>
            <code>type === 'binary'</code> 且 id 前缀 <code>binary.ffmpeg</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>chromium</code>
          </td>
          <td>无——见下方说明</td>
          <td>不走 Spark 清单</td>
        </tr>
        <tr>
          <td>
            <code>voice-pack</code>
          </td>
          <td>
            <code>selectVoiceNativeArtifact</code> + <code>selectVoiceModelArtifact</code>
          </td>
          <td>
            <code>type === 'voice'</code>，id 前缀 <code>voice.native.</code> /{' '}
            <code>voice.model.</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      <strong>Chromium 是唯一的例外</strong>：它不走 Spark 自建制品清单，而是直接用应用内已装好的
      Playwright 包去拉浏览器。这一点在 <code>performExternalInstall</code> 的注释里写得很明确：
      「Chromium 可以从已经随包提供的 Playwright 包安装，不需要 Spark 制品清单。
      其他适配器会从它们自己的选择器给出精确的『制品不可用』错误。」
    </p>
    <p>
      也就是说：<strong>external 里有三个依赖 Spark 自建仓库，一个（Chromium）依赖 npm 生态</strong>
      。 这一层差异是排查时最该先分清的一步—— 前三者装不上要怀疑制品仓库与网络，Chromium
      装不上要怀疑 pnpm / 内置 Node 运行时。
    </p>
    <h2 id="entry-points">3. 用户能看到的三个入口</h2>
    <p>
      这套子系统在界面上没有独立页面，只有三个入口：一张设置卡片、一个启动弹窗、以及组件内部的按需提示。
    </p>

    <h3 id="settings-card">3.1 设置 → 系统 → 完整性 → 可选功能组件</h3>
    <p>
      组件是 <code>OptionalCapabilitiesSettingsCard</code>，区块标题「<strong>可选功能组件</strong>
      」， 副标题「Codex、Office、视频处理、浏览器和语音资源按需安装，不占用基础安装包空间。」，
      右上角一个「检查更新」按钮（调 <code>actions.refresh(true)</code>，即强制走远程）。
    </p>
    <p>
      列表每行显示：显示名、状态文本、描述、以及（正在安装时的）进度条与进度文案；出错时多一行红色错误文本。
      右侧操作区依次是：
    </p>
    <table>
      <thead>
        <tr>
          <th>控件</th>
          <th>出现条件</th>
          <th>实际行为</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>「自动更新」开关</td>
          <td>
            <code>item.installedVersion</code> 非空
          </td>
          <td>
            <code>optional-capability:set-auto-update</code>
          </td>
        </tr>
        <tr>
          <td>主按钮</td>
          <td>
            始终渲染，但 <code>targetVersion == null</code> 时禁用
          </td>
          <td>按状态分派到 install / update / repair</td>
        </tr>
        <tr>
          <td>「卸载」按钮</td>
          <td>
            <code>installedVersion</code> 非空且 <code>supportsUninstall !== false</code>
          </td>
          <td>先弹确认框，再调 uninstall</td>
        </tr>
      </tbody>
    </table>
    <p>
      主按钮的文案与分派规则（<code>primaryLabel</code> / <code>primaryAction</code>）是：
    </p>
    <table>
      <thead>
        <tr>
          <th>能力状态</th>
          <th>按钮文案</th>
          <th>调用</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>update_available</code>
          </td>
          <td>更新</td>
          <td>
            <code>actions.update(id)</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>damaged</code> 或 <code>error</code>
          </td>
          <td>修复</td>
          <td>
            <code>actions.repair(id)</code>
          </td>
        </tr>
        <tr>
          <td>已安装但无更新</td>
          <td>重新安装</td>
          <td>
            <code>actions.install(id)</code>
          </td>
        </tr>
        <tr>
          <td>未安装</td>
          <td>安装</td>
          <td>
            <code>actions.install(id)</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      状态文本（<code>statusText</code>）逐字如下：
    </p>
    <ul>
      <li>
        <code>ready</code> → 「已安装 &lt;版本号&gt;」
      </li>
      <li>
        <code>update_available</code> → 「已安装 &lt;版本号&gt;，有更新」
      </li>
      <li>
        <code>damaged</code> → 「组件损坏 · &lt;版本号&gt;」
      </li>
      <li>
        <code>error</code> → 「安装失败」
      </li>
      <li>其它且有目标版本 → 「未安装 · 下载 xx.x MB」</li>
      <li>其它且无目标版本 → 「当前平台暂不可用」</li>
    </ul>
    <p>
      卡片底部还有一个「<strong>选择并安装可选功能</strong>
      」按钮，副文案「重新打开批量安装弹窗，查看全部组件状态」， 它不直接安装，而是派发一个{' '}
      <code>CustomEvent</code>（事件名 <code>spark:open-optional-capability-center</code>）去打开第
      3.2 节的弹窗。 这个导航桥接就写在 5 行的 <code>optionalCapabilityNavigation.ts</code> 里。
    </p>
    <p>
      卸载确认框的文案是固定两条：标题「卸载&lt;显示名&gt;」，描述「卸载后再次使用该功能需要重新下载资源。」，
      确认按钮「卸载」，且 <code>danger: true</code>。
    </p>

    <h3 id="startup-prompt">3.2 启动批量安装弹窗</h3>
    <p>
      组件是 <code>OptionalCapabilityCenter</code>，挂在 <code>App.tsx</code> 的顶层， 条件是{' '}
      <code>t.view !== 'onboarding'</code>（引导流程里不打扰）。它同时承担<strong>两种角色</strong>
      ： 启动提醒，和手动打开的「安装可选功能」弹窗。
    </p>
    <table>
      <thead>
        <tr>
          <th>模式</th>
          <th>触发</th>
          <th>标题</th>
          <th>列表内容</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>startup</td>
          <td>
            <code>shouldShowCapabilityPrompt</code> 为真且用户没关掉
          </td>
          <td>「安装可选功能」；若全部是更新则「核心组件更新」</td>
          <td>只列出「值得提醒」的能力</td>
        </tr>
        <tr>
          <td>manual</td>
          <td>
            收到 <code>spark:open-optional-capability-center</code> 事件
          </td>
          <td>「安装可选功能」</td>
          <td>列出全部六个能力</td>
        </tr>
      </tbody>
    </table>
    <p>
      弹窗宽度 640，底部按钮依次是「稍后」（manual 模式下文案变成「关闭」）、 「前往完整性」（
      <strong>只在 startup 模式出现</strong>）、以及主按钮
      「后台更新」/「后台安装」（按当前选中项是否全为更新切换），后面跟一个括号里的已选数量。
    </p>
    <p>
      选中项的下载总量会实时汇总显示在底部（<code>共 xx MB</code>）。 startup
      模式下还有一个复选框，文案完整是： 「
      <strong>不再在启动时提醒（下个版本更新会再提醒一次；也可在“设置 → 完整性”中手动安装）</strong>
      」。
    </p>
    <p>
      另外还有一个独立的悬浮进度卡（<code>aside</code>，<code>aria-label="可选功能安装进度"</code>
      ）， 标题「功能资源」，可点 × 收起。它只显示处于活跃阶段（非 <code>missing</code>）的项，
      每项显示进度条、<code>已下载 / 总量</code> 或消息文本、以及队列位次（<code>队列 N</code>）。
      取消按钮只在阶段为 <code>queued</code> 或 <code>downloading</code>、且该能力{' '}
      <code>cancellable !== false</code> 时出现——按第 1.3 节的表，这意味着四个 external 能力身上
      <strong>不会出现这个按钮</strong>。
    </p>

    <h3 id="inline-entry">3.3 组件内按需入口</h3>
    <p>
      当某个功能真的被用到、而资源还没装时，组件会就地提示而不是报错。 目前的实例是{' '}
      <code>OfficeFileViewer</code>：它订阅同一份能力快照， 只要 <code>office-viewer</code>{' '}
      没就绪，就把文件查看器替换成一块占位区。
    </p>
    <p>占位区的文案逐字如下：</p>
    <ul>
      <li>标题：「需要安装离线 Office 预览资源」</li>
      <li>正在检查时：「正在检查当前平台可用的 Office 预览资源…」</li>
      <li>有目标版本时：「需下载约 xx.x MB，安装后会自动重试预览。」</li>
      <li>没有目标版本时：「当前平台暂时没有可用的 Office 预览资源。」</li>
      <li>按钮：「安装 Office 预览资源」（检查中时显示「正在检查资源…」）</li>
      <li>安装中：显示进度消息与百分比，不再显示按钮</li>
    </ul>
    <p>
      这里有一个值得学的细节：如果快照里 <code>office-viewer</code> 既没装、也没有{' '}
      <code>targetVersion</code>，它会<strong>先强制刷新一次远程清单</strong>（
      <code>refreshCapabilities(true)</code>）， 且用 <code>manifestRefreshAttemptedRef</code>{' '}
      保证只尝试一次，避免打转。
      这么做是因为清单缓存可能是空的或过期的，直接判定「当前平台不可用」会误导用户。
    </p>

    <h2 id="external-detail">4. 四个 external 能力的探测与安装</h2>
    <p>
      这一节是全文最实在的部分：逐个说明「怎么判断装了没」和「点安装之后到底发生了什么」。
      四个能力共用一个描述结构 <code>ExternalCapabilityDescription</code>，字段是 <code>state</code>
      、<code>installedVersion</code>、<code>targetVersion</code>、<code>downloadSize</code>、
      <code>installedSize</code>、<code>error</code>、<code>errorCode</code>、<code>retryable</code>
      。
    </p>

    <h3 id="codex-runtime">4.1 codex-runtime</h3>
    <p>
      <strong>探测</strong>：
    </p>
    <ul>
      <li>
        先调 <code>configureCodexRuntimeEnvironment()</code>，它会写{' '}
        <code>SPARK_CODEX_RUNTIME_ROOT</code>，从包元数据里读出 Codex SDK 版本并写{' '}
        <code>SPARK_CODEX_SDK_VERSION</code>；打包态还会写{' '}
        <code>SPARK_CODEX_REQUIRE_RUNTIME=1</code>。
      </li>
      <li>
        读取托管状态文件，位置是 <code>&#123;userData&#125;/agent-runtimes/codex</code>（开发/非
        Electron 环境回落到 <code>&#123;cwd&#125;/.spark-agent/agent-runtimes/codex</code>）。
      </li>
      <li>
        另外有一个<strong>开发态旁路</strong>：只有没打包（<code>!app.isPackaged</code>
        ）且能解析出内置 Codex CLI 时，才算「已安装」，并把版本标成字符串 <code>bundled</code>。
      </li>
    </ul>
    <p>
      <strong>安装</strong>：
    </p>
    <ul>
      <li>
        从 Spark 自建制品清单里选制品（<code>fetchSparkInstallManifest()</code> +{' '}
        <code>selectCodexRuntimeArtifact</code>），下载到暂存目录{' '}
        <code>&#123;root&#125;/.staging-&lt;pid&gt;-&lt;时间戳&gt;</code>。
      </li>
      <li>
        激活后的目录结构是 <code>&#123;root&#125;/&lt;版本&gt;/&lt;targetTriple&gt;</code>，并写一个{' '}
        <code>active.json</code> 指针。
      </li>
      <li>
        前置校验很硬：没有 SDK 版本直接失败，提示「应用内缺少 Codex JS SDK，请先升级或重新安装 Spark
        Agent」；平台不支持时提示「当前平台不支持 Codex runtime (平台/架构)」。
      </li>
    </ul>
    <p>
      <code>codexTargetTriple()</code> 决定平台三元组，<code>targetTriple</code> 为{' '}
      <code>'unsupported'</code> 时 会被归一成 <code>null</code>，适配器随即给出「当前平台暂不支持
      Codex 运行时」。
    </p>

    <h3 id="ffmpeg">4.2 ffmpeg</h3>
    <p>
      <strong>探测优先级是三级</strong>（<code>doDetectFfmpegIntegrity</code>）：
    </p>
    <ol>
      <li>
        <strong>managed</strong>：扫 <code>&#123;userData&#125;/bin/</code> 下的子目录，找含{' '}
        <code>ffmpeg</code>（Windows 是 <code>ffmpeg.exe</code>）可执行文件的目录，跑一次{' '}
        <code>ffmpeg -version</code>（超时 5 秒）确认它能真的执行。
      </li>
      <li>
        <strong>system</strong>：用 <code>which</code>（Windows 是 <code>where</code>）定位系统 PATH
        里的 ffmpeg，同样要 <code>-version</code> 成功——注释说明这是为了排除「文件存在但 dyld
        库缺失崩溃」的假可用。
      </li>
      <li>
        <strong>none</strong>：都没有，则 <code>ffmpegReady: false</code>。
      </li>
    </ol>
    <p>
      返回结构 <code>FfmpegIntegrityState</code> 的字段是：
    </p>
    <table>
      <thead>
        <tr>
          <th>字段</th>
          <th>含义</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>ffmpegReady</code>
          </td>
          <td>是否可用</td>
        </tr>
        <tr>
          <td>
            <code>ffmpegSource</code>
          </td>
          <td>
            <code>'managed' | 'system' | 'none'</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>ffmpegVersion</code>
          </td>
          <td>
            从 <code>ffmpeg -version</code> 首行解析出的版本号
          </td>
        </tr>
        <tr>
          <td>
            <code>ffprobeReady</code>
          </td>
          <td>同目录下 ffprobe 是否存在</td>
        </tr>
        <tr>
          <td>
            <code>binaryPath</code>
          </td>
          <td>ffmpeg 绝对路径</td>
        </tr>
        <tr>
          <td>
            <code>ffprobePath</code>
          </td>
          <td>ffprobe 绝对路径</td>
        </tr>
        <tr>
          <td>
            <code>lastError</code>
          </td>
          <td>上一次失败原因</td>
        </tr>
      </tbody>
    </table>
    <p>
      <strong>版本选择</strong>用目录名而不是跑二进制：正则{' '}
      <code>/(\d+(?:\.\d+)&#123;1,2&#125;)/</code> 从目录名里抽版本元组，例如
      <code>FFmpeg-8.1.2-Windows-x64</code> → <code>[8,1,2]</code>。 这么做的理由写在注释里：保持{' '}
      <code>resolveManagedBinaryDir</code> 的同步签名，并规避在 Windows 上对陈旧
      <code>ffmpeg.exe</code> 起子进程（可能触发杀软）。 比较函数 <code>compareVersionTuples</code>{' '}
      是<strong>降序</strong>的，所以 <code>[0]</code> 就是最高版本，
      这也是「升级后新旧目录并存时不会误命中旧版本」的保障。
    </p>
    <p>
      <strong>安装</strong>：<code>installFfmpegFromSparkManifest</code> 从清单里选制品， 落盘目录是{' '}
      <code>&#123;userData&#125;/bin/&lt;artifact.name 清洗后的名字&gt;</code>。
      清洗规则是：去掉非法字符、空白折叠成 <code>-</code>、去掉圆括号；名字为空则退回用 artifact id
      清洗。 装完做三件事：非 Windows 平台对 ffmpeg/ffprobe <code>chmod 0o755</code>
      、二次探测确认真的可用、 最后清理其它旧的 ffmpeg 目录（<code>cleanupOldFfmpegDirs</code>
      ，失败只 warn）。
    </p>
    <p>
      二次探测失败时报的是「FFmpeg 下载完成，但未能在 &lt;目录&gt; 检测到可用的 ffmpeg 二进制」，
      这是个明确的「下载成功但不可用」信号，排查时和「下载失败」要分开看。
    </p>
    <p>
      运行时取二进制的入口是 <code>resolveFfmpegBin()</code>，它优先用缓存状态， 缺失时报「FFmpeg
      不可用。请在「设置 → 完整性」中下载 FFmpeg，或确认系统已安装 ffmpeg 并在 PATH 中。」； ffprobe
      缺失时另有一条提示，说明关键帧时间戳解析需要它。
    </p>

    <h3 id="chromium">4.3 chromium</h3>
    <p>
      这一项和其他三个都不同——<strong>它不读 Spark 制品清单</strong>。判定与安装都围绕 Playwright
      包展开。
    </p>
    <p>
      <strong>探测</strong>（<code>detectIntegrity</code>）返回{' '}
      <code>PlaywrightIntegrityState</code>：
    </p>
    <table>
      <thead>
        <tr>
          <th>字段</th>
          <th>来源</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>mcpInstalled</code> / <code>mcpVersion</code>
          </td>
          <td>
            能否解析出 <code>@playwright/mcp</code> 的 <code>package.json</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>playwrightInstalled</code>
          </td>
          <td>
            能否解析出 <code>playwright</code> 的 <code>package.json</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>browserReady</code>
          </td>
          <td>浏览器探测结果</td>
        </tr>
        <tr>
          <td>
            <code>browserSource</code>
          </td>
          <td>
            <code>'bundled' | 'system' | 'none'</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>lastError</code>
          </td>
          <td>沿用缓存里的错误</td>
        </tr>
      </tbody>
    </table>
    <p>
      包解析是<strong>同步</strong>的，路径按四组候选依次尝试：
      <code>&lt;root&gt;/node_modules/...</code>、把 <code>.asar</code> 换成{' '}
      <code>.asar.unpacked</code> 的变体、
      <code>&lt;root&gt;/apps/desktop/node_modules/...</code>、
      <code>&lt;root&gt;/packages/agent-runtime/node_modules/...</code>。 这是为了同时覆盖打包态与
      monorepo 开发态的多种 pnpm 布局。
    </p>
    <p>
      浏览器就绪探测按优先级三级：内置 <code>browsers/</code> 目录 → 系统 Chrome/Edge → Playwright
      默认缓存。
    </p>
    <p>
      <strong>安装</strong>（<code>installBrowser</code>）：
    </p>
    <table>
      <thead>
        <tr>
          <th>场景</th>
          <th>命令</th>
          <th>工作目录</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>打包态</td>
          <td>
            <code>
              &lt;内置 Node&gt; &lt;resourcesPath&gt;/playwright-mcp/node_modules/playwright/cli.js
              install chromium
            </code>
          </td>
          <td>
            <code>&#123;userData&#125;</code>
          </td>
        </tr>
        <tr>
          <td>开发态</td>
          <td>
            <code>pnpm exec playwright install chromium</code>（Windows 用 <code>pnpm.cmd</code> 且{' '}
            <code>shell: true</code>）
          </td>
          <td>desktop 应用目录</td>
        </tr>
      </tbody>
    </table>
    <p>
      下载目录由 <code>getBrowserInstallDirectory</code> 决定：
      <strong>
        打包态是 <code>&#123;userData&#125;/browsers</code>， 开发态是{' '}
        <code>&lt;desktopDir&gt;/browsers</code>
      </strong>
      。 命令通过环境变量 <code>PLAYWRIGHT_BROWSERS_PATH</code> 指向该目录， 装完后再把它写进{' '}
      <code>process.env</code>，这样后续的 Playwright 与 MCP 子进程都能解析到新浏览器。 子进程超时是
      5 分钟（<code>300_000</code>）。
    </p>
    <p>
      装完会重新探测，若 <code>browserSource !== 'bundled'</code> 就判定失败，提示
      「浏览器下载完成，但未能在内置目录检测到 Chromium: &lt;目录&gt;」。
    </p>
    <p>
      另外注意 <code>installMcp()</code> 是独立的一条路径（
      <code>pnpm add @playwright/mcp playwright</code>）， 它属于浏览器自动化的 MCP
      依赖安装，不在这个能力列表的按钮里。
    </p>

    <h3 id="voice-pack">4.4 voice-pack</h3>
    <p>
      语音包由<strong>三个组件</strong>构成，这是它比其它三个复杂的原因：
      <code>native</code>（sherpa-onnx 运行时）、<code>model</code>（识别模型）、
      <code>refine</code>（离线精修模型，<strong>可选</strong>）。
    </p>
    <p>
      <strong>平台支持是白名单</strong>（<code>voicePlatformKey</code>）：
    </p>
    <table>
      <thead>
        <tr>
          <th>平台键</th>
          <th>平台 / 架构</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>darwin-arm64</code>
          </td>
          <td>macOS Apple Silicon</td>
        </tr>
        <tr>
          <td>
            <code>darwin-x64</code>
          </td>
          <td>macOS Intel</td>
        </tr>
        <tr>
          <td>
            <code>win32-x64</code>
          </td>
          <td>Windows x64</td>
        </tr>
        <tr>
          <td>
            <code>linux-x64</code>
          </td>
          <td>Linux x64</td>
        </tr>
      </tbody>
    </table>
    <p>
      不在表里的组合返回 <code>null</code>，能力状态直接标成不支持： 「当前平台不支持语音输入
      (平台/架构)」。 例如 Windows on ARM 与 Linux arm64 就是这种情况。
    </p>
    <p>
      <strong>探测</strong>（<code>checkVoiceIntegrity</code>）读三处落盘：
    </p>
    <ul>
      <li>
        根目录 <code>&#123;userData&#125;/voice</code>（非 Electron 环境回落到{' '}
        <code>&#123;cwd&#125;/.spark-agent/voice</code>）；
      </li>
      <li>
        状态文件 <code>voice-state.json</code>，记录每个组件的 <code>version</code> /{' '}
        <code>artifactId</code> 与 <code>updatedAt</code>；
      </li>
      <li>
        各组件的实际目录：native 在 <code>voice/native/&lt;版本&gt;-&lt;平台键&gt;</code>、model 在{' '}
        <code>voice/model/&lt;版本&gt;</code>、refine 在 <code>voice/refine/&lt;版本&gt;</code>。
      </li>
    </ul>
    <p>
      native 的判定不是只看状态文件，还会读目录里的 <code>package.json</code>； model / refine
      则检查 <code>model-package.json</code> / <code>refine-package.json</code> 是否存在。
      状态里还有一个<strong>从磁盘恢复</strong>的兜底（<code>recovered-from-disk</code>），
      用于状态文件丢失但文件其实在的情况。
    </p>
    <p>
      <strong>安装</strong>（<code>installVoicePack(force, onProgress)</code>）的行为：
    </p>
    <ul>
      <li>
        用一个模块级布尔 <code>installInFlight</code> 做<strong>单飞保护</strong>
        ，重复调用直接返回「语音包正在安装中，请稍候」。
      </li>
      <li>
        下载顺序是<strong>先 model 后 native 再 refine</strong>
        。注释解释了原因：模型体积最大，先完成并原子激活；每完成一个组件就立刻写状态，这样后续组件失败时重试不会重复下载大模型。
      </li>
      <li>
        非强制模式下，若核心组件（native + model）已就绪且 refine
        无需补装，直接返回「语音包已就绪」。
      </li>
      <li>
        已安装同版本时不重复下载（按 <code>isVoiceModelVersionInstalled</code> /{' '}
        <code>isVoiceNativeVersionInstalled</code> / <code>isVoiceRefineVersionInstalled</code>{' '}
        判断）。
      </li>
      <li>
        激活方式是「先删目标目录、再 <code>rename</code> 暂存目录」，暂存目录是{' '}
        <code>&#123;root&#125;/.staging-&lt;pid&gt;-&lt;时间戳&gt;</code>，<code>finally</code>{' '}
        里清理。
      </li>
      <li>
        超时错误会被翻译成人话：匹配到 timeout / timed out / aborted
        就提示「下载超时，请检查网络或代理后重试」。30 分钟的超时常量正是为它准备的。
      </li>
    </ul>
    <p>
      <code>refine</code> 组件是<strong>允许静默缺失</strong>的：清单里没有它不算失败，
      缺它时组件状态里的提示是「未安装离线精修模型（可选，用于说完后整段优化）」。 另外{' '}
      <code>ready</code> 的定义是 <code>native &amp;&amp; model</code>，<strong>不含 refine</strong>
      。
    </p>
    <h2 id="codex-version">5. Codex 运行时的版本选择规则</h2>
    <p>
      这是四个 external 能力里唯一有<strong>复杂版本协商</strong>的一个，也是最容易被用户误解为 bug
      的地方： 「为什么我这里是 0.144.5，云端明明有更新的版本却不让我装？」
      这一节讲清规则，以及界面上会给出的解释。
    </p>

    <h3 id="protocol-baseline">5.1 协议基线</h3>
    <p>
      常量 <code>MIN_SUPPORTED_MANAGED_CODEX_RUNTIME_VERSION = '0.144.5'</code> 定义在{' '}
      <code>packages/agent-runtime/src/sdk/codex-runtime.ts</code>。 选择器第一件事就是按它过滤：
      <strong>低于这个版本的制品连候选都进不去</strong>， 理由是「低于协议基线的 runtime
      连加载都不允许，更不该被推荐安装」。
    </p>
    <p>
      如果清单里该平台的制品全都低于基线，结果是 <code>below-protocol-baseline</code>，
      对用户的解释是：「云端 &lt;平台&gt; 平台的 Codex 运行时（版本…）全部低于应用要求的协议基线
      0.144.5，无法安装。 请等待仓库补齐该平台的运行时制品。」
    </p>

    <h3 id="selection-reasons">5.2 五种选择结果</h3>
    <p>
      <code>selectCodexRuntimeArtifact</code> 返回{' '}
      <code>&#123; artifact?, reason, candidateVersions &#125;</code>，<code>reason</code>{' '}
      是五种之一：
    </p>
    <table>
      <thead>
        <tr>
          <th>reason</th>
          <th>含义</th>
          <th>是否给出可用制品</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>exact-sdk-match</code>
          </td>
          <td>
            云端有与应用内 JS SDK <strong>精确配对</strong>的制品（最稳）
          </td>
          <td>是</td>
        </tr>
        <tr>
          <td>
            <code>newest-compatible</code>
          </td>
          <td>没有精确配对，退到「不高于应用内 SDK 的最新受支持版本」</td>
          <td>是</td>
        </tr>
        <tr>
          <td>
            <code>no-published-runtime</code>
          </td>
          <td>清单里没有任何本平台/架构的 Codex 运行时</td>
          <td>否</td>
        </tr>
        <tr>
          <td>
            <code>below-protocol-baseline</code>
          </td>
          <td>该平台有制品，但版本全部低于协议基线</td>
          <td>否</td>
        </tr>
        <tr>
          <td>
            <code>newer-than-app-sdk</code>
          </td>
          <td>
            云端制品全部<strong>晚于</strong>应用内 SDK（应用比仓库旧）
          </td>
          <td>否</td>
        </tr>
      </tbody>
    </table>
    <p>
      「精确配对」的判定写得很具体——<code>isCompatibleWithCodexSdk</code> 要求制品满足二者之一：
    </p>
    <ul>
      <li>
        <code>artifact.sdkPackage === '@openai/codex-sdk@' + sdkVersion</code>；
      </li>
      <li>
        或者 <code>artifact.dependencies</code> 数组里包含上面这个字符串。
      </li>
    </ul>
    <p>
      这就是文档标题里说的「与应用内 SDK 匹配」的<strong>实际比对代码</strong>——
      它不是比较主版本号，而是一个拼好的精确字符串。
    </p>
    <p>
      选择顺序是：先筛平台/架构/版本安全性 → 按协议基线过滤 → 按版本降序排 → 尝试精确配对 →
      退到「不新于应用内 SDK」的第一个 → 都没有则返回 <code>newer-than-app-sdk</code>。
      注意最后那个分支注释特别说明：「SDK 版本未知时上面的 notNewerThanApp
      会保留全部候选，因此不会再落到这个分支」—— 也就是说 <code>newer-than-app-sdk</code> 只在
      <strong>确实知道 SDK 版本、且云端全部更新</strong>时才出现。
    </p>
    <p>
      还有一层制品合法性校验（<code>validateCodexArtifact</code>）：类型必须是 <code>binary</code>、
      必须有合法的 64 位十六进制 SHA256、<code>targetTriple</code> 必须匹配、 版本号必须符合{' '}
      <code>/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/</code>、<code>sdkPackage</code> 若存在必须以{' '}
      <code>@openai/codex-sdk@</code> 开头。
    </p>
    <p>界面上会把「为什么不给我更新」解释清楚。三种提示逐字如下：</p>
    <ul>
      <li>
        云端版本更新但不配对：「云端已有更新版本 &lt;版本&gt;，但它与应用内置的 Codex SDK
        &lt;版本&gt; 不配对。请先升级 Spark Agent 应用，再更新 Codex 运行时。」
      </li>
      <li>
        没有该平台制品：「云端仓库暂未提供 &lt;triple&gt; 平台的 Codex
        运行时。请检查网络后重试；若持续存在，请等待仓库补齐该平台制品或反馈给维护者。」
      </li>
      <li>
        云端全部更新：「云端 Codex 运行时（…）全部新于应用内置的 Codex SDK
        &lt;版本&gt;，直接安装可能不兼容。请先升级 Spark Agent 应用，再更新 Codex 运行时。」
      </li>
    </ul>
    <p>
      另有一个反向优化：若本机已装版本<strong>不低于</strong>
      云端最新，则按「已是最新」呈现而不是报错，
      注释写的是「已经没有可执行的动作，此时既不该报错，也不该解释『为什么不装更新的』」。
    </p>

    <h3 id="env-injection">5.3 环境变量注入</h3>
    <p>
      运行时靠环境变量被下游发现，注入点只有 <code>configureCodexRuntimeEnvironment()</code> 一处：
    </p>
    <table>
      <thead>
        <tr>
          <th>环境变量</th>
          <th>值</th>
          <th>条件</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>SPARK_CODEX_RUNTIME_ROOT</code>
          </td>
          <td>
            <code>&#123;userData&#125;/agent-runtimes/codex</code>
          </td>
          <td>总是设置</td>
        </tr>
        <tr>
          <td>
            <code>SPARK_CODEX_SDK_VERSION</code>
          </td>
          <td>
            从 <code>@openai/codex-sdk</code> 包元数据读到的版本
          </td>
          <td>读到了才设置</td>
        </tr>
        <tr>
          <td>
            <code>SPARK_CODEX_REQUIRE_RUNTIME</code>
          </td>
          <td>
            <code>1</code>
          </td>
          <td>仅打包态</td>
        </tr>
      </tbody>
    </table>
    <p>
      函数注释强调「必须在任何 SessionService 可能创建前设置，避免 Codex executor 看到旧环境」。
      这也是为什么适配器的 <code>describe()</code> 一进来就先调它——读状态的同时顺便把环境对齐。
    </p>
    <p>
      SDK 版本的读取方式有个坑值得记：它用 <code>findPackageJSON</code> 直接定位包元数据， 而不是{' '}
      <code>createRequire().resolve()</code>。原因是 Codex SDK 只暴露 ESM <code>import</code>{' '}
      条件，用 require 解析会抛 <code>ERR_PACKAGE_PATH_NOT_EXPORTED</code>。
    </p>

    <h2 id="archive-pipeline">6. archive 能力的安装流水线</h2>
    <p>
      这一节讲 <code>office-viewer</code> 与 <code>local-depth</code> 共用的通用流程。
      它是整台子系统里<strong>校验最严格</strong>的部分，也是「修复」按钮真正起作用的地方。
    </p>

    <h3 id="pipeline-steps">6.1 七个阶段</h3>
    <p>
      <code>performInstall</code> 的顺序是：
    </p>
    <ol>
      <li>
        <strong>刷新清单</strong>：<code>refreshManifest()</code>，失败则报{' '}
        <code>manifest_unavailable</code>，文案「无法连接组件仓库，请检查网络后重试」。
      </li>
      <li>
        <strong>选制品</strong>：<code>selectArtifacts</code> 为空则报{' '}
        <code>artifact_unavailable</code>，文案「当前平台暂无可用制品」，且{' '}
        <code>retryable: false</code>。
      </li>
      <li>
        <strong>校验制品</strong>：<code>validateArtifacts</code>，失败报{' '}
        <code>artifact_invalid</code>「远程制品清单无效」。
      </li>
      <li>
        <strong>准备目录</strong>：暂存目录{' '}
        <code>&#123;capabilityRoot&#125;/.staging-&lt;uuid&gt;</code>，目标目录{' '}
        <code>&#123;capabilityRoot&#125;/versions/&lt;安全化版本号&gt;</code>，备份目录是目标目录加{' '}
        <code>.backup-&lt;uuid&gt;</code> 后缀。
      </li>
      <li>
        <strong>逐个下载并校验</strong>：对每个制品调 <code>installArchive</code>（下载 + 校验
        sha256 + 解压），然后 <code>validateInstalledArtifact</code>{' '}
        逐文件比对哈希；任何一步失败都报 <code>package_invalid</code>
        ，文案「组件缺少必需文件或完整性校验未通过，请重试安装」。
      </li>
      <li>
        <strong>激活</strong>：把已存在的目标目录改名成备份，再把暂存目录改名成目标目录，然后写{' '}
        <code>active.json</code>。
      </li>
      <li>
        <strong>清场</strong>：成功后删掉备份；<code>finally</code> 里无条件清理暂存与备份残留。
      </li>
    </ol>
    <p>
      进度阶段（<code>OptionalCapabilityPhase</code> 里可用于进度的取值）依次是 <code>queued</code>{' '}
      → <code>downloading</code> → <code>verifying</code> → <code>extracting</code> →{' '}
      <code>activating</code> → <code>ready</code>，失败时是 <code>error</code>，取消时是{' '}
      <code>cancelled</code>。 注意 <code>extracting</code> 由 <code>installArchive</code> 的{' '}
      <code>onStage</code> 回调上报， 而 <code>downloading</code> 阶段会被跳过（
      <code>if (stage === 'downloading') return</code>），避免重复发事件。
    </p>
    <p>
      安装是<strong>串行队列</strong>：<code>enqueueInstall</code> 用一个 <code>queueTail</code>{' '}
      Promise 链把任务排队， 同一个能力的重复请求直接复用已有的 Promise（
      <code>if (existing) return existing</code>）。 排队中的任务会收到一条 <code>queued</code>{' '}
      进度，带当前队列位置。
    </p>

    <h3 id="package-manifest">6.2 包内 manifest 与全量哈希</h3>
    <p>
      每个制品解压后必须包含一个包内 manifest，文件名由 artifactId 决定：
      <code>model.</code> 开头的是 <code>model-package.json</code>， 其它一律是{' '}
      <code>capability-package.json</code>。
    </p>
    <p>
      <code>validatePackageDirectory</code> 会依次检查：
    </p>
    <ul>
      <li>
        <code>schemaVersion === 1</code>，且 <code>version</code> 与制品版本一致；
      </li>
      <li>
        非 model 制品还要求 <code>capabilityId</code> 与 <code>artifactId</code> 都对得上；
      </li>
      <li>
        必须有 <code>files</code> 对象；
      </li>
      <li>
        调 <code>validateCapabilityPackageHealth</code>（见 6.3）；
      </li>
      <li>
        <strong>逐文件</strong>比对 SHA-256，路径必须安全（见下），且不允许符号链接逃逸。
      </li>
    </ul>
    <p>路径与符号链接的防护有三层：</p>
    <table>
      <thead>
        <tr>
          <th>函数</th>
          <th>检查</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>safePackageFile</code>
          </td>
          <td>
            路径非空、不含反斜杠、<code>resolve</code> 后必须仍在包根目录之下
          </td>
        </tr>
        <tr>
          <td>
            <code>assertNoSymlinkEscape</code>
          </td>
          <td>
            文件本身不能是符号链接；<code>realpath</code> 后必须在包根目录之下
          </td>
        </tr>
        <tr>
          <td>
            <code>directorySize</code>
          </td>
          <td>遍历时遇到符号链接直接抛错「能力包不能包含符号链接」</td>
        </tr>
      </tbody>
    </table>

    <h3 id="health-scope">6.3 CapabilityPackageHealth 的实际覆盖面</h3>
    <p>
      这一项要特别说清楚，因为它的名字容易让人以为它管所有能力。
      <code>validateCapabilityPackageHealth</code> 的分支<strong>只有两条</strong>：
    </p>
    <ul>
      <li>
        能力是 <code>office-viewer</code>：要求 artifactId 以{' '}
        <code>archive.optional-office-viewer-</code> 开头，再校验 15 个必需文件是否都有哈希。
      </li>
      <li>
        artifactId 以 <code>runtime.optional-depth-</code> 或{' '}
        <code>model.depth-anything-v2-small-int8-</code> 开头：走深度处理的两条校验。
      </li>
      <li>
        其它任何输入 → <strong>抛错</strong>：「…不是受支持的 Office Viewer
        制品」/「…不是受支持的本地深度制品」。
      </li>
    </ul>
    <p>
      也就是说，<strong>四个 external 能力完全不经过这套校验</strong>——它们走{' '}
      <code>performExternalInstall</code>，
      根本不会走到这一层。而「完整性修复」在界面上的两个能力也只有 <code>office-viewer</code> 与{' '}
      <code>local-depth</code>。
    </p>
    <p>Office 的 15 个必需文件（原样抄自代码）：</p>
    <pre>
      <code>
        &#123; 'flyfish-viewer-manifest.json', 'flyfish-viewer-assets.json',
        'vendor/docx/docx.worker.js', 'vendor/docx/jszip.min.js', 'vendor/xlsx/sheet.worker.js',
        'vendor/pptx/pptx.worker.js', 'vendor/ppt/index.mjs', 'vendor/ppt/worker.mjs',
        'vendor/ppt/frame-cache.mjs', 'vendor/ppt/ppt-native.wasm', 'vendor/ppt/ppt-font-cjk.otf',
        'vendor/ppt/manifest.json', 'vendor/ppt/package.json', 'vendor/ppt/LICENSE',
        'vendor/ppt/NOTICE', &#125;
      </code>
    </pre>
    <p>深度处理的校验明显更严，理由是可以写出来的：</p>
    <table>
      <thead>
        <tr>
          <th>检查项</th>
          <th>规则</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Runtime 入口</td>
          <td>
            必须是 <code>node_modules/@huggingface/transformers/src/transformers.js</code>
          </td>
        </tr>
        <tr>
          <td>平台/架构</td>
          <td>
            包内 manifest 的 <code>platform</code> / <code>arch</code> 必须与制品一致
          </td>
        </tr>
        <tr>
          <td>依赖</td>
          <td>
            必须声明 <code>@huggingface/transformers</code> 与 <code>onnxruntime-node</code>
          </td>
        </tr>
        <tr>
          <td>禁止项</td>
          <td>
            不得包含 <code>onnxruntime-web</code>（依赖里和工作目录里都查）
          </td>
        </tr>
        <tr>
          <td>原生绑定</td>
          <td>
            必须有{' '}
            <code>
              node_modules/onnxruntime-node/bin/napi-v6/&lt;平台&gt;/&lt;架构&gt;/onnxruntime_binding.node
            </code>
          </td>
        </tr>
        <tr>
          <td>原生动态库</td>
          <td>
            该目录下必须至少有一个匹配平台的可执行库：macOS <code>.dylib</code>、Linux{' '}
            <code>.so</code>、Windows <code>.dll</code>
          </td>
        </tr>
        <tr>
          <td>异平台文件</td>
          <td>
            <code>onnxruntime-node/bin/napi-v6/</code> 下不允许出现非目标平台目录的文件
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      model 那一侧的校验很简单：包内 manifest 的 <code>modelId</code> 必须是{' '}
      <code>depth-anything-v2-small-int8</code>，并且必须含 <code>LICENSE</code>、
      <code>config.json</code>、<code>onnx/model_int8.onnx</code>、
      <code>preprocessor_config.json</code> 四个文件。
    </p>

    <h3 id="rollback">6.4 回滚与旧版本保留</h3>
    <p>回滚发生在两个不同的时间点，语义不同：</p>
    <table>
      <thead>
        <tr>
          <th>时机</th>
          <th>行为</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            激活<strong>之前</strong>失败（下载/校验出错）
          </td>
          <td>
            目标目录从未被改过，旧版本原封不动还在。有一个测试专门锁死这点：「keeps the active
            version when an update fails before activation」。
          </td>
        </tr>
        <tr>
          <td>
            激活<strong>过程中</strong>失败
          </td>
          <td>
            删掉半成品目标目录，把备份目录改名还原回去，报 <code>activation_failed</code>
            「无法激活新版本，<strong>原版本已保留</strong>」。
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      备份机制天然提供了<strong>单版本回退</strong>：激活时先把当前目标目录改名成{' '}
      <code>.backup-&lt;uuid&gt;</code>，成功后才删除。但要注意它<strong>不是版本历史</strong>——
      备份只在这一次激活期间存在，成功即删，没有「回滚到上一个版本」的功能。
    </p>

    <h2 id="state">7. 状态与落盘位置</h2>
    <p>
      这一节把「东西到底存在哪」一次列清。三个状态文件都在{' '}
      <code>&#123;userData&#125;/optional-capabilities/</code> 之下。
    </p>

    <h3 id="active-json">7.1 active.json 的字段与校验</h3>
    <p>
      位置是 <code>&#123;userData&#125;/optional-capabilities/&lt;能力 id&gt;/active.json</code>，
      写入用「先写 <code>.new</code> 再 <code>rename</code>」的原子替换，文件权限 <code>0o600</code>
      。 结构是 <code>ActiveCapabilityState</code>：
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
            <code>schemaVersion</code>
          </td>
          <td>
            固定 <code>1</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>capabilityId</code>
          </td>
          <td>必须是请求的那个能力</td>
        </tr>
        <tr>
          <td>
            <code>version</code>
          </td>
          <td>当前激活版本</td>
        </tr>
        <tr>
          <td>
            <code>autoUpdate</code>
          </td>
          <td>布尔</td>
        </tr>
        <tr>
          <td>
            <code>activatedAt</code>
          </td>
          <td>ISO 时间字符串</td>
        </tr>
        <tr>
          <td>
            <code>runtimeFailure</code>
          </td>
          <td>
            可选；含 <code>code</code>（固定 <code>package_invalid</code>）、<code>message</code>、
            <code>retryable</code>、<code>reportedAt</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>artifacts</code>
          </td>
          <td>
            以 artifactId 为键；每项含 <code>version</code>、<code>sha256</code>、
            <code>manifestSha256</code>、<code>directory</code>、<code>size</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      <code>read()</code> 对这份文件做<strong>严格的结构校验</strong>：schemaVersion
      不符、capabilityId 不符、 two 个 sha256 不是 64 位十六进制、size
      不是正整数——任意一条不满足就抛
      <code>Invalid active state for &lt;id&gt;</code>。只有文件不存在（<code>ENOENT</code>）才返回{' '}
      <code>null</code>。
    </p>
    <p>
      状态<strong>不能只信文件</strong>。真正判定「这份状态还有效吗」的是{' '}
      <code>validateActiveState</code>， 它会重新算包内 manifest 的哈希并与{' '}
      <code>manifestSha256</code> 比对，再跑一遍完整的 <code>validatePackageDirectory</code>（即 6.2
      + 6.3 的全部检查）。 校验结果按 <code>activeStateKey</code>（activatedAt + version +
      各制品指纹）缓存， 缓存命中就不再重复算哈希。
    </p>
    <p>
      这个过程直接决定界面状态：校验通过且没有运行时失败 → <code>ready</code>；
      校验通过但目标版本不同 → <code>update_available</code>；
      <strong>
        校验不通过 → <code>damaged</code>
      </strong>
      ，界面显示「需要修复」，主按钮变成「修复」。
    </p>
    <p>
      另一个把状态标成 <code>damaged</code> 的来源是<strong>运行时失败上报</strong>：
      <code>reportRuntimeFailure(id, cause)</code> 会往 active.json 里写 <code>runtimeFailure</code>
      ， 文案固定为「&lt;显示名&gt;运行验证失败：原生 Runtime 无法加载，请更新或修复组件」。
      目前的调用点是画布深度任务（<code>registerCanvasDepthTaskIpc</code>）——也就是说，
      <strong>
        只有 <code>local-depth</code> 会走这条路径
      </strong>
      ，而且它是「真跑崩了才报」，比哈希校验更晚也更有说服力。
    </p>

    <h3 id="manifest-cache">7.2 manifest-cache.json 与 24 小时缓存</h3>
    <p>
      位置 <code>&#123;userData&#125;/optional-capabilities/manifest-cache.json</code>， 结构是{' '}
      <code>&#123; schemaVersion: 1, checkedAt, manifest &#125;</code>，同样是原子写 +{' '}
      <code>0o600</code>。
    </p>
    <p>
      缓存有效期常量 <code>MANIFEST_CACHE_TTL_MS = 24 * 60 * 60 * 1_000</code>（24 小时）。
      <code>check(forceRemote)</code> 的逻辑是：只有 <code>forceRemote</code>{' '}
      为真、或没有清单、或缓存过期时才真的去拉远程。 界面上「检查更新」按钮走的是{' '}
      <code>refresh(true)</code>，也就是强制远程。
    </p>
    <p>
      <strong>一个必须知道的语义</strong>：从磁盘加载缓存时，<code>remoteAvailable</code> 会被
      <strong>显式置为 false</strong>。
      代码注释解释得很清楚：「磁盘缓存避免了多余的启动流量，但它不是网络可用的证据。」
      这个字段直接影响启动提醒（见 9.3）——只有真的联网拉取过清单，<code>remoteAvailable</code> 才是
      true。
    </p>

    <h3 id="auto-update-json">7.3 auto-update.json</h3>
    <p>
      位置 <code>&#123;userData&#125;/optional-capabilities/auto-update.json</code>，
      形状是一个扁平的 <code>&lt;能力 id&gt;: boolean</code> 映射，原子写 + <code>0o600</code>。
    </p>
    <p>
      写之前会先读旧文件并<strong>只保留布尔值</strong>（把非法值丢掉），读失败且不是{' '}
      <code>ENOENT</code> 才抛错。
    </p>
    <p>
      注意这里有个分工：archive 能力的自动更新偏好同时写进 <code>active.json</code> 的{' '}
      <code>autoUpdate</code> 字段和这份 JSON；而 external 能力的偏好<strong>只</strong>写这份 JSON
      （因为它们没有 active.json）。读取时 external 侧的顺序是： 内存缓存 →{' '}
      <code>auto-update.json</code> → 默认值。
    </p>

    <h3 id="disk-layout">7.4 各能力的实际落盘目录</h3>
    <table>
      <thead>
        <tr>
          <th>能力</th>
          <th>实际落盘位置</th>
          <th>状态文件</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>codex-runtime</code>
          </td>
          <td>
            <code>&#123;userData&#125;/agent-runtimes/codex/&lt;版本&gt;/&lt;triple&gt;</code>
          </td>
          <td>
            同目录下的 <code>active.json</code>（由 CodexRuntimeIntegrityService 自己维护）
          </td>
        </tr>
        <tr>
          <td>
            <code>ffmpeg</code>
          </td>
          <td>
            <code>&#123;userData&#125;/bin/&lt;清洗后的制品名&gt;</code>
          </td>
          <td>无独立状态文件，靠目录扫描 + 缓存</td>
        </tr>
        <tr>
          <td>
            <code>chromium</code>
          </td>
          <td>
            打包态 <code>&#123;userData&#125;/browsers</code>；开发态{' '}
            <code>&lt;desktopDir&gt;/browsers</code>
          </td>
          <td>无，靠包解析与路径探测</td>
        </tr>
        <tr>
          <td>
            <code>voice-pack</code>
          </td>
          <td>
            <code>&#123;userData&#125;/voice/native|model|refine/...</code>
          </td>
          <td>
            <code>&#123;userData&#125;/voice/voice-state.json</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>office-viewer</code>
          </td>
          <td>
            <code>
              &#123;userData&#125;/optional-capabilities/office-viewer/versions/&lt;版本&gt;/&lt;artifactId&gt;
            </code>
          </td>
          <td>
            <code>&#123;userData&#125;/optional-capabilities/office-viewer/active.json</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>local-depth</code>
          </td>
          <td>
            <code>
              &#123;userData&#125;/optional-capabilities/local-depth/versions/&lt;版本&gt;/&lt;artifactId&gt;
            </code>
          </td>
          <td>
            <code>&#123;userData&#125;/optional-capabilities/local-depth/active.json</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      <strong>这张表解释了 8.3 节的那个结论</strong>：只有两个 archive 能力的文件真的住在{' '}
      <code>optional-capabilities/&lt;id&gt;/</code> 里，所以「卸载」删这个目录对它们有效；
      另外四个的二进制散落在 <code>agent-runtimes/</code>、<code>bin/</code>、<code>browsers/</code>
      、 <code>voice/</code>，删 <code>optional-capabilities/</code> 下的目录根本碰不到它们。
      而它们又都是 <code>supportsUninstall: false</code>，界面上连卸载按钮都不给。
    </p>
    <h2 id="operations">8. install / update / repair / cancel / uninstall 的真实语义</h2>
    <p>
      界面给了你五个动作，但底下的实现比你想象的少。这一节逐个说清，尤其是
      <strong>哪些动作其实是同一个</strong>。
    </p>

    <h3 id="same-path">8.1 三者是同一条路径</h3>
    <p>
      <code>OptionalCapabilityManager</code> 上这三个方法的实现分别是：
    </p>
    <table>
      <thead>
        <tr>
          <th>方法</th>
          <th>实现</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>install(id)</code>
          </td>
          <td>
            <code>return this.enqueueInstall(id)</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>update(id)</code>
          </td>
          <td>
            <code>return this.enqueueInstall(id)</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>repair(id)</code>
          </td>
          <td>
            <code>return this.enqueueInstall(id)</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      三个方法体<strong>一字不差</strong>。所以「修复」不是一种特殊的修复动作——
      它就是「重新走一遍完整安装流程」，靠下载覆盖来达成修复效果。
    </p>
    <p>这带来几个实际后果，都是可以推导出来的：</p>
    <ul>
      <li>
        <strong>修复必然重新下载</strong>。它不会只校验、也不会只补缺失文件，整个制品（含{' '}
        <code>local-depth</code> 的两个制品）都要重新拉一遍。
      </li>
      <li>
        <strong>修复需要能连上仓库</strong>。断网时点「修复」得到的错误和点「安装」完全一样（
        <code>manifest_unavailable</code>）。
      </li>
      <li>
        <strong>真正的「校验型修复」不存在</strong>
        。即便损坏只是因为某个文件哈希不匹配，也必须整包重下。
      </li>
    </ul>
    <p>
      为什么三个都要重新下载？因为 <code>performInstall</code> 的下载-校验-激活流程本身就是幂等的：
      它会重新校验所有制品、重新激活、并保留旧版本直到成功。用一个流程覆盖三种语义，代价是流量，收益是没有特例分支。
    </p>
    <p>
      测试里也把这个行为固定住了：有一个用例先装成功、再让下载抛错，然后断言{' '}
      <code>repair('office-viewer')</code> 返回 <code>success: false</code>， 且 active.json
      里的版本<strong>仍是旧的</strong>。也就是说「修复失败不会把已装好的搞坏」是被测试保证的。
    </p>
    <p>
      还有一点：<code>enqueueInstall</code> 里 <code>if (existing) return existing</code> 意味着
      <strong>同一个能力在安装中时，连点五次只会执行一次</strong>，另外四次直接拿到同一个 Promise。
    </p>

    <h3 id="cancel-scope">8.2 取消只对 archive 能力可用</h3>
    <p>
      <code>cancel(id)</code> 先看 <code>definition.cancellable</code>，为 false 时直接返回
      「&lt;显示名&gt;当前安装任务不支持取消」，连 AbortController 都不碰。 按第 1.3 节的表，四个
      external 能力都是 <code>cancellable: false</code>。
    </p>
    <p>
      另外两种失败也要分清：能力可取消但当前<strong>没有</strong>在跑安装时，返回
      「&lt;显示名&gt;当前没有可取消的安装」。
    </p>
    <p>
      真能取消时，动作是 <code>controller.abort()</code>。中止信号在两个地方被检查：
      <code>performInstall</code> 的各阶段边界（<code>throwIfAborted</code>）和{' '}
      <code>installArchive</code> 内部的 <code>signal</code>。 external 适配器里也有{' '}
      <code>throwIfAborted(signal)</code>，但因为不可取消，这条永远走不到。
    </p>
    <p>
      <strong>一个容易踩的坑</strong>：取消<strong>不会自动回滚已下载的暂存目录</strong>—— 回滚由{' '}
      <code>finally</code> 块无条件完成（删暂存、删备份残留），所以结果是干净的，
      但已经下完的部分不会保留，下次要重下。
    </p>

    <h3 id="uninstall-scope">8.3 卸载做了什么、没做什么</h3>
    <p>
      同样先过 <code>supportsUninstall</code>，为 false 时返回「&lt;显示名&gt;不支持从应用内卸载」。
      能卸载时（只有 <code>office-viewer</code> 与 <code>local-depth</code>），实际动作是：
    </p>
    <ol>
      <li>
        若该能力有正在进行的安装，先 <code>abort()</code> 并等它结束；
      </li>
      <li>
        <code>store.remove(id)</code> →{' '}
        <code>
          rm(&#123;userData&#125;/optional-capabilities/&lt;id&gt;, &#123; recursive: true, force:
          true &#125;)
        </code>
        ；
      </li>
      <li>清掉内存里的错误状态与校验缓存；</li>
      <li>重新构建快照并推送。</li>
    </ol>
    <p>
      也就是说，卸载是<strong>删掉这个能力的整个状态目录</strong>——active.json 和{' '}
      <code>versions/</code> 下的实际文件一起没了。这很彻底，但也意味着：
    </p>
    <ul>
      <li>
        它<strong>不会</strong>清理 <code>manifest-cache.json</code>（那是全局共享的）；
      </li>
      <li>
        它<strong>不会</strong>为 external 能力删任何东西——因为 external 能力压根不允许卸载，
        而它们真正的二进制也不住在 <code>optional-capabilities/</code> 里（见 7.4）；
      </li>
      <li>
        卸载后的能力状态回到 <code>missing</code>，界面显示「未安装 · 下载 xx MB」。
      </li>
    </ul>
    <p>
      <strong>如果你想真正清掉某个 external 能力占的空间</strong>，代码里没有提供入口，
      只能手动删对应目录（<code>agent-runtimes/codex</code>、<code>bin/</code> 下的 ffmpeg 目录、
      <code>browsers/</code>、<code>voice/</code>），并且注意 Codex 那处还需要留意{' '}
      <code>active.json</code> 指针。 这一点在文档里如实说明，而不是承诺一个不存在的按钮。
    </p>

    <h2 id="auto-update">9. 自动更新与启动提醒</h2>

    <h3 id="auto-update-default">9.1 自动更新的默认值</h3>
    <p>
      默认值由一个函数决定，只有<strong>一个例外</strong>：
    </p>
    <pre>
      <code>
        function defaultAutoUpdateForCapability(id: OptionalCapabilityId): boolean &#123; // Codex
        App Server 是 Spark 适配器的协议上游。已安装的兼容 runtime 应保持可用， //
        新版本默认由用户明确选择；其他可选能力沿用原有自动更新默认值。 return id !== 'codex-runtime'
        &#125;
      </code>
    </pre>
    <p>
      即：
      <strong>
        除 <code>codex-runtime</code> 外全部默认开启自动更新，Codex 运行时默认关闭
      </strong>
      。 原因写在上面的注释里——它是协议上游，已装的兼容版本比新版更值得保稳。
    </p>
    <p>
      这个默认值被测试锁死：一个用例断言 Codex 在 <code>update_available</code> 状态下{' '}
      <code>autoUpdate: false</code>，并且 <code>expect(install).not.toHaveBeenCalled()</code>——
      也就是<strong>有更新但不会自动装</strong>；再把开关打开后，重启管理器仍能读到{' '}
      <code>true</code>（验证了持久化）。
    </p>
    <p>
      界面上这个开关只在 <code>installedVersion</code> 非空时出现，所以「没装过」的能力看不到开关。
      对 archive 能力，开关值存在 active.json；对 external 能力存在 auto-update.json（见 7.3）。
    </p>

    <h3 id="check-trigger">9.2 check 何时触发自动安装</h3>
    <p>
      <code>check(forceRemote)</code> 在返回快照<strong>之后</strong>会做一件事：遍历快照里的能力，
      凡满足下面三个条件的就静默触发一次安装：
    </p>
    <ol>
      <li>
        <code>manifestAvailable</code> 为真（<strong>真的联网拉到过清单</strong>
        ，而不是读了磁盘缓存）；
      </li>
      <li>
        状态是 <code>update_available</code>；
      </li>
      <li>
        <code>autoUpdate</code> 为真。
      </li>
    </ol>
    <p>
      也就是说：<strong>只是打开设置页、看到有更新，不一定会自动装</strong>—— 因为{' '}
      <code>check(&#123; forceRemote: false &#125;)</code> 在缓存新鲜时不会联网，
      <code>manifestAvailable</code> 就是 false。 只有点了「检查更新」（<code>refresh(true)</code>
      ）、或缓存过期后重新拉取，自动更新才会真的启动。 这个设计避免了每次渲染设置页都触发下载。
    </p>
    <p>
      配合 9.1 的默认值，可以推出一个实际行为：
      <strong>
        除 Codex 外，任何显示「有更新」的能力在你点过「检查更新」之后都可能已经开始后台下载了
      </strong>
      ， 进度通过悬浮卡显示。
    </p>

    <h3 id="prompt-policy">9.3 启动提醒的冷却与静音</h3>
    <p>
      启动提醒的判定是 <code>shouldShowCapabilityPrompt(snapshot, preference, now)</code>，
      顺序如下：
    </p>
    <ol>
      <li>
        <code>remoteAvailable</code> 为假，或 <code>manifestUpdatedAt</code> 为空 →{' '}
        <strong>不提醒</strong>；
      </li>
      <li>没有任何「值得提醒」的能力 → 不提醒；</li>
      <li>
        没有历史偏好记录 → <strong>提醒</strong>；
      </li>
      <li>
        用户勾过「不再在启动时提醒」（<code>disabled</code>）→ 只在出现
        <strong>没提醒过的新目标版本</strong>时提醒一次；
      </li>
      <li>有没提醒过的更新类目标 → 提醒；</li>
      <li>
        剩下的（缺失/损坏）走「清单变化 或 冷却到期」； 冷却常量{' '}
        <code>OPTIONAL_CAPABILITY_PROMPT_COOLDOWN_MS = 7 天</code>。
      </li>
    </ol>
    <p>
      「值得提醒」（<code>isPromptWorthyCapability</code>）的判定很窄，必须同时满足：
    </p>
    <ul>
      <li>
        <code>targetVersion</code> 非空；
      </li>
      <li>
        <code>downloadSize &gt; 0</code>；
      </li>
      <li>
        状态是 <code>missing</code>、<code>damaged</code> 或 <code>update_available</code> 之一。
      </li>
    </ul>
    <p>
      注意第三条排除了 <code>ready</code> 和 <code>error</code>——
      <strong>出错的能力不会进启动提醒</strong>， 只能到设置页自己看。
    </p>
    <p>
      偏好存在 <code>window.localStorage</code> 的 <code>spark-optional-capability-prompt</code>{' '}
      键下，结构包含 <code>manifestUpdatedAt</code>、<code>dismissedAt</code>、
      <code>dismissedTargets</code>（能力 id → 目标版本）与可选的 <code>disabled</code>。
      代码注释解释了为什么要记 <code>dismissedTargets</code>
      ：「『稍后』对同一版本不再打扰，出现新版本才再提醒」
      ——也就是避开了「点一次稍后就被静音到永远」。
    </p>

    <h2 id="asset-protocol">10. capability-asset:// 与 Office 预览</h2>
    <p>
      前面讲了 office-viewer 怎么装。这一节讲装完之后<strong>它是怎么被页面加载的</strong>——
      这条链路是自定义协议，也是本子系统里安全校验最密集的地方。
    </p>

    <h3 id="scheme">10.1 scheme 与特权声明</h3>
    <p>
      scheme 名是 <code>capability-asset</code>，特权声明在{' '}
      <code>CAPABILITY_ASSET_PRIVILEGED_SCHEME</code> 里，五项全开：
      <code>standard</code>、<code>secure</code>、<code>supportFetchAPI</code>、
      <code>corsEnabled</code>、<code>stream</code>。
    </p>
    <p>
      注册被集中在 <code>PrivilegedProtocolSchemes.ts</code>，与另两个应用内协议一起提交：
    </p>
    <table>
      <thead>
        <tr>
          <th>注册项</th>
          <th>来源</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>SAFE_FILE_PRIVILEGED_SCHEME</code>
          </td>
          <td>
            <code>SafeFileProtocol.ts</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>SNAPSHOT_PRIVILEGED_SCHEME</code>
          </td>
          <td>
            <code>computer-use/SnapshotProtocol.ts</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>CAPABILITY_ASSET_PRIVILEGED_SCHEME</code>
          </td>
          <td>
            <code>CapabilityAssetProtocol.ts</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      这个集中注册不是洁癖，注释给了原因：「Electron 在应用就绪前只接受<strong>一次</strong>特权
      scheme 注册调用。
      把所有应用协议放在这一个注册表里，后来新增的协议就不会静默移除先注册协议身上的
      fetch/CORS/安全特权。」 ——这是一个真实的 Electron 陷阱：分开调用只有第一次生效。
      请求处理本身在应用就绪后注册（<code>index.ts</code> 里调{' '}
      <code>registerCapabilityAssetProtocol()</code>）。
    </p>

    <h3 id="traversal">10.2 路径穿越与符号链接防护</h3>
    <p>
      <code>resolveCapabilityAssetPath</code> 是给文件型 host 用的解析器，防护分五步，缺一不可：
    </p>
    <table>
      <thead>
        <tr>
          <th>步骤</th>
          <th>检查</th>
          <th>拒绝理由</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>1</td>
          <td>
            协议必须是 <code>capability-asset:</code> 且 hostname 必须是 <code>office-viewer</code>
          </td>
          <td>Unsupported capability asset URL</td>
        </tr>
        <tr>
          <td>2</td>
          <td>
            逐段 <code>decodeURIComponent</code> 后，段不能为空、不能是 <code>.</code> 或{' '}
            <code>..</code>、不能含 <code>/</code> 或 <code>\</code>
          </td>
          <td>Capability asset path traversal is forbidden</td>
        </tr>
        <tr>
          <td>3</td>
          <td>路径段数量不能为 0</td>
          <td>Capability asset path is empty</td>
        </tr>
        <tr>
          <td>4</td>
          <td>
            <code>resolve(root, ...segments)</code> 后必须以 <code>root + sep</code> 开头
          </td>
          <td>Capability asset path traversal is forbidden</td>
        </tr>
        <tr>
          <td>5</td>
          <td>
            <code>lstat</code> 必须是普通文件、不能是符号链接；且 <code>realpath</code> 后仍必须在{' '}
            <code>realpath(root)</code> 之下
          </td>
          <td>Capability asset symlink escape is forbidden</td>
        </tr>
      </tbody>
    </table>
    <p>
      第 5 步是<strong>两层</strong>检查：先拒符号链接本身，再用 <code>realpath</code>{' '}
      处理「路径里有真实目录被换成链接」的情况。 第 2 步用 <code>rawPathSegments</code>{' '}
      先按原文切段再做解码，正是为了防 <code>%2e%2e%2f</code> 这类编码穿越。
    </p>
    <p>
      另外注意这个解析器<strong>要求能力已安装</strong>：<code>resolveRoot</code> 返回空时抛「Office
      Viewer capability is not installed」。
    </p>
    <p>
      最终的错误响应也做了区分：<code>not installed</code> 或 <code>ENOENT</code> →{' '}
      <strong>404 Not Found</strong>； 其它一律 <strong>403 Forbidden</strong>；且
      <strong>只有非 404 的情况才写 warn 日志</strong>， 避免页面正常探测时刷日志。
    </p>

    <h3 id="hosts">10.3 三条 host 分支</h3>
    <p>
      <code>capability-asset</code> 不只服务 Office 文件。虽然它的特权声明在这里， 但同一 scheme
      下挂了三个不同的 host，处理逻辑完全不同：
    </p>
    <table>
      <thead>
        <tr>
          <th>hostname</th>
          <th>用途</th>
          <th>数据来源</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>子应用沙箱文档 host</td>
          <td>子应用运行时 HTML 文档</td>
          <td>
            内存登记表，按 token 取（<code>takeSubAppRuntimeDoc</code>）
          </td>
        </tr>
        <tr>
          <td>HTML 渲染运行时 host</td>
          <td>HTML 产物沙箱文档</td>
          <td>
            内存登记表，按 token 取（<code>takeHtmlRenderRuntimeDoc</code>）
          </td>
        </tr>
        <tr>
          <td>子应用包资源 host</td>
          <td>子应用静态资源</td>
          <td>
            <code>resolveSubAppRuntimePackagePath</code>，再走安全文件响应
          </td>
        </tr>
        <tr>
          <td>
            <code>office-viewer</code>
          </td>
          <td>Office 预览器的 Worker / WASM / 字体</td>
          <td>第 10.2 节的路径解析器</td>
        </tr>
      </tbody>
    </table>
    <p>
      前两条是「内存文档」模式：HTML 不写磁盘，登记后按 token 取，取不到就 404，响应头固定{' '}
      <code>no-store</code>。这条链路的设计意图（写在 <code>RuntimeDocRegistry</code> 的注释里）是：
      渲染进程的 CSP 允许 <code>script-src 'self' capability-asset:</code>， 用自定义 scheme
      的文档加载可以避开 <code>srcdoc</code> 的沙箱策略限制。
    </p>
    <p>
      所以排查 Office 预览问题时，<code>capability-asset</code> 相关的失败也
      <strong>可能来自子应用/HTML 渲染那两条分支</strong>，不只是 Office。第 10.2 节的五步检查
      <strong>只作用于 office-viewer 那条</strong>， 另外两条各走自己的校验。
    </p>

    <h3 id="build-externalize">10.4 构建期资源外部化</h3>
    <p>
      这是「可选」在构建期落地的方式：Vite 插件 <code>externalizeOptionalOfficeAssetsPlugin</code>{' '}
      （名字 <code>externalize-optional-office-assets</code>，<code>apply: 'build'</code>、{' '}
      <code>enforce: 'pre'</code>）在打包时把上游模块里的 <code>import.meta.url</code>{' '}
      资源引用改写成 <code>capability-asset://</code> URL。
    </p>
    <p>目前有两处改写规则（模块 id 后缀 → 改写列表）：</p>
    <table>
      <thead>
        <tr>
          <th>模块</th>
          <th>被改写的引用</th>
          <th>改成</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td rowSpan={3}>
            <code>/@file-viewer/ppt/index.mjs</code>
          </td>
          <td>
            <code>./ppt-native.wasm</code>
          </td>
          <td>
            <code>capability-asset://office-viewer/vendor/ppt/ppt-native.wasm</code>
          </td>
        </tr>
        <tr>
          <td>字体包文件</td>
          <td>
            <code>capability-asset://office-viewer/vendor/ppt/ppt-font-cjk.otf</code>
          </td>
        </tr>
        <tr>
          <td>worker 文件</td>
          <td>
            <code>capability-asset://office-viewer/vendor/ppt/worker.mjs</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>/@file-viewer/pptx/dist/worker.js</code>
          </td>
          <td>
            <code>./worker/pptx.worker.js</code>
          </td>
          <td>
            <code>capability-asset://office-viewer/vendor/pptx/pptx.worker.js</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      注意字体与 worker 那两处用的是<strong>模板字符串形式</strong>的原串 （
      <code>MANIFEST.fontPack.file</code> 之类），说明改写是<strong>字符串精确匹配</strong>而不是
      AST。
    </p>
    <p>
      这也带来一个刻意设计的行为：如果上游模块改了写法导致匹配不到，插件会<strong>直接抛错</strong>
      而 不是静默跳过——
    </p>
    <pre>
      <code>
        [optional-office-assets] Upstream module changed; refusing to bundle its fallback asset:
        &lt;模块 id&gt;
      </code>
    </pre>
    <p>
      这是一个 fail-fast：与其把几百 MB 的默认资源偷偷打进 app.asar，不如让构建先失败。 升级 File
      Viewer 依赖后如果打包报这个错，说明那三处引用写法变了，需要同步更新改写表。
    </p>
    <p>
      另外 <code>rewriteOptionalOfficeAssetFallbacks</code> 是独立导出的纯函数（输入代码与模块 id，
      输出改写后代码或 <code>null</code>），因此改写规则本身有单测覆盖，不依赖跑完整构建。
    </p>

    <h2 id="codex-diagnostics">11. Codex Runtime 诊断卡片</h2>
    <p>
      这张卡片（<code>CodexRuntimeDiagnosticsCard</code>）位于设置 → 系统 → 完整性，
      和「可选功能组件」列表摆在一起，但它管的不是安装，而是
      <strong>已装 Codex 运行时的资源与性能</strong>。
    </p>

    <h3 id="diagnostics-channels">11.1 两个通道</h3>
    <table>
      <thead>
        <tr>
          <th>通道</th>
          <th>入参</th>
          <th>返回</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>codex-runtime:diagnostics</code>
          </td>
          <td>
            空对象（<code>z.object(&#123;&#125;).strict()</code>）
          </td>
          <td>
            持久运行时策略字段 + <code>diagnostics</code>（策略关闭时为 <code>null</code>）
          </td>
        </tr>
        <tr>
          <td>
            <code>codex-runtime:restart-idle</code>
          </td>
          <td>空对象</td>
          <td>
            <code>&#123; enabled, result &#125;</code>；策略关闭时 <code>result</code> 为{' '}
            <code>null</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      两个通道都由 <code>registerCodexRuntimeIpc</code> 注册，先读{' '}
      <code>persistentCodexRuntimePolicy()</code>；策略关闭时不调用后端，直接返回空结果。
      卡片上按钮的禁用条件也是 <code>!snapshot?.enabled || diagnostics == null</code>。
    </p>

    <h3 id="diagnostics-metrics">11.2 指标与告警阈值</h3>
    <p>顶部四张概要卡片（标签逐字）：</p>
    <table>
      <thead>
        <tr>
          <th>标签</th>
          <th>值</th>
          <th>副文本</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Runtime</td>
          <td>
            <code>activeRuntimeCount</code>
          </td>
          <td>
            <code>leasedRuntimeCount</code> 个运行中
          </td>
        </tr>
        <tr>
          <td>总内存</td>
          <td>
            <code>totalRssBytes</code> 格式化
          </td>
          <td>
            <code>processCount</code> 个进程
          </td>
        </tr>
        <tr>
          <td>暖启动命中率</td>
          <td>
            <code>counters.warmHitRate</code> 百分比
          </td>
          <td>
            <code>warmHitCount / acquireCount</code> 次
          </td>
        </tr>
        <tr>
          <td>暖 turn/start p95</td>
          <td>
            <code>latency.warmTurnStart.p95Ms</code>
          </td>
          <td>
            <code>count</code> 个样本
          </td>
        </tr>
      </tbody>
    </table>
    <p>下面是四行延迟明细，每行给出 p50 / p95 / max 与样本数：</p>
    <ul>
      <li>冷启动 acquire</li>
      <li>暖启动 acquire</li>
      <li>冷 turn/start</li>
      <li>暖 turn/start</li>
    </ul>
    <p>再下面是逐个 Runtime 的列表，每行显示：</p>
    <ul>
      <li>
        <code>Runtime &lt;leaseId&gt;</code>；
      </li>
      <li>
        状态标签（<code>starting</code> → 启动中、<code>running</code> → 运行中、<code>idle</code> →
        空闲、<code>exited</code> → 已退出）、内存、句柄数（缺失显示 <code>—</code>）；
      </li>
      <li>
        <code>N 个 thread · M 个 sidecar · 最近使用 &lt;本地时间&gt;</code>；
      </li>
      <li>右侧一个原始状态 Tag。</li>
    </ul>
    <p>
      列表为空时的文案是「尚无活跃 Runtime；首次 Codex 会话执行后会显示诊断。」
      策略关闭时整块替换为「持久 Runtime 已通过启动环境关闭，当前使用兼容的每轮临时载具。」
    </p>
    <p>健康度判定（右上角 Tag）与四条告警，阈值全部是组件内的常量：</p>
    <table>
      <thead>
        <tr>
          <th>常量</th>
          <th>值</th>
          <th>触发文案</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>TOTAL_RSS_WARNING_BYTES</code>
          </td>
          <td>1 GiB</td>
          <td>「Codex Runtime 总内存超过 1 GiB，建议在任务结束后重启空闲 Runtime。」</td>
        </tr>
        <tr>
          <td>
            <code>TOTAL_HANDLE_WARNING_COUNT</code>
          </td>
          <td>2048</td>
          <td>「Codex Runtime 总句柄数超过 2048，建议检查长时间未回收的工具连接。」</td>
        </tr>
        <tr>
          <td>
            <code>WARM_TURN_START_WARNING_MS</code>
          </td>
          <td>300 ms</td>
          <td>「暖 turn/start p95 为 Nms，超过 300ms 发布目标。」</td>
        </tr>
        <tr>
          <td>
            <code>WARM_RATE_MIN_SAMPLE_COUNT</code> / <code>WARM_RATE_WARNING_RATIO</code>
          </td>
          <td>5 / 0.6</td>
          <td>「暖启动命中率低于 60%，请检查 Provider、MCP 或身份配置是否频繁变化。」</td>
        </tr>
      </tbody>
    </table>
    <p>
      第五条不是阈值而是计数：启动失败数与崩溃替换数大于 0 就提示 「已记录 N 次启动失败、M
      次崩溃替换。」，并且这两个计数<strong>没有平滑窗口</strong>—— 只要发生过一次就会一直显示。
    </p>
    <p>
      命中率那条有<strong>样本数下限</strong>（至少 5 次 acquire），否则刚启动时会误报。
      另外代码里有几处 <code>!= null</code> 判断（内存、句柄、p95），说明这几个字段可能是{' '}
      <code>null</code>， 卡片在缺失时显示 <code>—</code> 而不是 0。
    </p>
    <p>
      卡片底部固定一行说明：「手动重启只回收空闲 Runtime；运行中的任务不会被中断。 告警阈值：总内存
      1 GiB、总句柄 2048、暖 turn/start p95 300ms。」
    </p>

    <h3 id="restart-idle">11.3 重启空闲 Runtime</h3>
    <p>
      按钮「<strong>重启空闲 Runtime</strong>」调 <code>codex-runtime:restart-idle</code>，
      成功后显示的消息是： 「已重启 N 个空闲 Runtime」；若有被跳过的，追加「，跳过 M
      个运行中任务」。
    </p>
    <p>
      返回值里 <code>restartedLeaseIds</code> 与 <code>busyLeaseIds</code> 两个数组各自给出 id，
      卡片只取长度做文案，不展示具体 id。点完会自动刷新一次诊断。
    </p>
    <p>
      <strong>这不是紧急刹车</strong>：它的语义是「回收空闲的那部分」，正在跑任务的 Runtime
      不会被碰—— 这一点在按钮文案与页脚注释里都写明了。想中断正在跑的任务需要从会话侧操作。
    </p>

    <h2 id="ipc">12. IPC 与协议契约</h2>
    <p>
      这套子系统一共 11 个 IPC 通道，分三组：<code>optional-capability:*</code> 8 个（见 12.1）、
      <code>sdk:integrity-*</code> 2 个（见 12.2），以及同一文件开头顺带注册的{' '}
      <code>video-workbench:get-ffmpeg-capabilities</code> 1 个。 11 个通道都在{' '}
      <code>packages/protocol</code> 里登记了类型对，但 zod 入参 schema 只覆盖其中 10 个， 例外见
      12.4。
    </p>

    <h3 id="capability-ipc">12.1 optional-capability:*</h3>
    <table>
      <thead>
        <tr>
          <th>通道</th>
          <th>入参</th>
          <th>返回</th>
          <th>渲染端调用点</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>optional-capability:list</code>
          </td>
          <td>
            <code>&#123;&#125;</code>（strict）
          </td>
          <td>快照</td>
          <td>
            <strong>无</strong>
          </td>
        </tr>
        <tr>
          <td>
            <code>optional-capability:check</code>
          </td>
          <td>
            <code>&#123; forceRemote?: boolean &#125;</code>
          </td>
          <td>快照</td>
          <td>
            <code>useOptionalCapabilities</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>optional-capability:install</code>
          </td>
          <td>
            <code>&#123; capabilityId &#125;</code>
          </td>
          <td>变更响应</td>
          <td>同上</td>
        </tr>
        <tr>
          <td>
            <code>optional-capability:update</code>
          </td>
          <td>同上</td>
          <td>变更响应</td>
          <td>同上</td>
        </tr>
        <tr>
          <td>
            <code>optional-capability:repair</code>
          </td>
          <td>同上</td>
          <td>变更响应</td>
          <td>同上</td>
        </tr>
        <tr>
          <td>
            <code>optional-capability:cancel</code>
          </td>
          <td>同上</td>
          <td>变更响应</td>
          <td>同上</td>
        </tr>
        <tr>
          <td>
            <code>optional-capability:uninstall</code>
          </td>
          <td>同上</td>
          <td>变更响应</td>
          <td>同上</td>
        </tr>
        <tr>
          <td>
            <code>optional-capability:set-auto-update</code>
          </td>
          <td>
            <code>&#123; capabilityId, enabled &#125;</code>
          </td>
          <td>快照</td>
          <td>同上</td>
        </tr>
      </tbody>
    </table>
    <p>
      <code>capabilityId</code> 在 zod 里是<strong>联合字面量</strong>（
      <code>OptionalCapabilityIdSchema</code>）， 所以传一个不存在的 id 会在 IP 边界就被拒，不会走到{' '}
      <code>getOptionalCapabilityDefinition</code> 的抛错分支。
    </p>
    <p>
      <code>optional-capability:list</code> 主进程有 handler 但<strong>渲染端没有任何调用点</strong>
      ： 界面只通过 <code>check</code>{' '}
      拿快照。它的存在意义是给未来或外部调用留一个不触发远程请求的读取入口 （<code>list()</code>{' '}
      只读缓存清单）。
    </p>
    <p>
      这五个变更通道共用同一个注册器 <code>registerMutation</code>，行为一致： 执行变更 → 推送快照 →{' '}
      <strong>成功时</strong>才回调 <code>onChanged</code>。 而 <code>onChanged</code> 只对{' '}
      <code>codex-runtime</code> 起作用： 它会重新跑一次 SDK 完整性检测并推送{' '}
      <code>stream:sdk:integrity</code>， 保证卡片上的运行时版本信息立即同步。
    </p>

    <h3 id="integrity-ipc">12.2 sdk:integrity-*</h3>
    <table>
      <thead>
        <tr>
          <th>通道</th>
          <th>入参</th>
          <th>行为</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>sdk:integrity-check</code>
          </td>
          <td>
            <code>&#123; checkLatest?: boolean &#125;</code>
          </td>
          <td>跑 SDK 完整性检测（含 Codex 运行时检测与 node/npm/git 探测）</td>
        </tr>
        <tr>
          <td>
            <code>sdk:integrity-install</code>
          </td>
          <td>
            <code>&#123; packageName &#125;</code>
          </td>
          <td>
            安装指定包，进度推 <code>stream:sdk:install-progress</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      <code>sdk:integrity-install</code> 有一个联动：若安装的包名是 <code>@openai/codex-sdk</code>{' '}
      且成功，会额外刷新 Codex 运行时快照与可选能力快照 （<code>publishCodexRuntimeSnapshots</code>
      ）。两个刷新都各自 try/catch 并有 warn 日志， 一处失败不会影响安装结果本身。
    </p>
    <p>
      第二个刷新的注释点出了一处细节：它用的是 <code>capabilityManager.list()</code> 而不是{' '}
      <code>check()</code>，理由是「只重读本地激活状态；<code>check()</code> 可能在缓存过期时联网
      并触发其他组件自动更新」。也就是说这里刻意避开了 9.2 节的自动更新副作用。
    </p>
    <p>
      渲染端的调用点有两处：<code>SettingsView</code> 的完整性区块， 以及工具函数{' '}
      <code>design/utils/codex-runtime-install.ts</code>。
    </p>
    <p>
      还有一个容易误判的行为：<code>checkSdkIntegrity</code> 里{' '}
      <strong>非 Codex 的 SDK 在打包态不会报「有更新」</strong>—— 代码把 <code>latestVersion</code>{' '}
      直接设成 <code>installedVersion</code>， 注释写的是「签名桌面应用里的 SDK
      包随应用一起升级，不要宣传打包构建根本装不了的 npm 更新」。 所以打包态下能更新的只有 Codex
      运行时那条。
    </p>

    <h3 id="event-streams">12.3 事件流</h3>
    <table>
      <thead>
        <tr>
          <th>事件</th>
          <th>触发</th>
          <th>载荷</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>stream:optional-capability:snapshot</code>
          </td>
          <td>check / 变更 / 自动更新后</td>
          <td>完整快照</td>
        </tr>
        <tr>
          <td>
            <code>stream:optional-capability:progress</code>
          </td>
          <td>安装各阶段</td>
          <td>单条进度</td>
        </tr>
        <tr>
          <td>
            <code>stream:sdk:integrity</code>
          </td>
          <td>启动推送 / Codex 运行时变化后</td>
          <td>SDK 完整性结果</td>
        </tr>
        <tr>
          <td>
            <code>stream:sdk:install-progress</code>
          </td>
          <td>SDK 安装过程</td>
          <td>安装进度</td>
        </tr>
      </tbody>
    </table>
    <p>
      渲染端用模块级单例 store + <code>useSyncExternalStore</code> 订阅前两个事件，
      <code>ensureStarted</code> 保证只初始化一次并立即发起一次 <code>check</code>。 另外 SDK
      完整性结果会被写进 <code>localStorage</code> 的 <code>spark-sdk-integrity</code>{' '}
      键并优先读缓存，避免每次打开设置页都重新检测。
    </p>

    <h3 id="zod">12.4 zod 校验覆盖面</h3>
    <p>
      11 个通道里<strong>有 10 个</strong>登记了 zod 条目（8 + 2 + 1：
      <code>optional-capability:*</code> 8 个、<code>sdk:integrity-*</code> 2 个）。
      <strong>
        唯一没有 zod 的是 <code>video-workbench:get-ffmpeg-capabilities</code>
      </strong>
      —— 它只登记在 <code>video-workbench.ts</code> 的 <code>VideoWorkbenchIpcChannelMap</code>{' '}
      类型表里，
      <code>schemas/index.ts</code> 中没有对应条目；<code>typedIpcHandle</code> 取不到 schema
      时会原样放行 （<code>schema != null ? schema.parse(rawRequest) : rawRequest</code>），
      所以这条通道不校验入参。其余通道里， 无入参的一律写成{' '}
      <code>z.object(&#123;&#125;).strict()</code>， 带参的都用 <code>.strict()</code>{' '}
      拒绝多余字段。
    </p>
    <p>
      这一点值得单独提，因为同仓库里其它子系统存在「只有类型注册、没有 zod」的情况； 本子系统 11
      个通道里有 10 个补齐了 schema，唯一例外就是上面那条
      <code>video-workbench:get-ffmpeg-capabilities</code>。
      排查时如果看到参数校验错，那一定是调用方传多了字段，不是缺少 schema 定义。
    </p>
    <h2 id="troubleshooting">13. 排查表</h2>
    <p>下面每一条都是可以从代码推导出的具体原因，按「现象 → 原因 → 怎么办」组织。</p>
    <table>
      <thead>
        <tr>
          <th>现象</th>
          <th>真实原因</th>
          <th>怎么办</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>点「修复」后进度条从 0 开始重新下载</td>
          <td>
            <code>repair</code> 就是 <code>install</code>，不存在「只校验不下载」的修复路径
          </td>
          <td>属预期行为；只想校验时就别点，或直接看错误文案定位</td>
        </tr>
        <tr>
          <td>主按钮灰着点不动</td>
          <td>
            该能力 <code>targetVersion</code> 为空——清单里没有你平台的制品，或平台不支持
          </td>
          <td>看按钮下面那行状态文本：「当前平台暂不可用」就是没有制品，不是网络问题</td>
        </tr>
        <tr>
          <td>Codex 显示「有更新」但一直不自动装</td>
          <td>
            <code>codex-runtime</code> 的自动更新默认<strong>关闭</strong>
          </td>
          <td>在那一行打开「自动更新」开关，或直接点「更新」</td>
        </tr>
        <tr>
          <td>只点了一次「检查更新」，别的组件自己开始下载了</td>
          <td>
            <code>check()</code> 在 <code>manifestAvailable</code> 为真时会对所有{' '}
            <code>update_available</code> 且 <code>autoUpdate</code> 的能力静默安装
          </td>
          <td>属预期行为；不想要就在对应行关掉「自动更新」开关</td>
        </tr>
        <tr>
          <td>安装进度卡上没有「取消」按钮</td>
          <td>
            四个 external 能力都是 <code>cancellable: false</code>，取消按钮的渲染条件是{' '}
            <code>cancellable !== false</code>
          </td>
          <td>外部能力的安装不能取消，只能等它结束或失败</td>
        </tr>
        <tr>
          <td>某能力装好了但没有「卸载」按钮</td>
          <td>
            四个 external 能力都是 <code>supportsUninstall: false</code>
          </td>
          <td>应用内没有卸载入口；要清空间只能手动删目录（见 7.4）</td>
        </tr>
        <tr>
          <td>卸载了 Office 预览，但磁盘空间没释放多少</td>
          <td>
            卸载删的是 <code>&#123;userData&#125;/optional-capabilities/&lt;id&gt;</code>，external
            能力的二进制不在这个目录下
          </td>
          <td>确认你要清的是哪个能力；external 的要按 7.4 的表找对应目录</td>
        </tr>
        <tr>
          <td>启动时没有弹出「安装可选功能」</td>
          <td>
            三种可能：只读了磁盘缓存导致 <code>remoteAvailable</code> 为
            false；没有缺失/损坏/有更新的能力；或偏好里该目标版本已被「稍后」静音
          </td>
          <td>
            打开设置 → 系统 → 完整性点「检查更新」；或清掉 localStorage 的{' '}
            <code>spark-optional-capability-prompt</code>
          </td>
        </tr>
        <tr>
          <td>
            某个组件一直是 <code>error</code>，但启动时从不提醒
          </td>
          <td>
            <code>isPromptWorthyCapability</code> 只认 <code>missing</code> / <code>damaged</code> /{' '}
            <code>update_available</code>，
            <strong>
              不含 <code>error</code>
            </strong>
          </td>
          <td>启动提醒不覆盖它，只能去设置页看</td>
        </tr>
        <tr>
          <td>点了「稍后」，之后再也不提醒了</td>
          <td>
            偏好按<strong>目标版本</strong>静音（<code>dismissedTargets</code>
            ）；同版本不再打扰，新版本会再提醒一次
          </td>
          <td>想立刻装就手动打开弹窗；不需要改配置</td>
        </tr>
        <tr>
          <td>打包版里 Claude SDK 永远显示没有更新</td>
          <td>
            打包态下 <code>checkSdkIntegrity</code> 把 <code>latestVersion</code>{' '}
            直接设成已装版本，注释说明「签名应用里的 SDK 随应用升级」
          </td>
          <td>属预期行为；打包态只有 Codex 运行时可以单独更新</td>
        </tr>
        <tr>
          <td>Codex 提示「云端已有更新版本，但与 SDK 不配对」</td>
          <td>
            精确配对要求 <code>sdkPackage</code> 或 <code>dependencies</code> 里出现{' '}
            <code>@openai/codex-sdk@&lt;应用内版本&gt;</code>
          </td>
          <td>按文案升级 Spark Agent 应用本身，再回来更新运行时</td>
        </tr>
        <tr>
          <td>Codex 提示「全部低于协议基线 0.144.5」</td>
          <td>
            该平台制品都被 <code>MIN_SUPPORTED_MANAGED_CODEX_RUNTIME_VERSION</code> 过滤掉了
          </td>
          <td>等仓库补齐该平台制品；这在应用内无解</td>
        </tr>
        <tr>
          <td>Chromium 下载失败</td>
          <td>
            开发态依赖 <code>pnpm</code>，打包态依赖内置 Node 与{' '}
            <code>resourcesPath/playwright-mcp</code> 下的 cli.js；任何一环缺失都会失败
          </td>
          <td>
            开发态确认 pnpm 可用；打包态提示「无法定位内置 Playwright
            下载程序」时说明安装包不完整，需重装应用
          </td>
        </tr>
        <tr>
          <td>Chromium 显示下载完成但仍判为未就绪</td>
          <td>
            装完复查 <code>browserSource !== 'bundled'</code>，说明没落到{' '}
            <code>&#123;userData&#125;/browsers</code>
          </td>
          <td>
            看报错里给出的目录，确认 <code>PLAYWRIGHT_BROWSERS_PATH</code> 指向的位置可写
          </td>
        </tr>
        <tr>
          <td>系统装了 ffmpeg，卡片却显示未安装</td>
          <td>
            系统探测要求 <code>which ffmpeg</code> 能找到<strong>且</strong>{' '}
            <code>ffmpeg -version</code> 能正常返回
          </td>
          <td>
            手动跑一次 <code>ffmpeg -version</code>；如果报 dyld / 依赖库错误，会被判为不可用
          </td>
        </tr>
        <tr>
          <td>明明是 managed 安装的，却回退到了系统版 ffmpeg</td>
          <td>
            managed 目录里的二进制若跑不出 <code>-version</code>，探测会静默继续往下走
          </td>
          <td>
            删掉 <code>&#123;userData&#125;/bin</code> 下那个坏目录后重新下载
          </td>
        </tr>
        <tr>
          <td>ffmpeg 显示「下载完成但未检测到可用二进制」</td>
          <td>下载与解压成功了，但目标目录里的可执行文件跑不起来（通常是平台/架构不匹配）</td>
          <td>和「下载失败」区分开：这是制品本身的问题，重试无效</td>
        </tr>
        <tr>
          <td>提示「ffprobe 不可用」</td>
          <td>
            <code>resolveFfmpegBin</code> 可以退到系统 ffmpeg，但 ffprobe 需要单独解析（managed 目录
            → 系统 PATH）
          </td>
          <td>装 FFmpeg 整包，不要只软链 ffmpeg 一个文件</td>
        </tr>
        <tr>
          <td>Windows ARM / Linux ARM 上语音输入直接不可用</td>
          <td>
            <code>voicePlatformKey</code> 是四值白名单：<code>darwin-arm64</code>、
            <code>darwin-x64</code>、<code>win32-x64</code>、<code>linux-x64</code>
          </td>
          <td>应用内无解，等上游提供 prebuilt</td>
        </tr>
        <tr>
          <td>语音包下载中途失败</td>
          <td>
            通用归档超时 2 分钟，语音单独放宽到 30
            分钟；超时会翻译成「下载超时，请检查网络或代理后重试」
          </td>
          <td>
            按提示检查网络；重试时<strong>只会重下没装完的组件</strong>，已成功的大模型不会重下
          </td>
        </tr>
        <tr>
          <td>语音的 refine 一直显示「未安装」</td>
          <td>
            refine 是可选组件，<code>ready</code> 只要求 native + model；清单没提供 refine
            时不算失败
          </td>
          <td>不影响语音识别可用性；它只用于「说完后整段优化」</td>
        </tr>
        <tr>
          <td>Office 文件打不开，显示占位提示</td>
          <td>office-viewer 未就绪时组件会主动替换成占位区</td>
          <td>点占位区的「安装 Office 预览资源」；若按钮灰着，说明当前平台没有制品</td>
        </tr>
        <tr>
          <td>Office 预览加载资源时 403</td>
          <td>
            <code>resolveCapabilityAssetPath</code> 的路径穿越或符号链接检查拒绝了请求
          </td>
          <td>403 是安全拒绝，不是缺文件；检查是不是有非预期字符或链接被放进了资源目录</td>
        </tr>
        <tr>
          <td>Office 预览加载资源时 404</td>
          <td>
            office-viewer 未安装，或请求的文件不存在（这条路径<strong>不写 warn 日志</strong>）
          </td>
          <td>先在设置页确认 office-viewer 状态；404 时去看是否真的装了</td>
        </tr>
        <tr>
          <td>
            打包时报 <code>[optional-office-assets] Upstream module changed</code>
          </td>
          <td>
            上游 File Viewer 模块里那三处 <code>import.meta.url</code> 写法变了，精确字符串匹配失败
          </td>
          <td>
            属 fail-fast 保护；同步更新 <code>optionalOfficeBuildAssets.ts</code> 里的改写表
          </td>
        </tr>
        <tr>
          <td>
            能力状态一直是「需要修复」（<code>damaged</code>）
          </td>
          <td>
            要么 <code>validateActiveState</code> 没通过（包内 manifest
            哈希变了、目录被挪动），要么曾经上报过 <code>runtimeFailure</code>
          </td>
          <td>
            点「修复」重装；若是 <code>local-depth</code>，先看是否报过「原生 Runtime 无法加载」
          </td>
        </tr>
        <tr>
          <td>深度处理任务失败后能力被标红</td>
          <td>
            画布深度任务会调 <code>reportRuntimeFailure('local-depth', ...)</code>，把失败写进
            active.json
          </td>
          <td>
            点「修复」重装 <code>local-depth</code>；同时那条报错信息才是根因（例如签名被拒）
          </td>
        </tr>
        <tr>
          <td>进度条没有百分比，只有文案</td>
          <td>
            <code>percent</code> 在 <code>total === 0</code> 时是 <code>null</code>，进度组件按 0
            展示
          </td>
          <td>属正常——准备阶段与校验阶段本来就没有可算的总量</td>
        </tr>
        <tr>
          <td>参数校验直接报错，没进到能力逻辑</td>
          <td>
            11 个通道里有 10 个带 <code>.strict()</code> 的 zod schema，多传字段会被拒
          </td>
          <td>
            检查调用方是否多传了字段；唯一没有 schema 的{' '}
            <code>video-workbench:get-ffmpeg-capabilities</code> 不受这条约束
          </td>
        </tr>
      </tbody>
    </table>

    <h2 id="notes">14. 声明了但当前不起作用的东西</h2>
    <p>
      这一节列的是「协议或类型里写了、但生产路径上没有实现或没有消费者」的部分。
      写出来是为了让你在排查时不要被字段名误导。
    </p>
    <table>
      <thead>
        <tr>
          <th>项</th>
          <th>实际情况</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>OptionalCapabilityItem.entryUrl</code>
          </td>
          <td>
            协议里声明了可选字段，但<strong>全仓没有任何地方给它赋值</strong>，也没有任何地方读它
          </td>
        </tr>
        <tr>
          <td>
            <code>installedSize</code>
          </td>
          <td>
            四个 external 适配器一律填 <code>null</code>；archive
            能力会算出真实值，但界面从不显示它（两个卡片都只读 <code>downloadSize</code>）
          </td>
        </tr>
        <tr>
          <td>
            <code>optional-capability:list</code>
          </td>
          <td>
            主进程有 handler、协议有类型与 schema，<strong>渲染端零调用点</strong>
          </td>
        </tr>
        <tr>
          <td>
            <code>repair</code> 的独立性
          </td>
          <td>
            与 install / update 是同一个实现，不存在单独的修复策略（不校验、不增量、不跳过下载）
          </td>
        </tr>
        <tr>
          <td>
            <code>CapabilityPackageHealth</code> 的覆盖面
          </td>
          <td>
            名字像是管所有能力，实际只校验 <code>office-viewer</code> 与 <code>local-depth</code>
            ；其它任何 id 进来都直接抛错
          </td>
        </tr>
        <tr>
          <td>Chromium 的版本号</td>
          <td>
            适配器把 <code>installedVersion</code> 与 <code>targetVersion</code> 都填成字符串{' '}
            <code>'chromium'</code>，不是真实版本。所以界面会显示「已安装 chromium」
          </td>
        </tr>
        <tr>
          <td>Chromium 的下载体积</td>
          <td>
            <code>CHROMIUM_ESTIMATED_DOWNLOAD_SIZE</code> 是固定估值 150
            MB；进度按命令行输出的百分比反算，没有真实总字节数
          </td>
        </tr>
        <tr>
          <td>进度上报里的死分支</td>
          <td>
            Chromium 的 <code>report(percent == null ? 'downloading' : 'downloading', ...)</code>{' '}
            两个分支取值相同，条件实际无意义
          </td>
        </tr>
        <tr>
          <td>external 能力的「取消」</td>
          <td>
            适配器里写了 <code>throwIfAborted(signal)</code>
            ，但四个能力都不可取消，这条检查在生产路径不可达
          </td>
        </tr>
        <tr>
          <td>能力内卸载 external 资源</td>
          <td>
            没有实现。四个外部能力的二进制不在 <code>optional-capabilities/</code>{' '}
            下，卸载逻辑也够不到它们
          </td>
        </tr>
        <tr>
          <td>
            <code>capability-asset</code> 的单一 scheme
          </td>
          <td>
            同一个 scheme 下挂了四个 host（子应用文档、HTML
            文档、子应用包资源、office-viewer），但第 10.2 节那套路径校验
            <strong>只作用于 office-viewer 一条</strong>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      最后一栏不只是洁癖问题：如果你在排查 <code>capability-asset</code> 相关的加载失败， 要先把「是
      Office 的资源，还是子应用/HTML 渲染的沙箱文档」分清楚，两者的校验与错误码完全不同。
    </p>
  </>
)

const optionalCapabilities: DocsPageContent = {
  slug: 'optional-capabilities',
  toc: [
    { id: 'overview', title: '1. 这套子系统解决什么问题', level: 2 },
    { id: 'why', title: '1.1 为什么基础安装包不带这些资源', level: 3 },
    { id: 'two-planes', title: '1.2 「可选功能组件」与「完整性」是什么关系', level: 3 },
    { id: 'inventory', title: '1.3 六个能力清单', level: 3 },
    { id: 'channels', title: '2. 两条安装通道', level: 2 },
    { id: 'archive-channel', title: '2.1 source: archive —— 通用归档流水线', level: 3 },
    { id: 'external-channel', title: '2.2 source: external —— 四个专用完整性服务', level: 3 },
    { id: 'empty-select', title: '2.3 为什么 external 的 selectArtifacts 返回空数组', level: 3 },
    { id: 'entry-points', title: '3. 用户能看到的三个入口', level: 2 },
    { id: 'settings-card', title: '3.1 设置 → 系统 → 完整性 → 可选功能组件', level: 3 },
    { id: 'startup-prompt', title: '3.2 启动批量安装弹窗', level: 3 },
    { id: 'inline-entry', title: '3.3 组件内按需入口', level: 3 },
    { id: 'external-detail', title: '4. 四个 external 能力的探测与安装', level: 2 },
    { id: 'codex-runtime', title: '4.1 codex-runtime', level: 3 },
    { id: 'ffmpeg', title: '4.2 ffmpeg', level: 3 },
    { id: 'chromium', title: '4.3 chromium', level: 3 },
    { id: 'voice-pack', title: '4.4 voice-pack', level: 3 },
    { id: 'codex-version', title: '5. Codex 运行时的版本选择规则', level: 2 },
    { id: 'protocol-baseline', title: '5.1 协议基线', level: 3 },
    { id: 'selection-reasons', title: '5.2 五种选择结果', level: 3 },
    { id: 'env-injection', title: '5.3 环境变量注入', level: 3 },
    { id: 'archive-pipeline', title: '6. archive 能力的安装流水线', level: 2 },
    { id: 'pipeline-steps', title: '6.1 七个阶段', level: 3 },
    { id: 'package-manifest', title: '6.2 包内 manifest 与全量哈希', level: 3 },
    { id: 'health-scope', title: '6.3 CapabilityPackageHealth 的实际覆盖面', level: 3 },
    { id: 'rollback', title: '6.4 回滚与旧版本保留', level: 3 },
    { id: 'state', title: '7. 状态与落盘位置', level: 2 },
    { id: 'active-json', title: '7.1 active.json 的字段与校验', level: 3 },
    { id: 'manifest-cache', title: '7.2 manifest-cache.json 与 24 小时缓存', level: 3 },
    { id: 'auto-update-json', title: '7.3 auto-update.json', level: 3 },
    { id: 'disk-layout', title: '7.4 各能力的实际落盘目录', level: 3 },
    {
      id: 'operations',
      title: '8. install / update / repair / cancel / uninstall 的真实语义',
      level: 2,
    },
    { id: 'same-path', title: '8.1 三者是同一条路径', level: 3 },
    { id: 'cancel-scope', title: '8.2 取消只对 archive 能力可用', level: 3 },
    { id: 'uninstall-scope', title: '8.3 卸载做了什么、没做什么', level: 3 },
    { id: 'auto-update', title: '9. 自动更新与启动提醒', level: 2 },
    { id: 'auto-update-default', title: '9.1 自动更新的默认值', level: 3 },
    { id: 'check-trigger', title: '9.2 check 何时触发自动安装', level: 3 },
    { id: 'prompt-policy', title: '9.3 启动提醒的冷却与静音', level: 3 },
    { id: 'asset-protocol', title: '10. capability-asset:// 与 Office 预览', level: 2 },
    { id: 'scheme', title: '10.1 scheme 与特权声明', level: 3 },
    { id: 'traversal', title: '10.2 路径穿越与符号链接防护', level: 3 },
    { id: 'hosts', title: '10.3 三条 host 分支', level: 3 },
    { id: 'build-externalize', title: '10.4 构建期资源外部化', level: 3 },
    { id: 'codex-diagnostics', title: '11. Codex Runtime 诊断卡片', level: 2 },
    { id: 'diagnostics-channels', title: '11.1 两个通道', level: 3 },
    { id: 'diagnostics-metrics', title: '11.2 指标与告警阈值', level: 3 },
    { id: 'restart-idle', title: '11.3 重启空闲 Runtime', level: 3 },
    { id: 'ipc', title: '12. IPC 与协议契约', level: 2 },
    { id: 'capability-ipc', title: '12.1 optional-capability:*', level: 3 },
    { id: 'integrity-ipc', title: '12.2 sdk:integrity-*', level: 3 },
    { id: 'event-streams', title: '12.3 事件流', level: 3 },
    { id: 'zod', title: '12.4 zod 校验覆盖面', level: 3 },
    { id: 'troubleshooting', title: '13. 排查表', level: 2 },
    { id: 'notes', title: '14. 声明了但当前不起作用的东西', level: 2 },
  ],
  faq: [
    {
      question: '「安装」「更新」「修复」有什么区别？',
      answer:
        '三个按钮调用的是同一个实现。管理器的 install、update、repair 三个方法体一字不差，都是 enqueueInstall(id)，所以修复不是增量修复，而是重新走一遍完整安装：重新拉清单、重新下载整包、重新逐文件校验、重新激活。代价是流量，收益是没有特例分支。实测被测试锁死的一点是：修复失败不会破坏已装好的版本——下载阶段抛错时 activate 之前的目标目录从未被改动，旧版本原样保留。',
    },
    {
      question: '为什么有的能力没有「取消」和「卸载」按钮？',
      answer:
        '因为定义表里那两项都是 false。codex-runtime、ffmpeg、chromium、voice-pack 四个能力都是 cancellable: false、supportsUninstall: false；只有 office-viewer 与 local-depth 两项都是 true。界面严格按这两个字段渲染，所以外部能力安装到一半没有取消入口，装好了也没有卸载入口。想清掉它们占的空间，代码里没有提供入口，只能按第 7.4 节的表手动删目录（agent-runtimes/codex、bin 下的 ffmpeg 目录、browsers、voice）。',
    },
    {
      question: '为什么 Codex 运行时显示有更新却不会自动安装？',
      answer:
        "因为它是自动更新默认值里唯一的例外。defaultAutoUpdateForCapability 的实现是 return id !== 'codex-runtime'，也就是除 Codex 外全部默认开启、Codex 默认关闭，注释给的理由是它是 Spark 适配器的协议上游、已装的兼容版本更值得保稳。测试把这个行为锁死了：Codex 处于 update_available 时断言 autoUpdate 为 false，且断言安装函数未被调用。想更新就在那一行手动打开开关或直接点更新。",
    },
    {
      question: '什么是 external？这四个能力不是从 Spark 仓库下载的吗？',
      answer:
        'external 描述的是走哪条安装通道，不是来源。它指的是不走 OptionalCapabilityManager 里那条通用归档流水线（解析清单、下载、校验包内文件、暂存、备份、激活），而是交给四个专用完整性服务，所以 definitions.ts 里它们的 selectArtifacts 写成 () => []。其中三个照样从 Spark 自建制品仓库下载：codex-runtime、ffmpeg、voice-pack 都调 fetchSparkInstallManifest 并用各自的选择器挑制品；只有 chromium 例外，它用应用内已装好的 Playwright 包执行 playwright install chromium，不读 Spark 清单。',
    },
    {
      question: 'Office 预览为什么一定要装 office-viewer？装到哪了？',
      answer:
        '因为它的 Worker、WASM 与中日韩字体被打包流程主动外部化了——构建期有一个 Vite 插件把上游模块里的 import.meta.url 资源引用改写成 capability-asset://office-viewer/... URL；注释写明了理由：Spark 在安装 office-viewer 后总是提供这些 URL，保留默认资源会在 app.asar 里重复一份。安装位置是 userData/optional-capabilities/office-viewer/versions/<版本>/<artifactId>，状态写在同目录的 active.json。加载时走自定义协议 capability-asset，只认 office-viewer 这个 host。',
    },
    {
      question: '能力状态显示「需要修复」是什么意思？',
      answer:
        '两种情况。一种是校验没过：管理器会重算包内 manifest 的哈希并与 active.json 里记录的 manifestSha256 比对，再完整跑一遍包内文件校验，任一环节不过就判 damaged。另一种是运行时主动上报失败：reportRuntimeFailure 会往 active.json 写 runtimeFailure，报错文案是「运行验证失败：原生 Runtime 无法加载，请更新或修复组件」，目前只有画布深度任务会对 local-depth 走这条路径。两种情况点「修复」都是重装整包，都需要能连上仓库。',
    },
  ],
  Body,
  aiSummary:
    'Spark Work 可选功能组件（Optional Capabilities）完整指南：六个按需下载的资源——Codex 原生运行时、离线 Office 预览、本地深度处理、FFmpeg、Chromium 与语音输入资源。本页讲清 definitions.ts 里 archive 与 external 两条安装通道的真实差异（external 不等于不来自 Spark 仓库，四个外部能力里三个照样走自建制品清单，只有 Chromium 走 npm 生态），四个专用完整性服务各自的探测方式（FFmpeg 三级降级与目录名解版本、Chromium 的包解析与三级浏览器探测、语音包三组件与四值平台白名单、Codex 的四段目录与 bundled 旁路），Codex 运行时的版本协商规则（协议基线 0.144.5、exact-sdk-match 与 newest-compatible 的取舍、五种失败原因对应的用户提示），archive 流水线的七个阶段与三层路径防护，CapabilityPackageHealth 实际只覆盖两个能力的事实，状态文件位置与 24 小时清单缓存，install/update/repair 三者同实现、取消与卸载只对 archive 能力可用的真实语义，自动更新的默认值与 check 触发条件、启动提醒的七天冷却与按版本静音，capability-asset:// 协议的五步路径穿越与符号链接防护及构建期资源外部化，Codex Runtime 诊断卡片的指标与四个告警阈值，11 个 IPC 通道的完整契约，以及 30 行排查表和 11 项声明了但当前不起作用的东西。',
  quickReference: [
    {
      key: '设置入口',
      value:
        '设置 → 系统 → 完整性（项 id integrity）；Chromium 的状态卡片在 设置 → 系统 → 浏览器自动化',
    },
    {
      key: '能力总数',
      value: '6 个：codex-runtime / office-viewer / local-depth / ffmpeg / chromium / voice-pack',
    },
    { key: 'archive 能力', value: 'office-viewer、local-depth（可取消、可卸载）' },
    {
      key: 'external 能力',
      value: 'codex-runtime、ffmpeg、chromium、voice-pack（不可取消、不可卸载）',
    },
    {
      key: '状态枚举',
      value:
        '12 个：checking/missing/queued/downloading/verifying/extracting/activating/cancelled/ready/update_available/damaged/error',
    },
    {
      key: '错误码',
      value:
        '8 个：manifest_unavailable/artifact_unavailable/artifact_invalid/download_failed/package_invalid/activation_failed/cancelled/internal_error',
    },
    { key: '清单缓存 TTL', value: '24 小时（MANIFEST_CACHE_TTL_MS）' },
    { key: '状态目录', value: 'userData/optional-capabilities/<能力 id>/active.json' },
    { key: '清单缓存文件', value: 'userData/optional-capabilities/manifest-cache.json' },
    { key: '自动更新偏好', value: 'userData/optional-capabilities/auto-update.json' },
    { key: 'Codex 运行时目录', value: 'userData/agent-runtimes/codex/<版本>/<triple>' },
    { key: 'FFmpeg 落盘', value: 'userData/bin/<清洗后的制品名>' },
    { key: 'Chromium 落盘', value: '打包态 userData/browsers；开发态 <desktopDir>/browsers' },
    { key: '语音落盘', value: 'userData/voice/native|model|refine/...' },
    { key: 'Codex 协议基线', value: '0.144.5（MIN_SUPPORTED_MANAGED_CODEX_RUNTIME_VERSION）' },
    {
      key: 'Codex 选择结果',
      value:
        'exact-sdk-match / newest-compatible / no-published-runtime / below-protocol-baseline / newer-than-app-sdk',
    },
    {
      key: 'Codex 环境变量',
      value: 'SPARK_CODEX_RUNTIME_ROOT / SPARK_CODEX_SDK_VERSION / SPARK_CODEX_REQUIRE_RUNTIME',
    },
    { key: '自动更新默认值', value: '除 codex-runtime 外全部默认开启；Codex 默认关闭' },
    { key: '启动提醒冷却', value: '7 天（OPTIONAL_CAPABILITY_PROMPT_COOLDOWN_MS）' },
    { key: '提醒偏好存储', value: 'localStorage 键 spark-optional-capability-prompt' },
    { key: '语音 30 分钟超时', value: 'VOICE_ARCHIVE_DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000' },
    { key: '语音平台白名单', value: 'darwin-arm64 / darwin-x64 / win32-x64 / linux-x64' },
    { key: 'Chromium 估算体积', value: '150 MB（CHROMIUM_ESTIMATED_DOWNLOAD_SIZE，固定估值）' },
    { key: '自定义协议', value: 'capability-asset（office-viewer + 三个沙箱文档/资源 host）' },
    {
      key: 'Office 必需文件',
      value: '15 个（含 ppt-native.wasm、ppt-font-cjk.otf、四个 viewer manifest）',
    },
    {
      key: '诊断告警阈值',
      value: '总内存 1 GiB / 总句柄 2048 / 暖 turn-start p95 300ms / 命中率 60%',
    },
    {
      key: 'IPC 通道数',
      value:
        '11 个（optional-capability:* 8 + sdk:integrity-* 2 + codex-runtime:* 2，其中 list 无渲染端调用）',
    },
    {
      key: '事件流',
      value:
        'stream:optional-capability:snapshot / :progress、stream:sdk:integrity、stream:sdk:install-progress',
    },
  ],
  howTo: {
    name: '按需安装一个可选功能组件并验证它真的可用',
    description: '从看清状态、判断该点哪个按钮，到装完验证与善后，走一遍完整流程。',
    totalTime: 'PT15M',
    steps: [
      '打开「设置 → 系统 → 完整性」，滚到最下面的「可选功能组件」卡片。六个能力的当前状态会在这里一次性列出。',
      '先读每行的状态文本再动手：显示「已安装 版本号」说明就绪；「有更新」说明有新版；「组件损坏」说明校验没过；「安装失败」是上一次操作留下的错误；「未安装 · 下载 xx MB」才是真的可以装。',
      '如果某行显示「当前平台暂不可用」，先别点。这意味着清单里没有你平台/架构的制品，或该平台本就不支持（语音的四个平台键之外都是这种），装也不会成功。',
      '选对按钮：有更新点「更新」，损坏或失败点「修复」，其余点「安装」或「重新安装」。但要记住「修复」会整包重下，不要在大流量环境下随手点。',
      '想先确认云端有没有新版本，先点右上角「检查更新」。注意一个副作用：除 Codex 运行时外，其它能力默认开启自动更新，这一步之后处于「有更新」的能力会立刻开始后台下载。',
      '安装过程中的进度显示在左下角悬浮卡「功能资源」里，含进度条、已下载/总量与队列位次。四个外部能力不会出现取消按钮，这是设计而非故障。',
      '装 Chromium 时留意日志里的路径：开发态执行的是 pnpm exec playwright install chromium，打包态用的是内置 Node 加 resourcesPath 下的 cli.js，下载目录固定在 userData/browsers。失败时先看是不是这条链路缺环。',
      '装 FFmpeg 时如果看到「下载完成但未检测到可用的 ffmpeg 二进制」，那是制品本身在你机器上跑不起来（多为平台不匹配），重试无效；如果只是「系统装了但显示未安装」，手动跑 ffmpeg -version 看是否报依赖库错误。',
      '装 office-viewer 后回到任意 Office 文件处验证：占位提示会消失、文件正常预览。若仍显示「需要安装离线 Office 预览资源」，看是不是装完没刷新，或资源请求被 capability-asset 协议以 403/404 拒绝。',
      '最后处理善后：只有 office-viewer 与 local-depth 能一键卸载；四个外部能力要清空间只能手动删 userData 下的 agent-runtimes/codex、bin 里的 ffmpeg 目录、browsers 与 voice。删之前先确认没有正在跑的任务在用它们。',
    ],
  },
}

export default optionalCapabilities
