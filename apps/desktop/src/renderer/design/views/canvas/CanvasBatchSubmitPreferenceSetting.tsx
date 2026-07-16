import { useEffect, useState } from 'react'
import { Switch } from 'antd'
import {
  CANVAS_BATCH_SUBMIT_PREFERENCE_EVENT,
  readSkipCanvasBatchSubmitConfirmation,
  writeSkipCanvasBatchSubmitConfirmation,
} from './canvasBatchSubmitPreferences'

export function CanvasBatchSubmitPreferenceSetting() {
  const [skipConfirmation, setSkipConfirmation] = useState(
    readSkipCanvasBatchSubmitConfirmation,
  )

  useEffect(() => {
    const syncPreference = () =>
      setSkipConfirmation(readSkipCanvasBatchSubmitConfirmation())
    window.addEventListener(
      CANVAS_BATCH_SUBMIT_PREFERENCE_EVENT,
      syncPreference,
    )
    return () =>
      window.removeEventListener(
        CANVAS_BATCH_SUBMIT_PREFERENCE_EVENT,
        syncPreference,
      )
  }, [])

  return (
    <div className="settings-card-row">
      <div className="flex1 min-w-0">
        <div className="row-title">批量提交运行确认</div>
        <div className="row-desc">
          关闭后，画布任务批量校验通过时直接提交；校验失败仍会打开配置面板。
        </div>
      </div>
      <div className="row-action">
        <Switch
          checked={!skipConfirmation}
          onChange={(confirmBeforeSubmit) => {
            const skip = !confirmBeforeSubmit
            writeSkipCanvasBatchSubmitConfirmation(skip)
            setSkipConfirmation(skip)
          }}
        />
      </div>
    </div>
  )
}
