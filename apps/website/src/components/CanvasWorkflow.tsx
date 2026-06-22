const steps = [
  '导入剧本',
  'AI 拆分场景',
  '生成角色卡',
  '规划镜头表',
  '生成分镜',
  '输出视频草案',
  '资产沉淀',
]
export function CanvasWorkflow() {
  return (
    <div className="workflow">
      {steps.map((step, i) => (
        <div className="workflow-step" key={step}>
          <span>{i + 1}</span>
          <strong>{step}</strong>
          <p>{i === 0 ? '从一个想法开始' : '保留上下文、来源和派生关系'}</p>
        </div>
      ))}
    </div>
  )
}
