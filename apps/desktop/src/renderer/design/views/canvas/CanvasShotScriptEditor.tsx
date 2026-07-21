import { useState, type ReactNode } from 'react'
import { Button, Tooltip } from '@lobehub/ui'
import { Input } from 'antd'
import { Icons } from '../../Icons'
import type { ParsedShotRow } from './canvasShotTableParse'
import {
  createStoryboardShot,
  normalizeStoryboardShotIndexes,
} from './canvasStoryboardEditor'
import type { CanvasAsset } from './canvas.types'
import './CanvasShotScriptEditor.less'

type EditorSection = 'story' | 'camera' | 'performance' | 'sound' | 'prompt'

const SECTIONS: Array<{
  id: EditorSection
  label: string
  icon: ReactNode
  description: string
}> = [
  {
    id: 'story',
    label: '画面设计',
    icon: <Icons.Film size={15} />,
    description: '镜头、场景、构图与首尾帧',
  },
  {
    id: 'camera',
    label: '摄影光色',
    icon: <Icons.Sliders size={15} />,
    description: '镜头参数、光照与氛围',
  },
  {
    id: 'performance',
    label: '角色表演',
    icon: <Icons.Users size={15} />,
    description: '角色、调度、动作与连续性',
  },
  {
    id: 'sound',
    label: '对白声音',
    icon: <Icons.AudioLines size={15} />,
    description: '对白、旁白、音效与转场',
  },
  {
    id: 'prompt',
    label: '生成控制',
    icon: <Icons.Sparkles size={15} />,
    description: '生成提示词与反向约束',
  },
]

const TEXTAREA_AUTO_SIZE = { minRows: 4, maxRows: 14 } as const
const LARGE_TEXTAREA_AUTO_SIZE = { minRows: 7, maxRows: 20 } as const

function Field({
  label,
  hint,
  wide = false,
  children,
}: {
  label: string
  hint?: string
  wide?: boolean
  children: ReactNode
}) {
  return (
    <label className={`canvas-storyboard-field${wide ? ' is-wide' : ''}`}>
      <span className="canvas-storyboard-field-label">
        <strong>{label}</strong>
        {hint ? <small>{hint}</small> : null}
      </span>
      {children}
    </label>
  )
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="canvas-storyboard-section-card">
      <div className="canvas-storyboard-section-heading">
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
      <div className="canvas-storyboard-field-grid">{children}</div>
    </section>
  )
}

function shotSummary(row: ParsedShotRow): string {
  return (
    row.description?.trim() ||
    row.sceneLayout?.trim() ||
    row.shotPrompt?.trim() ||
    '尚未填写画面内容'
  )
}

export function CanvasShotScriptEditor({
  rows,
  characterAssets,
  onRowsChange,
}: {
  rows: ParsedShotRow[]
  characterAssets: CanvasAsset[]
  onRowsChange: (rows: ParsedShotRow[]) => void
}) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [activeSection, setActiveSection] = useState<EditorSection>('story')
  const activeIndex = Math.min(selectedIndex, Math.max(0, rows.length - 1))
  const activeRow = rows[activeIndex]
  const totalDuration = rows.reduce((sum, row) => sum + (row.durationSec ?? 0), 0)

  if (!activeRow) return null

  const updateActiveRow = (patch: Partial<ParsedShotRow>) => {
    onRowsChange(rows.map((row, index) => (index === activeIndex ? { ...row, ...patch } : row)))
  }

  const addShot = () => {
    const insertAt = activeIndex + 1
    const nextRows = normalizeStoryboardShotIndexes([
      ...rows.slice(0, insertAt),
      createStoryboardShot(insertAt + 1),
      ...rows.slice(insertAt),
    ])
    onRowsChange(nextRows)
    setSelectedIndex(insertAt)
    setActiveSection('story')
  }

  const duplicateShot = () => {
    const insertAt = activeIndex + 1
    const duplicate: ParsedShotRow = {
      ...activeRow,
      title: activeRow.title.trim() ? `${activeRow.title} 副本` : `镜${insertAt + 1}`,
    }
    onRowsChange(
      normalizeStoryboardShotIndexes([
        ...rows.slice(0, insertAt),
        duplicate,
        ...rows.slice(insertAt),
      ]),
    )
    setSelectedIndex(insertAt)
  }

  const deleteShot = () => {
    if (rows.length <= 1) return
    onRowsChange(normalizeStoryboardShotIndexes(rows.filter((_, index) => index !== activeIndex)))
    setSelectedIndex(Math.max(0, activeIndex - 1))
  }

  const moveShot = (direction: -1 | 1) => {
    const targetIndex = activeIndex + direction
    if (targetIndex < 0 || targetIndex >= rows.length) return
    const nextRows = [...rows]
    const currentRow = nextRows[activeIndex]
    const targetRow = nextRows[targetIndex]
    if (!currentRow || !targetRow) return
    nextRows[activeIndex] = targetRow
    nextRows[targetIndex] = currentRow
    onRowsChange(normalizeStoryboardShotIndexes(nextRows))
    setSelectedIndex(targetIndex)
  }

  const toggleCharacter = (name: string) => {
    const current = activeRow.characterNames ?? []
    updateActiveRow({
      characterNames: current.includes(name)
        ? current.filter((item) => item !== name)
        : [...current, name],
    })
  }

  const textArea = (field: keyof ParsedShotRow, placeholder: string, large = false) => (
    <Input.TextArea
      autoSize={large ? LARGE_TEXTAREA_AUTO_SIZE : TEXTAREA_AUTO_SIZE}
      value={typeof activeRow[field] === 'string' ? (activeRow[field] as string) : ''}
      placeholder={placeholder}
      onChange={(event) => updateActiveRow({ [field]: event.target.value })}
    />
  )

  return (
    <div className="canvas-storyboard-editor">
      <aside className="canvas-storyboard-shot-rail" aria-label="镜头列表">
        <div className="canvas-storyboard-rail-head">
          <div>
            <strong>镜头序列</strong>
            <span>
              {rows.length} 镜{totalDuration > 0 ? ` · ${totalDuration.toFixed(1)}s` : ''}
            </span>
          </div>
          <Tooltip title="在当前镜头后添加">
            <Button
              size="middle"
              type="primary"
              icon={<Icons.Plus size={14} />}
              aria-label="添加镜头"
              onClick={addShot}
            />
          </Tooltip>
        </div>

        <div className="canvas-storyboard-shot-list">
          {rows.map((row, index) => (
            <button
              key={`${row.index ?? index + 1}-${index}`}
              type="button"
              className={`canvas-storyboard-shot-card${index === activeIndex ? ' is-active' : ''}`}
              aria-current={index === activeIndex ? 'true' : undefined}
              onClick={() => setSelectedIndex(index)}
            >
              <span className="canvas-storyboard-shot-number">
                {String(row.index ?? index + 1).padStart(2, '0')}
              </span>
              <span className="canvas-storyboard-shot-copy">
                <strong>{row.title?.trim() || `镜${index + 1}`}</strong>
                <small>{shotSummary(row)}</small>
                <span className="canvas-storyboard-shot-meta">
                  {row.shotSize ? <em>{row.shotSize}</em> : null}
                  {row.movement ? <em>{row.movement}</em> : null}
                  {row.durationSec ? <em>{row.durationSec}s</em> : null}
                </span>
              </span>
            </button>
          ))}
        </div>

        <div className="canvas-storyboard-rail-footer">
          <span>
            当前镜头 {activeIndex + 1} / {rows.length}
          </span>
          <div>
            <Tooltip title="上移镜头">
              <Button
                size="middle"
                type="text"
                icon={<Icons.ArrowUp size={14} />}
                disabled={activeIndex === 0}
                aria-label="上移镜头"
                onClick={() => moveShot(-1)}
              />
            </Tooltip>
            <Tooltip title="下移镜头">
              <Button
                size="middle"
                type="text"
                icon={<Icons.ArrowDown size={14} />}
                disabled={activeIndex === rows.length - 1}
                aria-label="下移镜头"
                onClick={() => moveShot(1)}
              />
            </Tooltip>
          </div>
        </div>
      </aside>

      <main className="canvas-storyboard-inspector">
        <div className="canvas-storyboard-inspector-head">
          <div className="canvas-storyboard-current-title">
            <span>SHOT {String(activeRow.index ?? activeIndex + 1).padStart(2, '0')}</span>
            <strong>{activeRow.title?.trim() || `镜${activeIndex + 1}`}</strong>
          </div>
          <div className="canvas-storyboard-current-actions">
            <Button size="middle" icon={<Icons.Copy size={14} />} onClick={duplicateShot}>
              复制镜头
            </Button>
            <Button
              size="middle"
              type="text"
              danger
              icon={<Icons.Trash size={14} />}
              disabled={rows.length <= 1}
              onClick={deleteShot}
            >
              删除
            </Button>
          </div>
        </div>

        <nav className="canvas-storyboard-section-tabs" aria-label="镜头配置分类">
          {SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              className={section.id === activeSection ? 'is-active' : ''}
              onClick={() => setActiveSection(section.id)}
            >
              {section.icon}
              <span>
                <strong>{section.label}</strong>
                <small>{section.description}</small>
              </span>
            </button>
          ))}
        </nav>

        <div className="canvas-storyboard-inspector-scroll">
          {activeSection === 'story' ? (
            <>
              <SectionCard title="镜头信息" description="定义镜头在序列中的身份、时长和摄影运动。">
                <Field label="镜头标题">
                  <Input
                    value={activeRow.title ?? ''}
                    placeholder={`镜${activeIndex + 1}`}
                    onChange={(event) => updateActiveRow({ title: event.target.value })}
                  />
                </Field>
                <Field label="镜号">
                  <Input
                    inputMode="numeric"
                    value={activeRow.index ?? activeIndex + 1}
                    onChange={(event) => {
                      const value = Number.parseInt(event.target.value, 10)
                      if (Number.isFinite(value)) updateActiveRow({ index: value })
                    }}
                  />
                </Field>
                <Field label="时长" hint="秒">
                  <Input
                    inputMode="decimal"
                    suffix="s"
                    value={activeRow.durationSec ?? ''}
                    onChange={(event) => {
                      const value = Number.parseFloat(event.target.value)
                      if (Number.isFinite(value) && value > 0) {
                        updateActiveRow({ durationSec: value })
                        return
                      }
                      onRowsChange(
                        rows.map((row, index) => {
                          if (index !== activeIndex) return row
                          const { durationSec: _durationSec, ...rest } = row
                          return rest
                        }),
                      )
                    }}
                  />
                </Field>
                <Field label="景别">
                  <Input
                    value={activeRow.shotSize ?? ''}
                    placeholder="如：中近景"
                    onChange={(event) => updateActiveRow({ shotSize: event.target.value })}
                  />
                </Field>
                <Field label="机位 / 角度">
                  <Input
                    value={activeRow.angle ?? ''}
                    placeholder="如：低机位、平视"
                    onChange={(event) => updateActiveRow({ angle: event.target.value })}
                  />
                </Field>
                <Field label="运镜">
                  <Input
                    value={activeRow.movement ?? ''}
                    placeholder="如：固定、跟拍、推近"
                    onChange={(event) => updateActiveRow({ movement: event.target.value })}
                  />
                </Field>
              </SectionCard>
              <SectionCard title="场景与画面" description="先描述空间，再明确画面主体与视觉组织。">
                <Field label="场次 / 分组">
                  <Input
                    value={activeRow.groupName ?? ''}
                    placeholder="如：E1-S02"
                    onChange={(event) => updateActiveRow({ groupName: event.target.value })}
                  />
                </Field>
                <Field label="场景名称">
                  <Input
                    value={activeRow.sceneName ?? ''}
                    placeholder="如：苏黎出租屋"
                    onChange={(event) => updateActiveRow({ sceneName: event.target.value })}
                  />
                </Field>
                <Field label="场景布局" wide>
                  {textArea('sceneLayout', '描述空间大小、陈设、入口、纵深与人物可活动区域')}
                </Field>
                <Field label="构图设计" wide>
                  {textArea('composition', '描述画面分割、视觉中心、前中后景与留白关系')}
                </Field>
                <Field label="画面 / 动作" wide>
                  {textArea('description', '完整描述这一镜实际看到的画面和动作', true)}
                </Field>
                <Field label="首帧" wide>
                  {textArea('firstFrame', '描述 0.0s 的确定画面、姿态与构图')}
                </Field>
                <Field label="尾帧" wide>
                  {textArea('lastFrame', '描述镜头结束时的确定画面与动作接点')}
                </Field>
              </SectionCard>
            </>
          ) : null}

          {activeSection === 'camera' ? (
            <>
              <SectionCard title="镜头参数" description="把抽象镜头语言落实为可执行的摄影参数。">
                <Field label="焦距 / 焦段">
                  <Input
                    value={activeRow.focalLength ?? ''}
                    placeholder="如：50mm"
                    onChange={(event) => updateActiveRow({ focalLength: event.target.value })}
                  />
                </Field>
                <Field label="光圈 / 景深">
                  <Input
                    value={activeRow.aperture ?? ''}
                    placeholder="如：f/2.8，浅景深"
                    onChange={(event) => updateActiveRow({ aperture: event.target.value })}
                  />
                </Field>
                <Field label="ISO / 颗粒">
                  <Input
                    value={activeRow.iso ?? ''}
                    placeholder="如：ISO 800"
                    onChange={(event) => updateActiveRow({ iso: event.target.value })}
                  />
                </Field>
                <Field label="综合镜头参数" wide>
                  {textArea('cameraParams', '补充快门、对焦、镜片质感、景深范围与特殊摄影要求')}
                </Field>
              </SectionCard>
              <SectionCard title="光色与氛围" description="统一光源逻辑、色彩策略和情绪表达。">
                <Field label="光照方案" wide>
                  {textArea('lighting', '描述主光、辅光、轮廓光、色温、方向和强弱关系', true)}
                </Field>
                <Field label="色调 / 色彩">
                  <Input
                    value={activeRow.colorTone ?? ''}
                    placeholder="如：暖橙与琥珀色"
                    onChange={(event) => updateActiveRow({ colorTone: event.target.value })}
                  />
                </Field>
                <Field label="氛围 / 情绪">
                  <Input
                    value={activeRow.mood ?? ''}
                    placeholder="如：压抑、焦躁、爆发前"
                    onChange={(event) => updateActiveRow({ mood: event.target.value })}
                  />
                </Field>
              </SectionCard>
            </>
          ) : null}

          {activeSection === 'performance' ? (
            <>
              <SectionCard title="出场角色" description="选择本镜角色，并锁定角色参考与造型状态。">
                <Field label="角色" wide>
                  <div className="canvas-storyboard-character-picker">
                    {characterAssets.length > 0 ? (
                      characterAssets.map((asset) => {
                        const name = asset.title ?? asset.id
                        const active = activeRow.characterNames?.includes(name)
                        return (
                          <button
                            key={asset.id}
                            type="button"
                            className={active ? 'is-active' : ''}
                            aria-pressed={active}
                            onClick={() => toggleCharacter(name)}
                          >
                            <Icons.User size={13} />
                            {name}
                          </button>
                        )
                      })
                    ) : (
                      <span>项目中暂无角色资产，可在下方手动填写。</span>
                    )}
                  </div>
                </Field>
                <Field label="角色名称" wide>
                  <Input
                    value={activeRow.characterNames?.join('、') ?? ''}
                    placeholder="使用顿号、逗号或空格分隔多个角色"
                    onChange={(event) =>
                      updateActiveRow({
                        characterNames: event.target.value
                          .split(/[,，、/\s]+/)
                          .map((item) => item.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </Field>
                <Field label="角色参考" wide>
                  {textArea('characterReferences', '描述角色资产、面部、发型、体型与一致性参考')}
                </Field>
                <Field label="服装 / 造型" wide>
                  {textArea('costume', '描述本镜服装、配饰、妆发和状态变化')}
                </Field>
              </SectionCard>
              <SectionCard title="调度与表演" description="明确角色在哪里、如何移动、如何表演。">
                <Field label="站位调度" wide>
                  {textArea('blocking', '描述人物与镜头、场景、道具之间的站位和移动关系', true)}
                </Field>
                <Field label="表情 / 微动作" wide>
                  {textArea('performance', '描述表情变化、视线、呼吸、手部和身体细节', true)}
                </Field>
                <Field label="动作节拍" wide>
                  {textArea('actionBeats', '按 0.5s 时间码描述动作推进与关键节拍', true)}
                </Field>
                <Field label="连续性约束" wide>
                  {textArea('continuity', '锁定轴线、视线、道具手位、造型、光向和动作接点')}
                </Field>
              </SectionCard>
            </>
          ) : null}

          {activeSection === 'sound' ? (
            <SectionCard
              title="声音与剪辑"
              description="把台词、环境声与镜头衔接放在同一时间语境中。"
            >
              <Field label="对白" wide>
                {textArea('dialogue', '填写角色对白；可标注角色名、语气和停顿', true)}
              </Field>
              <Field label="旁白" wide>
                {textArea('narration', '填写画外音、内心独白或叙事旁白')}
              </Field>
              <Field label="声音设计" wide>
                {textArea('soundEffects', '描述环境声、拟音、音乐、静默和声音变化')}
              </Field>
              <Field label="转场 / 剪辑" wide>
                {textArea('transition', '描述入镜、出镜、剪辑点和与前后镜头的转场方式')}
              </Field>
            </SectionCard>
          ) : null}

          {activeSection === 'prompt' ? (
            <SectionCard title="生成控制" description="为图像或视频模型准备完整提示词与排除项。">
              <Field label="生成提示词" wide>
                {textArea('shotPrompt', '整合镜头语言、主体、环境、动作、光色和风格要求', true)}
              </Field>
              <Field label="反向提示词" wide>
                {textArea('negativePrompt', '描述不应出现的元素、瑕疵、风格和技术问题', true)}
              </Field>
              <div className="canvas-storyboard-prompt-note">
                <Icons.Sparkles size={16} />
                <div>
                  <strong>生成提示词不会替代制作字段</strong>
                  <span>
                    结构化字段用于后续拆镜、关键帧、视频任务和连续性控制，建议两者同时维护。
                  </span>
                </div>
              </div>
            </SectionCard>
          ) : null}
        </div>
      </main>
    </div>
  )
}
