import { Checkbox, Modal } from 'antd'
import type { CanvasOperationType } from './canvas.types'

const DISMISS_KEY = 'spark.canvas.video-submit-reminder.v1.dismissed'

export type VideoSubmissionCheck = {
  id: string
  label: string
  detail: string
  detected: boolean
}

export function isVideoSubmissionOperation(operation: CanvasOperationType): boolean {
  return (
    operation === 'text_to_video' ||
    operation === 'image_to_video' ||
    operation === 'video_edit' ||
    operation === 'video_extend'
  )
}

export function buildVideoSubmissionChecks(input: {
  prompt: string
  imageCount: number
  modelParams: Record<string, unknown>
}): VideoSubmissionCheck[] {
  const prompt = input.prompt.toLowerCase()
  const params = input.modelParams
  const hasParam = (...keys: string[]) =>
    keys.some((key) => params[key] != null && params[key] !== '')
  return [
    {
      id: 'style',
      label: '视觉风格已固定',
      detail: '画风、色彩、时代、材质和一致性要求已经说明。',
      detected: hasParam('style', 'stylePresetId') || /风格|画风|色调|cinematic|style/.test(prompt),
    },
    {
      id: 'assets',
      label: '人物与场景资产已准备',
      detail: '关键人物、服装、道具或场景参考图已作为输入连接。',
      detected: input.imageCount > 0,
    },
    {
      id: 'camera',
      label: '镜头参数与运镜已明确',
      detail: '景别、机位、焦段、时长、帧率和推拉摇移等信息足够清楚。',
      detected:
        hasParam(
          'duration',
          'durationSeconds',
          'fps',
          'frameRate',
          'aspectRatio',
          'aspect_ratio',
        ) || /景别|机位|焦段|运镜|推镜|拉镜|摇镜|移镜|镜头|camera|lens/.test(prompt),
    },
    {
      id: 'action',
      label: '动作、对白与运行说明已补齐',
      detail: '主体动作、场景变化、对白节奏和不要出现的内容已经交代。',
      detected: prompt.length >= 80 || /动作|对白|台词|旁白|站位|布光|不要|避免/.test(prompt),
    },
  ]
}

export function videoSubmissionReminderDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === 'true'
  } catch {
    return false
  }
}

function dismissVideoSubmissionReminder(): void {
  try {
    localStorage.setItem(DISMISS_KEY, 'true')
  } catch {
    // localStorage 不可用时只影响“不再提醒”，不能阻断任务提交。
  }
}

export function confirmVideoSubmission(input: {
  prompt: string
  imageCount: number
  modelParams: Record<string, unknown>
}): Promise<boolean> {
  if (videoSubmissionReminderDismissed()) return Promise.resolve(true)
  const checks = buildVideoSubmissionChecks(input)
  let doNotRemind = false
  return new Promise((resolve) => {
    Modal.confirm({
      title: '提交视频任务前，快速确认一下',
      width: 560,
      icon: null,
      okText: '确认并提交',
      cancelText: '返回完善',
      content: (
        <div className="canvas-video-submit-gate">
          <p>这不是强制门禁。视频生成成本较高，花十秒确认素材和镜头信息能减少无效生成。</p>
          <div className="canvas-video-submit-gate-list">
            {checks.map((check) => (
              <div key={check.id} className={check.detected ? 'is-detected' : 'is-pending'}>
                <span>{check.detected ? '✓' : '!'}</span>
                <div>
                  <strong>{check.label}</strong>
                  <small>{check.detected ? '已从当前配置中检测到相关信息' : check.detail}</small>
                </div>
              </div>
            ))}
          </div>
          <Checkbox
            onChange={(event) => {
              doNotRemind = event.target.checked
            }}
          >
            不再显示此提醒
          </Checkbox>
        </div>
      ),
      onOk: () => {
        if (doNotRemind) dismissVideoSubmissionReminder()
        resolve(true)
      },
      onCancel: () => resolve(false),
    })
  })
}
