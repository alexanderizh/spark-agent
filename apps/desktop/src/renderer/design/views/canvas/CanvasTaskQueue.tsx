import { Button, Tag } from '@lobehub/ui'
import { Progress } from 'antd'
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
        <Tag color="blue">
          运行 {running}
        </Tag>
        <Tag color="red">
          失败 {failed}
        </Tag>
        <Tag color="green">
          完成 {completed}
        </Tag>
      </div>
      <div className="canvas-task-list">
        {tasks.slice(0, 4).map((task) => (
          <div key={task.id} className="canvas-task-pill">
            <span className="canvas-task-pill-title">
              {task.title ?? operationLabel(task.operation)}
            </span>
            <Progress percent={task.progress} size="small" />
            {task.status !== 'completed' && (
              <Button size="small" type="text" onClick={() => onCompleteDemoTask(task.id)}>
                Demo 完成
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
