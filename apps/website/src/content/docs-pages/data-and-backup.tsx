import type { DocsPageContent } from './_shared'

const Body = () => (
  <>
    <p>
      这一页讲三件容易被混为一谈的事：<strong>数据到底存在本地哪里</strong>、
      <strong>升级出问题时靠什么恢复</strong>、以及<strong>「账号同步」到底同步了什么</strong>。
      三者的共同点是：界面上的入口都很小，但背后的规则相当细，而且有几条与直觉相反。
    </p>
    <p>
      <strong>先给五条最容易被写错的结论</strong>：
    </p>
    <ul>
      <li>
        <strong>桌面端有两套完全不同的数据根，而且都带 spark</strong>： 应用数据在{' '}
        <code>&#123;userData&#125;</code>（macOS 上是
        <code>~/Library/Application Support/@spark/desktop</code>）， 跨工作区的长期记忆与看板在{' '}
        <code>~/.spark-agent</code>， 而 Spark CLI 用的是第三个目录 <code>~/.spark</code>
        。三者互不包含。
      </li>
      <li>
        <strong>开发实例默认不共用你的正式数据</strong>。非打包运行会把 userData 整体切到兄弟目录{' '}
        <code>@spark/desktop-dev</code>；这是为了修一个真实事故 （三方共用同一目录导致数据库在线恢复
        split-brain 丢数据）。
      </li>
      <li>
        <strong>「升级前自动恢复点」只在真有迁移时创建，而且复用旧快照时不自动回滚</strong>。
        自动恢复的开关是 <code>createdThisStartup === true</code>——只有在<em>本次启动</em>
        新建的快照才用于恢复。
      </li>
      <li>
        <strong>备份目录里其实住着两种格式的东西</strong>：<code>pre-migration-v*</code>是 SQLite
        在线备份产出的<em>单文件</em>快照；<code>pre-inherit-*</code> 是继承安装版数据时 裸拷的
        <em>三件套</em>。而清理逻辑只认前者，后者不会被回收。
      </li>
      <li>
        <strong>账号同步默认一个类别都不开，也不会自动跑</strong>。7 个类别默认全是
        <code>false</code>，总开关也默认关闭；开与不开、同步什么，都只在你点「立即同步」那一刻生效。
      </li>
    </ul>

    <h2 id="data-map">1. 本地数据存在哪：三个根与一张总表</h2>
    <p>先把根目录分清，否则后面的路径都会对不上。代码里出现的是这三个：</p>
    <table>
      <thead>
        <tr>
          <th>根</th>
          <th>真实路径</th>
          <th>里面装什么</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>&#123;userData&#125;</code>
          </td>
          <td>
            macOS：<code>~/Library/Application Support/@spark/desktop</code>；<br />
            dev 运行：兄弟目录 <code>@spark/desktop-dev</code>
          </td>
          <td>
            业务库 <code>spark.db</code>、项目工作目录、会话附件、Canvas 项目、 凭据
            vault、日志、备份、各类运行时与能力包
          </td>
        </tr>
        <tr>
          <td>
            <code>~/.spark-agent</code>
          </td>
          <td>
            <code>~/.spark-agent</code>
          </td>
          <td>
            <code>memory/</code>（user / agent 作用域长期记忆）、
            <code>board-tasks.json</code> 与 <code>board-attachments/</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>~/.spark</code>
          </td>
          <td>
            <code>~/.spark</code>（可用 <code>SPARK_HOME</code> 覆盖）
          </td>
          <td>
            Spark CLI 的 <code>config.toml</code>、<code>credentials.json</code>、<code>bin/</code>
            、会话记录。与桌面端<strong>不共用</strong>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      路径推导：<code>getDatabasePath()</code> 返回
      <code>join(app.getPath('userData'), 'spark.db')</code>（
      <code>apps/desktop/src/main/db.ts:24-27</code>）；userData 本身在应用启动最早期 就被{' '}
      <code>applyDevUserData()</code> 决定（<code>apps/desktop/src/main/index.ts:65-72</code>）。
    </p>

    <h3 id="data-inventory">1.1 逐类数据的落点、写入方与保留策略</h3>
    <p>
      下表是「谁写的、写到哪、会不会被自动清掉」的完整对照。保留策略一栏写
      <strong>无自动清理</strong>{' '}
      的，意思是只能靠用户手动删，或者干脆没有入口（并已在最后一列注明）。
    </p>
    <table>
      <thead>
        <tr>
          <th>数据类型</th>
          <th>路径</th>
          <th>保留策略</th>
          <th>界面清理入口</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>业务数据库</td>
          <td>
            <code>&#123;userData&#125;/spark.db</code>（+ <code>-wal</code> / <code>-shm</code>）
          </td>
          <td>无自动清理</td>
          <td>「清除历史运行时快照」（会 VACUUM）</td>
        </tr>
        <tr>
          <td>数据库迁移前恢复点</td>
          <td>
            <code>&#123;userData&#125;/backups/database/pre-migration-v&lt;版本&gt;/</code>
          </td>
          <td>最多 2 份、超 14 天回收、崩溃残留 24 小时后回收</td>
          <td>无（只读展示）</td>
        </tr>
        <tr>
          <td>继承安装版数据的前置备份</td>
          <td>
            <code>&#123;userData&#125;/backups/database/pre-inherit-*</code>
          </td>
          <td>
            <strong>无回收</strong>（前缀不匹配清理规则）
          </td>
          <td>无</td>
        </tr>
        <tr>
          <td>集中凭据 vault</td>
          <td>
            <code>&#123;userData&#125;/credential-vault-v1.enc</code>
          </td>
          <td>无 TTL</td>
          <td>无</td>
        </tr>
        <tr>
          <td>登录态加密备份</td>
          <td>
            <code>&#123;userData&#125;/cloud-auth-session.enc</code>
          </td>
          <td>无 TTL</td>
          <td>无（退出登录会清）</td>
        </tr>
        <tr>
          <td>文件日志</td>
          <td>
            <code>app.getPath('logs')</code>，macOS 为 <code>~/Library/Logs/@spark/desktop/</code>
          </td>
          <td>轮转 5 MB × 5 份</td>
          <td>「清空文件日志」</td>
        </tr>
        <tr>
          <td>主进程阻塞现场 profile</td>
          <td>
            <code>&lt;logs&gt;/main-block-profiles/</code>
          </td>
          <td>最多 8 份</td>
          <td>无</td>
        </tr>
        <tr>
          <td>Chromium 缓存</td>
          <td>
            <code>&#123;userData&#125;/Cache</code>、<code>Code Cache</code>、<code>GPUCache</code>{' '}
            等 7 个目录
          </td>
          <td>无自动清理</td>
          <td>「清空浏览器与渲染缓存」</td>
        </tr>
        <tr>
          <td>项目工作目录</td>
          <td>
            <code>&#123;userData&#125;/projects/</code>
          </td>
          <td>无自动清理</td>
          <td>「清理孤儿项目目录」</td>
        </tr>
        <tr>
          <td>会话附件（粘贴图片 / 文本）</td>
          <td>
            <code>&#123;userData&#125;/attachments/pasted-images/</code>、<code>pasted-texts/</code>
          </td>
          <td>无自动清理（刻意不放临时目录）</td>
          <td>无</td>
        </tr>
        <tr>
          <td>临时媒体（粘贴 / 预览副本）</td>
          <td>
            <code>&lt;系统临时目录&gt;/spark-agent-pasted-images</code> 等
          </td>
          <td>7 天，每 6 小时扫一次</td>
          <td>无（自动）</td>
        </tr>
        <tr>
          <td>Canvas 项目目录</td>
          <td>
            默认 <code>&#123;userData&#125;/canvas-projects/</code>，根可在设置里改
          </td>
          <td>
            时间戳快照 10 份，退出画布后收紧到 2 份；<code>latest.json</code> 永不删
          </td>
          <td>无「清空全部画布」按钮</td>
        </tr>
        <tr>
          <td>旧全局画布资源</td>
          <td>
            <code>&#123;userData&#125;/.spark-artifacts/media/</code>
          </td>
          <td>无 TTL</td>
          <td>「清理旧画布孤儿资源」</td>
        </tr>
        <tr>
          <td>工具结果归档</td>
          <td>
            <code>&lt;工作区&gt;/.spark-agent/tool-results/</code>
          </td>
          <td>7 天 + 总量 512 MB，单件上限 64 MB</td>
          <td>无</td>
        </tr>
        <tr>
          <td>看板任务与附件</td>
          <td>
            <code>~/.spark-agent/board-tasks.json</code>、<code>board-attachments/</code>
          </td>
          <td>无自动清理</td>
          <td>看板内逐条删除</td>
        </tr>
        <tr>
          <td>长期记忆（user / agent）</td>
          <td>
            <code>~/.spark-agent/memory/user/</code>、<code>memory/agent/</code>
          </td>
          <td>无基于时间的清理</td>
          <td>记忆面板逐条删除</td>
        </tr>
        <tr>
          <td>长期记忆（project）</td>
          <td>
            <code>&lt;工作区&gt;/.spark-agent/memory/</code>
          </td>
          <td>
            无；<strong>刻意不 gitignore</strong>，随仓库版本化
          </td>
          <td>无</td>
        </tr>
        <tr>
          <td>子应用分享包覆盖前备份</td>
          <td>
            <code>&#123;userData&#125;/sub-app-backups/*.sparkapp</code>
          </td>
          <td>
            <strong>无任何回收</strong>（只增不减）
          </td>
          <td>无</td>
        </tr>
        <tr>
          <td>电脑操作快照库</td>
          <td>
            <code>&#123;userData&#125;/snapshot-vault/blobs/</code>（AES-256-GCM 加密）
          </td>
          <td>每 6 小时扫；行级 TTL；孤儿宽限 24 小时</td>
          <td>无</td>
        </tr>
        <tr>
          <td>更新器缓存</td>
          <td>
            <code>&#123;userData&#125;/@sparkdesktop-updater/&lt;版本&gt;/</code>
          </td>
          <td>最多 2 个版本目录，启动时回收</td>
          <td>无（手动删目录）</td>
        </tr>
        <tr>
          <td>用量账本</td>
          <td>
            <code>spark.db</code> 内 <code>usage_ledger</code>
          </td>
          <td>无自动清理</td>
          <td>「清理旧记录」（固定 90 天）</td>
        </tr>
        <tr>
          <td>会话事件 / 终态请求</td>
          <td>
            <code>spark.db</code> 内 <code>agent_events</code> / <code>turn_requests</code>
          </td>
          <td>终态请求 30 天；增量 deltas 按批次清</td>
          <td>无</td>
        </tr>
      </tbody>
    </table>

    <h3 id="two-profiles">1.2 两个数据目录：dev 与安装版的隔离</h3>
    <p>
      代码注释里记着这个隔离策略的由来：打包产物 asar 内的 <code>package.json</code> 只有
      <code>name</code>（<code>@spark/desktop</code>）、没有 <code>productName</code>， 于是
      Electron 推导出的默认 userData 会让「<code>pnpm dev</code>」「签名安装包」
      「本地未签名安装包」<strong>三方共用同一个目录</strong>，曾在版本切换时触发 数据库在线恢复
      split-brain 丢数据。
    </p>
    <p>
      现在的规则由 <code>shouldUseDevUserData()</code> 决定（
      <code>apps/desktop/src/main/data-profile.ts:40-45</code>）：
    </p>
    <table>
      <thead>
        <tr>
          <th>条件</th>
          <th>结果</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>SPARK_DATA_PROFILE=production</code>
          </td>
          <td>用生产目录（即使是 dev 运行）</td>
        </tr>
        <tr>
          <td>
            <code>SPARK_DATA_PROFILE=dev</code>
          </td>
          <td>用隔离目录（即使是打包产物）</td>
        </tr>
        <tr>
          <td>
            未设置，且 <code>!app.isPackaged</code>
          </td>
          <td>用隔离目录</td>
        </tr>
        <tr>
          <td>未设置，且已打包</td>
          <td>用生产目录</td>
        </tr>
      </tbody>
    </table>
    <ul>
      <li>
        取值会做 <code>trim().toLowerCase()</code>，所以 <code>" Production "</code>
        也能识别；空串等同未设置。
      </li>
      <li>
        <code>production</code> 的判断<strong>先于</strong> dev 判断返回，所以
        <code>SPARK_DATA_PROFILE=production</code> 一定会盖过 dev 默认行为。
      </li>
      <li>
        隔离目录 = 当前 userData 的<strong>兄弟目录</strong>加 <code>-dev</code> 后缀 （
        <code>@spark/desktop</code> → <code>@spark/desktop-dev</code>）。
      </li>
      <li>
        这个 <code>-dev</code> 后缀不只是命名习惯，还是<strong>隐式 API</strong>：
        「继承安装版数据」功能就是靠它推断「安装版目录」的，改了后缀会同时打断两处。
      </li>
    </ul>
    <div className="callout">
      <p>
        <strong>实用推论</strong>：如果你在 dev 里看不到自己的正式会话，这是设计如此，不是 bug。
        反过来，<code>SPARK_DATA_PROFILE=production</code> 跑 dev 会直接写你的正式库——
        只在明确要检查生产数据时使用。
      </p>
    </div>

    <h2 id="database">2. 业务数据库：一个 SQLite 文件</h2>
    <p>
      SparkWork 的权威存储只有一个文件：<code>&#123;userData&#125;/spark.db</code>。
      会话、消息、规则、工作流、Agent、审计日志、用量账本全在里面。
      设置页顶部那句说明就是这个意思：「所有会话、规则、工作流与审计日志默认存在本地 SQLite」。
    </p>

    <h3 id="db-pragma">2.1 打开时的连接参数</h3>
    <p>
      连接由 <code>SparkDatabase</code> 构造函数统一开启（
      <code>packages/storage/src/database.ts:167-171</code>）， 也是全仓唯一可写的建库入口：
    </p>
    <pre>
      <code>
        journal_mode = WAL synchronous = NORMAL foreign_keys = ON temp_store = MEMORY mmap_size =
        268435456 // 256 MB
      </code>
    </pre>
    <ul>
      <li>
        <strong>WAL</strong> 意味着磁盘上同时存在 <code>spark.db-wal</code> 与
        <code>spark.db-shm</code>。任何「复制一份数据库」的操作都必须把这三个文件当成一个整体看待，
        否则会拿到不一致的快照。
      </li>
      <li>
        <code>close()</code> 会在退出时合并 WAL（
        <code>packages/storage/src/database.ts:240-246</code>），
        所以要手工拷贝数据库，先正常退出应用最稳。
      </li>
      <li>
        只读预检走的是另一条路径：<code>inspectPendingMigrations()</code> 用
        <code>readonly: true, fileMustExist: true</code> 打开，
        <strong>不加任何 pragma、不建表、不切 WAL</strong>（注释见
        <code>packages/storage/src/database.ts:113-117</code>）。
      </li>
    </ul>

    <h3 id="migrations">2.2 迁移：101 个 SQL 文件与 schema_migrations</h3>
    <ul>
      <li>
        迁移文件放在 <code>packages/storage/migrations/</code>，命名形如
        <code>001_initial_schema.sql</code>，当前共 <strong>101 个</strong>
        （最新为 <code>101_hook_compensator_sweep_indexes.sql</code>）； 打包后映射到{' '}
        <code>{'{resourcesPath}'}/migrations/</code>。
      </li>
      <li>
        版本号提取用的是 <code>/^(\d+)/</code>——<strong>只要能开头解析出数字就算合法</strong>，
        <code>001abc.sql</code> 也会被接受（只是与报错文案里写的
        <code>{'{number}_{name}.sql'}</code> 并不严格一致）。
      </li>
      <li>
        文件按<strong>文件名字典序</strong>排序执行。当前全是三位零填充，字典序恰好等于数值序；
        如果将来出现四位数文件名（如 <code>1000_x.sql</code>），执行顺序会错乱。
      </li>
      <li>
        已应用记录写在 <code>schema_migrations</code> 表 （
        <code>version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT</code>）， 每条迁移
        <strong>各自一个事务</strong>。
      </li>
      <li>
        版本号重复会在<strong>读取阶段</strong>就抛错，报错里会点名两个撞号文件。
      </li>
    </ul>
    <p>
      另外有两处特殊分支值得知道：版本 <strong>18 / 49</strong> 在检测到「schema 已反映」时
      可以只登记不执行；版本 <strong>48</strong> 走一个专用兼容 handler 来补生成列与索引 （
      <code>packages/storage/src/database.ts:264-317</code>）。
    </p>

    <h3 id="db-only-entry">2.3 手工操作数据库前请注意</h3>
    <ul>
      <li>
        不要用别的工具在应用运行时直接改 <code>spark.db</code>，WAL 状态下的并发写很容易踩坏。
      </li>
      <li>想直接看文件，用「存储与备份 → 数据目录 → 打开」，再正常退出应用后拷贝。</li>
      <li>
        <code>inspectPendingMigrations()</code> 会因「库文件不存在 / migrations 目录读不到 /
        文件名解析不出数字 / 版本撞号 / <code>schema_migrations</code> 查询失败」而抛错；
        上层拿到抛错后会<strong>转入保守路径</strong>——先照样做备份，再继续升级流程。
      </li>
    </ul>

    <h2 id="backup">3. 升级前自动恢复点</h2>
    <p>
      每次<strong>有新迁移要执行</strong>时，SparkWork 会先给数据库做一份完整快照，再动 schema。
      这份快照就是「设置 → 存储与备份 → 升级前自动恢复点」说的事 （
      <code>SettingsView.tsx:4519-4522</code>）。
    </p>

    <h3 id="backup-trigger">3.1 什么时候会创建、什么时候复用</h3>
    <p>
      创建的总条件是「库已存在 <em>且</em> 本次需要准备升级」 （
      <code>apps/desktop/src/main/index.ts:1065-1067</code>）：
    </p>
    <pre>
      <code>
        const requiresUpgradePreparation = databaseExistedBeforeInitialization &amp;&amp;
        (migrationPreflightFailed || pendingMigrations.length &gt; 0)
      </code>
    </pre>
    <p>
      在 <code>ensurePreMigrationBackup()</code> 内部还有第二层判断：
    </p>
    <ul>
      <li>
        <strong>源库不存在</strong> → 直接返回 <code>null</code>，不做任何事
        （这是正常路径，不是错误）。
      </li>
      <li>
        <strong>
          该版本目录下已有合法 <code>manifest.json</code>
        </strong>{' '}
        → 直接复用， 返回的快照里 <code>createdThisStartup = false</code>。
      </li>
      <li>
        <strong>否则新建</strong>，返回 <code>createdThisStartup = true</code>。
      </li>
    </ul>
    <p>
      关键点：备份目录名里<strong>带版本号</strong>（<code>pre-migration-v&lt;版本&gt;</code>），
      所以「同一个版本只备份一次」是天然成立的——重复启动同一版本会命中复用分支。 另外复用分支
      <strong>也会先跑一次清理</strong>再返回，所以过期备份该回收照样回收。
    </p>
    <div className="callout">
      <p>
        <strong>容易误解的一点</strong>：复用判定<em>只看 manifest 的字段是否合法</em>（
        <code>databasePath</code> / <code>appVersion</code> / <code>createdAt</code> 是字符串、
        <code>files</code> 是数组），
        <strong>
          不会校验目录里的 <code>spark.db</code> 是否还在、内容是否匹配
        </strong>
        。 如果那个文件被人手工删了，这里仍会判定为「可以复用」。
      </p>
    </div>

    <h3 id="backup-format">3.2 快照是什么格式：在线备份，不是拷文件</h3>
    <p>
      <code>pre-migration-v*</code> 走的是 <strong>SQLite Online Backup API</strong>（
      <code>better-sqlite3</code> 的 <code>db.backup()</code>），只读打开源库， 把主库与 WAL 合并成
      <strong>一个</strong>目标文件。代码注释写得很直白：
    </p>
    <pre>
      <code>
        // SQLite Online Backup 将主库与 WAL 合并成单个一致性快照，并能提供真实页数进度。 //
        不再分别复制 db/-wal/-shm，避免三个文件落在不同时间点。
      </code>
    </pre>
    <p>所以一个迁移前恢复点目录里只有两个文件：</p>
    <table>
      <thead>
        <tr>
          <th>文件</th>
          <th>说明</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>spark.db</code>
          </td>
          <td>已合并 WAL 的单文件一致性快照（文件名取自源库 basename）</td>
        </tr>
        <tr>
          <td>
            <code>manifest.json</code>
          </td>
          <td>
            含 <code>directory</code> / <code>databasePath</code> / <code>appVersion</code> /
            <code>createdAt</code> / <code>files</code> / <code>createdThisStartup</code>，权限 0600
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      落盘方式是「先写临时目录再整体 rename」：临时目录名形如
      <code>&lt;目标目录&gt;.tmp-&lt;pid&gt;-&lt;时间戳&gt;</code>， 只有 <code>rename()</code>{' '}
      成功后目录才可见。所以你在目录里看到
      <code>.tmp-</code> 开头的残留，说明那次备份中途被打断了。
    </p>
    <p>
      进度是真实的页数进度：每步复制 <code>SQLITE_BACKUP_PAGES_PER_STEP = 2048</code> 页 （按常见 4
      KiB 页约 8 MiB）。百分比<strong>封顶 99</strong>， 100%
      只由收尾那次显式调用报出；重复的同一百分比不会重复上报。 进度回调抛错会被吞掉并记 warn，
      <strong>不会影响备份产物</strong>。
    </p>

    <h3 id="backup-retention">3.3 保留策略：2 份 / 14 天 / 24 小时</h3>
    <table>
      <thead>
        <tr>
          <th>常量</th>
          <th>值</th>
          <th>含义</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>DEFAULT_MAX_DATABASE_BACKUPS</code>
          </td>
          <td>
            <strong>2</strong>
          </td>
          <td>按 mtime 从新到旧保留 2 份（即「当前版本 + 上一版本」）</td>
        </tr>
        <tr>
          <td>
            <code>DEFAULT_BACKUP_MAX_AGE_DAYS</code>
          </td>
          <td>
            <strong>14</strong>
          </td>
          <td>超过 14 天的整份回收，不管数量</td>
        </tr>
        <tr>
          <td>
            <code>STALE_TMP_DIRECTORY_MAX_AGE_MS</code>
          </td>
          <td>
            <strong>24 小时</strong>
          </td>
          <td>
            崩溃残留的 <code>.tmp-</code> 目录超期回收（更近的可能属于并发启动的实例）
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      清理只处理名字以 <code>pre-migration-v</code> 开头的目录。两个边界要注意：
    </p>
    <ul>
      <li>
        <code>maxBackups &lt; 1</code> 时<strong>整个清理直接返回</strong>（连 24 小时的
        <code>.tmp-</code> 回收也一起跳过），不是「全部删除」。
      </li>
      <li>
        <code>maxAgeDays &lt; 1</code> 被视为<strong>不限期</strong>（cutoff 取负无穷），
        这是为了避免误传 0 时把刚建好的备份按超龄删掉。
      </li>
    </ul>
    <p>
      清理时机有两处：升级路径里备份写完后同步跑一次（包在 try/catch 里，失败只吞掉），
      以及启动流程里主窗口与托盘创建<strong>之后</strong>延迟 5 秒异步跑一次兜底 （
      <code>apps/desktop/src/main/index.ts:1356-1370</code>）。 两处都不会因为清理失败而阻塞启动。
    </p>

    <h3 id="backup-progress-ui">3.4 备份进度显示在哪</h3>
    <p>
      备份进度<strong>不走主窗口的 IPC</strong>，而是推给一个独立的、无边框的 「数据库升级」窗口（
      <code>apps/desktop/src/main/startup-guidance.ts</code>）， 通过{' '}
      <code>webContents.executeJavaScript</code> 注入。
    </p>
    <p>它的阶段枚举只有三个值：</p>
    <pre>
      <code>type StartupGuidanceStage = 'backup' | 'migration' | 'launch'</code>
    </pre>
    <ul>
      <li>
        这个窗口<strong>只在需要准备升级时创建</strong>。普通启动既没有窗口，也没有进度推送。
      </li>
      <li>
        到了 <code>migration</code> 与 <code>launch</code> 阶段，UI 会把 backup 一步 显示为
        100%，所以你在后面阶段看到的「备份已完成」是 UI 补齐的，不代表又备份了一次。
      </li>
      <li>窗口已关闭或销毁时，进度推送是静默 no-op。</li>
    </ul>

    <h2 id="restore">4. 迁移失败：自动恢复与它的边界</h2>
    <p>这是全篇最值得逐字读的一段，因为「有恢复点」和「会自动恢复」不是同一件事。</p>

    <h3 id="restore-gate">4.1 自动恢复的唯一开关是 createdThisStartup</h3>
    <p>
      数据库初始化失败时，恢复逻辑长这样（<code>apps/desktop/src/main/index.ts:1250-1253</code>）：
    </p>
    <pre>
      <code>
        let restored = false if (databaseBackup?.createdThisStartup === true) &#123; try &#123;
        await restoreDatabaseBackup(databaseBackup) restored = true // ...
      </code>
    </pre>
    <p>
      也就是说：<strong>只有本次启动新建的快照会被自动用于回滚</strong>。三种情况都不会恢复：
    </p>
    <table>
      <thead>
        <tr>
          <th>情况</th>
          <th>结果</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            快照是复用的（<code>createdThisStartup === false</code>）
          </td>
          <td>不恢复，弹「数据库无法安全初始化，应用将退出以避免继续写入或扩大损坏」</td>
        </tr>
        <tr>
          <td>
            本次启动没进入升级准备（<code>databaseBackup</code> 为 <code>null</code>）
          </td>
          <td>不恢复，同上弹窗</td>
        </tr>
        <tr>
          <td>备份阶段本身失败（快照压根没建成）</td>
          <td>不恢复；这条路径的弹窗是另一条（见 4.3）</td>
        </tr>
      </tbody>
    </table>
    <p>
      代码里没有写这条门槛的理由注释。合理推断是：复用快照可能<em>早于</em>当前库状态，
      回滚它会丢数据——但这是推断，不是代码明文。
    </p>

    <h3 id="restore-how">4.2 恢复动作具体做了什么</h3>
    <pre>
      <code>
        for (const suffix of DATABASE_SUFFIXES) &#123; await
        rm(`$&#123;snapshot.databasePath&#125;$&#123;suffix&#125;`, &#123; force: true &#125;)
        &#125; for (const file of snapshot.files) &#123; // 按文件名后缀决定写回成主库 / -wal / -shm
        await copyFile(join(snapshot.directory, file),
        `$&#123;snapshot.databasePath&#125;$&#123;suffix&#125;`) &#125;
      </code>
    </pre>
    <ul>
      <li>
        <code>DATABASE_SUFFIXES = ['', '-wal', '-shm']</code>。
        <strong>先删当前三件套，再写回快照</strong>。
      </li>
      <li>
        原库<strong>不做重命名保留</strong>，是直接删除。唯一留下的就是快照目录本身。
      </li>
      <li>
        恢复前的前提是 WAL 与文件锁已释放：<code>createDatabase()</code> 在迁移失败时会 先{' '}
        <code>db.close()</code> 再抛错（<code>packages/storage/src/database.ts:386-393</code>）。
      </li>
      <li>
        快照目录<strong>不会被删</strong>，仍留在
        <code>&#123;userData&#125;/backups/database/pre-migration-v&lt;版本&gt;/</code>，
        弹窗里会把该路径给你，让你保留并联系支持。
      </li>
      <li>
        写回逻辑里那段「按后缀判断」对现有产物其实是<strong>死代码</strong>： 写入方{' '}
        <code>files</code> 永远只含主库名一个文件，解析不出 <code>-wal</code> / <code>-shm</code>。
        只有手工改过 manifest 才可能走到。
      </li>
    </ul>

    <h3 id="backup-fail">4.3 备份失败时的后果链</h3>
    <p>
      备份失败（磁盘满、目录没权限等）会走这条链 （
      <code>apps/desktop/src/main/index.ts:1092-1099</code>）：
    </p>
    <ol>
      <li>
        <code>log.error</code> 记录失败原因；
      </li>
      <li>
        弹出<strong>阻塞式</strong>错误框，标题「SparkWork
        无法创建升级恢复点」，正文说明应用将退出且不会执行迁移；
      </li>
      <li>
        <code>throw</code> 抛出。
      </li>
    </ol>
    <p>
      因为这一步发生在 <code>createDatabase()</code> <strong>之前</strong>，
      所以迁移一定不会被执行。抛出后由顶层兜住：关掉升级窗口、记录日志、 请求应用退出。注意这条路径
      <strong>不会尝试任何恢复</strong>——恢复点根本没建成。 失败时那个 <code>.tmp-</code>{' '}
      临时目录会被清掉。
    </p>

    <h2 id="inherit">5. 继承安装版数据（仅 dev 实例可见）</h2>
    <p>
      「设置 → 存储与备份 → 导入与恢复 → 继承安装版数据」是把<strong>安装版的数据库快照</strong>
      导进当前 dev 实例，用来在开发时用正式数据复现问题。
    </p>

    <h3 id="inherit-availability">5.1 什么时候这个入口才出现</h3>
    <p>
      可用性判定有两条硬条件（<code>ProductionDbInheritService.ts:87-98</code>）：
    </p>
    <ol>
      <li>
        当前 userData 目录名以 <code>-dev</code> 结尾；
      </li>
      <li>
        兄弟目录（去掉 <code>-dev</code>）里确实存在 <code>spark.db</code>。
      </li>
    </ol>
    <p>
      不满足时任一条都会给出对应原因文案（「当前实例未运行在 dev 沙箱数据目录」/
      「未找到安装版数据目录中的 spark.db」）。也就是说：
      <strong>
        <code>SPARK_DATA_PROFILE=production</code> 下这个功能自动不可用
      </strong>
      ， 因为那时 userData 没有 <code>-dev</code> 后缀。
    </p>

    <h3 id="inherit-flow">5.2 两阶段流程：stage 与 apply</h3>
    <p>点「继承并重启」不是一步完成，而是分成两段，中间隔一次重启：</p>
    <table>
      <thead>
        <tr>
          <th>阶段</th>
          <th>做什么</th>
          <th>关键路径</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <strong>stage</strong>
          </td>
          <td>用 SQLite 在线备份只读导出安装版数据库，写成一个暂存文件，并落一个待应用标记</td>
          <td>
            <code>&#123;userData&#125;/spark.db.incoming</code>、
            <code>&#123;userData&#125;/inherit-db.pending</code>
          </td>
        </tr>
        <tr>
          <td>
            <strong>apply</strong>
          </td>
          <td>
            在<strong>建库之前</strong>执行：先给当前库整组备份，再删当前三件套， 把 incoming 原子
            rename 成 <code>spark.db</code>，最后清标记
          </td>
          <td>
            <code>
              &#123;userData&#125;/backups/database/pre-inherit-v&lt;版本&gt;-&lt;时间戳&gt;/
            </code>
          </td>
        </tr>
      </tbody>
    </table>
    <ul>
      <li>
        stage 阶段用的是<strong>在线备份</strong>（只读打开安装版库 + <code>backup()</code>）， 所以
        <strong>安装版正在运行时也可以执行</strong>，数据不会被 dev 实例改动。
      </li>
      <li>
        apply 阶段用的是<strong>裸 copyFile 三件套</strong>（存在才拷），
        因为那个时机还没有数据库连接可用，只能用文件复制。
      </li>
      <li>
        apply 阶段的备份目录内容是 <code>spark.db</code> / <code>spark.db-wal</code> /
        <code>spark.db-shm</code> 加上一份 manifest， manifest 字段是{' '}
        <code>databasePath / appVersion / stagedAt / sourcePath / createdAt</code>
        ——
        <strong>
          注意它没有 <code>files</code> 字段
        </strong>
        ，与迁移前恢复点的 manifest 形状不同。
      </li>
      <li>
        <code>inherit-db.pending</code> 不是「只允许继承一次」的开关：成功与失败都会删掉它。
        这个功能设计上就是<strong>可重复执行</strong>的，用来同步安装版的最新数据。
      </li>
    </ul>

    <h3 id="inherit-failure">5.3 失败语义：绝不阻断启动</h3>
    <p>
      apply 阶段的失败<strong>不会向上抛错</strong>，只做三件事：记 <code>log.error</code>、
      清掉标记、返回 <code>{'{ applied: false }'}</code>，然后用现有库正常启动。
      另外两个健壮性分支也会提前退出并清标记：标记 JSON 损坏、
      <code>spark.db.incoming</code> 不存在。
    </p>
    <p>
      还有一个隐含效果：apply 发生在 <code>databaseExistedBeforeInitialization</code>
      判断<strong>之前</strong>，所以继承进来的生产库会被当作「既有库」参与迁移预检—— 如果它的
      schema 比当前版本旧，就会再走一次备份 + 迁移。
    </p>

    <h2 id="backup-blindspots">6. 备份的清理规则与三个盲区</h2>

    <h3 id="two-backup-formats">6.1 同一个目录住着两种格式</h3>
    <p>
      <code>&#123;userData&#125;/backups/database/</code>{' '}
      底下同时存在两类目录，格式与生命周期都不同：
    </p>
    <table>
      <thead>
        <tr>
          <th>前缀</th>
          <th>产生方</th>
          <th>内容</th>
          <th>会被回收吗</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>pre-migration-v&lt;版本&gt;</code>
          </td>
          <td>升级前恢复点</td>
          <td>
            单文件 <code>spark.db</code>（WAL 已合并）+ manifest（含 <code>files</code>）
          </td>
          <td>
            <strong>会</strong>：2 份 / 14 天
          </td>
        </tr>
        <tr>
          <td>
            <code>pre-inherit-v&lt;版本&gt;-&lt;时间戳&gt;</code>
          </td>
          <td>继承安装版数据时给旧库做的备份</td>
          <td>
            裸拷三件套 + manifest（<strong>无</strong> <code>files</code>）
          </td>
          <td>
            <strong>不会</strong>：清理只匹配 <code>pre-migration-v</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      所以「备份最多占 2 份」这个印象只对迁移前恢复点成立。 如果你反复用「继承并重启」，
      <code>pre-inherit-*</code> 目录会一直累积—— 全仓检索不到任何针对它的回收逻辑。
    </p>

    <h3 id="storage-stats-gap">6.2 存储用量不统计备份</h3>
    <p>「存储用量」那块只统计 6 项：</p>
    <pre>
      <code>
        合计 = spark.db(+ -wal + -shm) + Chromium 缓存 + projects/ + attachments/ + Canvas 项目根 +
        logs/
      </code>
    </pre>
    <p>
      <strong>
        <code>backups/</code> 不在其中
      </strong>
      ，<code>~/.spark-agent</code> 也不在其中，
      <code>snapshot-vault/</code> 与 <code>sub-app-*</code> 同样不在。
      所以那个「合计」不是磁盘占用的完整口径，别拿它对账。 另外整个 <code>backups/</code> 目录
      <strong>没有任何界面清理入口</strong>， 想腾空间只能手工删目录。
    </p>

    <h3 id="retention-matrix">6.3 保留期一览：为什么口径不统一</h3>
    <table>
      <thead>
        <tr>
          <th>数据</th>
          <th>保留期</th>
          <th>常量</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>临时媒体（粘贴 / 预览副本）</td>
          <td>7 天</td>
          <td>
            <code>TEMP_MEDIA_RETENTION_MS</code>
          </td>
        </tr>
        <tr>
          <td>会话图片优化缓存</td>
          <td>7 天</td>
          <td>
            <code>CACHE_MAX_AGE_MS</code>
          </td>
        </tr>
        <tr>
          <td>工具结果归档</td>
          <td>7 天 + 512 MB 总量</td>
          <td>
            <code>TOOL_RESULT_RETENTION_MS</code> / <code>TOOL_RESULT_TOTAL_BYTES</code>
          </td>
        </tr>
        <tr>
          <td>Hooks 已解决事件</td>
          <td>7 天</td>
          <td>
            <code>DEFAULT_RESOLVED_RETENTION_MS</code>
          </td>
        </tr>
        <tr>
          <td>媒体上传引用缓存</td>
          <td>6 天</td>
          <td>
            <code>SPARK_TRANSFER_CACHE_TTL_MS</code>
          </td>
        </tr>
        <tr>
          <td>数据库迁移前恢复点</td>
          <td>14 天 / 2 份</td>
          <td>
            <code>DEFAULT_BACKUP_MAX_AGE_DAYS</code>
          </td>
        </tr>
        <tr>
          <td>电脑操作执行证据</td>
          <td>24 小时</td>
          <td>
            <code>EXECUTION_EVIDENCE_TTL_MS</code>
          </td>
        </tr>
        <tr>
          <td>终态 turn_requests</td>
          <td>30 天</td>
          <td>
            <code>TERMINAL_TURN_REQUEST_RETENTION_MS</code>
          </td>
        </tr>
        <tr>
          <td>更新器缓存</td>
          <td>最近 2 个版本</td>
          <td>
            <code>MAX_CACHED_RELEASE_DIRS</code>
          </td>
        </tr>
        <tr>
          <td>主进程阻塞 profile</td>
          <td>最多 8 份</td>
          <td>
            <code>MAX_BLOCK_PROFILES</code>
          </td>
        </tr>
        <tr>
          <td>Canvas 时间戳快照</td>
          <td>编辑中 10 份 / 退出后 2 份</td>
          <td>
            <code>CANVAS_SNAPSHOT_KEEP</code> / <code>..._ON_EXIT</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      没有统一的 <code>RETENTION</code> 常量，每处各自定义。 这意味着你在估算「这台机器上 SparkWork
      会长期占多少盘」时， 不能用一个倍数套所有数据类型。
    </p>
    <div className="callout">
      <p>
        <strong>Canvas 的 10 → 2 值得单独记住</strong>：离开画布（关窗或切项目）后，
        可用的历史恢复点会从 10 份静默收紧到 2 份，而 <code>latest.json</code> 永远保留。
        这在你需要回退到较早版本时会很关键。
      </p>
    </div>

    <h2 id="sync-intro">7. 账号同步：定位与默认状态</h2>
    <p>
      入口在<strong>设置 →「通用」分组 →「账号同步」</strong>（<code>SettingsView.tsx:353-382</code>
      ，搜索关键词包含「云同步」「手动同步」「备份」「跨设备」）。 它是把「安全的工作配置」在
      <strong>当前设备与已登录账号</strong>之间做<strong>手动双向同步</strong>。
    </p>

    <h3 id="sync-defaults">7.1 默认全部关闭</h3>
    <p>
      偏好对象只有两个必填字段（<code>packages/protocol/src/account-sync.ts:21-29</code>）：
    </p>
    <pre>
      <code>
        interface AccountSyncPreferences &#123; enabled: boolean categories:
        AccountSyncCategorySelection lastOperation?: &#123; operationId: string; status:
        AccountSyncOperationStatus; finishedAt: string &#125; &#125;
      </code>
    </pre>
    <p>
      默认值全部是关闭（<code>AccountSyncService.ts:67-81</code>）：
    </p>
    <table>
      <thead>
        <tr>
          <th>字段</th>
          <th>默认</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>enabled</code>
          </td>
          <td>
            <strong>false</strong>
          </td>
        </tr>
        <tr>
          <td>
            <code>categories.customCommands</code>
          </td>
          <td>
            <strong>false</strong>
          </td>
        </tr>
        <tr>
          <td>
            <code>categories.prompts</code>
          </td>
          <td>
            <strong>false</strong>
          </td>
        </tr>
        <tr>
          <td>
            <code>categories.memory</code>
          </td>
          <td>
            <strong>false</strong>
          </td>
        </tr>
        <tr>
          <td>
            <code>categories.assistants</code>
          </td>
          <td>
            <strong>false</strong>
          </td>
        </tr>
        <tr>
          <td>
            <code>categories.workflows</code>
          </td>
          <td>
            <strong>false</strong>
          </td>
        </tr>
        <tr>
          <td>
            <code>categories.appearance</code>
          </td>
          <td>
            <strong>false</strong>
          </td>
        </tr>
        <tr>
          <td>
            <code>categories.promptLibrary</code>
          </td>
          <td>
            <strong>false</strong>
          </td>
        </tr>
        <tr>
          <td>
            <code>lastOperation</code>
          </td>
          <td>不存在（首次读取返回里没有这个键）</td>
        </tr>
      </tbody>
    </table>
    <ul>
      <li>
        界面上那句「开启后仍不会后台运行；所有类别默认关闭，需要逐项选择」是准确的：
        <code>enabled</code> 只是手动开关，<strong>全仓没有同步调度器</strong>。
      </li>
      <li>
        读取时会做
        <strong>
          严格 <code>=== true</code>
        </strong>{' '}
        归一化， 所以字符串 <code>"true"</code>、数字 <code>1</code> 这类值都会落成 false。
      </li>
      <li>
        偏好按账号隔离存储：<code>app_settings</code> 的<code>account-sync.preferences</code> /{' '}
        <code>user:&lt;userId&gt;</code>。
      </li>
      <li>
        <code>updatePreferences</code> 是<strong>浅合并 patch</strong>： 只覆盖显式传入的字段，
        <code>categories</code> 按 key 逐项合并，没传的类别保持原值。
      </li>
    </ul>

    <h3 id="sync-unauth">7.2 未登录时各方法的行为并不一致</h3>
    <table>
      <thead>
        <tr>
          <th>方法</th>
          <th>未登录时的行为</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>getPreferences()</code>
          </td>
          <td>
            不抛错，返回 <code>{'{ authenticated: false, preferences: 默认偏好 }'}</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>updatePreferences()</code>
          </td>
          <td>
            抛 <code>VALIDATION_FAILED 请先登录 SparkWork 账号</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>execute()</code>
          </td>
          <td>
            抛同一错误，且是<strong>同步抛出</strong>（不是 rejected promise）
          </td>
        </tr>
        <tr>
          <td>
            <code>preview()</code>
          </td>
          <td>抛同一错误</td>
        </tr>
        <tr>
          <td>
            <code>listHistory()</code>
          </td>
          <td>抛同一错误（async 方法，因此表现为 rejection）</td>
        </tr>
      </tbody>
    </table>
    <p>
      跨过 IPC 之后渲染层统一看到的是错误对象，因为注册的 handler 都是
      <code>async</code> 箭头函数，同步抛出会转成 rejection。
      所以「未登录能打开设置页、但点不动任何操作」是预期行为。
    </p>

    <h2 id="sync-protocol">8. 同步怎么跑：一个 endpoint、两套模式</h2>
    <p>
      同步的目标端是<strong>同一个 HTTP endpoint</strong>，靠请求体里的 <code>mode</code> 区分
      是「预览」还是「真同步」：
    </p>
    <table>
      <thead>
        <tr>
          <th>用途</th>
          <th>方法与路径</th>
          <th>说明</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>执行同步</td>
          <td>
            <code>POST /api/v1/desktop-sync/execute</code>
          </td>
          <td>
            不带 <code>mode</code>，即默认应用
          </td>
        </tr>
        <tr>
          <td>冲突预览</td>
          <td>
            <code>POST /api/v1/desktop-sync/execute</code>
          </td>
          <td>
            同一路径，请求体带 <code>mode: 'preview'</code>
          </td>
        </tr>
        <tr>
          <td>回执上报</td>
          <td>
            <code>POST /api/v1/desktop-sync/operations/&lt;id&gt;/ack</code>
          </td>
          <td>
            上报 <code>status</code> 与 <code>errorCodes</code>；失败只记 warn，不影响返回
          </td>
        </tr>
        <tr>
          <td>历史记录</td>
          <td>
            <code>GET /api/v1/desktop-sync/history</code>
          </td>
          <td>
            分页参数 <code>page</code> / <code>pageSize</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      基础地址由设置页可切换的服务器地址决定，客户端写相对路径，
      <code>resolveUrl</code> 会自动补 <code>/api/v1</code> 前缀。 超时是 <strong>30 秒</strong>（
      <code>EduServerClient.ts:54</code>）， 业务层<strong>没有通用重试</strong>；唯一的自动重试是
      HTTP 401 时用 refreshToken 续期后重放， 最多<strong>续期 2 次</strong>。
    </p>
    <p>发起请求前有一道安全闸：</p>
    <pre>
      <code>
        // base URL 既不是 https、也不是 loopback（localhost / 127.0.0.1 / ::1） // →
        抛「账号同步仅允许 HTTPS 服务端或本机开发地址」
      </code>
    </pre>
    <p>
      注意这道闸<strong>只校验配置里的 base URL</strong>，不校验实际拼出来的请求 URL； 而且它在{' '}
      <code>enabled</code> 与类别校验<strong>之后</strong>执行， 所以「没开同步」的报错会先于「HTTPS
      不合格」出现。
    </p>

    <h3 id="sync-execute-steps">8.1 execute() 的完整步骤</h3>
    <ol>
      <li>取当前用户 id；未登录直接同步抛出。</li>
      <li>
        并发闸门：同一账号的重复调用<strong>返回同一个 in-flight Promise</strong>
        ；账号已切换则直接拒绝。
      </li>
      <li>读偏好：未开启抛「请先开启账号同步」；一个类别都没选抛「请至少选择一个同步类别」。</li>
      <li>校验安全端点（见上）。</li>
      <li>
        生成 <code>operationId</code>（UUID）与时间戳。
      </li>
      <li>
        并发采集所有选中类别。<strong>单类失败不打断其他类</strong>，失败项进入 failures。
      </li>
      <li>采集后再查一次账号是否切换（换了就抛，避免把 A 账号数据写进 B）。</li>
      <li>
        若一个类别都没采成功 → 走 <code>finishCollectionFailure()</code>： 写{' '}
        <code>lastOperation.status = 'failed'</code>、返回
        <code>errorCodes: ['SYNC_LOCAL_COLLECT_FAILED']</code>，
        <strong>不请求服务端、也不 ack</strong>。
      </li>
      <li>
        组装请求体（<code>operationId</code>、设备信息、各类别的 records 与 baseHashes）。
      </li>
      <li>
        发出请求。这里有两个特判：
        <ul>
          <li>
            错误信息
            <strong>
              包含字符串 <code>404</code>
            </strong>{' '}
            → 抛「当前服务端暂不支持账号同步，请升级服务端后重试」；
          </li>
          <li>
            错误信息含 <code>SYNC_INVALID_CATEGORY</code>、且本次选中了
            <code>promptLibrary</code>、且<strong>没有带冲突选择</strong>→ 剔除 promptLibrary{' '}
            <strong>重试一次</strong>。 带冲突选择时不重试（否则会丢用户的选择语义）。
          </li>
        </ul>
      </li>
      <li>归一化并严格校验响应（类别重复/缺失、字段形态非法都判为「同步服务返回了无效响应」）。</li>
      <li>再查一次账号是否切换。</li>
      <li>
        按<strong>固定顺序</strong>逐类本地应用（这个顺序很关键，见 8.2）。
      </li>
      <li>
        单类应用：合并 skipped 统计 → 消毒服务端记录 → 调适配器 apply。 apply 抛错会被 catch 成{' '}
        <code>SYNC_LOCAL_APPLY_FAILED</code> 并继续下一类。
      </li>
      <li>
        该类有错误码 → 写「保留原 state + <code>pendingApply: true</code>」并
        <strong>不推进 revision</strong>；无错 → 写入新的
        <code>revision</code> / <code>baseHashes</code> / <code>tombstones</code>。
      </li>
      <li>
        汇总状态：有影响状态的错误码时，成功应用 0 类 → <code>failed</code>， 否则 →{' '}
        <code>partial</code>；<code>SYNC_CATEGORY_UNSUPPORTED</code> 被显式排除、只展示不降级。
      </li>
      <li>ack 上报结果（失败只记 warn）。</li>
      <li>
        把 <code>lastOperation</code> 写进偏好并返回结果。
      </li>
    </ol>

    <h3 id="sync-apply-order">8.2 本地应用顺序 ≠ 类别枚举顺序</h3>
    <p>这两个顺序不一样，写错就会理解错依赖关系：</p>
    <table>
      <thead>
        <tr>
          <th>来源</th>
          <th>顺序</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            类别枚举 <code>ACCOUNT_SYNC_CATEGORIES</code>
          </td>
          <td>
            <code>customCommands</code> → <code>prompts</code> → <code>memory</code> →
            <code>assistants</code> → <code>workflows</code> → <code>appearance</code> →
            <code>promptLibrary</code>
          </td>
        </tr>
        <tr>
          <td>
            实际应用顺序 <code>applyOrder</code>
          </td>
          <td>
            <code>workflows</code> → <code>prompts</code> → <code>assistants</code> →
            <code>customCommands</code> → <code>memory</code> → <code>appearance</code> →
            <code>promptLibrary</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      这不是笔误：<code>workflows</code> 必须排在 <code>assistants</code> 之前， 因为 Agent
      定义里可能引用工作流 id，工作流先落地引用才不会悬空； 引用缺失时报{' '}
      <code>SYNC_WORKFLOW_DEPENDENCY_MISSING</code>。
    </p>

    <h3 id="sync-preview">8.3 preview 与 execute 的真实差别</h3>
    <p>
      预览<strong>不是</strong>只读接口，它会做全量本地采集，只是<strong>不写任何状态</strong>：
    </p>
    <table>
      <thead>
        <tr>
          <th>维度</th>
          <th>execute</th>
          <th>preview</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>本地采集</td>
          <td>会</td>
          <td>也会</td>
        </tr>
        <tr>
          <td>校验 enabled / 类别</td>
          <td>会</td>
          <td>会</td>
        </tr>
        <tr>
          <td>
            写 <code>lastOperation</code>
          </td>
          <td>会</td>
          <td>
            <strong>不会</strong>
          </td>
        </tr>
        <tr>
          <td>写类别 revision / tombstones</td>
          <td>会</td>
          <td>
            <strong>不会</strong>
          </td>
        </tr>
        <tr>
          <td>ack 上报</td>
          <td>会</td>
          <td>
            <strong>不会</strong>
          </td>
        </tr>
        <tr>
          <td>
            支持 <code>conflictChoices</code>
          </td>
          <td>支持</td>
          <td>
            <strong>不支持</strong>（从不发送）
          </td>
        </tr>
        <tr>
          <td>404 文案</td>
          <td>「暂不支持账号同步」</td>
          <td>「暂不支持冲突预览」</td>
        </tr>
        <tr>
          <td>promptLibrary 剔类重试</td>
          <td>有</td>
          <td>
            <strong>没有</strong>
          </td>
        </tr>
      </tbody>
    </table>

    <h2 id="sync-scope">9. 同步的内容边界：四重校验</h2>
    <p>
      「敏感配置不会上传」这句界面文案背后是一套具体的过滤。它是<strong>逐条全有全无</strong>的：
      一条记录只要有一处不合规，<strong>整条</strong>被跳过，而<strong>不是</strong>
      把敏感字段裁掉再传。
    </p>

    <h3 id="sync-whitelist">9.1 第一重：顶层字段白名单</h3>
    <p>
      每个类别有一份允许的顶层字段集合，只要出现一个不在集合里的键，
      <strong>整条丢弃</strong>（错误码 <code>SYNC_FIELD_NOT_ALLOWLISTED</code>）。 几个代表性类别：
    </p>
    <table>
      <thead>
        <tr>
          <th>类别</th>
          <th>允许的顶层字段</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>customCommands</code>
          </td>
          <td>
            <code>id</code> <code>name</code> <code>description</code> <code>prompt</code>{' '}
            <code>script</code> <code>scriptLanguage</code> <code>enabled</code>{' '}
            <code>updatedAt</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>workflows</code>
          </td>
          <td>
            <code>id</code> <code>scope</code> <code>name</code> <code>version</code>{' '}
            <code>description</code> <code>status</code> <code>tags</code> <code>enabled</code>{' '}
            <code>graph</code> <code>createdAt</code> <code>updatedAt</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>assistants</code>
          </td>
          <td>
            <code>id</code> <code>kind</code> <code>name</code> <code>description</code>{' '}
            <code>enabled</code>
            <code>isDefault</code> <code>prompt</code> <code>permissionMode</code>{' '}
            <code>skillIds</code>
            <code>ruleIds</code> <code>workflowIds</code> <code>memberIds</code>{' '}
            <code>leaderId</code>
            <code>coordinationMode</code> <code>discussionRounds</code> <code>metadata</code>
            <code>createdAt</code> <code>updatedAt</code>
          </td>
        </tr>
        <tr>
          <td>
            <code>appearance</code>
          </td>
          <td>
            <code>id</code> <code>theme</code> <code>emptyHeroTheme</code> <code>primary</code>
            <code>density</code> <code>font</code> <code>fontSize</code> <code>uiZoom</code>
            <code>codeLigature</code> <code>windowCorners</code> <code>backdropBlur</code>
            <code>autoCollapseTools</code> <code>inlineTokenCount</code>{' '}
            <code>syntaxHighlight</code>
            <code>timestampFormat</code> <code>updatedAt</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p>
      注意 <code>assistants</code> 的白名单里<strong>没有</strong>
      <code>providerProfileId</code> / <code>modelId</code> / <code>agentAdapter</code> /
      <code>reasoningEffort</code> / <code>mcpServerIds</code> / <code>hookConfig</code>。 这些是
      <strong>靠「不在白名单」被排除的</strong>，不是靠黑名单——
      两种机制的结果一样，但理解上要区分开。
    </p>

    <h3 id="sync-denylist">9.2 第二重：键名黑名单（只匹配键，不匹配值）</h3>
    <p>完整正则是这一行：</p>
    <pre>
      <code>
        /(?:api.?key|access.?token|refresh.?token|token|password|passwd|secret|credential|authorization|cookie|headers?|env(?:ironment)?|keystore|provider.?profile|model.?id|reasoning.?effort|agent.?adapter|mcp|hooks?)/i
      </code>
    </pre>
    <p>它的匹配语义有几个必须知道的特征：</p>
    <ul>
      <li>
        <strong>只扫键名，不扫值</strong>。递归到任意嵌套深度、数组也遍历。
      </li>
      <li>
        <strong>裸词子串匹配</strong>：正则没有 <code>^...$</code> 锚， 任何位置命中都算——所以{' '}
        <code>mcpServerIds</code>、<code>inlineTokenCount</code>、<code>prefixEnv</code> 都会命中。
      </li>
      <li>
        大小写不敏感（<code>/i</code>）；<code>api.?key</code> 里那个 <code>.</code>
        没有转义，因此它其实是「任意字符」，<code>apiXkey</code> 也算命中。
      </li>
      <li>
        只检查对象的<strong>自有可枚举字符串键</strong>；Symbol 键与原型链上的键不检查。
      </li>
    </ul>
    <p>下面这组对照能帮你看清「键名过滤」和「语义过滤」的差别：</p>
    <table>
      <thead>
        <tr>
          <th>输入</th>
          <th>结果</th>
          <th>原因</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            键 <code>mcpServerIds</code>
          </td>
          <td>被拦</td>
          <td>
            键名含裸词 <code>mcp</code>
          </td>
        </tr>
        <tr>
          <td>
            值 <code>{'toolSource: "mcp"'}</code>
          </td>
          <td>放行</td>
          <td>
            值不参与键名匹配（键是 <code>toolSource</code>）
          </td>
        </tr>
        <tr>
          <td>
            键 <code>toolServerId</code>
          </td>
          <td>放行</td>
          <td>不含任何词条</td>
        </tr>
        <tr>
          <td>
            键 <code>inlineTokenCount</code>
          </td>
          <td>
            <strong>被拦</strong>
          </td>
          <td>
            键名含裸词 <code>token</code>——见 9.4，这一条有实际后果
          </td>
        </tr>
      </tbody>
    </table>

    <h3 id="sync-other-checks">9.3 第三、四重：字段类型与值文本扫描</h3>
    <p>黑名单之后还有两道：</p>
    <ul>
      <li>
        <strong>字段类型表</strong>：每个类别的每个字段都登记了期望类型 （<code>string</code> /{' '}
        <code>nullable-string</code> / <code>boolean</code> /<code>number</code> /{' '}
        <code>string-array</code> / <code>object</code>）， 不匹配则整条丢弃（
        <code>SYNC_FIELD_TYPE_INVALID</code>）。
      </li>
      <li>
        <strong>值文本扫描</strong>：用另一组正则扫值里的敏感内容， 命中时
        <strong>把命中的模式名本身当作原因码</strong>返回。完整的原因码有：
        <code>SECRET_PEM_PRIVATE_KEY</code>、<code>SECRET_BEARER_TOKEN</code>、
        <code>SECRET_JWT</code>、<code>SECRET_COMMON_API_KEY</code>、
        <code>SECRET_CREDENTIAL_URL</code>、<code>LOCAL_ABSOLUTE_PATH</code>。
      </li>
      <li>
        <strong>豁免规则</strong>：值以 <code>data:image/</code> 开头时跳过文本扫描 （避免 base64
        撞上密钥/路径模式误报）；其它 <code>data:</code> 类型照常扫。
      </li>
      <li>
        <code>assistants</code> 的 <code>metadata</code> 还有一层专用子白名单：
        <strong>
          只允许 <code>avatar</code> 一个键
        </strong>
        ，其它键一律判违规。 而且这个检查
        <strong>
          只对 <code>assistants</code> 生效
        </strong>
        ， 其它类别走同一个函数时会直接返回「无问题」。
      </li>
    </ul>
    <p>
      另外提醒一个实现细节：判定函数返回的是<strong>同一对象引用，没有深拷贝</strong>。
      策略层做的是「校验 + 拒绝」，不是「投影 + 复制」。
    </p>

    <h3 id="sync-appearance-collision">9.4 一个实际后果：外观设置会整类被拦</h3>
    <p>
      把 9.1 与 9.2 放在一起看，会发现一处自相矛盾：
      <code>appearance</code> 的白名单
      <strong>
        收进了 <code>inlineTokenCount</code>
      </strong>
      ， 而同文件的键名黑名单里有一个
      <strong>
        裸词 <code>token</code>
      </strong>
      —— 于是这个字段只要存在，就会让<strong>整条</strong> appearance 记录被判
      <code>SYNC_FORBIDDEN_FIELD</code>。
    </p>
    <p>这条链路是闭合的，四步都能在代码里指出来：</p>
    <ol>
      <li>
        渲染端 <code>patchAppearance()</code> 写的是<strong>整个</strong>外观对象 （
        <code>&#123;...readAppearance(), ...patch&#125;</code>）， 而默认值里就有{' '}
        <code>inlineTokenCount: false</code>；
      </li>
      <li>
        采集侧对「已定义」的字段<strong>全量拷贝</strong>，所以 <code>inlineTokenCount</code>
        会被带进 payload；
      </li>
      <li>
        类型检查能过（<code>inlineTokenCount: 'boolean'</code> 登记过）；
      </li>
      <li>
        键名黑名单命中裸词 <code>token</code> → 整条 <code>SYNC_FORBIDDEN_FIELD</code>。
      </li>
    </ol>
    <p>实测确认（直接加载真实模块调用策略函数）：</p>
    <pre>
      <code>
        不带 inlineTokenCount → &#123; item: &#123; ... &#125; &#125; 带上 inlineTokenCount → &#123;
        skipped: &#123; id: 'appearance', reasonCode: 'SYNC_FORBIDDEN_FIELD' &#125; &#125;
      </code>
    </pre>
    <p>
      系统性检查也做了：把全部 <strong>52 个</strong>白名单字段名逐个拿黑名单正则去测，
      <strong>
        只有 <code>inlineTokenCount</code> 这一个命中
      </strong>
      。 也就是说这是一个孤立的口径冲突，不是大面积问题。
    </p>
    <div className="callout">
      <p>
        <strong>实际影响与现状</strong>：只要你动过一次外观设置，整个「外观」类别就会在每轮同步里
        被静默跳过（界面只体现为「跳过 N」的数字，原因码<strong>不在</strong>
        渲染端的错误码翻译表里）， 同时该条 id
        会进入保护列表——结果是云端外观既不上传、也不会覆盖本地。 界面侧仍把这个字段列为可同步字段。
        代码里没有任何注释说明这是有意设计，因此判定为<strong>缺陷</strong>而非策略。
        这一条是本次核实中发现的，页面如实记录，未在源码侧做任何改动。
      </p>
    </div>

    <h3 id="sync-mcp-collision">9.5 同类机制：绑定 MCP 的工作流被静默跳过</h3>
    <p>
      同样因为「裸词 + 递归扫键」，工作流也会被拦： 整张 <code>graph</code> 原样进 payload，图节点
      schema 里合法存在
      <code>mcpServerIds</code> 键，于是命中裸词 <code>mcp</code> → 整条工作流
      <code>SYNC_FORBIDDEN_FIELD</code>。
    </p>
    <pre>
      <code>
        graph 里含 mcpServerIds → &#123; skipped: &#123; id: 'wf1', reasonCode:
        'SYNC_FORBIDDEN_FIELD' &#125; &#125; graph 里用 toolSource: 'mcp' → &#123; item: &#123; ...
        &#125; &#125; // 值不触发
      </code>
    </pre>
    <p>
      这里要精确表述成「<strong>键名撞词</strong>的连带效果」，而不是「绑定 MCP 的工作流会被拦」——
      因为同一张图若用 <code>toolSource: 'mcp'</code> + <code>toolServerId</code> 表达，
      反而能通过。设计文档确实要求「命中时跳过整条工作流、不做破坏性裁剪」，
      所以「整条跳过」是刻意的，但把 MCP 绑定卷进去是词条过宽的副作用。
    </p>
    <p>
      后果还有一条连锁：被跳过的 id 会进保护列表， 而且 <code>seenIds</code> 是在校验
      <strong>之前</strong>登记的，
      所以它既不会被上传、也不会生成删除墓碑——云端旧副本保留、本地版本保留，
      两边静默分叉，你只会看到一个「跳过 1」。
    </p>

    <h2 id="sync-conflict">10. 冲突处理与保护列表</h2>

    <h3 id="sync-protected">10.1 保护列表：防止云端覆盖本地的唯一机制</h3>
    <p>
      保护列表来自本次采集里<strong>被判为敏感的条目 id 集合</strong>，
      它只存在于内存、每轮重算、不落库、不上传：
    </p>
    <pre>
      <code>const protectedIds = new Set(collected.skippedItems.map((item) =&gt; item.id))</code>
    </pre>
    <p>它同时起两个作用：</p>
    <ol>
      <li>
        <strong>不上传</strong>：这些 id 不会进上传的 records； 也<strong>不会生成删除墓碑</strong>
        （否则会把你本地那条敏感记录在云端删掉）。
      </li>
      <li>
        <strong>不被覆盖</strong>：作为 <code>protectedIds</code> 传给各适配器的 apply，
        每个适配器开头都有一句 <code>if (protectedIds.has(item.id)) continue</code>。
      </li>
    </ol>
    <p>
      推论：保护<strong>不是粘性的</strong>。如果你把提示词里的敏感内容删干净了，
      下一轮它就不再被拒绝，会重新进入上传集合。
    </p>

    <h3 id="sync-conflict-ui">10.2 冲突：客户端不做裁决</h3>
    <ul>
      <li>
        冲突判定的输入是<strong>哈希</strong>不是时间：请求体带
        <code>baseRevision</code> 与各类别的 <code>baseHashes</code>， 服务端返回合并后的 canonical
        records 与新的 revision。
      </li>
      <li>
        适配器层<strong>完全不做时间戳比对</strong>，拿到什么就写什么
        （唯一的过滤是保护列表）。所以「未选择的冲突按修改时间自动处理」这条规则 是
        <strong>服务端行为</strong>，客户端代码里看不到实现—— 本仓库只有调用方，服务端在另一个仓库。
      </li>
      <li>
        手工裁决通过 <code>conflictChoices</code> 回传， 键格式{' '}
        <code>&lt;category&gt;/&lt;itemId&gt;</code>，值为 <code>'local'</code> 或{' '}
        <code>'cloud'</code>。
      </li>
    </ul>

    <h3 id="sync-merge-detail">10.3 各类别的合并细节</h3>
    <table>
      <thead>
        <tr>
          <th>类别</th>
          <th>合并行为</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <code>customCommands</code>
          </td>
          <td>按 id 覆盖整个对象（保护列表防止把本地敏感命令删掉）</td>
        </tr>
        <tr>
          <td>
            <code>prompts</code>
          </td>
          <td>
            系统规则只同步 <code>enabled</code> 开关（按指纹匹配本地规则，匹配不到报
            <code>SYNC_SYSTEM_RULE_NOT_FOUND</code>）；运行时提示词只写
            <code>enabled</code> 与 <code>content</code>；本地是 system 作用域的普通规则
            <strong>拒绝覆盖也拒绝删除</strong>
          </td>
        </tr>
        <tr>
          <td>
            <code>assistants</code>
          </td>
          <td>
            Agent 与团队按 id upsert；<code>builtIn</code> 条目拒绝删除；
            <code>metadata</code> 只替换 <code>avatar</code> 键、保留本机其它键； 团队 leader
            找不到就整条跳过，成员缺失只报码不阻断；
            <code>maxDepth</code> 夹在 1–3、<code>discussionRounds</code> 夹在 1–20
          </td>
        </tr>
        <tr>
          <td>
            <code>memory</code>
          </td>
          <td>
            按 id upsert 并重写 markdown 文件；<code>hit_count</code> 恒置 0，
            <code>lastHitAt</code> / <code>sourceSessionId</code> / <code>links</code> 恒置空 ——
            <strong>本机命中统计会在应用云端记忆时丢失</strong>
          </td>
        </tr>
        <tr>
          <td>
            <code>workflows</code>
          </td>
          <td>
            按 id upsert；删除时若仍被本机引用（<code>WorkflowReferenceGuardError</code>） 只{' '}
            <code>console.warn</code> 并跳过
          </td>
        </tr>
        <tr>
          <td>
            <code>appearance</code>
          </td>
          <td>字段级合并：只覆盖 payload 里出现过的字段，保留本机其它字段</td>
        </tr>
        <tr>
          <td>
            <code>promptLibrary</code>
          </td>
          <td>
            按 id 合并，<code>usageCount</code> 保留本机值， 云端分类并回本地分类列表
          </td>
        </tr>
      </tbody>
    </table>
    <p>两个时间戳的坑：</p>
    <ul>
      <li>
        <strong>回写云端时间戳</strong>的类别：<code>rules</code> / <code>agents</code> /
        <code>agent_teams</code> / <code>workflows</code> / <code>memory</code> /{' '}
        <code>appearance</code>。
      </li>
      <li>
        <strong>一律写当前时间</strong>的类别：<code>customCommands</code> 与
        <code>promptLibrary</code>。也就是说这两类的本地
        <code>updated_at</code> 会因为「应用了云端数据」而变<em>新</em>。
      </li>
      <li>
        适配器内<strong>没有事务包裹</strong>，多次仓储调用逐条提交，
        中途失败会留下部分应用的状态（错误码汇总在 <code>errorCodes</code>）。
      </li>
    </ul>

    <h2 id="sync-limits">11. 限额、并发与重试</h2>

    <h3 id="sync-limits-table">11.1 真实限额</h3>
    <table>
      <thead>
        <tr>
          <th>项</th>
          <th>上限</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>提示词库同步条目数</td>
          <td>2 000</td>
        </tr>
        <tr>
          <td>提示词库总字符预算</td>
          <td>60 000 000</td>
        </tr>
        <tr>
          <td>
            单条提示词 <code>text</code>
          </td>
          <td>256 000 字符</td>
        </tr>
        <tr>
          <td>
            单条 <code>title</code>
          </td>
          <td>2 000 字符</td>
        </tr>
        <tr>
          <td>
            <code>id</code>
          </td>
          <td>1–256 字符</td>
        </tr>
        <tr>
          <td>
            <code>tags</code>
          </td>
          <td>最多 100 个，每项 ≤ 512</td>
        </tr>
        <tr>
          <td>
            <code>coverUrl</code>
          </td>
          <td>≤ 12 000 000 字符</td>
        </tr>
        <tr>
          <td>每类别服务端 records</td>
          <td>
            应用前 <code>slice(0, 2000)</code>，超出会追加{' '}
            <code>SYNC_SERVER_ITEM_LIMIT_EXCEEDED</code>
          </td>
        </tr>
        <tr>
          <td>每类别服务端 skippedItems</td>
          <td>≤ 2 000，超出判为无效响应</td>
        </tr>
        <tr>
          <td>预览单类别冲突明细</td>
          <td>≤ 2 000，超出判为无效响应</td>
        </tr>
        <tr>
          <td>
            <code>errorCodes</code> / <code>ackErrorCodes</code>
          </td>
          <td>≤ 64 项，每项截断 128 字符</td>
        </tr>
        <tr>
          <td>
            历史分页 <code>pageSize</code>
          </td>
          <td>1–100，默认 20</td>
        </tr>
        <tr>
          <td>记忆采集</td>
          <td>三种作用域各取 2000，整体再截 2000</td>
        </tr>
      </tbody>
    </table>
    <p>
      封面压缩的独立参数：源文件 ≤ <strong>8 MB</strong>、输出最长边 <strong>512 px</strong>、
      base64 结果 ≤ <strong>240 KB</strong>，质量按 80 → 60 → 40 逐级降。 全都超限就返回{' '}
      <code>null</code>，此时<strong>封面置空、条目文字照常同步</strong>。 远程 <code>http(s)</code>{' '}
      封面 URL 原样保留、<strong>不下载</strong>—— 所以没有独立的文件上传步骤，压缩后的 dataUrl
      直接写进 <code>coverUrl</code> 随 JSON 走。
    </p>

    <h3 id="sync-concurrency">11.2 并发：重复点击返回同一个 Promise</h3>
    <ul>
      <li>
        <strong>
          同账号重复调用 <code>execute()</code>
        </strong>
        ：不报错、不排队， 而是返回<strong>同一个 in-flight Promise</strong>。
      </li>
      <li>
        <strong>账号已切换</strong>：直接拒绝，提示「账号已切换，请等待当前同步结束后重试」。
      </li>
      <li>
        闸门在 <code>finally</code> 中清除，并用 promise 身份比对避免误清新请求。
      </li>
      <li>
        <strong>
          <code>preview()</code> 有独立的第二把闸门
        </strong>
        ，与 execute 互不影响， 所以预览与同步可以并发（注释写明「预览为只读操作，可随时发起」）。
      </li>
      <li>
        这些保护是<strong>内存态</strong>，进程重启即失效。 渲染层另有一层按钮禁用作为兜底。
      </li>
    </ul>

    <h3 id="sync-retry">11.3 没有取消，重试基本靠手点</h3>
    <ul>
      <li>
        <strong>没有取消能力</strong>：<code>AccountSync</code> 目录下没有任何 cancel / abort / 中断
        IPC。
      </li>
      <li>唯一的自动重试是 8.1 里那条「剔除 promptLibrary 后重试一次」。</li>
      <li>
        「重试」的实际机制是：<strong>失败的类别不推进 revision</strong>， 所以你
        <strong>再点一次「立即同步」</strong>时，它会用同样的 base 重新做三方合并——
        这等价于一次手动重试。
      </li>
      <li>
        代码里写的 <code>pendingApply</code> / <code>lastErrorCodes</code>是
        <strong>只写状态</strong>：写了、读回了， 但<strong>没有任何分支消费它</strong>
        （没有自动重试，界面也不读）。 注释里「保留待应用状态」的说法在服务层并未兑现。
      </li>
    </ul>

    <h3 id="sync-device">11.4 设备标识</h3>
    <p>
      设备标识是<strong>安装级</strong>的：一个随机 UUID 存在设置里， 标签形如{' '}
      <code>macOS #a1b2</code>（取 uuid 后 4 位）。 它<strong>跨账号共享</strong>
      ——同一台机器换账号登录，同步记录里显示的还是同一个设备标签。
    </p>

    <h2 id="sync-ui">12. 界面操作：三个动作</h2>
    <p>账号同步页上你实际只会做三件事，对应界面上的真实文案：</p>
    <table>
      <thead>
        <tr>
          <th>动作</th>
          <th>按钮文案</th>
          <th>你会看到什么</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>开启并选类别</td>
          <td>「启用账号同步」开关 + 每类一个开关</td>
          <td>未开总开关时，各分类开关是禁用的</td>
        </tr>
        <tr>
          <td>执行同步</td>
          <td>
            <strong>「立即同步」</strong>
          </td>
          <td>
            左侧显示「已选择 N 类内容」或「尚未选择同步内容」； 完成后走
            Toast：「账号同步完成」/「账号同步部分完成，请查看结果」/
            「账号同步失败，请查看错误信息」
          </td>
        </tr>
        <tr>
          <td>处理冲突</td>
          <td>
            <strong>「预览并处理冲突」</strong>
          </td>
          <td>
            打开冲突面板，卡片标题「冲突预览 · N 项待处理」，
            有「全部保留本机」「全部保留云端」「清除选择」批量按钮，
            逐条可单选「保留本机」/「保留云端」，底部「应用选择并同步」
          </td>
        </tr>
      </tbody>
    </table>
    <p>结果与记录区：</p>
    <ul>
      <li>「本次结果」显示「上传 N / 下载 N / 冲突 N / 跳过 N」， 最多显示 4 条中文错误提示。</li>
      <li>
        「同步记录」的说明是「服务端仅保存状态、数量和错误码，不保存历史正文」，
        每行格式是「设备标签 · 类别中文名」加升降箭头。 记录<strong>不落本地</strong>，每次都是{' '}
        <code>GET</code> 服务端。
      </li>
      <li>
        记录分页固定 20 条；状态标签映射为
        <code>success → 成功</code>、<code>partial → 部分成功</code>、<code>failed → 失败</code>
        ，另有 <code>ackStatus === 'pending'</code> 显示为「本机待确认」。
      </li>
      <li>
        错误码在服务端侧<strong>原文保存</strong>，只在渲染层翻译成中文；
        <code>SYNC_FORBIDDEN_FIELD</code> 不在翻译表里，会落到兜底文案。
      </li>
    </ul>

    <h2 id="storage-actions">13. 「存储与备份」页能做的事</h2>
    <p>把这一页的入口一次列全，方便你对照寻找：</p>
    <table>
      <thead>
        <tr>
          <th>分区</th>
          <th>项</th>
          <th>说明</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td rowSpan={4}>路径</td>
          <td>数据目录 + 「打开」</td>
          <td>
            直接打开 <code>&#123;userData&#125;</code>
          </td>
        </tr>
        <tr>
          <td>当前工作区 + 「选择」/「关闭」</td>
          <td>Agent 文件工具的根目录</td>
        </tr>
        <tr>
          <td>Canvas 项目根目录 + 「选择」</td>
          <td>新建画布项目的默认保存位置</td>
        </tr>
        <tr>
          <td>存储用量 + 「刷新」</td>
          <td>6 项统计（见 6.2 的口径提醒）</td>
        </tr>
        <tr>
          <td rowSpan={3}>导入与恢复</td>
          <td>升级前自动恢复点</td>
          <td>只读说明，没有按钮</td>
        </tr>
        <tr>
          <td>导入对话历史 + 「导入」</td>
          <td>检测并导入宿主机 Claude Code / Codex 对话历史</td>
        </tr>
        <tr>
          <td>继承安装版数据 + 「继承并重启」</td>
          <td>仅 dev 实例可见（见第 5 节）</td>
        </tr>
        <tr>
          <td rowSpan={7}>清理</td>
          <td>清空浏览器与渲染缓存 + 「清空」</td>
          <td>不动 Cookies / Local Storage / Preferences，不会掉登录</td>
        </tr>
        <tr>
          <td>清理孤儿项目目录 + 「清空」</td>
          <td>
            删除 <code>projects/</code> 下不再被引用的目录，同时清浏览器缓存
          </td>
        </tr>
        <tr>
          <td>清空文件日志 + 「清空」</td>
          <td>见 13.1 的注意事项</td>
        </tr>
        <tr>
          <td>清除历史运行时快照 + 「清除」</td>
          <td>清大字段并 VACUUM 压缩数据库</td>
        </tr>
        <tr>
          <td>迁移旧画布资源到项目目录 + 「迁移」</td>
          <td>把旧全局 media 目录的资源复制进项目文件夹并重写引用</td>
        </tr>
        <tr>
          <td>清理旧画布孤儿资源 + 「清理」</td>
          <td>删除不再被任何快照引用的文件</td>
        </tr>
        <tr>
          <td>（另一页）用量统计 → 清理旧记录</td>
          <td>固定删除 90 天以前的本地用量明细</td>
        </tr>
      </tbody>
    </table>

    <h3 id="log-clear-caveat">13.1 「清空文件日志」清了什么、没清什么</h3>
    <p>
      界面文案写的是「清空 main.log <strong>及轮转文件</strong>内容」， 但{' '}
      <code>clearLogFile()</code> 的实现只有一句：
    </p>
    <pre>
      <code>fs.writeFileSync(fileState.currentPath, '')</code>
    </pre>
    <p>
      也就是<strong>只把当前那个日志文件截断为 0 字节</strong>，<code>main.1.log</code> …{' '}
      <code>main.4.log</code> 这些轮转文件原封不动。 同理日志查看器的 <code>log:read</code>{' '}
      也只读当前文件， 所以它能看到的历史<strong>不超过一个 5 MB 段</strong>。
    </p>
    <p>
      想真正清空：用「日志查看器 → 在文件夹中显示」打开目录后手工删轮转文件，
      或者知道「清空」按钮的实际语义就是这样，别指望它腾出 5 × 5 MB。
    </p>

    <h2 id="troubleshooting">14. 排查表</h2>
    <table>
      <thead>
        <tr>
          <th>现象</th>
          <th>原因与处理</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>dev 里看不到正式环境的数据</td>
          <td>
            设计如此。dev 默认用 <code>@spark/desktop-dev</code>
            ；需要正式数据就用「继承安装版数据」，或临时 <code>SPARK_DATA_PROFILE=production</code>
          </td>
        </tr>
        <tr>
          <td>「继承安装版数据」这一项不显示</td>
          <td>
            两条硬条件之一不满足：当前目录不带 <code>-dev</code> 后缀，或兄弟目录里没有{' '}
            <code>spark.db</code>。开启 <code>SPARK_DATA_PROFILE=production</code> 也会让它消失
          </td>
        </tr>
        <tr>
          <td>
            备份目录里有 <code>.tmp-</code> 残留
          </td>
          <td>
            上次备份中途被打断。超过 24 小时的会被自动回收；不足 24
            小时的会被保留（可能是并发实例在写）
          </td>
        </tr>
        <tr>
          <td>
            <code>backups/database</code> 越占越大
          </td>
          <td>
            <code>pre-inherit-*</code> 前缀不在清理规则里，只会累积。迁移前恢复点才有 2 份 / 14
            天的上限
          </td>
        </tr>
        <tr>
          <td>迁移失败后没有自动回滚</td>
          <td>
            只有<strong>本次启动新建</strong>的快照会自动回滚（
            <code>createdThisStartup === true</code>
            ）。复用旧快照时只弹提示不恢复。手工恢复：退出应用后把快照目录里的 <code>
              spark.db
            </code>{' '}
            拷回 <code>&#123;userData&#125;/spark.db</code>，并删掉 <code>-wal</code> /{' '}
            <code>-shm</code>
          </td>
        </tr>
        <tr>
          <td>启动时提示「无法创建升级恢复点」并退出</td>
          <td>
            备份阶段失败（磁盘空间 / 目录权限）。应用会主动退出且<strong>不执行迁移</strong>
            ，检查磁盘与目录权限后重试
          </td>
        </tr>
        <tr>
          <td>存储用量「合计」对不上磁盘占用</td>
          <td>
            合计只含 6 项，不含 <code>backups/</code>、<code>~/.spark-agent</code>、
            <code>snapshot-vault/</code>、<code>sub-app-*</code>
          </td>
        </tr>
        <tr>
          <td>「清空文件日志」后目录还是很大</td>
          <td>它只截断当前日志文件，不动轮转文件（见 13.1）</td>
        </tr>
        <tr>
          <td>账号同步页什么都点不动</td>
          <td>
            未登录。只有 <code>getPreferences()</code>{' '}
            在未登录时返回默认值，其余方法都会抛「请先登录 SparkWork 账号」
          </td>
        </tr>
        <tr>
          <td>点「立即同步」没反应</td>
          <td>
            同账号的重复调用会复用进行中的 Promise，所以第二次点击本来就不会新起一轮。看按钮是否处于
            loading
          </td>
        </tr>
        <tr>
          <td>提示「账号已切换，请等待当前同步结束后重试」</td>
          <td>同步过程中登录账号变了。等当前这轮结束，在新账号下重新发起</td>
        </tr>
        <tr>
          <td>提示「请先开启账号同步」</td>
          <td>
            <code>enabled</code> 默认 false。要开总开关再选类别
          </td>
        </tr>
        <tr>
          <td>提示「请至少选择一个同步类别」</td>
          <td>7 个类别默认全关，至少要勾一个</td>
        </tr>
        <tr>
          <td>提示「账号同步仅允许 HTTPS 服务端或本机开发地址」</td>
          <td>配置的服务器地址既不是 https 也不是 loopback。这条校验只看配置的 base URL</td>
        </tr>
        <tr>
          <td>提示「当前服务端暂不支持账号同步，请升级服务端后重试」</td>
          <td>
            服务端返回的错误信息里包含 <code>404</code>。判定方式是字符串包含，不是状态码
          </td>
        </tr>
        <tr>
          <td>某类总显示「跳过 N」但看不到原因</td>
          <td>
            按条目记录的原因码不会展示，界面只有计数。最常见是键名撞黑名单（见 9.4 /
            9.5）与值里含绝对路径
          </td>
        </tr>
        <tr>
          <td>外观设置永远同步不过去</td>
          <td>
            见 9.4：白名单里的 <code>inlineTokenCount</code> 与黑名单的裸词 <code>token</code>{' '}
            冲突，整类被判 <code>SYNC_FORBIDDEN_FIELD</code>
          </td>
        </tr>
        <tr>
          <td>绑了 MCP 的工作流同步不过去</td>
          <td>
            图里的 <code>mcpServerIds</code> 撞裸词 <code>mcp</code>
            ，整条工作流被跳过并进保护列表（见 9.5）
          </td>
        </tr>
        <tr>
          <td>云端改了记忆，本地命中次数没了</td>
          <td>
            应用云端记忆时 <code>hit_count</code> 恒置 0、<code>lastHitAt</code>{' '}
            等置空。这是当前实现
          </td>
        </tr>
        <tr>
          <td>云端删了工作流，本地还在</td>
          <td>
            若该工作流仍被本机引用，删除会被 <code>WorkflowReferenceGuardError</code>{' '}
            拦下并跳过（只记 console warn）
          </td>
        </tr>
        <tr>
          <td>
            同步后本地 <code>updated_at</code> 变新了
          </td>
          <td>
            <code>customCommands</code> 与 <code>promptLibrary</code>{' '}
            不回写云端时间戳，一律写当前时间（见 10.3）
          </td>
        </tr>
        <tr>
          <td>同步没有取消按钮</td>
          <td>当前实现没有取消能力，只能等它跑完或超时（单请求 30 秒）</td>
        </tr>
        <tr>
          <td>申请了同步但似乎没自动重试</td>
          <td>
            没有通用重试。唯一自动重试是「剔除 promptLibrary
            重试一次」；其余靠再点一次「立即同步」，因为失败类别不推进 revision
          </td>
        </tr>
        <tr>
          <td>提示「同步服务返回了无效响应」</td>
          <td>响应未通过严格校验：类别重复或缺失、字段类型不对、条数超限等</td>
        </tr>
        <tr>
          <td>Canvas 历史恢复点突然只剩 2 个</td>
          <td>
            离开画布后会从 10 份收紧到 2 份（<code>CANVAS_SNAPSHOT_KEEP_ON_EXIT</code>），
            <code>latest.json</code> 不受影响
          </td>
        </tr>
        <tr>
          <td>想手工备份整个应用数据</td>
          <td>
            退出应用后再拷贝 <code>&#123;userData&#125;</code>；只拷 <code>spark.db</code> 会漏掉
            WAL 里的最新写入
          </td>
        </tr>
      </tbody>
    </table>

    <h2 id="boundaries">15. 事实边界</h2>
    <p>
      以下几项在本次代码核实中<strong>没有找到证据</strong>
      ，页面按「未找到证据」处理，没有写成结论：
    </p>
    <ul>
      <li>
        <strong>服务端实现</strong>：本仓库只有 <code>/desktop-sync/*</code> 的调用方，
        服务端代码在另一个仓库（<code>edu-server</code>）。
        因此「未选择的冲突按修改时间自动处理」这条规则<strong>无法在本仓库验证</strong>，
        只能说客户端不做时间戳比对、把它交给服务端。
      </li>
      <li>
        <strong>自动 / 定时同步</strong>：全仓没有同步调度器，
        <code>enabled</code> 只是手动开关。界面文案也明说「不会自动同步」。
      </li>
      <li>
        <strong>整个 execute 请求体的字节级上限</strong>：只找到提示词库的 2000 条与 6000
        万字符预算，没有整包上限。
      </li>
      <li>
        <strong>备份失败 / 恢复失败的上报</strong>：只写本地日志，
        没有找到上报后端或额外审计文件的证据。
      </li>
      <li>
        <strong>
          <code>ProductionDbInheritService</code> 没有对应测试文件
        </strong>
        ： 它的行为只有实现与注释可依据，没有测试佐证。
      </li>
      <li>
        <strong>磁盘上的两个孤儿文件</strong>：<code>~/.spark-agent/artifacts/</code>与{' '}
        <code>~/.spark-agent/board-tasks.json.bak</code> 在磁盘上存在，
        但代码里找不到写入方。属于历史残留，不是当前功能。
      </li>
    </ul>
    <p>
      另外，本次核实中发现了两处「代码与界面文案不一致」 （<code>inlineTokenCount</code>{' '}
      冲突、清空日志不清轮转文件）。 页面<strong>如实描述了现状</strong>
      ，但没有改动产品源码——这两处是产品侧决定的事， 不是文档问题。
    </p>
  </>
)

const content = {
  slug: 'data-and-backup',
  toc: [
    { id: 'data-map', title: '1. 本地数据存在哪：三个根与一张总表', level: 2 },
    { id: 'data-inventory', title: '1.1 逐类数据的落点、写入方与保留策略', level: 3 },
    { id: 'two-profiles', title: '1.2 两个数据目录：dev 与安装版的隔离', level: 3 },
    { id: 'database', title: '2. 业务数据库：一个 SQLite 文件', level: 2 },
    { id: 'db-pragma', title: '2.1 打开时的连接参数', level: 3 },
    { id: 'migrations', title: '2.2 迁移：101 个 SQL 文件与 schema_migrations', level: 3 },
    { id: 'db-only-entry', title: '2.3 手工操作数据库前请注意', level: 3 },
    { id: 'backup', title: '3. 升级前自动恢复点', level: 2 },
    { id: 'backup-trigger', title: '3.1 什么时候会创建、什么时候复用', level: 3 },
    { id: 'backup-format', title: '3.2 快照是什么格式：在线备份，不是拷文件', level: 3 },
    { id: 'backup-retention', title: '3.3 保留策略：2 份 / 14 天 / 24 小时', level: 3 },
    { id: 'backup-progress-ui', title: '3.4 备份进度显示在哪', level: 3 },
    { id: 'restore', title: '4. 迁移失败：自动恢复与它的边界', level: 2 },
    { id: 'restore-gate', title: '4.1 自动恢复的唯一开关是 createdThisStartup', level: 3 },
    { id: 'restore-how', title: '4.2 恢复动作具体做了什么', level: 3 },
    { id: 'backup-fail', title: '4.3 备份失败时的后果链', level: 3 },
    { id: 'inherit', title: '5. 继承安装版数据（仅 dev 实例可见）', level: 2 },
    { id: 'inherit-availability', title: '5.1 什么时候这个入口才出现', level: 3 },
    { id: 'inherit-flow', title: '5.2 两阶段流程：stage 与 apply', level: 3 },
    { id: 'inherit-failure', title: '5.3 失败语义：绝不阻断启动', level: 3 },
    { id: 'backup-blindspots', title: '6. 备份的清理规则与三个盲区', level: 2 },
    { id: 'two-backup-formats', title: '6.1 同一个目录住着两种格式', level: 3 },
    { id: 'storage-stats-gap', title: '6.2 存储用量不统计备份', level: 3 },
    { id: 'retention-matrix', title: '6.3 保留期一览：为什么口径不统一', level: 3 },
    { id: 'sync-intro', title: '7. 账号同步：定位与默认状态', level: 2 },
    { id: 'sync-defaults', title: '7.1 默认全部关闭', level: 3 },
    { id: 'sync-unauth', title: '7.2 未登录时各方法的行为并不一致', level: 3 },
    { id: 'sync-protocol', title: '8. 同步怎么跑：一个 endpoint、两套模式', level: 2 },
    { id: 'sync-execute-steps', title: '8.1 execute() 的完整步骤', level: 3 },
    { id: 'sync-apply-order', title: '8.2 本地应用顺序 ≠ 类别枚举顺序', level: 3 },
    { id: 'sync-preview', title: '8.3 preview 与 execute 的真实差别', level: 3 },
    { id: 'sync-scope', title: '9. 同步的内容边界：四重校验', level: 2 },
    { id: 'sync-whitelist', title: '9.1 第一重：顶层字段白名单', level: 3 },
    { id: 'sync-denylist', title: '9.2 第二重：键名黑名单（只匹配键，不匹配值）', level: 3 },
    { id: 'sync-other-checks', title: '9.3 第三、四重：字段类型与值文本扫描', level: 3 },
    { id: 'sync-appearance-collision', title: '9.4 一个实际后果：外观设置会整类被拦', level: 3 },
    { id: 'sync-mcp-collision', title: '9.5 同类机制：绑定 MCP 的工作流被静默跳过', level: 3 },
    { id: 'sync-conflict', title: '10. 冲突处理与保护列表', level: 2 },
    { id: 'sync-protected', title: '10.1 保护列表：防止云端覆盖本地的唯一机制', level: 3 },
    { id: 'sync-conflict-ui', title: '10.2 冲突：客户端不做裁决', level: 3 },
    { id: 'sync-merge-detail', title: '10.3 各类别的合并细节', level: 3 },
    { id: 'sync-limits', title: '11. 限额、并发与重试', level: 2 },
    { id: 'sync-limits-table', title: '11.1 真实限额', level: 3 },
    { id: 'sync-concurrency', title: '11.2 并发：重复点击返回同一个 Promise', level: 3 },
    { id: 'sync-retry', title: '11.3 没有取消，重试基本靠手点', level: 3 },
    { id: 'sync-device', title: '11.4 设备标识', level: 3 },
    { id: 'sync-ui', title: '12. 界面操作：三个动作', level: 2 },
    { id: 'storage-actions', title: '13. 「存储与备份」页能做的事', level: 2 },
    { id: 'log-clear-caveat', title: '13.1 「清空文件日志」清了什么、没清什么', level: 3 },
    { id: 'troubleshooting', title: '14. 排查表', level: 2 },
    { id: 'boundaries', title: '15. 事实边界', level: 2 },
  ],
  faq: [
    {
      question: 'SparkWork 的数据到底存在哪里？',
      answer:
        '应用数据在 {userData}（macOS 上是 ~/Library/Application Support/@spark/desktop），权威存储是其中的 spark.db；跨工作区的长期记忆与看板在 ~/.spark-agent；Spark CLI 另用 ~/.spark。三者互不包含，也没有自动合并。开发实例默认使用兄弟目录 @spark/desktop-dev。',
    },
    {
      question: '开发时怎么看到我正式环境的数据？',
      answer:
        '先确认你跑的是 dev 实例（userData 目录以 -dev 结尾），然后在「设置 → 存储与备份 → 导入与恢复」里点「继承安装版数据」。它分两段执行：先只读导出安装版数据库，重启后再应用，并把当前开发库整组备份到 backups/database/pre-inherit-* 下。这个过程安装版数据不会被改动，也可以重复执行。',
    },
    {
      question: '升级出问题会丢数据吗？',
      answer:
        '每个新版本首次执行数据库迁移前会自动做一份完整快照。迁移失败时，只有本次启动新建的快照会被自动用于回滚（createdThisStartup === true），复用的旧快照不会。回滚是先删当前数据库三件套再写回快照，原库不做重命名保留；快照目录本身不会被删，弹窗里会把路径给你。',
    },
    {
      question: '为什么备份目录越来越大，界面又看不到？',
      answer:
        'backups/database 下有前缀不同的两类目录。pre-migration-v* 是迁移前恢复点，受「2 份 / 14 天」上限保护；pre-inherit-* 是继承安装版数据时裸拷的三件套，清理逻辑只匹配前一个前缀，所以它不会被回收。而且「存储用量」的合计里不包含 backups/ 目录，也没有任何界面按钮能清它，只能手工删。',
    },
    {
      question: '账号同步会上传我的 API Key 吗？',
      answer:
        '不会。同步对每条记录做四重校验：顶层字段白名单、键名黑名单（含 apiKey / token / secret / credential / env / mcp 等词条）、字段类型表、值文本扫描（PEM 私钥、Bearer、JWT、常见 API Key 形态、含凭据的 URL、本机绝对路径）。而且是「整条跳过」而非裁剪字段，同时被跳过的 id 会进入保护列表，云端也不会覆盖本地那一份。',
    },
    {
      question: '为什么我的外观设置同步不过去？',
      answer:
        '这是一个口径冲突：appearance 类别的白名单里收进了 inlineTokenCount，而同一份代码的键名黑名单里有一个裸词 token。裸词是子串匹配，所以该字段一旦存在就会让整条 appearance 记录被判为 SYNC_FORBIDDEN_FIELD。把全部 52 个白名单字段名逐个测过，只有这一个命中。界面只显示「跳过 N」，原因码不在错误码翻译表里，所以看起来是静默失败。',
    },
    {
      question: '同步能取消或自动重试吗？',
      answer:
        '都不能。当前实现没有取消能力，也没有通用重试；唯一的自动重试是「服务端不支持 promptLibrary 时剔除该类重试一次」。重试的实际方式是再点一次「立即同步」——因为失败的类别不会推进 revision，下一次会拿同样的 base 重新做三方合并。另外同一账号重复点击不会新起一轮，而是返回进行中的那个 Promise。',
    },
    {
      question: '「清空文件日志」为什么没腾出多少空间？',
      answer:
        '界面文案写的是「清空 main.log 及轮转文件内容」，但实现只把当前日志文件截断为 0 字节，main.1.log 到 main.4.log 这些轮转文件不会被删。日志轮转参数是 5 MB × 5 份，所以真正占用是那 4 个轮转文件。要彻底清空需用「在文件夹中显示」打开目录后手工删除。',
    },
  ],
  aiSummary:
    'SparkWork 本地数据、备份与账号同步完整指南：先把数据分成三个根讲清——应用数据在 {userData}（开发实例走兄弟目录 @spark/desktop-dev，由 SPARK_DATA_PROFILE 控制）、跨工作区记忆与看板在 ~/.spark-agent、CLI 另用 ~/.spark。再讲数据库本体（唯一权威存储 spark.db、WAL 与 pragma、101 个迁移与 schema_migrations）与升级安全网：迁移前自动恢复点用 SQLite 在线备份产出单文件快照，保留 2 份 / 14 天，自动回滚的唯一门槛是 createdThisStartup === true；同一个 backups/database 目录下还住着继承安装版数据时裸拷的三件套 pre-inherit-*，它不受任何清理约束，且整个 backups/ 不计入存储用量、也没有界面清理入口。最后讲账号同步：7 个类别默认全关、只在点「立即同步」时跑、走同一个 /desktop-sync/execute 端点（预览靠 mode 区分），四重校验（字段白名单、键名黑名单、类型表、值文本扫描）是「整条跳过」而非裁剪，配保护列表防止云端覆盖本地。含保留期对照、真实限额、应用顺序、25 行排查表，并如实记录两处代码与文案不一致（appearance 的 inlineTokenCount 撞黑名单导致整类失效、清空日志不清轮转文件）。',
  quickReference: [
    { key: '生产 userData（macOS）', value: '~/Library/Application Support/@spark/desktop' },
    { key: '开发 userData', value: '兄弟目录 @spark/desktop-dev（-dev 后缀）' },
    { key: '数据目录开关', value: 'SPARK_DATA_PROFILE=dev | production' },
    { key: 'CLI 数据目录', value: '~/.spark（可用 SPARK_HOME 覆盖）' },
    { key: '跨工作区数据目录', value: '~/.spark-agent' },
    { key: '业务数据库', value: '{userData}/spark.db（+ -wal / -shm）' },
    { key: '数据库 pragma', value: 'WAL / synchronous=NORMAL / foreign_keys=ON / mmap_size=256MB' },
    { key: '迁移文件数', value: '101 个（packages/storage/migrations/）' },
    { key: '迁移记录表', value: 'schema_migrations' },
    { key: '迁移前恢复点目录', value: '{userData}/backups/database/pre-migration-v<版本>/' },
    { key: '继承备份目录', value: '{userData}/backups/database/pre-inherit-v<版本>-<时间戳>/' },
    { key: '恢复点保留', value: '2 份 / 14 天 / .tmp- 残留 24 小时' },
    { key: '备份进度粒度', value: '2048 页/步（约 8 MiB），百分比封顶 99' },
    { key: '自动回滚门槛', value: 'createdThisStartup === true' },
    { key: '文件日志轮转', value: '5 MB × 5 份' },
    { key: '账号同步入口', value: '设置 → 通用 → 账号同步' },
    { key: '同步类别数', value: '7 个，默认全部关闭' },
    { key: '同步 endpoint', value: 'POST /api/v1/desktop-sync/execute（mode=preview 为预览）' },
    { key: '同步超时', value: '30 秒；401 续期最多 2 次，无通用重试' },
    {
      key: '同步本地应用顺序',
      value:
        'workflows → prompts → assistants → customCommands → memory → appearance → promptLibrary',
    },
    { key: '提示词库同步上限', value: '2000 条 / 6000 万字符' },
    { key: '封面压缩', value: '源 ≤8MB，输出最长边 512px、base64 ≤240KB' },
    { key: '冲突选择键格式', value: '<category>/<itemId> → local | cloud' },
    { key: '同步历史分页', value: '1–100，默认 20' },
    { key: '临时媒体保留', value: '7 天，每 6 小时扫描' },
    { key: '工具结果归档保留', value: '7 天 + 512MB 总量' },
    { key: 'Canvas 快照保留', value: '编辑中 10 份 / 退出后 2 份' },
    { key: '存储用量统计口径', value: '6 项（不含 backups/ 与 ~/.spark-agent）' },
  ],
  howTo: {
    name: '备份与迁移本地数据',
    description:
      '在升级、换机或排查问题时安全处理 SparkWork 的本地数据：先分清数据在哪，再决定用什么方式备份，最后确认恢复路径可用。',
    totalTime: 'PT15M',
    steps: [
      '先在「设置 → 存储与备份」看清数据目录、数据库位置与各项占用，注意「合计」不含 backups/ 与 ~/.spark-agent。',
      '做整体备份前先正常退出应用——spark.db 处于 WAL 模式，运行中直接拷贝 spark.db 会漏掉 -wal 里的最新写入。',
      '如果只想保住业务数据，退出后拷贝整个 userData 目录下的 spark.db / spark.db-wal / spark.db-shm 三件套；想连凭据一起保住，再把 credential-vault-v1.enc 与 cloud-auth-session.enc 一并拷走。',
      '不要依赖备份目录自动增长：迁移前恢复点只有 2 份且 14 天后回收，pre-inherit-* 前缀则完全不受清理规则约束、只会累积，需要时手工清理。',
      '升级后如果应用提示恢复，先看弹窗里给的是哪一个快照路径——只有本次启动新建的快照会被自动回滚，复用旧快照时应用只会退出并保留路径。',
      '手工恢复的正确做法：退出应用，把快照目录里的 spark.db 拷回 userData 覆盖，并删掉同目录的 spark.db-wal 与 spark.db-shm，再启动。',
      '需要跨版本复现问题时用「继承安装版数据」，它会先把当前开发库整组备份到 pre-inherit-* 再应用，可重复执行；用完后记得手工清理那些备份目录。',
    ],
  },
  Body,
} satisfies DocsPageContent

export default content
