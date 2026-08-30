import { Checkbox, Modal } from 'antd'
import type { MediaContractIssue } from '@spark/protocol'

export type CanvasTaskValidationDecision = {
  confirmed: boolean
  skipFutureValidation: boolean
}

export function confirmCanvasTaskValidation(
  issues: MediaContractIssue[],
): Promise<CanvasTaskValidationDecision> {
  if (issues.length === 0) {
    return Promise.resolve({ confirmed: true, skipFutureValidation: false })
  }

  let skipFutureValidation = false
  return new Promise((resolve) => {
    Modal.confirm({
      title: '任务参数校验提示',
      width: 560,
      icon: null,
      okText: '确认继续提交',
      cancelText: '返回修改',
      content: (
        <div className="canvas-task-validation-warning">
          <p>
            当前任务发现 {issues.length}{' '}
            个参数或输入问题。继续提交可能导致供应商拒绝任务或生成结果不符合预期。
          </p>
          <div className="canvas-task-validation-warning-list" role="alert">
            {issues.map((issue, index) => (
              <div key={`${issue.code}-${issue.path.join('.')}-${index}`}>
                <strong>{issue.code}</strong>
                <span>{issue.message}</span>
              </div>
            ))}
          </div>
          <Checkbox onChange={(event) => (skipFutureValidation = event.target.checked)}>
            下次不再提醒参数校验问题
          </Checkbox>
        </div>
      ),
      onOk: () => resolve({ confirmed: true, skipFutureValidation }),
      onCancel: () => resolve({ confirmed: false, skipFutureValidation: false }),
    })
  })
}
