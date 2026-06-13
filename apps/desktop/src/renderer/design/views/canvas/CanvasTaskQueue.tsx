import { Button, Progress, Tag } from '@arco-design/web-react'
import { operationLabel } from './canvas.api'
import type { CanvasTask } from './canvas.types'

export function CanvasTaskQueue({
  tasks,
  onCompleteDemoTask,
}: {
  tasks: CanvasTask[]
  onCompleteDemoTask: (taskId: string) => void
}) {
  const running = tasks.filter(
    (task) => task.status === 'pending' || task.status === 'running',
  ).length
  const failed = tasks.filter((task) => task.status === 'failed').length
  const completed = tasks.filter((task) => task.status === 'completed').length

  return (
    <div className="canvas-task-queue">
      <div className="canvas-task-summary">
        <span>任务队列</span>
        <Tag size="small" color="arcoblue">
          运行 {running}
        </Tag>
        <Tag size="small" color="red">
          失败 {failed}
        </Tag>
        <Tag size="small" color="green">
          完成 {completed}
        </Tag>
      </div>
      <div className="canvas-task-list">
        {tasks.slice(0, 4).map((task) => (
          <div key={task.id} className="canvas-task-pill">
            <span className="canvas-task-pill-title">
              {task.title ?? operationLabel(task.operation)}
            </span>
            <Progress percent={task.progress} size="small" showText={false} />
            {task.status !== 'completed' && (
              <Button size="mini" type="text" onClick={() => onCompleteDemoTask(task.id)}>
                Demo 完成
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
