/**
 * performance 模块翻译资源（设置 → 性能：资源总览 / 趋势 / 治理闸门 / 阈值配置）
 *
 * key 前缀：`perf.*`；元素类型后缀与长度阈值见 scripts/check-i18n.mjs。
 * 长段说明用 `...LongDesc` / `...Body`（≤200），其余按常规后缀收口。
 */
export const PERFORMANCE_RESOURCE = {
  zh: {
    // ── 压力级别 ──────────────────────────────────────────────────────────
    'perf.level.nominal': '正常',
    'perf.level.warning': '警告',
    'perf.level.critical': '严重',
    'perf.level.emergency': '危急',
    'perf.levelAction.nominal': '资源充裕 · 正常调度',
    'perf.levelAction.warning': '限制新任务 · 进行中任务不受影响',
    'perf.levelAction.critical': '暂停新派发 · 后台任务延迟执行',
    'perf.levelAction.emergency': '暂停全部新任务派发 · 必要时终止排队任务',

    // ── 指标标签 ──────────────────────────────────────────────────────────
    'perf.indicator.systemUsedPctLabel': '系统内存',
    'perf.indicator.appFootprintPctLabel': '应用占用',
    'perf.indicator.hostRssPctLabel': '宿主内存',
    'perf.indicator.childrenRssPctLabel': '子进程内存',
    'perf.indicator.childrenCountLabel': '子进程数',
    'perf.indicator.eventLoopDelayMsLabel': '事件循环延迟',

    // ── 进程分类 ──────────────────────────────────────────────────────────
    'perf.processKind.claudeCli': 'Claude CLI',
    'perf.processKind.codexCli': 'Codex CLI',
    'perf.processKind.agentUnknown': '未知 Agent',
    'perf.processKind.mcpBridge': 'MCP 桥',
    'perf.processKind.platformPool': '平台常驻池',
    'perf.processKind.codexPool': 'Codex 池',
    'perf.processKind.engineSubagent': '引擎子代理',
    'perf.processKind.mediaMcp': '媒体 MCP',
    'perf.processKind.toolPackage': '工具包',
    'perf.processKind.terminalPty': '终端',
    'perf.processKind.subappService': '子应用服务',
    'perf.processKind.mediaTool': '媒体工具',
    'perf.processKind.other': '其他',

    // ── 通用单位 ──────────────────────────────────────────────────────────
    'perf.unit.count': '{{value}} 个',

    // ── 资源总览 ──────────────────────────────────────────────────────────
    'perf.metric.hostRssLabel': '宿主内存（RSS）',
    'perf.metric.systemLabel': '系统内存',
    'perf.metric.eventLoopLabel': '事件循环延迟',
    'perf.metric.cpuLabel': 'CPU 占用',
    'perf.metric.hostSubDesc': '占基线 {{pct}}% · 堆 {{heap}} · 外部 {{external}}',
    'perf.metric.systemSubDesc': '剩余 {{free}} · 基线 {{baseline}}',
    'perf.metric.eventLoopSubDesc': '峰值 {{ms}}',
    'perf.metric.cpuSubDesc': '峰值 {{peak}} · {{cores}} 逻辑核',
    'perf.metric.collectFailedError': '采集失败 · 自动重试中',
    'perf.status.reading': '读取中…',
    'perf.status.collecting': '正在采集资源指标',
    'perf.status.lastUpdated': '最后更新 {{time}}',
    'perf.status.refreshTitle': '刷新',
    'perf.children.title': '子进程',
    'perf.children.none': '暂无明细',
    'perf.children.summary': '{{count}} 个 · 治理口径 {{governed}} 个 · {{rss}}',
    'perf.children.collectFailedError': '子进程采集暂时失败，以下为最近一次成功扫描结果',
    'perf.children.emptyDesc': '暂无子进程明细 · 打开 Agent 会话后开始追踪',
    'perf.children.policyLongDesc':
      '治理口径 {{governed}} 个 = claude / codex 家族（含 CLI 内部子代理）；MCP 桥与常驻池不计入压力判定，仅诊断展示。',

    // ── 治理闸门 ──────────────────────────────────────────────────────────
    'perf.governance.pillWarning': '限流中',
    'perf.governance.pillCritical': '已暂停派发',
    'perf.governance.pillEmergency': '已熔断',
    'perf.governance.emptyDesc': '暂无闸门运行数据（将在首次任务派发后显示）',
    'perf.governance.disabledDesc': '并发闸门已停用（governance.enabled=false）',
    'perf.governance.nameMain': '成员派发（主池）',
    'perf.governance.nameNested': '嵌套派发（防死锁池）',
    'perf.governance.running': '{{inUse}}/{{capacity}} 运行',
    'perf.governance.queued': '{{count}} 排队',
    'perf.governance.statusLabel': '状态',
    'perf.governance.normalScheduling': '正常调度',
    'perf.governance.hostUsage': '运行中会话 {{inflight}}（全部计入并发预算）',
    'perf.governance.hostUsageCapped':
      '运行中会话 {{inflight}} · 计入并发预算 {{effective}}（宿主封顶 {{cap}}）',
    'perf.governance.budgetSuffix': '全局并发预算 {{budget}}',
    'perf.governance.hostUsageHintLongDesc':
      '运行中会话：正在执行本轮任务的会话数（含即将开始的过渡态）。宿主封顶：宿主会话占用计入主池的上限，超出部分不再占用主池；主池容量 = 全局并发预算 − 计入的宿主占用，再取成员侧硬顶。数据为诊断快照：打开页面、每 30 秒、压力级别变更时刷新。',

    // ── 降级事件 ──────────────────────────────────────────────────────────
    'perf.events.upgraded': '升入 {{name}}',
    'perf.events.recovered': '恢复至 {{name}}',
    'perf.events.empty': '暂无降级事件 · 运行平稳',

    // ── 趋势图 ────────────────────────────────────────────────────────────
    'perf.trend.hostLabel': '宿主内存（RSS）',
    'perf.trend.sysLabel': '系统内存占用率',
    'perf.trend.procLabel': '子进程数（全量）',
    'perf.trend.empty': '暂无趋势数据',
    'perf.trend.rangeAgo': '-{{minutes}} 分钟',
    'perf.trend.now': '现在',

    // ── 性能设置页 ────────────────────────────────────────────────────────
    'perf.sectionTitle': '性能',
    'perf.section.ledeDesc':
      '实时监控 SparkWork 与宿主电脑的资源占用；压力过高时自动降级并发任务并通知你。',
    'perf.section.baselineNoteDesc': '阈值按本机内存与 CPU 核数动态换算（当前基线：{{baseline}}）',
    'perf.section.baselineDesc': '{{bytes}} / {{cores}} 核',
    'perf.section.ledeTailDesc': '，数据 2 秒采样，仅保存在本地。',
    'perf.section.governanceDesc':
      '统计范围：团队 / 工作流子代理派发（普通会话不占闸门槽位，只计入下方并发预算）',
    'perf.section.trendTitle': '历史趋势',
    'perf.section.governanceTitle': '活动治理',
    'perf.section.eventsTitle': '最近降级 / 恢复事件',
    'perf.section.protectionTitle': '性能保护',
    'perf.section.restoreDefaultBtn': '恢复默认',
    'perf.section.footnoteLongDesc':
      '通知规则：warning / critical 仅静默降级（限流、暂停新派发），不弹任何提示；只有 emergency（电脑资源即将耗尽、已暂停全部新任务派发）才弹常驻横幅并发送系统通知。这是电脑资源保护机制——压力恢复后横幅自动消失并提示「电脑资源已恢复」。',
    'perf.error.collectFailed': '性能数据采集失败',
    'perf.error.configFailed': '性能配置操作失败',
    'perf.error.retrying': '将自动重试',
    'perf.off.title': '性能监控未开启',
    'perf.off.descDesc':
      '开启后展示宿主内存、系统内存、事件循环延迟等实时指标，并在压力过高时自动降级。',
    'perf.off.enableBtn': '开启性能监控',
    'perf.off.enablingBtn': '开启中…',
    'perf.range.minutes': '{{count}} 分钟',
    'perf.saveFailed': '性能配置保存失败：{{message}}',
    'perf.resetFailed': '性能配置重置失败：{{message}}',

    // ── 阈值配置面板 ──────────────────────────────────────────────────────
    'perf.config.hostLabel': '宿主内存',
    'perf.config.systemLabel': '系统内存',
    'perf.config.eventLoopLabel': '事件循环',
    'perf.config.levelWarningDesc': '静默限流新任务，不弹通知',
    'perf.config.levelCriticalDesc': '暂停新派发，不弹通知',
    'perf.config.levelEmergencyDesc': '暂停全部新任务，即将溢出时弹通知',
    'perf.config.monitorTitle': '性能监控',
    'perf.config.monitorDesc':
      '实时采集宿主与子进程资源指标（2 秒采样，仅本地保存）；关闭后不再采样与推送。',
    'perf.config.governanceTitle': '自动降级保护',
    'perf.config.governanceDesc':
      '资源压力过高时自动限制并发任务，防止应用与系统无响应；关闭后不再自动降级（监控与展示不受影响）。',
    'perf.config.capTitle': '并发上限',
    'perf.config.capDesc': '同时运行的任务数上限，超出部分进入排队，空闲后按顺序启动。',
    'perf.config.globalBudgetLabel': '全局预算',
    'perf.config.memberDispatchLabel': '成员派发',
    'perf.config.waveWidthLabel': '工作流波宽',
    'perf.config.childrenThresholdDesc': '子进程数阈值 · 治理口径 · 按核数与并发预算推导',
    'perf.config.childrenPolicyLongDesc':
      '治理口径统计 claude / codex 家族子进程及其内部 node 载体 （含会话挂载的 MCP server 进程，每会话常驻十几个属正常）， 因此阈值下限远高于日常用量，仅在进程数量失控时触发。',
    'perf.config.childrenDerivedLongDesc':
      '按本机基线（{{cores}} 逻辑核 / 预算 {{budget}}）推导：警告 {{warning}} / 严重 {{critical}} / 危急 {{emergency}} 个，公式 max(下限, 核数×8/12/16, 预算+0/8/16)。',
    'perf.config.childrenManualOverrideDesc': '已手动覆盖（下方危急/严重/警告列可编辑）。',
    'perf.config.restoreAutoBtn': '恢复自动推导',
    'perf.config.childrenCountLabel': '子进程数',
    'perf.config.childrenUnit': ' 个',
    'perf.config.decreaseAria': '减少',
    'perf.config.increaseAria': '增加',
    'perf.config.footnoteLongDesc':
      '阈值判定：宿主内存（RSS，按占系统总内存百分比）、系统内存占用率、事件循环延迟、子进程数四类指标任一越级，即进入更高压力级别；内存阈值按宿主机基线动态换算 （基线随内存变化 >5% 或休眠恢复自动重采样）。判定以百分比直比为准， GB 换算值仅用于展示。并发闸门在压力升级时按 warning 限流 → critical 暂停派发 → emergency 熔断的固定矩阵自动执行，无需逐项开关。',

    // ── 降级通知 ──────────────────────────────────────────────────────────
    'perf.notice.phenomenonMemory': '内存占用接近上限',
    'perf.notice.phenomenonChildren': '后台进程数量过多',
    'perf.notice.phenomenonSlow': '系统响应明显变慢',
    'perf.notice.phenomenonDefault': '资源占用接近饱和',
    'perf.notice.messageBody':
      '检测到电脑整体{{phenomena}}，Spark 已暂停新任务派发以保护系统流畅。这是资源保护机制而非应用故障，进行中的任务不受影响；释放电脑资源后会自动恢复。',
    'perf.notice.systemTitle': '电脑资源压力提示',
    'perf.notice.systemBody':
      '电脑整体{{phenomena}}，Spark 已暂停新任务派发以保护系统流畅。释放电脑资源后将自动恢复。',
    'perf.notice.viewPerformanceBtn': '查看性能',
    'perf.notice.recovered': '电脑资源已恢复，任务派发已继续',
  },
  en: {
    // ── 压力级别 ──────────────────────────────────────────────────────────
    'perf.level.nominal': 'Normal',
    'perf.level.warning': 'Warning',
    'perf.level.critical': 'Critical',
    'perf.level.emergency': 'Emergency',
    'perf.levelAction.nominal': 'Plenty of resources · normal scheduling',
    'perf.levelAction.warning': 'New tasks limited · running tasks unaffected',
    'perf.levelAction.critical': 'New dispatch paused · background delayed',
    'perf.levelAction.emergency': 'All dispatch paused · queued tasks may stop',

    // ── 指标标签 ──────────────────────────────────────────────────────────
    'perf.indicator.systemUsedPctLabel': 'System memory',
    'perf.indicator.appFootprintPctLabel': 'App usage',
    'perf.indicator.hostRssPctLabel': 'Host memory',
    'perf.indicator.childrenRssPctLabel': 'Child memory',
    'perf.indicator.childrenCountLabel': 'Child processes',
    'perf.indicator.eventLoopDelayMsLabel': 'Event loop delay',

    // ── 进程分类 ──────────────────────────────────────────────────────────
    'perf.processKind.claudeCli': 'Claude CLI',
    'perf.processKind.codexCli': 'Codex CLI',
    'perf.processKind.agentUnknown': 'Unknown agent',
    'perf.processKind.mcpBridge': 'MCP bridge',
    'perf.processKind.platformPool': 'Platform pool',
    'perf.processKind.codexPool': 'Codex pool',
    'perf.processKind.engineSubagent': 'Engine subagent',
    'perf.processKind.mediaMcp': 'Media MCP',
    'perf.processKind.toolPackage': 'Tool package',
    'perf.processKind.terminalPty': 'Terminal',
    'perf.processKind.subappService': 'Subapp service',
    'perf.processKind.mediaTool': 'Media tool',
    'perf.processKind.other': 'Other',

    // ── 通用单位 ──────────────────────────────────────────────────────────
    'perf.unit.count': '{{value}}',

    // ── 资源总览 ──────────────────────────────────────────────────────────
    'perf.metric.hostRssLabel': 'Host memory (RSS)',
    'perf.metric.systemLabel': 'System memory',
    'perf.metric.eventLoopLabel': 'Event loop delay',
    'perf.metric.cpuLabel': 'CPU usage',
    'perf.metric.hostSubDesc': 'Of baseline {{pct}}% · heap {{heap}} · external {{external}}',
    'perf.metric.systemSubDesc': 'Free {{free}} · baseline {{baseline}}',
    'perf.metric.eventLoopSubDesc': 'Peak {{ms}}',
    'perf.metric.cpuSubDesc': 'Peak {{peak}} · {{cores}} logical cores',
    'perf.metric.collectFailedError': 'Collection failed · retrying',
    'perf.status.reading': 'Reading…',
    'perf.status.collecting': 'Collecting resource metrics',
    'perf.status.lastUpdated': 'Updated {{time}}',
    'perf.status.refreshTitle': 'Refresh',
    'perf.children.title': 'Child processes',
    'perf.children.none': 'No details',
    'perf.children.summary': '{{count}} · governed {{governed}} · {{rss}}',
    'perf.children.collectFailedError': 'Child scan failed; showing last successful result',
    'perf.children.emptyDesc': 'No child details · tracking starts with an Agent session',
    'perf.children.policyLongDesc':
      'Governed {{governed}} = claude / codex family; MCP bridges and pools are diagnostics only.',

    // ── 治理闸门 ──────────────────────────────────────────────────────────
    'perf.governance.pillWarning': 'Throttling',
    'perf.governance.pillCritical': 'Dispatch paused',
    'perf.governance.pillEmergency': 'Tripped',
    'perf.governance.emptyDesc': 'No gate data yet (shown after the first dispatch)',
    'perf.governance.disabledDesc': 'Concurrency gate disabled (governance.enabled=false)',
    'perf.governance.nameMain': 'Member dispatch (main pool)',
    'perf.governance.nameNested': 'Nested dispatch (anti-deadlock)',
    'perf.governance.running': '{{inUse}}/{{capacity}} running',
    'perf.governance.queued': '{{count}} queued',
    'perf.governance.statusLabel': 'Status',
    'perf.governance.normalScheduling': 'Normal scheduling',
    'perf.governance.hostUsage': 'Running sessions {{inflight}} (all counted)',
    'perf.governance.hostUsageCapped':
      'Running sessions {{inflight}} · counted {{effective}} (host cap {{cap}})',
    'perf.governance.budgetSuffix': 'global budget {{budget}}',
    'perf.governance.hostUsageHintLongDesc':
      'Running sessions include those about to start. The host cap limits how many count toward the main pool; capacity is budget minus counted host usage. Refreshes on open, every 30s and on change.',

    // ── 降级事件 ──────────────────────────────────────────────────────────
    'perf.events.upgraded': 'Upgraded to {{name}}',
    'perf.events.recovered': 'Recovered to {{name}}',
    'perf.events.empty': 'No degradation events · running smoothly',

    // ── 趋势图 ────────────────────────────────────────────────────────────
    'perf.trend.hostLabel': 'Host memory (RSS)',
    'perf.trend.sysLabel': 'System memory',
    'perf.trend.procLabel': 'Child processes',
    'perf.trend.empty': 'No trend data yet',
    'perf.trend.rangeAgo': '-{{minutes}} min',
    'perf.trend.now': 'Now',

    // ── 性能设置页 ────────────────────────────────────────────────────────
    'perf.sectionTitle': 'Performance',
    'perf.section.ledeDesc':
      'Monitors SparkWork and host resource usage; auto-degrades concurrency under pressure.',
    'perf.section.baselineNoteDesc':
      'Thresholds scale with local memory and CPU cores (baseline: {{baseline}})',
    'perf.section.baselineDesc': '{{bytes}} / {{cores}} cores',
    'perf.section.ledeTailDesc': '. Sampled every 2s, stored locally only.',
    'perf.section.governanceDesc':
      'Scope: team / workflow subagent dispatch (normal sessions count only toward the budget)',
    'perf.section.trendTitle': 'History',
    'perf.section.governanceTitle': 'Activity governance',
    'perf.section.eventsTitle': 'Recent degrade / recover events',
    'perf.section.protectionTitle': 'Performance protection',
    'perf.section.restoreDefaultBtn': 'Restore defaults',
    'perf.section.footnoteLongDesc':
      'Only emergency shows a persistent banner and sends a system notification; warning / critical degrade silently. This is resource protection — the banner disappears when pressure recovers.',
    'perf.error.collectFailed': 'Failed to collect performance data',
    'perf.error.configFailed': 'Performance config operation failed',
    'perf.error.retrying': 'Will retry automatically',
    'perf.off.title': 'Performance monitoring is off',
    'perf.off.descDesc':
      'Enable to see live memory, CPU and event loop metrics, with auto-degrade under pressure.',
    'perf.off.enableBtn': 'Enable monitoring',
    'perf.off.enablingBtn': 'Enabling…',
    'perf.range.minutes': '{{count}} min',
    'perf.saveFailed': 'Failed to save performance config: {{message}}',
    'perf.resetFailed': 'Failed to reset performance config: {{message}}',

    // ── 阈值配置面板 ──────────────────────────────────────────────────────
    'perf.config.hostLabel': 'Host memory',
    'perf.config.systemLabel': 'System memory',
    'perf.config.eventLoopLabel': 'Event loop',
    'perf.config.levelWarningDesc': 'Throttle new tasks silently',
    'perf.config.levelCriticalDesc': 'Pause new dispatch silently',
    'perf.config.levelEmergencyDesc': 'Pause all new tasks; notify before overflow',
    'perf.config.monitorTitle': 'Performance monitoring',
    'perf.config.monitorDesc':
      'Collect host and child metrics (2s, local only); stops sampling when off.',
    'perf.config.governanceTitle': 'Auto-degrade protection',
    'perf.config.governanceDesc':
      'Limits concurrency under high pressure to keep the app responsive.',
    'perf.config.capTitle': 'Concurrency limits',
    'perf.config.capDesc': 'Max tasks running at once; extra tasks queue and start in order.',
    'perf.config.globalBudgetLabel': 'Global budget',
    'perf.config.memberDispatchLabel': 'Member dispatch',
    'perf.config.waveWidthLabel': 'Workflow width',
    'perf.config.childrenThresholdDesc':
      'Child process thresholds · governed scope · derived from cores and budget',
    'perf.config.childrenPolicyLongDesc':
      'Counts claude / codex family processes and their node hosts (including MCP servers); thresholds trigger only when process count runs away.',
    'perf.config.childrenDerivedLongDesc':
      'Derived from this machine ({{cores}} cores / budget {{budget}}): warning {{warning}} / critical {{critical}} / emergency {{emergency}}, formula max(min, cores×8/12/16, budget+0/8/16).',
    'perf.config.childrenManualOverrideDesc': 'Manually overridden (edit the columns below).',
    'perf.config.restoreAutoBtn': 'Restore auto',
    'perf.config.childrenCountLabel': 'Child processes',
    'perf.config.childrenUnit': '',
    'perf.config.decreaseAria': 'Decrease',
    'perf.config.increaseAria': 'Increase',
    'perf.config.footnoteLongDesc':
      'Any metric crossing its threshold raises the pressure level. Percentages decide; GB values are display only. The gate follows a fixed matrix: warning throttle, critical pause, emergency cut off.',

    // ── 降级通知 ──────────────────────────────────────────────────────────
    'perf.notice.phenomenonMemory': 'Memory usage near its limit',
    'perf.notice.phenomenonChildren': 'Too many background processes',
    'perf.notice.phenomenonSlow': 'System is noticeably slower',
    'perf.notice.phenomenonDefault': 'Resources nearly saturated',
    'perf.notice.messageBody':
      'Your computer is low on resources ({{phenomena}}). Spark paused new tasks to keep things smooth — this is resource protection, not an app failure. Running tasks are unaffected and it resumes automatically.',
    'perf.notice.systemTitle': 'Computer resource pressure',
    'perf.notice.systemBody':
      'Your computer is low on resources ({{phenomena}}). Spark paused new tasks to keep things smooth and resumes once resources free up.',
    'perf.notice.viewPerformanceBtn': 'View performance',
    'perf.notice.recovered': 'Resources recovered; task dispatch resumed',
  },
} as const
