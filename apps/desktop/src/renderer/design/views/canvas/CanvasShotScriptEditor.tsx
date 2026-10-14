import { useState, type ReactNode } from 'react'
import { Button, Tooltip } from '@lobehub/ui'
import { Input } from 'antd'
import { Icons } from '../../Icons'
import { translate, useI18n } from '../../i18n'
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
    label: translate('canvasShotScript.t1'),
    icon: <Icons.Film size={15} />,
    description: translate('canvasShotScript.t2'),
  },
  {
    id: 'camera',
    label: translate('canvasShotScript.t3'),
    icon: <Icons.Sliders size={15} />,
    description: translate('canvasShotScript.t4'),
  },
  {
    id: 'performance',
    label: translate('canvasShotScript.t5'),
    icon: <Icons.Users size={15} />,
    description: translate('canvasShotScript.t6'),
  },
  {
    id: 'sound',
    label: translate('canvasShotScript.t7'),
    icon: <Icons.AudioLines size={15} />,
    description: translate('canvasShotScript.t8'),
  },
  {
    id: 'prompt',
    label: translate('canvasShotScript.t9'),
    icon: <Icons.Sparkles size={15} />,
    description: translate('canvasShotScript.t10'),
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
    translate('canvasShotScript.t11')
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
  // 本文件使用非响应式 translate()：顶层订阅语言变化，保证切换语言后整树重渲染。
  useI18n()
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
      title: activeRow.title.trim() ? translate('canvasShotScript.tpl2Desc', { title: activeRow.title }) : translate('canvasShotScript.tpl1Desc', { index: insertAt + 1 }),
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
      <aside className="canvas-storyboard-shot-rail" aria-label={translate('canvasShotScript.t31')}>
        <div className="canvas-storyboard-rail-head">
          <div>
            <strong>{translate('canvasShotScript.t98')}</strong>
            <span>
              {translate('canvasShotScript.tpl3Desc', { count: rows.length })}{totalDuration > 0 ? translate('canvasShotScript.tpl4Desc', { seconds: totalDuration.toFixed(1) }) : ''}
            </span>
          </div>
          <Tooltip title={translate('canvasShotScript.t32')}>
            <Button
              size="middle"
              type="primary"
              icon={<Icons.Plus size={14} />}
              aria-label={translate('canvasShotScript.t33')}
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
                <strong>{row.title?.trim() || translate('canvasShotScript.tpl1Desc', { index: index + 1 })}</strong>
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
            {translate('canvasShotScript.tpl5Desc', { index: activeIndex + 1, total: rows.length })}
          </span>
          <div>
            <Tooltip title={translate('canvasShotScript.t34')}>
              <Button
                size="middle"
                type="text"
                icon={<Icons.ArrowUp size={14} />}
                disabled={activeIndex === 0}
                aria-label={translate('canvasShotScript.t34')}
                onClick={() => moveShot(-1)}
              />
            </Tooltip>
            <Tooltip title={translate('canvasShotScript.t35')}>
              <Button
                size="middle"
                type="text"
                icon={<Icons.ArrowDown size={14} />}
                disabled={activeIndex === rows.length - 1}
                aria-label={translate('canvasShotScript.t35')}
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
            <strong>{activeRow.title?.trim() || translate('canvasShotScript.tpl1Desc', { index: activeIndex + 1 })}</strong>
          </div>
          <div className="canvas-storyboard-current-actions">
            <Button size="middle" icon={<Icons.Copy size={14} />} onClick={duplicateShot}>
              {translate('canvasShotScript.t99')}
            </Button>
            <Button
              size="middle"
              type="text"
              danger
              icon={<Icons.Trash size={14} />}
              disabled={rows.length <= 1}
              onClick={deleteShot}
            >
              {translate('canvasShotScript.t100')}
            </Button>
          </div>
        </div>

        <nav className="canvas-storyboard-section-tabs" aria-label={translate('canvasShotScript.t36')}>
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
              <SectionCard title={translate('canvasShotScript.t37')} description={translate('canvasShotScript.t38Desc')}>
                <Field label={translate('canvasShotScript.t39')}>
                  <Input
                    value={activeRow.title ?? ''}
                    placeholder={translate('canvasShotScript.tpl1Desc', { index: activeIndex + 1 })}
                    onChange={(event) => updateActiveRow({ title: event.target.value })}
                  />
                </Field>
                <Field label={translate('canvasShotScript.t40')}>
                  <Input
                    inputMode="numeric"
                    value={activeRow.index ?? activeIndex + 1}
                    onChange={(event) => {
                      const value = Number.parseInt(event.target.value, 10)
                      if (Number.isFinite(value)) updateActiveRow({ index: value })
                    }}
                  />
                </Field>
                <Field label={translate('canvasShotScript.t41')} hint={translate('canvasShotScript.t42')}>
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
                <Field label={translate('canvasShotScript.t43')}>
                  <Input
                    value={activeRow.shotSize ?? ''}
                    placeholder={translate('canvasShotScript.t44')}
                    onChange={(event) => updateActiveRow({ shotSize: event.target.value })}
                  />
                </Field>
                <Field label={translate('canvasShotScript.t45')}>
                  <Input
                    value={activeRow.angle ?? ''}
                    placeholder={translate('canvasShotScript.t46')}
                    onChange={(event) => updateActiveRow({ angle: event.target.value })}
                  />
                </Field>
                <Field label={translate('canvasShotScript.t47')}>
                  <Input
                    value={activeRow.movement ?? ''}
                    placeholder={translate('canvasShotScript.t48')}
                    onChange={(event) => updateActiveRow({ movement: event.target.value })}
                  />
                </Field>
              </SectionCard>
              <SectionCard title={translate('canvasShotScript.t49')} description={translate('canvasShotScript.t50Desc')}>
                <Field label={translate('canvasShotScript.t51')}>
                  <Input
                    value={activeRow.groupName ?? ''}
                    placeholder={translate('canvasShotScript.t52')}
                    onChange={(event) => updateActiveRow({ groupName: event.target.value })}
                  />
                </Field>
                <Field label={translate('canvasShotScript.t53')}>
                  <Input
                    value={activeRow.sceneName ?? ''}
                    placeholder={translate('canvasShotScript.t54')}
                    onChange={(event) => updateActiveRow({ sceneName: event.target.value })}
                  />
                </Field>
                <Field label={translate('canvasShotScript.t55')} wide>
                  {textArea('sceneLayout', translate('canvasShotScript.t12Desc'))}
                </Field>
                <Field label={translate('canvasShotScript.t56')} wide>
                  {textArea('composition', translate('canvasShotScript.t13Desc'))}
                </Field>
                <Field label={translate('canvasShotScript.t57')} wide>
                  {textArea('description', translate('canvasShotScript.t14Desc'), true)}
                </Field>
                <Field label={translate('canvasShotScript.t58')} wide>
                  {textArea('firstFrame', translate('canvasShotScript.t15Desc'))}
                </Field>
                <Field label={translate('canvasShotScript.t59')} wide>
                  {textArea('lastFrame', translate('canvasShotScript.t16Desc'))}
                </Field>
              </SectionCard>
            </>
          ) : null}

          {activeSection === 'camera' ? (
            <>
              <SectionCard title={translate('canvasShotScript.t60')} description={translate('canvasShotScript.t61Desc')}>
                <Field label={translate('canvasShotScript.t62')}>
                  <Input
                    value={activeRow.focalLength ?? ''}
                    placeholder={translate('canvasShotScript.t63')}
                    onChange={(event) => updateActiveRow({ focalLength: event.target.value })}
                  />
                </Field>
                <Field label={translate('canvasShotScript.t64')}>
                  <Input
                    value={activeRow.aperture ?? ''}
                    placeholder={translate('canvasShotScript.t65')}
                    onChange={(event) => updateActiveRow({ aperture: event.target.value })}
                  />
                </Field>
                <Field label={translate('canvasShotScript.t66')}>
                  <Input
                    value={activeRow.iso ?? ''}
                    placeholder={translate('canvasShotScript.t67')}
                    onChange={(event) => updateActiveRow({ iso: event.target.value })}
                  />
                </Field>
                <Field label={translate('canvasShotScript.t68')} wide>
                  {textArea('cameraParams', translate('canvasShotScript.t17Desc'))}
                </Field>
              </SectionCard>
              <SectionCard title={translate('canvasShotScript.t69')} description={translate('canvasShotScript.t70Desc')}>
                <Field label={translate('canvasShotScript.t71')} wide>
                  {textArea('lighting', translate('canvasShotScript.t18Desc'), true)}
                </Field>
                <Field label={translate('canvasShotScript.t72')}>
                  <Input
                    value={activeRow.colorTone ?? ''}
                    placeholder={translate('canvasShotScript.t73')}
                    onChange={(event) => updateActiveRow({ colorTone: event.target.value })}
                  />
                </Field>
                <Field label={translate('canvasShotScript.t74')}>
                  <Input
                    value={activeRow.mood ?? ''}
                    placeholder={translate('canvasShotScript.t75')}
                    onChange={(event) => updateActiveRow({ mood: event.target.value })}
                  />
                </Field>
              </SectionCard>
            </>
          ) : null}

          {activeSection === 'performance' ? (
            <>
              <SectionCard title={translate('canvasShotScript.t76')} description={translate('canvasShotScript.t77Desc')}>
                <Field label={translate('canvasShotScript.t78')} wide>
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
                      <span>{translate('canvasShotScript.t101Desc')}</span>
                    )}
                  </div>
                </Field>
                <Field label={translate('canvasShotScript.t79')} wide>
                  <Input
                    value={activeRow.characterNames?.join('、') ?? ''}
                    placeholder={translate('canvasShotScript.t80Desc')}
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
                <Field label={translate('canvasShotScript.t81')} wide>
                  {textArea('characterReferences', translate('canvasShotScript.t19Desc'))}
                </Field>
                <Field label={translate('canvasShotScript.t82')} wide>
                  {textArea('costume', translate('canvasShotScript.t20Desc'))}
                </Field>
              </SectionCard>
              <SectionCard title={translate('canvasShotScript.t83')} description={translate('canvasShotScript.t84Desc')}>
                <Field label={translate('canvasShotScript.t85')} wide>
                  {textArea('blocking', translate('canvasShotScript.t21Desc'), true)}
                </Field>
                <Field label={translate('canvasShotScript.t86')} wide>
                  {textArea('performance', translate('canvasShotScript.t22Desc'), true)}
                </Field>
                <Field label={translate('canvasShotScript.t87')} wide>
                  {textArea('actionBeats', translate('canvasShotScript.t23Desc'), true)}
                </Field>
                <Field label={translate('canvasShotScript.t88')} wide>
                  {textArea('continuity', translate('canvasShotScript.t24Desc'))}
                </Field>
              </SectionCard>
            </>
          ) : null}

          {activeSection === 'sound' ? (
            <SectionCard
              title={translate('canvasShotScript.t89')}
              description={translate('canvasShotScript.t90Desc')}
            >
              <Field label={translate('canvasShotScript.t91')} wide>
                {textArea('dialogue', translate('canvasShotScript.t25Desc'), true)}
              </Field>
              <Field label={translate('canvasShotScript.t92')} wide>
                {textArea('narration', translate('canvasShotScript.t26Desc'))}
              </Field>
              <Field label={translate('canvasShotScript.t93')} wide>
                {textArea('soundEffects', translate('canvasShotScript.t27Desc'))}
              </Field>
              <Field label={translate('canvasShotScript.t94')} wide>
                {textArea('transition', translate('canvasShotScript.t28Desc'))}
              </Field>
            </SectionCard>
          ) : null}

          {activeSection === 'prompt' ? (
            <SectionCard title={translate('canvasShotScript.t9')} description={translate('canvasShotScript.t95Desc')}>
              <Field label={translate('canvasShotScript.t96')} wide>
                {textArea('shotPrompt', translate('canvasShotScript.t29Desc'), true)}
              </Field>
              <Field label={translate('canvasShotScript.t97')} wide>
                {textArea('negativePrompt', translate('canvasShotScript.t30Desc'), true)}
              </Field>
              <div className="canvas-storyboard-prompt-note">
                <Icons.Sparkles size={16} />
                <div>
                  <strong>{translate('canvasShotScript.t102Desc')}</strong>
                  <span>
                    {translate('canvasShotScript.t103Desc')}
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
