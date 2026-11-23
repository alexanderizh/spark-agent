const SESSION_SCHEDULE_MUTABLE_PROPERTIES = {
  name: { type: 'string', minLength: 1, maxLength: 200, description: '任务名称' },
  description: { type: 'string', maxLength: 2000, description: '可选说明' },
  enabled: { type: 'boolean', description: '是否启用' },
  triggerType: {
    type: 'string',
    enum: ['interval', 'cron', 'once'],
    description: '触发方式：固定间隔、Cron 或单次',
  },
  intervalSeconds: {
    anyOf: [{ type: 'integer', minimum: 10, maximum: 31536000 }, { type: 'null' }],
    description: '固定间隔秒数，最少 10 秒',
  },
  cronExpression: {
    anyOf: [{ type: 'string', minLength: 1, maxLength: 200 }, { type: 'null' }],
    description: 'Cron 表达式',
  },
  runAt: {
    anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }],
    description: '单次执行时间（ISO 8601）',
  },
  timezone: {
    type: 'string',
    minLength: 1,
    maxLength: 100,
    description: '时区，默认 system',
  },
  startAt: {
    anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }],
    description: '可选开始时间（ISO 8601）',
  },
  endAt: {
    anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }],
    description: '可选结束时间（ISO 8601）',
  },
  maxExecutions: {
    type: 'integer',
    minimum: 0,
    maximum: 1000000,
    description: '最大执行次数；0 表示不限',
  },
  promptTemplate: {
    type: 'string',
    minLength: 1,
    maxLength: 100000,
    description: '唤醒时发送给当前会话的完整任务指令；应包含检查目标、完成条件和清理要求',
  },
  timeoutSeconds: { type: 'integer', minimum: 10, maximum: 86400, description: '单次执行超时秒数' },
  maxRetries: { type: 'integer', minimum: 0, maximum: 100, description: '失败重试次数' },
  retryDelaySeconds: {
    type: 'integer',
    minimum: 0,
    maximum: 86400,
    description: '重试初始延迟秒数',
  },
  retryBackoff: {
    type: 'string',
    enum: ['fixed', 'linear', 'exponential'],
    description: '重试退避策略',
  },
  concurrencyPolicy: {
    type: 'string',
    enum: ['skip', 'queue', 'cancel'],
    description: '上次执行仍在运行时的策略；默认 queue',
  },
  tags: {
    type: 'array',
    maxItems: 50,
    items: { type: 'string', minLength: 1, maxLength: 80 },
    description: '标签',
  },
  historyRetentionDays: {
    type: 'integer',
    minimum: 1,
    maximum: 3650,
    description: '执行记录保留天数',
  },
}

const SHARED_SCHEDULE_PROPERTIES = { ...SESSION_SCHEDULE_MUTABLE_PROPERTIES }
delete SHARED_SCHEDULE_PROPERTIES.skipIfSessionRunning
delete SHARED_SCHEDULE_PROPERTIES.continueOnError
const APPLICATION_SCHEDULE_PROPERTIES = {
  ...SHARED_SCHEDULE_PROPERTIES,
  concurrencyPolicy: {
    ...SHARED_SCHEDULE_PROPERTIES.concurrencyPolicy,
    description: '并发策略，默认 skip',
  },
  ...Object.fromEntries(
    ['agentId', 'teamId', 'modelId', 'workspaceId'].map((key) => [
      key,
      { anyOf: [{ type: 'string', minLength: 1, maxLength: 200 }, { type: 'null' }] },
    ]),
  ),
}
const SCHEDULE_ID_PROPERTY = {
  type: 'string',
  minLength: 1,
  maxLength: 200,
  description: '从列表或创建回执取得的任务 ID',
}
const SCHEDULE_PAGE_PROPERTIES = {
  page: { type: 'integer', minimum: 1, maximum: 100000, default: 1 },
  pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
}
const SCHEDULE_EXECUTION_PROPERTIES = {
  ...SCHEDULE_PAGE_PROPERTIES,
  status: { type: 'string', enum: ['running', 'completed', 'failed', 'cancelled', 'timeout'] },
}
function scheduleSchema(properties = {}, required = []) {
  return { type: 'object', properties, required, additionalProperties: false }
}

const IMPORT_PROPERTIES = {
  payload: {
    type: 'object',
    required: ['version', 'exportedAt', 'exportedBy', 'tasks'],
    properties: {
      version: { type: 'integer', enum: [1] },
      exportedAt: { type: 'string' },
      exportedBy: { type: 'string', enum: ['spark-agent'] },
      tasks: { type: 'array', maxItems: 500, items: { type: 'object' } },
    },
  },
  mode: { type: 'string', enum: ['merge', 'replace'], default: 'merge' },
}
const WORKSPACE = {
  workspaceId: {
    ...SCHEDULE_ID_PROPERTY,
    description: '工作区 ID，可用 application_schedule_options 查询。缺省使用当前会话所属工作区。',
  },
}
const TARGET = { ...WORKSPACE, targetId: SCHEDULE_ID_PROPERTY }
const TARGET_TASK = { ...TARGET, id: SCHEDULE_ID_PROPERTY }
const SESSION_CREATE_SCHEMA = scheduleSchema(SESSION_SCHEDULE_MUTABLE_PROPERTIES, [
  'name',
  'triggerType',
  'promptTemplate',
])
const SESSION_LIST_PROPERTIES = {
  ...WORKSPACE,
  query: { type: 'string', maxLength: 200, description: '会话标题筛选' },
  offset: { type: 'integer', minimum: 0, maximum: 100000 },
  pageSize: { type: 'integer', minimum: 1, maximum: 50 },
}

export const SCHEDULE_METHOD_DEFINITIONS = [
  {
    name: 'application_schedule_export',
    description: '导出指定应用级任务的 JSON。导出不含通知地址、凭据或自定义权限设置。',
    inputSchema: scheduleSchema(
      { ids: { type: 'array', minItems: 1, maxItems: 100, items: SCHEDULE_ID_PROPERTY } },
      ['ids'],
    ),
  },
  {
    name: 'application_schedule_import_preview',
    description: '预览应用级 JSON 导入，返回新建项和同名冲突项。无需写入。',
    inputSchema: scheduleSchema(IMPORT_PROPERTIES, ['payload']),
  },
  {
    name: 'application_schedule_import',
    description: '导入已预览的应用级任务 JSON，默认跳过同名项。replace 模式覆盖前经应用内确认。',
    inputSchema: scheduleSchema(IMPORT_PROPERTIES, ['payload']),
  },
  {
    name: 'application_schedule_options',
    description: '列出应用级定时任务可选的 Agent、团队、模型与工作区。按实际名称选择 ID。',
    inputSchema: scheduleSchema(),
  },
  {
    name: 'application_schedule_list',
    description: '查询左侧「定时任务」中的应用级定时任务。可按名称、说明、启停状态或标签筛选。',
    inputSchema: scheduleSchema({
      ...SCHEDULE_PAGE_PROPERTIES,
      query: { type: 'string', maxLength: 200 },
      enabled: { type: 'boolean' },
      status: { type: 'string', enum: ['idle', 'running', 'disabled', 'error'] },
      tags: APPLICATION_SCHEDULE_PROPERTIES.tags,
    }),
  },
  {
    name: 'application_schedule_get',
    description: '读取应用级定时任务的配置、启用状态、下次执行时间和最近结果。',
    inputSchema: scheduleSchema({ id: SCHEDULE_ID_PROPERTY }, ['id']),
  },
  {
    name: 'application_schedule_create',
    description:
      '在左侧「定时任务」创建应用级任务。用明确时间和自包含提示词配置。可指定 Agent 或团队，以及模型、工作区；未指定时使用平台默认配置。',
    inputSchema: scheduleSchema(APPLICATION_SCHEDULE_PROPERTIES, [
      'name',
      'triggerType',
      'promptTemplate',
    ]),
  },
  {
    name: 'application_schedule_update',
    description: '局部修改应用级定时任务。用 enabled 暂停或恢复。未传字段保持原值。',
    inputSchema: scheduleSchema({ id: SCHEDULE_ID_PROPERTY, ...APPLICATION_SCHEDULE_PROPERTIES }, [
      'id',
    ]),
  },
  {
    name: 'application_schedule_delete',
    description:
      '删除应用级任务及其执行历史。先读取详情，传详情返回的 version 作为 expectedVersion，再由用户在应用内确认。',
    inputSchema: scheduleSchema(
      {
        id: SCHEDULE_ID_PROPERTY,
        expectedVersion: { type: 'string', minLength: 64, maxLength: 64 },
      },
      ['id', 'expectedVersion'],
    ),
  },
  {
    name: 'application_schedule_run_now',
    description: '按用户明确请求立即触发应用级任务。返回执行记录，启动与完成状态分别判断。',
    inputSchema: scheduleSchema({ id: SCHEDULE_ID_PROPERTY }, ['id']),
  },
  {
    name: 'application_schedule_executions',
    description: '分页查看应用级任务的执行历史，可按完成或失败等状态筛选。',
    inputSchema: scheduleSchema({ id: SCHEDULE_ID_PROPERTY, ...SCHEDULE_EXECUTION_PROPERTIES }, [
      'id',
    ]),
  },
  {
    name: 'application_schedule_execution_get',
    description: '查看应用级定时任务的单次执行结果或失败详情。',
    inputSchema: scheduleSchema({ id: SCHEDULE_ID_PROPERTY, executionId: SCHEDULE_ID_PROPERTY }, [
      'id',
      'executionId',
    ]),
  },
  {
    name: 'application_schedule_stats',
    description: '查看应用级定时任务的执行统计。',
    inputSchema: scheduleSchema({ id: SCHEDULE_ID_PROPERTY }, ['id']),
  },
  {
    name: 'session_schedule_run_now',
    description: '按用户明确请求立即执行当前会话的一项计划任务。回执不保证会话轮次已完成。',
    inputSchema: scheduleSchema({ id: SCHEDULE_ID_PROPERTY }, ['id']),
  },
  {
    name: 'session_schedule_executions',
    description: '分页查看当前会话的一项计划任务的执行记录。',
    inputSchema: scheduleSchema({ id: SCHEDULE_ID_PROPERTY, ...SCHEDULE_EXECUTION_PROPERTIES }, [
      'id',
    ]),
  },

  // ── Current-session Scheduled Tasks ──
  {
    name: 'session_schedule_list',
    description: '列出当前会话挂载的全部定时任务。创建轮询任务前先调用，避免重复创建。',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'session_schedule_get',
    description: '读取当前会话中的一个定时任务。只能访问当前会话。',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', minLength: 1, maxLength: 200, description: '任务 ID' },
      },
    },
  },
  {
    name: 'session_schedule_create',
    description:
      '在当前会话创建持久化定时唤醒任务。任务会跟随会话当前 Agent、模型、权限与工作区配置；完成目标后必须删除。',
    inputSchema: {
      type: 'object',
      required: ['name', 'triggerType', 'promptTemplate'],
      properties: SESSION_SCHEDULE_MUTABLE_PROPERTIES,
    },
  },
  {
    name: 'session_schedule_update',
    description: '修改当前会话中的定时任务，包括调度频率、唤醒指令和启停状态。',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', description: '任务 ID' },
        ...SESSION_SCHEDULE_MUTABLE_PROPERTIES,
      },
    },
  },
  {
    name: 'session_schedule_delete',
    description: '删除当前会话中的定时任务。轮询目标完成、取消、永久阻塞或不再需要时应立即调用。',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', description: '任务 ID' },
      },
    },
  },

  {
    name: 'project_schedule_list_sessions',
    description:
      '按标题查找当前或选定工作区内可管理计划任务的活跃本地会话。重名时让用户选择；不要询问会话 ID。',
    inputSchema: scheduleSchema(SESSION_LIST_PROPERTIES),
  },
  {
    name: 'project_schedule_list',
    description: '分页查询当前或选定工作区各个会话的计划任务。本次查询经用户在应用内授权后执行。',
    inputSchema: scheduleSchema(SESSION_LIST_PROPERTIES),
  },
  {
    name: 'project_schedule_list_target',
    description: '查看指定已有会话的计划任务。targetId 取自 project_schedule_list_sessions。',
    inputSchema: scheduleSchema(TARGET, ['targetId']),
  },
  {
    name: 'project_schedule_create',
    description: '给已有目标会话添加计划任务，复用该会话运行配置。通过应用内授权后写入。',
    inputSchema: scheduleSchema({ ...TARGET, schedule: SESSION_CREATE_SCHEMA }, [
      'targetId',
      'schedule',
    ]),
  },
  {
    name: 'project_schedule_update',
    description: '局部修改已有目标会话的计划任务。patch.enabled 可暂停或恢复。',
    inputSchema: scheduleSchema(
      { ...TARGET_TASK, patch: scheduleSchema(SESSION_SCHEDULE_MUTABLE_PROPERTIES) },
      ['targetId', 'id', 'patch'],
    ),
  },
  {
    name: 'project_schedule_delete',
    description: '删除其他会话的计划任务及其执行历史，调用后由用户在应用内确认。',
    inputSchema: scheduleSchema(TARGET_TASK, ['targetId', 'id']),
  },
  {
    name: 'project_schedule_run_now',
    description: '按用户请求在目标会话立即触发计划任务。回执反映执行记录，轮次可在后台继续。',
    inputSchema: scheduleSchema(TARGET_TASK, ['targetId', 'id']),
  },
  {
    name: 'project_schedule_executions',
    description: '按页查看目标会话计划任务的执行历史。',
    inputSchema: scheduleSchema(
      {
        ...TARGET_TASK,
        ...SCHEDULE_EXECUTION_PROPERTIES,
        pageSize: SESSION_LIST_PROPERTIES.pageSize,
      },
      ['targetId', 'id'],
    ),
  },
  {
    name: 'project_schedule_new_session',
    description:
      '仅当用户明确要求新建会话并设置计划任务时调用。创建空白会话并挂任务，同一次操作重试沿用相同 requestKey、标题和计划配置。',
    inputSchema: scheduleSchema(
      {
        ...WORKSPACE,
        requestKey: { type: 'string', minLength: 1, maxLength: 200 },
        title: { type: 'string', minLength: 1, maxLength: 120 },
        schedule: SESSION_CREATE_SCHEMA,
      },
      ['requestKey', 'title', 'schedule'],
    ),
  },
]

export const SCHEDULE_METHOD_MAP = {
  application_schedule_export: 'application_schedule.export',
  application_schedule_import_preview: 'application_schedule.import_preview',
  application_schedule_import: 'application_schedule.import',
  application_schedule_options: 'application_schedule.options',
  application_schedule_list: 'application_schedule.list',
  application_schedule_get: 'application_schedule.get',
  application_schedule_create: 'application_schedule.create',
  application_schedule_update: 'application_schedule.update',
  application_schedule_delete: 'application_schedule.delete',
  application_schedule_run_now: 'application_schedule.run_now',
  application_schedule_executions: 'application_schedule.executions',
  application_schedule_execution_get: 'application_schedule.execution_get',
  application_schedule_stats: 'application_schedule.stats',
  session_schedule_run_now: 'session_schedule.run_now',
  session_schedule_executions: 'session_schedule.executions',
  session_schedule_list: 'session_schedule.list',
  session_schedule_get: 'session_schedule.get',
  session_schedule_create: 'session_schedule.create',
  session_schedule_update: 'session_schedule.update',
  session_schedule_delete: 'session_schedule.delete',
  project_schedule_list_sessions: 'project_schedule.list_sessions',
  project_schedule_list: 'project_schedule.list',
  project_schedule_list_target: 'project_schedule.list_target',
  project_schedule_create: 'project_schedule.create',
  project_schedule_update: 'project_schedule.update',
  project_schedule_delete: 'project_schedule.delete',
  project_schedule_run_now: 'project_schedule.run_now',
  project_schedule_executions: 'project_schedule.executions',
  project_schedule_new_session: 'project_schedule.new_session',
}
