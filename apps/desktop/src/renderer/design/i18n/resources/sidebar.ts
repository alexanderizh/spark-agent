/**
 * sidebar 模块翻译资源
 *
 * 覆盖：画布项目侧栏（CanvasProjectSidebarList）、侧栏会话列表（SidebarSessionList）、
 * 会话侧栏上下文（SessionSidebarContext）、记忆待确认角标（MemoryPendingBadge）。
 *
 * key 前缀：`canvasSidebar.*` / `sessionList.*` / `sessionSidebar.*` / `memory.*`
 */
export const SIDEBAR_RESOURCE = {
  zh: {
    // ── 画布项目侧栏 ──────────────────────────────────────────────────────
    'canvasSidebar.open': '打开',
    'canvasSidebar.edit': '编辑',
    'canvasSidebar.pin': '置顶',
    'canvasSidebar.unpin': '取消置顶',
    'canvasSidebar.openFolder': '打开文件夹',
    'canvasSidebar.export': '导出',
    'canvasSidebar.archive': '归档',
    'canvasSidebar.restore': '恢复',
    'canvasSidebar.pinFailed': '更新项目置顶状态失败',
    'canvasSidebar.archiveFailed': '更新项目归档状态失败',
    'canvasSidebar.openFolderFailed': '打开项目文件夹失败',
    'canvasSidebar.exported': 'Canvas 项目包已导出',
    'canvasSidebar.exportFailed': '导出 Canvas 项目失败',
    'canvasSidebar.deleteTitle': '删除 Canvas 项目？',
    'canvasSidebar.deleteDesc': '项目会被标记为删除。',
    'canvasSidebar.deleteFailed': '删除 Canvas 项目失败',
    'canvasSidebar.nodeCount': '{{count}} 节点',
    'canvasSidebar.taskCount': '{{count}} 任务',

    // ── 侧栏会话列表 ──────────────────────────────────────────────────────
    'sessionList.terminalRunningTitle': '终端运行中 ({{count}})，点击打开终端',
    'sessionList.terminalRunningAria': '终端运行中 ({{count}})，打开终端面板',
    'sessionList.dateAria': '会话日期 {{date}}',
    'sessionList.planTasks': '计划任务',
    'sessionList.copySession': '复制会话',
    'sessionList.addToChat': '添加到对话',
    'sessionList.copyPath': '复制路径',
    'sessionList.pathCopied': '已复制路径',
    'sessionList.copyFailed': '复制失败',
    'sessionList.newTempSession': '新建临时会话',
    'sessionList.tempSessionActions': '临时会话操作',
    'sessionList.openTempFolder': '打开临时目录',
    'sessionList.openChatFirst': '请先打开一个对话',
    'sessionList.composerUnavailable': '当前对话输入区不可用',

    // ── 会话侧栏上下文 ────────────────────────────────────────────────────
    'sessionSidebar.copyRunning': '源会话仍在运行；副本只复制到最近一个已完成轮次。',
    'sessionSidebar.copyWorkflowMissing':
      '源会话挂载的工作流已不存在；副本保留该配置用于解释历史，首次执行时会明确失败。',
    'sessionSidebar.copyWorkflowDisabled':
      '源会话挂载的工作流已停用；副本保留该配置用于解释历史，首次执行时会明确失败。',
    'sessionSidebar.copyWorkflowInactive':
      '源会话挂载的工作流不在活跃状态；副本保留该配置用于解释历史，首次执行时会明确失败。',
    'sessionSidebar.copyFailed': '复制会话失败',
    'sessionSidebar.dropAddFailed': '拖拽添加项目失败',

    // ── 记忆待确认角标 ────────────────────────────────────────────────────
    'memory.pendingBadgeAria': '{{count}} 条记忆候选待确认',
  },
  en: {
    // ── 画布项目侧栏 ──────────────────────────────────────────────────────
    'canvasSidebar.open': 'Open',
    'canvasSidebar.edit': 'Edit',
    'canvasSidebar.pin': 'Pin',
    'canvasSidebar.unpin': 'Unpin',
    'canvasSidebar.openFolder': 'Open folder',
    'canvasSidebar.export': 'Export',
    'canvasSidebar.archive': 'Archive',
    'canvasSidebar.restore': 'Restore',
    'canvasSidebar.pinFailed': 'Failed to pin project',
    'canvasSidebar.archiveFailed': 'Failed to archive project',
    'canvasSidebar.openFolderFailed': 'Failed to open project folder',
    'canvasSidebar.exported': 'Canvas package exported',
    'canvasSidebar.exportFailed': 'Failed to export canvas project',
    'canvasSidebar.deleteTitle': 'Delete canvas project?',
    'canvasSidebar.deleteDesc': 'The project will be marked as deleted.',
    'canvasSidebar.deleteFailed': 'Failed to delete canvas project',
    'canvasSidebar.nodeCount': '{{count}} nodes',
    'canvasSidebar.taskCount': '{{count}} tasks',

    // ── 侧栏会话列表 ──────────────────────────────────────────────────────
    'sessionList.terminalRunningTitle': 'Terminal running ({{count}}), open',
    'sessionList.terminalRunningAria': 'Terminal running ({{count}}), open panel',
    'sessionList.dateAria': 'Session date {{date}}',
    'sessionList.planTasks': 'Scheduled tasks',
    'sessionList.copySession': 'Duplicate session',
    'sessionList.addToChat': 'Add to chat',
    'sessionList.copyPath': 'Copy path',
    'sessionList.pathCopied': 'Path copied',
    'sessionList.copyFailed': 'Copy failed',
    'sessionList.newTempSession': 'New temporary session',
    'sessionList.tempSessionActions': 'Temporary session actions',
    'sessionList.openTempFolder': 'Open temp folder',
    'sessionList.openChatFirst': 'Open a chat first',
    'sessionList.composerUnavailable': 'Composer unavailable',

    // ── 会话侧栏上下文 ────────────────────────────────────────────────────
    'sessionSidebar.copyRunning': 'Source still running; copied to last turn',
    'sessionSidebar.copyWorkflowMissing': 'Source workflow missing; kept for history',
    'sessionSidebar.copyWorkflowDisabled': 'Source workflow disabled; kept for history',
    'sessionSidebar.copyWorkflowInactive': 'Source workflow inactive; kept for history',
    'sessionSidebar.copyFailed': 'Failed to duplicate session',
    'sessionSidebar.dropAddFailed': 'Failed to add dropped project',

    // ── 记忆待确认角标 ────────────────────────────────────────────────────
    'memory.pendingBadgeAria': '{{count}} memory candidates pending',
  },
} as const
