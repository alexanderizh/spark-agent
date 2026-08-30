import React, { useState } from 'react'
import { useApp, PRIMARIES } from '../AppContext'
import { LobeThemeProvider } from './LobeThemeProvider'
import { useResolvedTheme } from '../hooks/useResolvedTheme'
import { Button, Input, Select, Tag, Modal, Tooltip, Dropdown } from '@lobehub/ui'
import { Switch } from 'antd'
import './LobePreviewView.less'

const PRIMARY_OPTIONS = Object.entries(PRIMARIES).map(([color, info]) => ({
  label: info.name,
  value: color,
}))

export function LobePreviewView() {
  const { t, setTweak } = useApp()
  const resolvedTheme = useResolvedTheme()
  const [modalOpen, setModalOpen] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [selectValue, setSelectValue] = useState<string>('blue')
  const [checked, setChecked] = useState(false)

  return (
    <LobeThemeProvider
      themeMode={t.theme}
      resolvedTheme={resolvedTheme}
      primary={t.primary}
    >
      <div className="lobe-preview">
        <header className="lobe-preview-header">
          <h2>@lobehub/ui Sandbox</h2>
          <p className="lobe-preview-subtitle">
            验证 lobe-ui + antd v6 是否正确响应主题与 accent color。此页面隔离运行，不影响主应用。
          </p>
        </header>

        <section className="lobe-preview-row">
          <label>Theme</label>
          <Select
            value={t.theme}
            onChange={(v) => setTweak('theme', v as typeof t.theme)}
            options={[
              { label: 'Light', value: 'light' },
              { label: 'Dark', value: 'dark' },
              { label: 'System', value: 'system' },
            ]}
            style={{ width: 160 }}
          />
        </section>

        <section className="lobe-preview-row">
          <label>Primary</label>
          <Select
            value={t.primary}
            onChange={(v) => setTweak('primary', v as string)}
            options={PRIMARY_OPTIONS}
            style={{ width: 220 }}
          />
        </section>

        <section className="lobe-preview-block">
          <h3>Buttons</h3>
          <div className="lobe-preview-flex">
            <Button type="primary">Primary</Button>
            <Button type="text">Default</Button>
            <Button type="dashed">Dashed</Button>
            <Button type="text">Text</Button>
            <Button type="link">Link</Button>
            <Button danger>Danger</Button>
          </div>
        </section>

        <section className="lobe-preview-block">
          <h3>Form elements</h3>
          <div className="lobe-preview-flex">
            <Input
              placeholder="Input"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              style={{ width: 220 }}
            />
            <Select
              value={selectValue}
              onChange={setSelectValue}
              options={PRIMARY_OPTIONS}
              style={{ width: 200 }}
            />
            <Switch checked={checked} onChange={setChecked} />
          </div>
        </section>

        <section className="lobe-preview-block">
          <h3>Tags & Tooltip</h3>
          <div className="lobe-preview-flex">
            <Tag color="primary">primary</Tag>
            <Tag color="success">success</Tag>
            <Tag color="warning">warning</Tag>
            <Tag color="error">error</Tag>
            <Tooltip title="Tooltip content">
              <Button variant="outlined">Hover me</Button>
            </Tooltip>
          </div>
        </section>

        <section className="lobe-preview-block">
          <h3>Dropdown & Modal</h3>
          <div className="lobe-preview-flex">
            <Dropdown
              menu={{
                items: [
                  { key: '1', label: 'Item 1' },
                  { key: '2', label: 'Item 2' },
                  { key: '3', label: 'Item 3' },
                ],
              }}
            >
              <Button>Open Dropdown</Button>
            </Dropdown>
            <Button type="primary" onClick={() => setModalOpen(true)}>
              Open Modal
            </Button>
          </div>
        </section>

        <Modal
          open={modalOpen}
          onCancel={() => setModalOpen(false)}
          onOk={() => setModalOpen(false)}
          title="Modal Title"
        >
          <p>Modal body content.</p>
        </Modal>
      </div>
    </LobeThemeProvider>
  )
}
