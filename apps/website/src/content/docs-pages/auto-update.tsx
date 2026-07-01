import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      Spark Agent 桌面端使用 <strong>electron-builder + GitHub Releases + 官网版本中心 + 自定义更新服务</strong>
      作为发布与更新源。流程由 GitHub Actions 自动化触发，元数据先登记到官网版本中心，
      应用启动时先读官网版本中心，失败或不可用时回退 GitHub Release。
    </p>

    <h2 id="publish-flow">1. 发布流程</h2>
    <ol>
      <li>合并代码到 <code>master</code>。</li>
      <li>只有 <code>apps/desktop/package.json</code> 被改动时，workflow 才会触发。</li>
      <li>Workflow 对比本次 push 前后的 <code>version</code>，只有版本号真的变化才继续发布。</li>
      <li>Workflow 自动创建 <code>v&lt;version&gt;</code> tag（如不存在）。</li>
      <li><code>electron-builder</code> 为 macOS Apple Silicon / Intel / Windows 打包并上传到对应 GitHub Release。</li>
      <li>Release 发布后，CI 优先把安装包元数据登记到官网版本中心；应用内更新服务先读官网版本中心，失败时回退 GitHub Release。</li>
    </ol>

    <h2 id="repo-config">2. 当前仓库配置</h2>
    <ul>
      <li>发布源配置：<code>apps/desktop/electron-builder.yml</code></li>
      <li>自动发布 workflow：<code>.github/workflows/publish-desktop-release.yml</code></li>
      <li>应用内更新服务：<code>apps/desktop/src/main/services/UpdateService.ts</code></li>
      <li>开发环境更新配置：<code>apps/desktop/dev-app-update.yml</code></li>
    </ul>
    <p>其他要点：</p>
    <ul>
      <li>Playwright 相关 JS 包不再走整包 <code>asarUnpack</code>，避免 pnpm 硬链接目录在 <code>electron-builder</code> 打包阶段触发重复 link 的 <code>EEXIST</code>。</li>
      <li>macOS Release 直接发布 <code>arm64</code> / <code>x64</code> 两个 <code>dmg</code>，Windows Release 直接发布 <code>x64</code> <code>exe</code>。</li>
      <li>应用更新检查不再依赖 <code>latest-mac.yml</code> / <code>latest.yml</code> 解析 zip，而是读取官网版本中心返回的平台安装包；回退 GitHub 时按平台筛选 Release 资产。</li>
      <li>Release 构建在 <code>electron-builder</code> 前强制执行 <code>pnpm run rebuild:native -- &lt;arch&gt;</code>，把 <code>better-sqlite3</code> / <code>keytar</code> / <code>node-pty</code> 重编译到 Electron ABI；同架构 runner 会继续用 Electron 运行 <code>native:verify</code>。</li>
      <li>macOS <code>x64</code> Release 固定走 Intel runner，<code>arm64</code> 走 Apple Silicon runner；不再发布 universal 单包。</li>
      <li>Windows Release 必须在 Windows runner 上构建；本地/CI 不再支持 macOS 交叉打包 Windows 安装包。</li>
    </ul>

    <h2 id="in-app-update">3. 应用内更新策略</h2>
    <ul>
      <li>应用启动后延迟一次自动检查，避免影响首屏加载。</li>
      <li>固定间隔轮询已移除，避免无意义消耗 GitHub API 次数。</li>
      <li>窗口重新聚焦且距离上次检查较久时补做一次轻量检查。</li>
      <li>发现新版本后先进入「可更新」状态，由用户主动点击后再开始下载。</li>
      <li>下载完成后主进程弹出安装提示。</li>
      <li>macOS 打开 <code>dmg</code>，用户拖入「应用程序」完成替换。</li>
      <li>Windows 启动 <code>exe</code> 安装器；<code>autoInstall=true</code> 时退出应用会自动启动安装器。</li>
      <li>更新状态通过 <code>stream:update:status</code> 同步到设置页，含当前版本、可用版本、下载进度、上次检查时间、实际检查来源（官网版本中心 / GitHub Releases）。</li>
      <li>侧边栏顶部折叠按钮旁提供全局更新入口：检查 / 下载 / 下载中状态 / 安装。</li>
      <li>Windows Release 构建统一走 <code>apps/desktop/scripts/build-win-release.sh</code>，本地和 CI 都使用同一套 <code>WIN_CSC_LINK</code> / <code>WIN_CSC_KEY_PASSWORD</code> 处理逻辑。</li>
    </ul>

    <h2 id="dev-debug">4. 开发调试</h2>
    <ul>
      <li><code>pnpm dev</code> 下更新检查和下载链路同样可用；若存在 <code>dev-app-update.yml</code>，会优先读取其中的仓库配置。</li>
      <li>可调试：检查更新 / 下载状态 / 顶部按钮 / 设置页同步。</li>
      <li>若远端 release 缺少对应平台安装包（如 macOS 没有 dmg），开发环境同样会收到对应错误。</li>
      <li>更新检查优先请求 <code>releasesApiBase</code> 的 <code>/api/v1/desktop/releases/latest</code>；默认 <code>releasesApiBase</code> 为 <code>https://spark.yiqibyte.com</code>，失败后回退 GitHub REST API。</li>
    </ul>
    <p>
      GitHub 未认证请求受官方 rate limit 约束；如果开发调试时频繁点「检查更新」，建议等待 reset 时间后重试，
      或仅在本地 <code>dev-app-update.yml</code> 中配置一个仅用于开发的 GitHub token。
    </p>

    <h2 id="windows-sign">5. Windows 签名构建</h2>
    <p>
      CI 可配置 <code>WIN_CSC_LINK</code> 和 <code>WIN_CSC_KEY_PASSWORD</code>。<code>WIN_CSC_LINK</code> 可以是 <code>.pfx</code> 文件的 base64 内容，
      也可以是 <code>https://</code> / <code>data:...;base64,...</code> 形式；workflow 会在 Windows runner 中解码并交给 <code>electron-builder</code> 签名。
      若这两个变量缺失，会继续构建未签名安装包。
    </p>
    <p>本地 Windows 构建使用同一入口；没有证书时直接产出未签名安装包：</p>
    <pre>{`cd apps/desktop
pnpm run build:win:release -- --publish never`}</pre>
    <p>若不在 <code>apps/desktop</code> 目录，也可从仓库根目录调用：</p>
    <pre>{`bash apps/desktop/scripts/build-win-release.sh x64 --publish never`}</pre>
    <p>如果本地有 <code>.pfx</code>，可在运行前设置：</p>
    <pre>{`WIN_CSC_LINK=/path/to/cert.pfx \\
WIN_CSC_KEY_PASSWORD=your-pfx-password \\
pnpm run build:win:release -- --publish never`}</pre>
    <p>
      若本地不想把证书落盘，也可以把 <code>.pfx</code> base64 后传入 <code>WIN_CSC_LINK</code>。
      脚本会写入临时目录，构建结束自动删除。只有提供了两个变量时，脚本才会要求最终 <code>.exe</code> 的 Authenticode 状态为 <code>Valid</code>。
    </p>

    <h2 id="requirements">6. 使用要求</h2>
    <p>每次希望发布新版本时，需要先更新 <code>apps/desktop/package.json</code> 里的 <code>version</code>。</p>
    <p>GitHub Actions 需要仓库 <code>contents: write</code> 权限来创建 tag 和 release。</p>
    <p>若要用于正式分发，建议配置签名相关 secrets：</p>
    <ul>
      <li><code>CSC_LINK</code>：base64 编码的 macOS <code>.p12</code>，必须包含 <code>Developer ID Application</code> 证书和私钥；<code>Apple Development</code> 证书不能用于正式发布和公证。</li>
      <li><code>CSC_KEY_PASSWORD</code>：上述 <code>.p12</code> 的导出密码。</li>
      <li><code>APPLE_ID</code>、<code>APPLE_APP_SPECIFIC_PASSWORD</code>、<code>APPLE_TEAM_ID</code>。</li>
      <li><code>WIN_CSC_LINK</code>：Windows 代码签名 <code>.pfx</code> 的路径、URL、data URL 或 base64 内容；未配置时 Windows 产物不签名但仍会构建。</li>
      <li><code>WIN_CSC_KEY_PASSWORD</code>：上述 <code>.pfx</code> 的密码。</li>
    </ul>
    <p>
      macOS CI 会在导入证书后校验 <code>Developer ID Application</code> identity；如果 secret 误填成开发证书，会立即失败，
      避免后续公证阶段才报未签名或 adhoc 签名错误。
      Windows CI 有证书时会校验 <code>.exe</code> 的 Authenticode 状态为 <code>Valid</code>；没有证书时跳过签名校验并保留安装包。
    </p>

    <h2 id="channels">7. 更新通道</h2>
    <ul>
      <li><code>stable</code> 通道读取正式 release。</li>
      <li><code>beta</code> 通道允许读取 prerelease；如果后续要发 beta，只需要把发布流程改为 prerelease 即可。</li>
    </ul>
  </>
)

export const autoUpdate: DocsPageContent = {
  slug: 'auto-update',
  toc: [
    { id: 'publish-flow', title: '1. 发布流程', level: 2 },
    { id: 'repo-config', title: '2. 当前仓库配置', level: 2 },
    { id: 'in-app-update', title: '3. 应用内更新策略', level: 2 },
    { id: 'dev-debug', title: '4. 开发调试', level: 2 },
    { id: 'windows-sign', title: '5. Windows 签名构建', level: 2 },
    { id: 'requirements', title: '6. 使用要求', level: 2 },
    { id: 'channels', title: '7. 更新通道', level: 2 },
  ],
  faq: [
    {
      question: 'GitHub Release 是发布源吗？',
      answer: '是。CI 先把元数据登记到官网版本中心，应用内更新先读官网版本中心，失败时回退 GitHub Release。',
    },
    {
      question: '为什么应用会先更新官网版本中心？',
      answer: '官网版本中心在中国大陆访问更稳；同时能给官网提供「下载按钮」的最新版本号。',
    },
    {
      question: 'Windows 必须有证书吗？',
      answer: '不是。没有证书会继续产出未签名安装包，但用户首次打开会有 SmartScreen 警告。',
    },
    {
      question: 'beta 通道怎么开？',
      answer: '把发布流程改为 prerelease 即可；UpdateService 读 prerelease 即视为 beta。',
    },
  ],
  quickReference: [
    { key: '发布源', value: 'electron-builder + GitHub Releases + 官网版本中心' },
    { key: 'macOS 包', value: 'arm64 dmg + x64 dmg（runner 隔离，不发 universal）' },
    { key: 'Windows 包', value: 'x64 exe（必须在 Windows runner 上构建）' },
    { key: '原生模块重编译', value: 'pnpm run rebuild:native -- <arch> + native:verify' },
    { key: '官网版本中心 API', value: '/api/v1/desktop/releases/latest（默认 spark.yiqibyte.com）' },
    { key: '更新通道', value: 'stable（默认）/ beta（读取 prerelease）' },
  ],
  howTo: {
    name: '发布一次桌面端新版本',
    description: '从改 version 到让用户收到更新提示',
    totalTime: 'PT30M',
    steps: [
      '在 apps/desktop/package.json 把 version 改成新号（如 0.2.0）',
      '合并到 master，workflow 会自动触发（仅当 apps/desktop/package.json 变化）',
      'CI 创建 v0.2.0 tag、调用 electron-builder、为 macOS arm64/x64 + Windows x64 打包',
      'Release 上传后 CI 把安装包元数据登记到官网版本中心',
      '用户在桌面端启动 App 时收到「可更新」状态，点击「下载」即可完成更新',
    ],
  },
  aiSummary:
    'Spark Agent 桌面端自动更新：electron-builder + GitHub Releases + 官网版本中心（spark.yiqibyte.com）+ 自定义 UpdateService。' +
    '发布流程：合并 master → apps/desktop/package.json 变化才触发 → 对比 version 变化 → 自动建 tag → electron-builder 打包 → ' +
    'CI 把元数据登记到官网版本中心 → App 启动先读官网版本中心失败时回退 GitHub Release。' +
    'macOS Release：arm64 dmg（Apple Silicon runner） + x64 dmg（Intel runner），不再发布 universal。' +
    'Windows Release：x64 exe（Windows runner），不再跨平台打包。' +
    '应用内策略：启动延迟检查、移除固定间隔轮询、聚焦补查、可更新态才允许下载、下载后弹安装提示，状态通过 stream:update:status 同步。' +
    '签名：macOS Developer ID Application + CSC_KEY_PASSWORD + APPLE_ID/TEAM_ID；Windows WIN_CSC_LINK + WIN_CSC_KEY_PASSWORD，' +
    '无证书时构建未签名包（macOS CI 校验 identity；Windows CI 校验 Authenticode Valid）。' +
    '通道：stable（默认）+ beta（读取 prerelease）。本地 dev：pnpm dev 下更新链路可用，dev-app-update.yml 覆盖仓库配置。',
  Body,
}

export default autoUpdate
