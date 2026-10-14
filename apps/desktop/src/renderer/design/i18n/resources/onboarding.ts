/**
 * onboarding 模块翻译资源（新手引导全流程）
 *
 * key 前缀：`onboarding.*`
 * 元素类型后缀见 `scripts/check-i18n.mjs` 的长度规则表；
 * `...Prompt` 为写给模型的指令文本，不参与长度校验。
 */
export const ONBOARDING_RESOURCE = {
  zh: {
    // ── 阶段导航 / 通用 ────────────────────────────────────────────────────
    'onboarding.backBtn': '上一步',
    'onboarding.laterBtn': '稍后再说',
    'onboarding.continueBtn': '继续',
    'onboarding.skipStepBtn': '跳过本步',
    'onboarding.skipToast': '已跳过新手引导，可稍后从设置中重新打开。',

    // ── 步骤 1：欢迎 ──────────────────────────────────────────────────────
    'onboarding.welcomeTitle': '你想先做些什么？',
    'onboarding.welcomeLead': '选一个最贴近你的场景，我们为你准备一个好的开始。',
    'onboarding.welcomeHint': '随时可以尝试其他用途，这不会限制你的助手。',

    // ── 步骤 2：模型来源 ──────────────────────────────────────────────────
    'onboarding.modelSourceTitle': '选择你的 AI 模型',
    'onboarding.modelSourceLead': '推荐使用已有的第三方模型 API Key，也可以登录 Spark 账号或连接本机工具。',
    'onboarding.modelSourceThirdParty': '第三方模型',
    'onboarding.modelSourceRecommended': '推荐',
    'onboarding.modelSourceThirdPartyDesc': '使用已有 API Key，密钥只保存在本机',
    'onboarding.modelSourceThirdPartyBtn': '填写 API Key',
    'onboarding.modelSourceSparkAccount': 'Spark 账号',
    'onboarding.modelSourceSparkAccountDesc': '登录即可使用，无需配置',
    'onboarding.modelSourceLocalCli': '本机 AI 工具',
    'onboarding.modelSourceLocalCliDesc': '连接 Claude Code 或 Codex',
    'onboarding.modelSourceSkipBtn': '暂时跳过',

    // ── 步骤 3a：Spark 账号 ───────────────────────────────────────────────
    'onboarding.sparkAccountTitle': '使用 Spark 平台模型',
    'onboarding.sparkAccountLead':
      '不必申请或配置 API Key。平台模型作为一个可选 Provider，与你的第三方模型配置并存。',

    // ── 步骤 3b：本机 CLI ─────────────────────────────────────────────────
    'onboarding.localCliTitle': '连接本机的 Claude Code 或 Codex',
    'onboarding.localCliLead':
      '选中后会直接复用你本机已登录的 Claude Code / Codex 配置，不需要再填写 API Key。如果两个都还没装，可以改用第三方模型路径。',
    'onboarding.localCliDetecting': '正在检测本机是否已安装…',
    'onboarding.localCliCheckingBadge': '检测中',
    'onboarding.localCliAvailableBadge': '可用',
    'onboarding.localCliUnavailableBadge': '未安装',
    'onboarding.localCliRecheckBtn': '重新检测',
    'onboarding.localCliFallbackBtn': '改用第三方模型',
    'onboarding.localCliClaudeTitle': 'Claude Code（本机）',
    'onboarding.localCliClaudeDesc': '复用宿主机已登录的 Claude Code。',
    'onboarding.localCliClaudeHint': '未检测到，可运行 npm i -g @anthropic-ai/claude-code 安装。',
    'onboarding.localCliCodexTitle': 'Codex（本机）',
    'onboarding.localCliCodexDesc': '复用宿主机已登录的 Codex CLI。',
    'onboarding.localCliCodexHint': '未检测到，可运行 npm i -g @openai/codex 安装。',
    'onboarding.localCliCheckingLabel': '正在检测本机 {{label}} …',
    'onboarding.localCliNotFoundError':
      '未检测到本机 {{label}}。请先安装{{cli}}（{{cmd}}）并完成一次登录。',
    'onboarding.localCliUnavailableError': '本机 {{label}} 不可用',
    'onboarding.localCliConnectedDesc':
      '已检测到本机 {{label}}，可直接复用你已登录的凭证，无需填写 API Key。',
    'onboarding.localCliConnected': '已连接本机 {{label}}。',

    // ── 步骤 3c：第三方 Provider ──────────────────────────────────────────
    'onboarding.providerTitle': '填写你的模型服务信息',
    'onboarding.providerLead': '“密钥”就是模型服务商给你的使用凭证。SparkWork 会把它安全保存在你的电脑里。',
    'onboarding.providerVendorLabel': '服务商',
    'onboarding.providerVendorHint': '已内置接口地址与默认模型',
    'onboarding.providerKeyLabel': '密钥',
    'onboarding.providerGetKey': '获取密钥',
    'onboarding.providerGetKeyTitle': '前往 {{url}} 获取密钥',
    'onboarding.providerKeyPlaceholder': '粘贴 API Key',
    'onboarding.providerKeyHint': '只保存在本机，不会上传到任何服务器',
    'onboarding.providerModelLabel': '模型 ID',
    'onboarding.providerModelHint': '点右侧按钮可从服务商读取可用模型',
    'onboarding.providerModelSelectPlaceholder': '选择模型',
    'onboarding.providerModelPlaceholder': '填写 Model ID',
    'onboarding.providerFetchModelsBtn': '获取模型',
    'onboarding.providerRefetchModelsBtn': '重新获取',
    'onboarding.providerUrlLabel': 'API URL',
    'onboarding.providerUrlPlaceholder': '默认可留空',
    'onboarding.providerUrlHint': '仅在使用自建或代理接口时填写，需兼容 OpenAI 接口格式',
    'onboarding.providerSubmitBtn': '测试并保存',
    'onboarding.providerSubmittingBtn': '正在测试并保存…',
    'onboarding.providerApiKeyRequired': '请粘贴模型服务商提供的密钥。',
    'onboarding.providerDefaultName': '{{name}} · 新手引导',
    'onboarding.providerTesting': '正在发送“你好”测试模型连接…',
    'onboarding.providerTestOk': '测试通过：模型已响应。{{latency}}',
    'onboarding.providerTestLatency': '延迟 {{ms}}ms。',
    'onboarding.providerUnhealthyError': '测试未通过：Provider 返回不健康状态，请返回检查配置。',
    'onboarding.providerTestFailed': '测试失败：{{message}}',
    'onboarding.providerSaved': '模型连接信息已保存。',
    'onboarding.providerSaveFailed': '保存失败：{{message}}',
    'onboarding.fetchModelsNoKey': '获取模型列表需要先填写 API Key。',
    'onboarding.fetchModelsEmpty': '没有获取到可用模型，请检查服务商地址或稍后重试。',
    'onboarding.fetchModelsSuccess': '已获取 {{count}} 个模型，可在模型 ID 中选择。',
    'onboarding.fetchModelsFailed': '获取模型失败：{{message}}',

    // ── 步骤 4：连接测试 ──────────────────────────────────────────────────
    'onboarding.connectionTestTitle': '已用“你好”测试模型',
    'onboarding.connectionTestLead': '下面是本次模型连接测试结果。若失败，可以返回重新选择方案或修改密钥。',
    'onboarding.connectionTestWaiting': '等待测试结果…',
    'onboarding.connectionTestBackBtn': '返回修改模型',

    // ── 步骤 5：第一项任务 ────────────────────────────────────────────────
    'onboarding.firstSessionTitle': '从第一件小事开始。',
    'onboarding.firstSessionMatched': '已为你匹配：{{name}}',
    'onboarding.firstSessionAdjust': '调整助手类型',
    'onboarding.firstSessionLead': '修改下面的内容，开始你的第一项任务。发送成功后将进入工作台。',
    'onboarding.firstSessionPromptAria': '第一项任务',
    'onboarding.firstSessionSkipBtn': '稍后开始，进入工作台',
    'onboarding.firstSessionMoreBtn': '了解更多功能',
    'onboarding.firstSessionSubmitBtn': '开始第一项任务',
    'onboarding.firstSessionSubmittingBtn': '正在发送…',
    'onboarding.firstSessionNoPrompt': '请先输入或选择一句想让助手完成的话。',
    'onboarding.firstSessionNoModel': '没有可用的模型配置，请先完成模型连接。',
    'onboarding.firstSessionCreated': '第一次会话已创建。',
    'onboarding.firstSessionFailed': '发送失败：{{message}}',
    'onboarding.createAgentFailed': '创建助手失败：{{message}}',

    // ── 指南页：工作流 ────────────────────────────────────────────────────
    'onboarding.workflowsGuideTitle': '把多步任务编排成工作流',
    'onboarding.workflowsGuideLead':
      '工作流是一张节点 + 边的 DAG 图：把“先做 A、再做 B、最后做 C”这种多步任务可视化、可复用。适合可重复、可追溯的复杂流程。',
    'onboarding.workflowsGuideItem1Title': '节点 + 边的图编辑器',
    'onboarding.workflowsGuideItem1Desc':
      '节点代表一个步骤（Agent 调用、Skill、工具、条件分支），用边表示执行顺序；中间面板负责调参。',
    'onboarding.workflowsGuideItem2Title': '绑定到 Agent 自动跑',
    'onboarding.workflowsGuideItem2Desc':
      '把工作流绑定到某个助手，Agent 收到匹配任务时会按流程自动跑完所有节点，结果回写到原位置。',
    'onboarding.workflowsGuideItem3Title': '模板、版本与还原点',
    'onboarding.workflowsGuideItem3Desc':
      '可保存为模板复用；如果工作流里的代码步骤跑偏，能结合代码还原点回到上一个稳定状态后继续推进。',
    'onboarding.workflowsGuideBackBtn': '返回第一项任务',
    'onboarding.workflowsGuideNextBtn': '继续了解画布',

    // ── 指南页：画布 ──────────────────────────────────────────────────────
    'onboarding.canvasGuideTitle': '画布是你的多媒体创作工作台',
    'onboarding.canvasGuideLead':
      '画布是按“项目”组织的多媒体创作空间，把剧本、角色、场景、分镜、参考图、提示词和生成结果都摆在一张可平移、可缩放的画布上。它不是聊天窗口的延伸，而是真正动手做东西的地方。',
    'onboarding.canvasGuideItem1Title': '多模态节点 + 创作链路',
    'onboarding.canvasGuideItem1Desc':
      '文本、图片、视频、音频、镜头都能作为节点摆放，节点之间用线串起“先有剧本 → 再做分镜 → 跑图生视频”的创作链路。',
    'onboarding.canvasGuideItem2Title': '按项目组织，不会丢',
    'onboarding.canvasGuideItem2Desc':
      '每个画布对应一个项目，角色设定、首帧、迭代版本都在画布里保留，跨会话也能继续。',
    'onboarding.canvasGuideItem3Title': '生成结果直接回写画布',
    'onboarding.canvasGuideItem3Desc':
      '图片、视频、语音的产出自动落成新节点，AI 操作在画布上跑，过程清楚可见。',
    'onboarding.canvasGuideNextBtn': '继续了解多媒体模型',
    'onboarding.canvasGuideBackBtn': '返回画布',

    // ── 指南页：多媒体 ────────────────────────────────────────────────────
    'onboarding.mediaGuideTitle': '图片、视频、语音也可以进入对话',
    'onboarding.mediaGuideLead':
      '当你配置的服务商支持多媒体模型时，SparkWork 会按模型类型组织能力。你可以在对话里描述要生成的画面，也可以把参考素材带进画布继续加工。',
    'onboarding.mediaGuideItem1Title': '参考素材要说清楚',
    'onboarding.mediaGuideItem1Desc': '例如“用这张图做首帧”“保持角色一致”“生成 16:9 封面”。',
    'onboarding.mediaGuideItem2Title': '生成结果可继续迭代',
    'onboarding.mediaGuideItem2Desc': '把图片或视频结果放回上下文，继续改提示词、做分镜或转成下一步素材。',
    'onboarding.mediaGuideFinishBtn': '完成引导',

    // ── 通用：跳过讲解 ────────────────────────────────────────────────────
    'onboarding.skipGuideBtn': '跳过讲解，进入会话',

    // ── 步骤 6：完成 ──────────────────────────────────────────────────────
    'onboarding.doneTitle': '设置完成！',
    'onboarding.doneLead': '以后你可以直接从左侧新建会话开始使用，也可以继续添加更多模型和助手。',
    'onboarding.doneItem1Title': '运行环境缺失？交给 Agent',
    'onboarding.doneItem1Desc':
      '使用某些能力时可能会提示缺少 Python、Node.js 等运行环境——不必手动折腾，直接让 Agent 帮你安装配置即可，装好就能继续用。',
    'onboarding.doneEnterBtn': '进入会话',

    // ── 助手模板 ──────────────────────────────────────────────────────────
    'onboarding.template.generalTitle': '通用助手',
    'onboarding.template.generalName': '我的通用助手',
    'onboarding.template.generalDesc': '适合日常问答、写作、总结和信息整理。',
    'onboarding.template.generalPrompt':
      '你是一个耐心、清楚、适合非技术用户的 AI 助手。回答时先给结论，再给步骤。避免使用不必要的技术术语；如果必须使用，请用生活化例子解释。',
    'onboarding.template.documentTitle': '文档助手',
    'onboarding.template.documentName': '我的文档助手',
    'onboarding.template.documentDesc': '适合阅读、总结、改写和整理资料。',
    'onboarding.template.documentPrompt':
      '你是一个文档整理助手。帮助用户阅读、总结、提炼重点、改写文本，并用简明标题和清晰条目输出。用户不是技术人员时，避免技术行话。',
    'onboarding.template.workTitle': '工作助理',
    'onboarding.template.workName': '我的工作助理',
    'onboarding.template.workDesc': '适合计划、待办、复盘和工作沟通。',
    'onboarding.template.workPrompt':
      '你是一个可靠的工作助理。帮助用户拆解任务、制定计划、整理待办、起草沟通内容。输出要可执行、简短、清楚。',
    'onboarding.template.developerTitle': '开发助手',
    'onboarding.template.developerName': '我的开发助手',
    'onboarding.template.developerDesc': '适合代码、项目、自动化与工程任务。',
    'onboarding.template.developerPrompt':
      '你是一个严谨的开发助手。帮助用户理解项目、修改代码、解释技术方案。遇到风险时先说明影响，再执行。',

    // ── 用途卡片 / 品牌叙事 / 进度 ────────────────────────────────────────
    'onboarding.useCase.dailyTitle': '写作与表达',
    'onboarding.useCase.dailyDesc': '写文章、润色邮件、整理思路',
    'onboarding.useCase.dailyHeadline1': '让表达，',
    'onboarding.useCase.dailyHeadline2': '更进一步。',
    'onboarding.useCase.dailyCaption': '邮件、文章与灵感，都有一个好的开始。',
    'onboarding.useCase.documentTitle': '资料与文件',
    'onboarding.useCase.documentDesc': '读文档、提炼重点、整理信息',
    'onboarding.useCase.documentHeadline1': '让信息，',
    'onboarding.useCase.documentHeadline2': '清晰起来。',
    'onboarding.useCase.documentCaption': '从繁杂资料中，找到真正重要的内容。',
    'onboarding.useCase.workTitle': '日常工作',
    'onboarding.useCase.workDesc': '做计划、写总结、拆解任务',
    'onboarding.useCase.workHeadline1': '让每天，',
    'onboarding.useCase.workHeadline2': '从容一些。',
    'onboarding.useCase.workCaption': '理清优先级，为重要的事情留出时间。',
    'onboarding.useCase.developerTitle': '代码与创造',
    'onboarding.useCase.developerDesc': '理解项目、开发功能、自动化',
    'onboarding.useCase.developerHeadline1': '让创造，',
    'onboarding.useCase.developerHeadline2': '发生得更快。',
    'onboarding.useCase.developerCaption': '从第一行代码，到下一次突破。',
    'onboarding.bannerTagline': '一点灵感，无限可能',
    'onboarding.progressAria': '新手引导进度',
    'onboarding.progressStep1': '选择用途',
    'onboarding.progressStep2': '连接 AI',
    'onboarding.progressStep3': '开始创作',

    // ── 示例提示词 ────────────────────────────────────────────────────────
    'onboarding.firstPrompt.summary': '帮我写一段简短的工作总结，语气自然、清楚。',
    'onboarding.firstPrompt.cleanup': '请把这段话整理得更清楚，并列出重点。',
    'onboarding.firstPrompt.plan': '帮我规划今天的 3 个重要任务，并给出执行顺序。',
    'onboarding.useCasePrompt.general': '帮我写一封简洁、友好的邮件，同步本周工作进展。',
    'onboarding.useCasePrompt.document': '帮我设计一份阅读笔记模板，包含核心观点、关键证据和待确认的问题。',
    'onboarding.useCasePrompt.work': '帮我制定本周工作计划，按优先级拆解并预留复盘时间。',
    'onboarding.useCasePrompt.developer': '帮我梳理新项目的启动清单，包含目标、技术选型和第一阶段任务。',
  },
  en: {
    // ── 阶段导航 / 通用 ────────────────────────────────────────────────────
    'onboarding.backBtn': 'Back',
    'onboarding.laterBtn': 'Later',
    'onboarding.continueBtn': 'Continue',
    'onboarding.skipStepBtn': 'Skip',
    'onboarding.skipToast': 'Onboarding skipped. Reopen it from Settings.',

    // ── 步骤 1：欢迎 ──────────────────────────────────────────────────────
    'onboarding.welcomeTitle': 'What would you like to do?',
    'onboarding.welcomeLead': 'Pick the scenario closest to you and we will set up a good start.',
    'onboarding.welcomeHint': 'You can try other uses anytime.',

    // ── 步骤 2：模型来源 ──────────────────────────────────────────────────
    'onboarding.modelSourceTitle': 'Choose your AI model',
    'onboarding.modelSourceLead': 'Use your own API key, sign in to Spark, or connect a local tool.',
    'onboarding.modelSourceThirdParty': 'Third-party model',
    'onboarding.modelSourceRecommended': 'Recommended',
    'onboarding.modelSourceThirdPartyDesc': 'Use your existing API key; it stays on this device',
    'onboarding.modelSourceThirdPartyBtn': 'Enter API Key',
    'onboarding.modelSourceSparkAccount': 'Spark account',
    'onboarding.modelSourceSparkAccountDesc': 'Sign in to use; no setup needed',
    'onboarding.modelSourceLocalCli': 'Local AI tools',
    'onboarding.modelSourceLocalCliDesc': 'Connect Claude Code or Codex',
    'onboarding.modelSourceSkipBtn': 'Skip for now',

    // ── 步骤 3a：Spark 账号 ───────────────────────────────────────────────
    'onboarding.sparkAccountTitle': 'Use Spark platform models',
    'onboarding.sparkAccountLead':
      'No API key needed. Platform models work as an optional provider alongside your own.',

    // ── 步骤 3b：本机 CLI ─────────────────────────────────────────────────
    'onboarding.localCliTitle': 'Connect a local AI tool',
    'onboarding.localCliLead':
      'Reuse the Claude Code or Codex already signed in here — no API key needed.',
    'onboarding.localCliDetecting': 'Checking for a local install…',
    'onboarding.localCliCheckingBadge': 'Checking',
    'onboarding.localCliAvailableBadge': 'Available',
    'onboarding.localCliUnavailableBadge': 'Not installed',
    'onboarding.localCliRecheckBtn': 'Re-check',
    'onboarding.localCliFallbackBtn': 'Third-party model',
    'onboarding.localCliClaudeTitle': 'Claude Code (local)',
    'onboarding.localCliClaudeDesc': 'Reuse the Claude Code you already signed in to.',
    'onboarding.localCliClaudeHint': 'Not found. Install with npm i -g @anthropic-ai/claude-code',
    'onboarding.localCliCodexTitle': 'Codex (local)',
    'onboarding.localCliCodexDesc': 'Reuse the Codex CLI you already signed in to.',
    'onboarding.localCliCodexHint': 'Not found. Install with npm i -g @openai/codex',
    'onboarding.localCliCheckingLabel': 'Checking local {{label}}…',
    'onboarding.localCliNotFoundError': 'Local {{label}} not found. Install {{cli}} and sign in once.',
    'onboarding.localCliUnavailableError': 'Local {{label}} unavailable',
    'onboarding.localCliConnectedDesc':
      'Found local {{label}}. Its signed-in credentials are reused; no API key needed.',
    'onboarding.localCliConnected': 'Connected to local {{label}}.',

    // ── 步骤 3c：第三方 Provider ──────────────────────────────────────────
    'onboarding.providerTitle': 'Enter your model provider info',
    'onboarding.providerLead':
      'The API key is your provider credential. SparkWork stores it safely here.',
    'onboarding.providerVendorLabel': 'Provider',
    'onboarding.providerVendorHint': 'Endpoint and default model included',
    'onboarding.providerKeyLabel': 'API key',
    'onboarding.providerGetKey': 'Get key',
    'onboarding.providerGetKeyTitle': 'Get key at {{url}}',
    'onboarding.providerKeyPlaceholder': 'Paste API key',
    'onboarding.providerKeyHint': 'Stored locally, never uploaded',
    'onboarding.providerModelLabel': 'Model ID',
    'onboarding.providerModelHint': 'Fetch available models from the provider',
    'onboarding.providerModelSelectPlaceholder': 'Select model',
    'onboarding.providerModelPlaceholder': 'Enter model ID',
    'onboarding.providerFetchModelsBtn': 'Fetch models',
    'onboarding.providerRefetchModelsBtn': 'Refetch',
    'onboarding.providerUrlLabel': 'API URL',
    'onboarding.providerUrlPlaceholder': 'Optional',
    'onboarding.providerUrlHint': 'Only for self-hosted or proxy endpoints, OpenAI-compatible',
    'onboarding.providerSubmitBtn': 'Test & save',
    'onboarding.providerSubmittingBtn': 'Testing & saving…',
    'onboarding.providerApiKeyRequired': 'Paste the API key from your provider.',
    'onboarding.providerDefaultName': '{{name}} · Onboarding',
    'onboarding.providerTesting': 'Sending "hello" to test the connection…',
    'onboarding.providerTestOk': 'Test passed: model responded. {{latency}}',
    'onboarding.providerTestLatency': 'Latency {{ms}}ms.',
    'onboarding.providerUnhealthyError': 'Test failed: provider is unhealthy. Check the config.',
    'onboarding.providerTestFailed': 'Test failed: {{message}}',
    'onboarding.providerSaved': 'Model connection saved.',
    'onboarding.providerSaveFailed': 'Save failed: {{message}}',
    'onboarding.fetchModelsNoKey': 'Enter an API key first.',
    'onboarding.fetchModelsEmpty': 'No models found. Check the endpoint or retry.',
    'onboarding.fetchModelsSuccess': 'Fetched {{count}} models; pick one as the model ID.',
    'onboarding.fetchModelsFailed': 'Failed to fetch models: {{message}}',

    // ── 步骤 4：连接测试 ──────────────────────────────────────────────────
    'onboarding.connectionTestTitle': 'Model tested with "hello"',
    'onboarding.connectionTestLead':
      'Here is the connection test result. If it failed, go back to change the setup or key.',
    'onboarding.connectionTestWaiting': 'Waiting for test result…',
    'onboarding.connectionTestBackBtn': 'Back to model',

    // ── 步骤 5：第一项任务 ────────────────────────────────────────────────
    'onboarding.firstSessionTitle': 'Start with one small task',
    'onboarding.firstSessionMatched': 'Matched: {{name}}',
    'onboarding.firstSessionAdjust': 'Adjust assistant type',
    'onboarding.firstSessionLead': 'Edit the text below to start your first task, then enter the workspace.',
    'onboarding.firstSessionPromptAria': 'First task',
    'onboarding.firstSessionSkipBtn': 'Skip to workspace',
    'onboarding.firstSessionMoreBtn': 'Explore features',
    'onboarding.firstSessionSubmitBtn': 'Start first task',
    'onboarding.firstSessionSubmittingBtn': 'Sending…',
    'onboarding.firstSessionNoPrompt': 'Enter or pick a message for the assistant.',
    'onboarding.firstSessionNoModel': 'No model configured. Set up a model first.',
    'onboarding.firstSessionCreated': 'First session created.',
    'onboarding.firstSessionFailed': 'Send failed: {{message}}',
    'onboarding.createAgentFailed': 'Failed to create assistant: {{message}}',

    // ── 指南页：工作流 ────────────────────────────────────────────────────
    'onboarding.workflowsGuideTitle': 'Build workflows from tasks',
    'onboarding.workflowsGuideLead':
      'A workflow is a DAG of nodes and edges: turn "do A, then B" into something reusable.',
    'onboarding.workflowsGuideItem1Title': 'Node and edge editor',
    'onboarding.workflowsGuideItem1Desc':
      'Nodes are steps (agent calls, skills, tools, branches); edges set the order.',
    'onboarding.workflowsGuideItem2Title': 'Runs automatically via agents',
    'onboarding.workflowsGuideItem2Desc':
      'Bind a workflow to an assistant; it runs every node and writes results back.',
    'onboarding.workflowsGuideItem3Title': 'Templates and restore points',
    'onboarding.workflowsGuideItem3Desc':
      'Save as templates; use code checkpoints to return to a stable state and carry on.',
    'onboarding.workflowsGuideBackBtn': 'Back to first task',
    'onboarding.workflowsGuideNextBtn': 'Next: canvas',

    // ── 指南页：画布 ──────────────────────────────────────────────────────
    'onboarding.canvasGuideTitle': 'Canvas is your media workspace',
    'onboarding.canvasGuideLead':
      'Canvas lays out scripts, characters, scenes and results on one pan-and-zoom board.',
    'onboarding.canvasGuideItem1Title': 'Multimodal nodes + chains',
    'onboarding.canvasGuideItem1Desc':
      'Text, image, video and audio become nodes, linked into a script-to-video chain.',
    'onboarding.canvasGuideItem2Title': 'Organized by project',
    'onboarding.canvasGuideItem2Desc':
      'Each canvas is a project; characters, first frames and versions persist across sessions.',
    'onboarding.canvasGuideItem3Title': 'Results write back to canvas',
    'onboarding.canvasGuideItem3Desc':
      'Images, video and audio become new nodes, with AI work visible on the canvas.',
    'onboarding.canvasGuideNextBtn': 'Next: media models',
    'onboarding.canvasGuideBackBtn': 'Back to canvas',

    // ── 指南页：多媒体 ────────────────────────────────────────────────────
    'onboarding.mediaGuideTitle': 'Images, video and audio in chat',
    'onboarding.mediaGuideLead':
      'When your provider supports media models, SparkWork organizes them by type.',
    'onboarding.mediaGuideItem1Title': 'Describe your references',
    'onboarding.mediaGuideItem1Desc':
      'For example "use this as the first frame", "keep the character", "16:9 cover".',
    'onboarding.mediaGuideItem2Title': 'Iterate on results',
    'onboarding.mediaGuideItem2Desc':
      'Put image or video results back in context to refine prompts or build storyboards.',
    'onboarding.mediaGuideFinishBtn': 'Finish',

    // ── 通用：跳过讲解 ────────────────────────────────────────────────────
    'onboarding.skipGuideBtn': 'Skip to chat',

    // ── 步骤 6：完成 ──────────────────────────────────────────────────────
    'onboarding.doneTitle': 'All set!',
    'onboarding.doneLead': 'Start a new session from the left sidebar, or add more models and assistants.',
    'onboarding.doneItem1Title': 'Missing runtime? Ask the agent',
    'onboarding.doneItem1Desc':
      'Some features need Python or Node.js. Let the agent install and configure them for you.',
    'onboarding.doneEnterBtn': 'Open chat',

    // ── 助手模板 ──────────────────────────────────────────────────────────
    'onboarding.template.generalTitle': 'General assistant',
    'onboarding.template.generalName': 'My general assistant',
    'onboarding.template.generalDesc': 'Good for Q&A, writing, and summaries.',
    'onboarding.template.generalPrompt':
      'You are a patient, clear assistant for non-technical users. Give the conclusion first, then steps. Avoid jargon; explain with everyday examples.',
    'onboarding.template.documentTitle': 'Doc assistant',
    'onboarding.template.documentName': 'My doc assistant',
    'onboarding.template.documentDesc': 'Good for reading, summarizing and rewriting.',
    'onboarding.template.documentPrompt':
      'You are a document assistant. Help users read, summarize, highlight key points and rewrite, using clear headings and bullets. Avoid jargon for non-technical users.',
    'onboarding.template.workTitle': 'Work assistant',
    'onboarding.template.workName': 'My work assistant',
    'onboarding.template.workDesc': 'Good for planning, todos and work updates.',
    'onboarding.template.workPrompt':
      'You are a reliable work assistant. Help users break down tasks, plan, organize todos and draft messages. Keep output actionable and concise.',
    'onboarding.template.developerTitle': 'Dev assistant',
    'onboarding.template.developerName': 'My dev assistant',
    'onboarding.template.developerDesc': 'Good for code, projects and automation.',
    'onboarding.template.developerPrompt':
      'You are a rigorous development assistant. Help users understand projects, change code and explain designs. State the impact before acting on any risk.',

    // ── 用途卡片 / 品牌叙事 / 进度 ────────────────────────────────────────
    'onboarding.useCase.dailyTitle': 'Writing & expression',
    'onboarding.useCase.dailyDesc': 'Draft, polish emails, organize ideas',
    'onboarding.useCase.dailyHeadline1': 'Take expression',
    'onboarding.useCase.dailyHeadline2': 'further.',
    'onboarding.useCase.dailyCaption': 'A good start for emails, articles and ideas.',
    'onboarding.useCase.documentTitle': 'Docs & files',
    'onboarding.useCase.documentDesc': 'Read, extract and organize info',
    'onboarding.useCase.documentHeadline1': 'Make info',
    'onboarding.useCase.documentHeadline2': 'clear.',
    'onboarding.useCase.documentCaption': 'Find what really matters in messy material.',
    'onboarding.useCase.workTitle': 'Daily work',
    'onboarding.useCase.workDesc': 'Plan, summarize and break down tasks',
    'onboarding.useCase.workHeadline1': 'Make every',
    'onboarding.useCase.workHeadline2': 'day calmer.',
    'onboarding.useCase.workCaption': 'Set priorities and time for what matters.',
    'onboarding.useCase.developerTitle': 'Code & creation',
    'onboarding.useCase.developerDesc': 'Understand, build and automate',
    'onboarding.useCase.developerHeadline1': 'Create',
    'onboarding.useCase.developerHeadline2': 'faster.',
    'onboarding.useCase.developerCaption': 'From the first line to the next breakthrough.',
    'onboarding.bannerTagline': 'A spark of ideas',
    'onboarding.progressAria': 'Onboarding progress',
    'onboarding.progressStep1': 'Choose a use',
    'onboarding.progressStep2': 'Connect AI',
    'onboarding.progressStep3': 'Start creating',

    // ── 示例提示词 ────────────────────────────────────────────────────────
    'onboarding.firstPrompt.summary': 'Write a short, clear work summary.',
    'onboarding.firstPrompt.cleanup': 'Clean this text up and list the key points.',
    'onboarding.firstPrompt.plan': 'Plan my 3 key tasks today, in order.',
    'onboarding.useCasePrompt.general': 'Draft a short, friendly weekly update email.',
    'onboarding.useCasePrompt.document': 'Design a reading-note template with key points.',
    'onboarding.useCasePrompt.work': 'Plan this week by priority, with review time.',
    'onboarding.useCasePrompt.developer': 'Draft a new-project kickoff checklist.',
  },
} as const
