const steps = [
  ['提出目标', '在侧边对话里描述要修复的问题、要完成的内容或要生成的素材。'],
  ['执行与验证', 'Agent 可以读取项目、运行命令、操作浏览器，并把过程反馈到任务面板。'],
  ['审查与回退', '每次自动改动都可以逐块检查，关键节点也能保存为可回退状态。'],
  ['团队协作', '主 Agent 按能力分派成员 Agent，分别完成实现、审查、调研和验证。'],
  ['画布策划', '把剧本、角色、场景、Prompt 和参考素材组织成可追踪节点。'],
  ['生成任务', '图片、视频、语音等 AI 任务以节点方式执行，并自动回写结果。'],
  ['资产沉淀', '产物进入资产中心，保留来源关系，方便继续派生和复用。'],
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
