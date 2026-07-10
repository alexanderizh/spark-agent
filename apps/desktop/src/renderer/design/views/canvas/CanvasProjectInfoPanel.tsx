import { useState } from 'react'
import { Button, Tag, Tooltip } from '@lobehub/ui'
import { Input, message } from 'antd'
import { Icons } from '../../Icons'
import { CanvasPresetHubEntry } from './CanvasPresetHubEntry'
import { readStyleBible } from './canvasPipeline'
import type { CanvasProject, CanvasProjectSettings } from './canvas.types'

export function CanvasProjectInfoPanel({
  project,
  configuredPresetCount,
  onOpenProjectFolder,
  onOpenPresetCenter,
  onSave,
  onSaveStyleBible,
}: {
  project: CanvasProject
  configuredPresetCount: number
  onOpenProjectFolder: () => Promise<void>
  onOpenPresetCenter: () => void
  onSave: (settings: CanvasProjectSettings) => Promise<void>
  onSaveStyleBible: (styleBible: string) => Promise<void>
}) {
  const [prompt, setPrompt] = useState(project.settings?.prompt ?? '')
  const [negativePrompt, setNegativePrompt] = useState(project.settings?.negativePrompt ?? '')
  const [styleBible, setStyleBible] = useState(readStyleBible(project.metadata))
  const [savingStyle, setSavingStyle] = useState(false)
  const [saving, setSaving] = useState(false)

  const saveStyleBible = async () => {
    setSavingStyle(true)
    try {
      await onSaveStyleBible(styleBible)
      message.success('视觉总设定已更新')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存视觉总设定失败')
    } finally {
      setSavingStyle(false)
    }
  }

  const save = async () => {
    setSaving(true)
    try {
      await onSave({ prompt, negativePrompt })
      message.success('项目提示词已更新')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存项目提示词失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="canvas-side-panel-content canvas-side-panel-content-project">
      <CanvasPresetHubEntry
        configuredPresetCount={configuredPresetCount}
        onOpen={onOpenPresetCenter}
        variant="panel"
      />
      <section className="canvas-panel-section">
        <div className="canvas-panel-title-row">
          <h3>项目基础信息</h3>
          <Tag color={project.status === 'active' ? 'green' : 'default'} bordered>
            {project.status}
          </Tag>
        </div>
        <div className="canvas-project-info-grid">
          <CanvasProjectInfoItem label="项目名" value={project.title} />
          <CanvasProjectInfoItem label="节点" value={project.nodeCount} />
          <CanvasProjectInfoItem label="素材" value={project.assetCount} />
          <CanvasProjectInfoItem label="任务" value={project.taskCount} />
        </div>
        <div className="canvas-project-folder-card canvas-project-folder-card-inline">
          <div className="canvas-project-folder-info">
            <span>项目文件夹</span>
            <Tooltip title={project.rootPath || '默认位置'} placement="topLeft">
              <strong>{project.rootPath || '默认位置'}</strong>
            </Tooltip>
          </div>
          <Button
            size="middle"
            icon={<Icons.Folder size={14} />}
            onClick={() => void onOpenProjectFolder()}
          >
            打开
          </Button>
        </div>
      </section>
      <section className="canvas-panel-section">
        <div className="canvas-panel-title-row">
          <h3>视觉总设定 (Style Bible)</h3>
          <Tag color={styleBible.trim() ? 'purple' : 'default'} bordered>
            {styleBible.trim() ? '已设定' : '未设定'}
          </Tag>
        </div>
        <div className="canvas-form-row">
          <label>全片视觉风格（被角色图/分镜/关键帧等所有生成继承）</label>
          <Input.TextArea
            value={styleBible}
            rows={5}
            placeholder="例如：日系动画风格，电影级布光，冷色调，胶片颗粒，2.39:1 宽银幕，统一美术与材质语言"
            onChange={(event) => setStyleBible(event.target.value)}
          />
        </div>
        <div className="canvas-project-prompt-actions">
          <Button size="middle" onClick={() => setStyleBible(readStyleBible(project.metadata))}>
            重置
          </Button>
          <Button
            size="middle"
            type="primary"
            loading={savingStyle}
            onClick={() => void saveStyleBible()}
          >
            保存设定
          </Button>
        </div>
      </section>
      <section className="canvas-panel-section">
        <div className="canvas-panel-title-row">
          <h3>AI 提示词设置</h3>
          <Tag color={prompt.trim() || negativePrompt.trim() ? 'blue' : 'default'} bordered>
            {prompt.trim() || negativePrompt.trim() ? '已配置' : '未配置'}
          </Tag>
        </div>
        <div className="canvas-form-row">
          <label>项目统一提示词</label>
          <Input.TextArea
            value={prompt}
            rows={6}
            placeholder="例如：统一品牌语气、画面风格、构图偏好、输出格式等"
            onChange={(event) => setPrompt(event.target.value)}
          />
        </div>
        <div className="canvas-form-row">
          <label>反向提示词</label>
          <Input.TextArea
            value={negativePrompt}
            rows={5}
            placeholder="例如：不要出现的元素、不能做的动作、需要规避的风格或内容"
            onChange={(event) => setNegativePrompt(event.target.value)}
          />
        </div>
        <div className="canvas-project-prompt-actions">
          <Button
            size="middle"
            onClick={() => {
              setPrompt(project.settings?.prompt ?? '')
              setNegativePrompt(project.settings?.negativePrompt ?? '')
            }}
          >
            重置
          </Button>
          <Button size="middle" type="primary" loading={saving} onClick={() => void save()}>
            保存设置
          </Button>
        </div>
      </section>
    </div>
  )
}

function CanvasProjectInfoItem({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="canvas-project-info-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
