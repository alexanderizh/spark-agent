const steps = [
  ['需求 / 代码任务', '侧边聊天描述目标，选择项目、模型、内核和 worktree。'],
  ['调试 / 执行', '内置终端、Debug 模式、浏览器自动化和任务面板持续反馈。'],
  ['审查 / 还原', 'Git Review、HunkDiff、Checkpoint 让每一步都能复盘。'],
  ['团队协作', 'Host 调度 Member Agent，按能力拆分实现、审查和验证。'],
  ['画布策划', '将剧本、角色、场景、Prompt 和参考素材组织成节点。'],
  ['AI 操作节点', '文生图、图生图、图生视频、语音等任务自动回写画布。'],
  ['资产沉淀', '产物进入资产中心，保留血缘并支持继续派生。'],
]
export function CanvasWorkflow() {
  return (
    <div className="workflow">
      {steps.map(([step, detail], i) => (
        <div className="workflow-step" key={step}>
          <span>{i + 1}</span>
          <strong>{step}</strong>
          <p>{detail}</p>
        </div>
      ))}
    </div>
  )
}
