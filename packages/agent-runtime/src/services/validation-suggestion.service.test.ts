import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ValidationSuggestionService } from './validation-suggestion.service.js'

const tmpDirs: string[] = []

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('ValidationSuggestionService', () => {
  it('suggests project validation scripts for code changes', () => {
    const root = makeWorkspace({
      scripts: {
        typecheck: 'tsc --noEmit',
        'test:unit': 'vitest run',
        lint: 'eslint src',
      },
      lockfile: 'pnpm-lock.yaml',
    })

    const suggestion = new ValidationSuggestionService().suggest({
      workspaceRootPath: root,
      changedFiles: ['src/app.ts', 'src/app.ts', 'src/app.test.ts'],
    })

    expect(suggestion).not.toBeNull()
    expect(suggestion?.changedFiles).toEqual(['src/app.ts', 'src/app.test.ts'])
    expect(suggestion?.commands.map((command) => command.command)).toEqual([
      'pnpm run typecheck',
      'pnpm run test:unit',
      'pnpm run lint',
    ])
  })

  it('returns null when the project has no validation scripts', () => {
    const root = makeWorkspace({
      scripts: { dev: 'vite' },
    })

    const suggestion = new ValidationSuggestionService().suggest({
      workspaceRootPath: root,
      changedFiles: ['src/app.ts'],
    })

    expect(suggestion).toBeNull()
  })

  it('returns null when the only change is a script outside the workspace', () => {
    const root = makeWorkspace({
      scripts: { typecheck: 'tsc --noEmit', lint: 'eslint src' },
      lockfile: 'pnpm-lock.yaml',
    })

    const suggestion = new ValidationSuggestionService().suggest({
      workspaceRootPath: root,
      changedFiles: [path.join(root, '..', 'make_docx.py')],
    })

    expect(suggestion).toBeNull()
  })

  it('returns null when in-workspace changes are only document artifacts', () => {
    const root = makeWorkspace({
      scripts: { typecheck: 'tsc --noEmit', lint: 'eslint src' },
      lockfile: 'pnpm-lock.yaml',
    })

    const suggestion = new ValidationSuggestionService().suggest({
      workspaceRootPath: root,
      changedFiles: ['report.docx', 'out/sheet.xlsx'],
    })

    expect(suggestion).toBeNull()
  })

  it('keeps only in-workspace source files when suggesting', () => {
    const root = makeWorkspace({
      scripts: { typecheck: 'tsc --noEmit', lint: 'eslint src' },
      lockfile: 'pnpm-lock.yaml',
    })

    const suggestion = new ValidationSuggestionService().suggest({
      workspaceRootPath: root,
      changedFiles: ['report.docx', 'src/app.ts', path.join(root, '..', 'outside.ts')],
    })

    expect(suggestion).not.toBeNull()
    expect(suggestion?.changedFiles).toEqual(['src/app.ts'])
  })
})

function makeWorkspace(params: {
  scripts: Record<string, string>
  lockfile?: string
}): string {
  const root = mkdtempSync(path.join(process.cwd(), 'tmp-validation-'))
  tmpDirs.push(root)
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: params.scripts }, null, 2))
  if (params.lockfile != null) {
    writeFileSync(path.join(root, params.lockfile), '')
  }
  return root
}
