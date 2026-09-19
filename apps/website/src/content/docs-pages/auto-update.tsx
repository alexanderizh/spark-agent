import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      SparkWork 桌面端的更新链路有<strong>三个真实参与方</strong>：GitHub Actions 负责构建与发布，
      对象存储（MinIO / S3 兼容）承载安装包，官网版本中心（edu-server 的{' '}
      <code>/api/v1/desktop/releases/*</code>）提供应用内更新所需的元数据；GitHub Releases
      是回退源。 应用内更新由主进程的 <code>UpdateService</code> 实现，
      <strong>不走 electron-updater</strong>： 它自己拉元数据、自己下载、自己用 SHA
      校验、最后调用系统方式打开安装包。
    </p>

    <h2 id="pipeline">1. 整体链路一览</h2>
    <table>
      <thead>
        <tr>
          <th>环节</th>
          <th>真实实现</th>
          <th>产物/接口</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>CI 构建与发布</td>
          <td>
            <code>.github/workflows/publish-desktop-release.yml</code>
          </td>
          <td>
            GitHub Release <code>v&lt;version&gt;</code> + 平台安装包（同时上传为 5 天有效的
            workflow artifacts）
          </td>
        </tr>
        <tr>
          <td>安装包归档</td>
          <td>
            workflow 的 <code>publish-to-official-website</code> job（需要{' '}
            <code>official-website-production</code> 环境审批）
          </td>
          <td>
            <code>aws s3 cp</code> 到 <code>s3://&lt;bucket&gt;/stable/&lt;version&gt;/</code>
            （dmg/exe/AppImage/zip/deb/rpm/blockmap）
          </td>
        </tr>
        <tr>
          <td>元数据登记</td>
          <td>
            <code>apps/desktop/scripts/register-release.mjs</code>
          </td>
          <td>
            <code>POST {'{RELEASE_API_BASE}'}/api/v1/ci/desktop/releases/register</code>（头{' '}
            <code>X-Release-Token</code>）
          </td>
        </tr>
        <tr>
          <td>应用内检查</td>
          <td>
            <code>apps/desktop/src/main/services/UpdateService.ts</code>
          </td>
          <td>
            <code>GET /api/v1/desktop/releases/latest?channel=&amp;platform=&amp;arch=</code>
            ，失败回退 GitHub REST API
          </td>
        </tr>
        <tr>
          <td>官网下载按钮</td>
          <td>
            <code>apps/website/src/lib/releases.ts</code> +{' '}
            <code>apps/website/scripts/fetch-downloads.mjs</code>
          </td>
          <td>
            运行时读同一个 <code>/latest</code> 接口，构建期烘焙快照到{' '}
            <code>src/content/downloads.generated.json</code>
          </td>
        </tr>
      </tbody>
    </table>

    <h2 id="publish-flow">2. 发布流程：workflow 的真实触发与结构</h2>
    <p>
      <strong>触发条件</strong>（比「只有 apps/desktop/package.json 变更才触发」更宽）：
    </p>
    <ul>
      <li>
        push 到 <code>master</code>，且改动命中这些路径之一：<code>apps/desktop/package.json</code>
        、 根 <code>package.json</code>、<code>.nvmrc</code>、<code>.node-version</code>、
        <code>.github/workflows/publish-desktop-release.yml</code> 自身。
      </li>
      <li>
        手动 <code>workflow_dispatch</code>，输入：<code>platforms</code>（all / mac / win /
        mac-arm64 / mac-x64 / win-x64）、<code>publish_to_release</code>（默认
        false，即只构建+签名验证）、
        <code>optional_capabilities_only</code>（只构建深度可选能力包）、<code>ref</code>。
      </li>
    </ul>
    <p>
      <strong>prepare job（判断是否真的要发布）</strong>：
    </p>
    <ol>
      <li>
        版本号取自 <code>apps/desktop/package.json</code> 的 <code>version</code>，tag 为{' '}
        <code>v&lt;version&gt;</code>。
      </li>
      <li>
        push 触发时会比对 <code>github.event.before</code> 那个提交里的版本号；
        <strong>版本号没变就直接结束</strong>（<code>should_publish=false</code>）。
      </li>
      <li>
        若同名 tag 已存在且指向别的提交，直接报错退出：「请提升版本号，禁止把新产物发布到旧标签」。
      </li>
      <li>
        更新说明由 <code>scripts/release-notes.mjs</code> 从 <code>CHANGELOG.md</code> 生成；
        缺少该版本条目时允许为空，流程继续。
      </li>
      <li>
        GitHub Release 由这一个 job 预先创建/更新（<code>--latest</code>）；不能让多个 matrix job
        并发创建， 否则会撞 422 already_exists。
      </li>
    </ol>
    <p>
      <strong>构建矩阵（push 默认全平台）</strong>：
    </p>
    <table>
      <thead>
        <tr>
          <th>target</th>
          <th>runner</th>
          <th>产物</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>mac-arm64</code>
          </td>
          <td>
            <code>macos-latest</code>
          </td>
          <td>arm64 dmg</td>
        </tr>
        <tr>
          <td>
            <code>mac-x64</code>
          </td>
          <td>
            <code>macos-26-intel</code>
          </td>
          <td>x64 dmg（Intel runner + Xcode 26）</td>
        </tr>
        <tr>
          <td>
            <code>win-x64</code>
          </td>
          <td>
            <code>windows-2022</code>
          </td>
          <td>x64 exe（NSIS 安装器）</td>
        </tr>
      </tbody>
    </table>
    <p>构建步骤里的硬性要求：</p>
    <ul>
      <li>
        <code>pnpm</code> 固定 11.13.0，Node 用 <code>.nvmrc</code>，安装用{' '}
        <code>--frozen-lockfile</code>。
      </li>
      <li>
        先跑 <code>pnpm run check:codex-protocol</code> 校验 Codex App Server 协议兼容性。
      </li>
      <li>
        macOS runner 需要 Python 3.11（node-gyp 9.x 依赖 <code>distutils</code>）。
      </li>
      <li>
        macOS 先用 <code>apps/desktop/scripts/import-cert-ci.sh</code> 把 Developer ID Application
        证书导入临时钥匙串， 并立即用{' '}
        <code>security find-identity -v -p codesigning | grep "Developer ID Application"</code>{' '}
        校验， 证书误配会在构建早期直接失败。
      </li>
      <li>
        Windows 构建带 <code>REQUIRE_WINDOWS_SIGNING=1</code> 与{' '}
        <code>ALLOW_UNSIGNED_WINDOWS_RELEASE=0</code>， 正式发布必须有证书。
      </li>
      <li>
        renderer 打包内存：<code>NODE_OPTIONS=--max-old-space-size=8192</code>。
      </li>
      <li>
        实际打包分别走 <code>apps/desktop/scripts/build-mac-release.sh</code> 与{' '}
        <code>apps/desktop/scripts/build-win-release.sh</code>；macOS 构建只对两类瞬时故障重试一次
        （dmg 卸载 <code>Resource busy</code>、Apple 侧网络错误）。
      </li>
    </ul>
    <p>
      Release 发布后（或手动触发且勾选 <code>publish_to_release</code>）才进入{' '}
      <code>publish-to-official-website</code> job：它挂在 <code>official-website-production</code>{' '}
      环境上，<strong>一次人工审批</strong>同时控制 MinIO 上传与版本中心登记。该 job 会先检查 6 个
      secrets 是否齐备（<code>RELEASE_API_BASE</code>、<code>RELEASE_CI_TOKEN</code>、
      <code>RELEASE_MINIO_ENDPOINT</code>、<code>RELEASE_MINIO_BUCKET</code>、
      <code>RELEASE_MINIO_ACCESS_KEY</code>、<code>RELEASE_MINIO_SECRET_KEY</code>），缺一个就失败。
    </p>

    <h2 id="version-center">3. 官网版本中心：登记什么、读取什么</h2>
    <p>
      <strong>登记（CI → 官网）</strong>：<code>register-release.mjs</code> 的行为可以逐条核对：
    </p>
    <ul>
      <li>
        环境变量：<code>VERSION</code>、<code>PLATFORM</code>、<code>ARCH</code>、
        <code>RELEASE_API_BASE</code>、<code>RELEASE_CI_TOKEN</code>、可选 <code>CHANNEL</code>
        （默认 stable）、<code>DIST_DIR</code>（默认 <code>apps/desktop/dist</code>）、
        <code>RELEASE_OBJECT_PREFIX</code>（默认 <code>&lt;channel&gt;/&lt;version&gt;</code>）、
        <code>RELEASE_AUTO_PUBLISH</code>（设为 <code>false</code> 时发布为未自动上线）。
      </li>
      <li>
        安装包匹配规则：文件名同时满足「含 <code>-&lt;platform&gt;-&lt;arch&gt;.</code>
        」与扩展名属于 <code>[.dmg, .exe, .appimage, .zip, .deb, .rpm]</code>
        ；匹配不到直接报错并打印 dist 目录内容。
      </li>
      <li>
        每个文件登记 <code>platform</code>、<code>arch</code>、<code>fileName</code>、
        <code>fileSize</code>、<code>sha512</code>（Base64）、<code>objectKey</code>、
        <code>blockmapKey</code>。
      </li>
      <li>
        请求：<code>POST {'{apiBase}'}/api/v1/ci/desktop/releases/register</code>，头
        <code>X-Release-Token</code>，body{' '}
        <code>
          {'{'}version, channel, files, releaseNotes, autoPublish{'}'}
        </code>
        ； 失败最多重试 3 次（2s、4s 退避），响应 <code>code !== 0</code> 视为失败。
      </li>
      <li>workflow 会按矩阵逐个平台/架构调用这个脚本，所以一次发布会登记多条文件记录。</li>
    </ul>
    <p>
      <strong>读取（官网页面）</strong>：
    </p>
    <ul>
      <li>
        运行时：<code>apps/website/src/lib/releases.ts</code> 请求{' '}
        <code>/api/v1/desktop/releases/latest?channel=stable</code>；基地址优先取{' '}
        <code>VITE_RELEASES_API_BASE</code>，没有配置时用同源 <code>window.location.origin</code>。
        返回结构是{' '}
        <code>
          {'{'}code, message, data: LatestRelease | LatestRelease[] | null{'}'}
        </code>
        ， 字段为
        version/channel/platform/arch/fileName/fileSize/publicUrl/releaseNotes/publishedAt。
      </li>
      <li>
        构建期：<code>pnpm --filter @spark/website prebuild</code> 会跑{' '}
        <code>scripts/fetch-downloads.mjs</code> 把同一个接口的结果写进{' '}
        <code>src/content/downloads.generated.json</code>；页面首屏用这份快照渲染（无闪烁），
        后台再拉一次实时数据替换，接口失败则继续用快照。
      </li>
    </ul>

    <h2 id="in-app">4. 应用内更新：状态机、节奏与缓存</h2>
    <p>
      状态枚举（<code>UpdateStatusState</code>）：<code>idle</code> → <code>checking</code> →{' '}
      <code>available</code> → <code>downloading</code> → <code>downloaded</code>， 以及{' '}
      <code>not-available</code> 与 <code>error</code>。<code>UpdateStatus</code> 里还会带{' '}
      <code>currentVersion</code>、<code>updateInfo</code>、<code>progress</code>、
      <code>lastCheckedAt</code>、<code>updateSource</code>（<code>version-center</code> /{' '}
      <code>github</code>）与 <code>downloadSource</code>。
    </p>
    <p>
      <strong>检查节奏（真实常量）</strong>：
    </p>
    <table>
      <thead>
        <tr>
          <th>行为</th>
          <th>取值</th>
          <th>说明</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>启动检查延迟</td>
          <td>5 秒</td>
          <td>避免影响首屏</td>
        </tr>
        <tr>
          <td>常规检查间隔</td>
          <td>30 分钟</td>
          <td>静默执行（自动检查失败不弹提示）</td>
        </tr>
        <tr>
          <td>抖动</td>
          <td>±5 分钟</td>
          <td>避免客户端集中请求</td>
        </tr>
        <tr>
          <td>失败退避</td>
          <td>30 分钟 × 2ⁿ，上限 2 小时</td>
          <td>连续失败时指数退避</td>
        </tr>
        <tr>
          <td>聚焦/唤醒补查</td>
          <td>距上次检查超过 30 分钟才补</td>
          <td>
            <code>browser-window-focus</code> 与 <code>powerMonitor</code> 的 <code>resume</code>{' '}
            触发
          </td>
        </tr>
        <tr>
          <td>手动检查失败</td>
          <td>仍会显示错误</td>
          <td>只有自动检查静默</td>
        </tr>
      </tbody>
    </table>
    <p>
      <strong>下载与安装</strong>：
    </p>
    <ul>
      <li>
        默认 <code>autoDownload: false</code>：发现新版本先进入 <code>available</code>
        ，由用户点「下载更新」。 打开「自动下载」后才会在检查时自动下载。
      </li>
      <li>
        下载落在 <code>{'{userData}'}/spark-agent-updater/&lt;version&gt;/&lt;assetName&gt;</code>；
        应用启动时会清理缓存，只保留最近 2 个版本目录（按目录修改时间）。命中缓存则直接进入{' '}
        <code>downloaded</code>，不重复下载。
      </li>
      <li>
        校验：元数据带 <code>digest</code>（版本中心映射成 <code>sha512:&lt;base64&gt;</code>，
        GitHub 资产可能是 <code>sha256:&lt;hex&gt;</code>）时端到端校验，不匹配报「更新包
        SHA…完整性校验失败」； 旧版本资产没有 digest 时只记录警告并继续（兼容行为）。
      </li>
      <li>
        下载完成 → 系统通知 + 对话框。macOS 按钮是「打开安装镜像」，说明是「打开 dmg 后请将应用拖到
        Applications 替换现有版本」， 随后应用延迟 1.2 秒退出；Windows 按钮是「安装更新」，直接启动
        exe 安装器。
      </li>
      <li>
        Windows 独有「自动安装」：<code>autoInstall: true</code> 且状态为 <code>downloaded</code>{' '}
        时， 退出应用会自动启动安装器（其他平台该设置被强制为 false）。
      </li>
      <li>
        <strong>没有增量更新</strong>：<code>blockmap</code> 会被上传与登记，但更新服务不消费它——
        每次都是下载完整 dmg/exe（资产筛选时还会显式排除 <code>*.dmg.blockmap</code> /{' '}
        <code>*.exe.blockmap</code>）。
      </li>
    </ul>
    <p>
      <strong>IPC 与界面</strong>：
    </p>
    <ul>
      <li>
        通道：<code>update:check</code>、<code>update:download</code>、
        <code>update:install-restart</code>、<code>update:get-status</code>、
        <code>update:settings</code>（可改 autoCheck / autoDownload / autoInstall / channel）。
      </li>
      <li>
        推送：<code>stream:update:status</code> 为主，另有 <code>stream:update:available</code>、
        <code>stream:update:progress</code>、<code>stream:update:downloaded</code>。
      </li>
      <li>
        设置 → 更新：状态卡（含下载进度条与操作按钮）、更新内容卡（超过 1200 字符可折叠）、 「打开
        Release 页」、「更新策略」四项（自动检查更新 / 自动下载 / 自动安装 / 更新来源）、版本卡。
        「更新来源」会写明检查顺序「官网版本中心 → GitHub Releases」并显示当前实际来源
        （界面文案分别是 <code>官网</code> / <code>GitHub</code> / <code>待检查</code>）。
      </li>
      <li>
        侧边栏头部图标按钮：只在非 idle 状态出现——<code>available</code> 点击即下载、
        <code>downloading</code> 点击跳到设置页、<code>downloaded</code> 点击安装、
        <code>error</code>/<code>checking</code> 有对应图标；tooltip 会显示「来源：官网版本中心 /
        GitHub Releases」。
      </li>
      <li>
        偏好与上次检查时间持久化在 <code>app_settings</code> 的 <code>updates/data</code> 与{' '}
        <code>updates/lastChecked</code>。
      </li>
    </ul>

    <h2 id="source-selection">5. 更新源选择、回退与错误文案</h2>
    <ol>
      <li>
        先请求版本中心：
        <code>
          GET {'{releasesApiBase}'}/api/v1/desktop/releases/latest?channel=&amp;platform=&amp;arch=
        </code>
        。<code>releasesApiBase</code> 默认 <code>https://www.yiqibyte.com</code>， 可被{' '}
        <code>dev-app-update.yml</code> / <code>app-update.yml</code> 覆盖。请求头{' '}
        <code>user-agent: Spark-Agent-Updater</code>。
      </li>
      <li>
        版本中心不可用（网络失败、<code>code !== 0</code>、非 2xx）时记录警告并回退 GitHub：
        <code>stable</code> 通道读 <code>/releases/latest</code>；<code>beta</code> 通道读{' '}
        <code>/releases?per_page=20</code> 并取第一个非 draft。
      </li>
      <li>
        版本比较用 tag 规范化后的版本号：不大于当前版本 → <code>not-available</code>。
        平台资产筛选规则：macOS 只接受 <code>.dmg</code>，按当前架构优先（arm64 优先含 arm64 的包，
        x64 优先含 x64 的包，fallback universal）；Windows 只接受 <code>.exe</code>，含{' '}
        <code>setup</code> 加权、含 <code>portable</code> 降权。找不到合适资产时报「当前 Release
        缺少适用于 macOS/Windows 的安装包」。
      </li>
      <li>
        GitHub 未认证请求会撞 rate limit：服务会解析 <code>retry-after</code> /{' '}
        <code>x-ratelimit-reset</code> 并在提示里给出重置时间；频繁点「检查更新」时请等待或改用带
        token 的配置。
      </li>
    </ol>
    <p>配置来源与优先级（用于排查「为什么读到的是另一份配置」）：</p>
    <ul>
      <li>
        打包版读 <code>{'{resourcesPath}'}/app-update.yml</code>（由 electron-builder 依据{' '}
        <code>electron-builder.yml</code> 的 <code>publish</code> 段生成：github / owner{' '}
        <code>alexanderizh</code> / repo <code>spark-agent</code> / releaseType release）。
      </li>
      <li>
        开发版按顺序找：当前工作目录的 <code>dev-app-update.yml</code>、
        <code>apps/desktop/dev-app-update.yml</code> 等候选路径；仓库里的这份内容是{' '}
        <code>provider: github</code>、<code>updaterCacheDirName: spark-agent-dev-updater</code>、
        <code>releasesApiBase: https://www.yiqibyte.com</code>。
      </li>
      <li>
        可识别字段：<code>owner</code>、<code>repo</code>、<code>updaterCacheDirName</code>、
        <code>token</code>（用于提高 GitHub 限额，仅本地开发用）、<code>releasesApiBase</code>
        。都找不到时用内置默认值。
      </li>
    </ul>

    <h2 id="signing">6. 签名、公证与原生模块要求</h2>
    <ul>
      <li>
        <code>electron-builder.yml</code>：<code>appId: com.spark-agent.desktop</code>、
        <code>productName: Spark Agent</code>、
        <code>artifactName: ${'{productName}-${version}-${os}-${arch}.${ext}'}</code>、
        <code>electronVersion: 43.2.0</code>、<code>mac.target: dmg</code>、
        <code>hardenedRuntime: true</code>、<code>identity: 'Developer ID Application'</code>
        、公证交给 <code>afterSign: scripts/notarize.js</code>。 协议 scheme 注册为{' '}
        <code>spark-agent</code>。
      </li>
      <li>
        macOS 还需要 <code>APPLE_ID</code>、<code>APPLE_APP_SPECIFIC_PASSWORD</code>、
        <code>APPLE_TEAM_ID</code>；<code>build-mac-release.sh</code> 会在启动前检查这三个变量、
        keychain 里的 Developer ID 证书以及 <code>xcrun notarytool</code> 可用性。
      </li>
      <li>
        Windows：<code>signtoolOptions</code> 里是 SHA-256 + RFC3161 时间戳 （
        <code>http://timestamp.digicert.com</code>），<code>signExts: [.exe]</code>。 CI 传{' '}
        <code>WIN_CSC_LINK</code> / <code>WIN_CSC_KEY_PASSWORD</code>；
        <code>build-win-release.sh</code> 支持本地 <code>.pfx</code> 路径、<code>http(s)</code>
        、data URL 或 base64 内容， 并把证书写到临时目录、构建结束自动清理。
      </li>
      <li>
        签名校验：有证书时脚本要求最终 <code>.exe</code> 的 Authenticode 状态是 <code>Valid</code>；
        正式发布路径（<code>REQUIRE_WINDOWS_SIGNING=1</code>）缺少证书会直接失败；
        只传了一半凭据也会失败（除非显式允许未签名）。
      </li>
      <li>
        原生模块：<code>better-sqlite3</code>、<code>keytar</code>、<code>node-pty</code>{' '}
        必须按目标架构重建到 Electron ABI。 打包脚本调用{' '}
        <code>pnpm run rebuild:native -- &lt;arch&gt;</code>，宿主架构与目标一致时会继续跑{' '}
        <code>native:verify</code>（真实用 Electron 加载一次）；不一致时跳过并提示「在目标架构
        runner 上构建」。
      </li>
      <li>
        <code>electron-builder.yml</code> 关闭了自带 native rebuild（<code>npmRebuild: false</code>
        ）， 原因写在配置注释里：<code>node-pty@1.1.0</code> 的 install 脚本会跑 tsc 编译测试文件，
        类型检查失败会拖垮整个 rebuild。
      </li>
    </ul>

    <h2 id="local-build">7. 本地构建与调试</h2>
    <p>
      常用命令（都在 <code>apps/desktop</code> 下，或直接用脚本路径）：
    </p>
    <pre>{`# 开发模式（更新检查/下载链路同样可用）
pnpm --filter @spark/desktop dev

# macOS 单架构发布构建（内部会先 rebuild:native 再 electron-builder）
pnpm --filter @spark/desktop build:mac:arm64
pnpm --filter @spark/desktop build:mac:x64

# Windows 发布构建（不发布到 Release）
pnpm --filter @spark/desktop build:win:release -- --publish never
# 或者从仓库根目录：
bash apps/desktop/scripts/build-win-release.sh x64 --publish never

# 带本地证书的 Windows 构建
WIN_CSC_LINK=/path/to/cert.pfx \\
WIN_CSC_KEY_PASSWORD=your-pfx-password \\
pnpm --filter @spark/desktop build:win:release -- --publish never`}</pre>
    <p>调试要点：</p>
    <ul>
      <li>
        <code>dev-app-update.yml</code> 会覆盖仓库/缓存目录/版本中心地址；如果要绕过 GitHub 限额，
        可以在里面加一个仅供开发用的 <code>token</code>。
      </li>
      <li>
        本地想验证「版本中心 → 官网下载按钮」链路时，设置 <code>VITE_RELEASES_API_BASE</code>
        （运行时） 与 <code>RELEASES_API_BASE</code>（<code>prebuild</code> 拉快照）指向你的
        edu-server 实例。
      </li>
      <li>
        可观测点：设置 → 更新 的状态卡与「更新来源」、会话/主窗口里的{' '}
        <code>stream:update:status</code> 事件、侧边栏更新按钮 tooltip、以及{' '}
        <code>{'{userData}'}/spark-agent-updater/</code> 下的缓存目录。
      </li>
      <li>
        远端 Release 缺少对应平台安装包时，本地也会收到同一错误文案（例如「当前 Release 缺少适用于
        macOS 的安装包」）。
      </li>
    </ul>

    <h2 id="channels-pitfalls">8. 通道、设置与常见坑</h2>
    <p>
      通道类型是 <code>UpdateChannel = 'stable' | 'beta'</code>，默认 <code>stable</code>，可通过{' '}
      <code>update:settings</code> 修改并持久化在 <code>updates/data</code>。需要说清楚的是：
      <strong>当前设置 → 更新 页面没有通道选择器</strong>，只有「自动检查更新 / 自动下载 / 自动安装
      / 更新来源」四项， 以及检查、下载、安装三个动作按钮；也就是说 beta
      在协议与检查逻辑上可用，但普通用户界面上切不了。
    </p>
    <p>常见坑：</p>
    <ul>
      <li>
        <strong>「自动安装」在 macOS 上打开又自己关掉</strong>：这是设计——保存偏好时会强制把非
        Windows 平台的 <code>autoInstall</code> 置回
        false（界面提示「当前平台不支持自动安装，下载后需手动打开安装包」）。
      </li>
      <li>
        <strong>以为发的是增量包</strong>：blockmap 只被登记，不会被消费；用户每次都下完整安装包。
      </li>
      <li>
        <strong>
          改了 <code>CHANGELOG.md</code> 却没触发发布
        </strong>
        ：触发路径里没有 CHANGELOG， 它只影响 release notes 内容；另外版本号不变时 workflow
        会判定不发布。
      </li>
      <li>
        <strong>tag 已存在但指向旧提交</strong>：workflow
        会直接失败并要求提升版本号，这是防止「新产物挂到旧标签」的保护。
      </li>
      <li>
        <strong>Release 里能看到安装包，但应用内检查不到</strong>：应用内优先读版本中心；
        如果版本中心登记失败（缺 secrets 或审批未通过），要么回退 GitHub
        成功、要么提示缺少平台资产。 先看 GitHub Release 里资产名是否包含{' '}
        <code>-&lt;platform&gt;-&lt;arch&gt;.</code>（例如 <code>-mac-arm64.dmg</code>
        ），这是登记与筛选共用的命名约定。
      </li>
      <li>
        <strong>担心缓存越滚越大</strong>：更新器启动时只保留最近 2 个版本目录，其余自动回收；
        想手动清理可以删掉 <code>{'{userData}'}/spark-agent-updater/</code>。
      </li>
      <li>
        <strong>Windows 未签名包</strong>：本地构建允许产出未签名 exe（会有 SmartScreen 警告）， 但
        CI 正式发布路径要求签名；判据就是脚本对 Authenticode 状态是否为 <code>Valid</code> 的校验。
      </li>
    </ul>
  </>
)

export const autoUpdate: DocsPageContent = {
  slug: 'auto-update',
  toc: [
    { id: 'pipeline', title: '1. 整体链路一览', level: 2 },
    { id: 'publish-flow', title: '2. 发布流程：workflow 的真实触发与结构', level: 2 },
    { id: 'version-center', title: '3. 官网版本中心：登记什么、读取什么', level: 2 },
    { id: 'in-app', title: '4. 应用内更新：状态机、节奏与缓存', level: 2 },
    { id: 'source-selection', title: '5. 更新源选择、回退与错误文案', level: 2 },
    { id: 'signing', title: '6. 签名、公证与原生模块要求', level: 2 },
    { id: 'local-build', title: '7. 本地构建与调试', level: 2 },
    { id: 'channels-pitfalls', title: '8. 通道、设置与常见坑', level: 2 },
  ],
  faq: [
    {
      question: 'GitHub Release 是唯一发布源吗？',
      answer:
        '不是。CI 会同时把安装包上传到对象存储（MinIO/S3 兼容桶的 stable/<version>/）并把元数据登记到官网版本中心；应用内更新优先读版本中心，失败才回退 GitHub Releases API。',
    },
    {
      question: '为什么我只改了版本号却要先人工审批？',
      answer:
        'electron-builder 推完 GitHub Release 后，publish-to-official-website job 挂在 official-website-production 环境上，required reviewer 会拦一次；这次审批同时控制 MinIO 上传与版本中心登记，所以正式分发路径需要人工放行。',
    },
    {
      question: '应用内更新是增量下载吗？',
      answer:
        '不是。blockmap 会被上传与登记，但 UpdateService 不消费它，资产筛选中还会显式排除 *.blockmap，因此每次都是完整安装包。',
    },
    {
      question: '自动检查更新会打扰我吗？',
      answer:
        '不会弹提示。启动后延迟 5 秒检查一次，之后约每 30 分钟静默检查（±5 分钟抖动），失败按 30 分钟 × 2ⁿ 退避、上限 2 小时；只有手动检查失败才会显示错误。',
    },
    {
      question: '能切到 beta 通道吗？',
      answer:
        '协议与检查逻辑支持 stable/beta（beta 会遍历 /releases?per_page=20 取第一个非 draft），也能通过 update:settings 修改并持久化；但当前设置 → 更新 页面没有通道选择器，界面上切不了。',
    },
    {
      question: 'Windows 一定要证书吗？',
      answer:
        '本地构建可以不带证书（产出未签名 exe，会有 SmartScreen 警告）；CI 正式发布路径设置了 REQUIRE_WINDOWS_SIGNING=1 且不允许未签名，脚本还会要求最终 exe 的 Authenticode 状态为 Valid。',
    },
  ],
  quickReference: [
    { key: '发布源', value: 'GitHub Release + MinIO 对象存储 + 官网版本中心（GitHub 为回退源）' },
    { key: '登记接口', value: 'POST /api/v1/ci/desktop/releases/register（头 X-Release-Token）' },
    { key: '检查接口', value: 'GET /api/v1/desktop/releases/latest?channel=&platform=&arch=' },
    { key: '版本中心默认地址', value: 'https://www.yiqibyte.com' },
    {
      key: '对象存储路径',
      value: 's3://<bucket>/stable/<version>/（dmg/exe/AppImage/zip/deb/rpm/blockmap）',
    },
    {
      key: '构建矩阵',
      value: 'mac-arm64（macos-latest）· mac-x64（macos-26-intel）· win-x64（windows-2022）',
    },
    { key: '检查节奏', value: '启动延迟 5 秒 · 常规 30 分钟 ± 5 分钟抖动 · 失败退避上限 2 小时' },
    { key: '更新缓存', value: '{userData}/spark-agent-updater/<version>/，保留最近 2 个版本' },
    { key: 'IPC', value: 'update:check / download / install-restart / get-status / settings' },
    { key: '推送', value: 'stream:update:status（另有 available / progress / downloaded）' },
    {
      key: '原生模块',
      value:
        'better-sqlite3 · keytar · node-pty（pnpm run rebuild:native -- <arch> + native:verify）',
    },
    {
      key: 'macOS 签名',
      value: 'Developer ID Application + hardenedRuntime + afterSign 公证（notarize.js）',
    },
    { key: 'Windows 签名', value: 'WIN_CSC_LINK / WIN_CSC_KEY_PASSWORD，SHA-256 + RFC3161 时间戳' },
  ],
  howTo: {
    name: '发布一次桌面端新版本',
    description: '从改 version 到用户收到更新提示',
    totalTime: 'PT40M',
    steps: [
      '在 apps/desktop/package.json 把 version 改成新号，并在 CHANGELOG.md 里补一条对应版本的说明（缺条目也能发布，但更新说明会为空）',
      '合并到 master；只要改动命中 workflow 的 paths（含 apps/desktop/package.json），桌面端发布 workflow 就会触发',
      'prepare job 比对版本号、创建 v<version> tag 与 GitHub Release（版本号没变会直接跳过）',
      '三个 matrix job 分别在 macOS（arm64 / Intel）与 Windows runner 上 rebuild 原生模块、打包、签名（macOS 还会公证），并把安装包上传为 workflow artifacts',
      '通过 official-website-production 环境审批后，安装包被复制到对象存储的 stable/<version>/，并按平台逐个登记到官网版本中心',
      '打开桌面端 设置 → 更新 点「检查更新」，确认状态进入「可更新」且「更新来源」显示官网；点下载后确认进度与完成提示',
      '回到官网下载页确认按钮已指向新版本（运行时接口或构建期快照二选一都应有新数据）',
    ],
  },
  aiSummary:
    'SparkWork 桌面端更新链路：GitHub Actions 的 publish-desktop-release.yml 在 master 上 apps/desktop/package.json 等路径变化时触发，比对版本号后创建 v<version> tag 与 GitHub Release，' +
    '在 macos-latest（arm64）、macos-26-intel（x64）、windows-2022（x64）三个 runner 上打包签名（macOS 公证走 notarize.js，Windows 需要 WIN_CSC_LINK 且要求 Authenticode 为 Valid）；' +
    '审批后安装包上传到 MinIO 的 stable/<version>/ 并由 register-release.mjs 登记到官网版本中心（POST /api/v1/ci/desktop/releases/register），失败可回退 GitHub Releases。' +
    '应用内 UpdateService 优先 GET /api/v1/desktop/releases/latest（默认 https://www.yiqibyte.com），启动后延迟 5 秒检查、常规 30 分钟 ±5 分钟抖动、失败指数退避上限 2 小时、聚焦/唤醒按 30 分钟阈值补查；' +
    '状态机为 idle/checking/available/downloading/downloaded/not-available/error，默认不自动下载，缓存保留最近 2 个版本目录，带 digest 时做 SHA 校验，安装走 macOS 打开 dmg 或 Windows 启动 exe（autoInstall 仅 Windows）。' +
    '通道类型支持 stable/beta，但当前设置页没有通道选择器；blockmap 只登记不消费，实际都是全量下载。',
  Body,
}

export default autoUpdate
