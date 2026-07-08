import { useEffect, useMemo, useState } from 'react'
import { Button } from '@lobehub/ui'
import { Icons } from '../Icons'
import { useResolvedTheme } from '../hooks/useResolvedTheme'

type MarkdownCodeBlockProps = {
  code: string
  lang: string
  syntaxHighlight: boolean
  incomplete?: boolean
}

const SHIKI_THEME = {
  light: 'github-light',
  dark: 'github-dark',
} as const

const LANGUAGE_ALIASES: Record<string, string> = {
  cplusplus: 'cpp',
  cxx: 'cpp',
  js: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  golang: 'go',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  shellscript: 'bash',
  yml: 'yaml',
}

const COMMON_LANGUAGES = [
  'bash',
  'c',
  'cpp',
  'css',
  'go',
  'html',
  'java',
  'javascript',
  'json',
  'jsx',
  'markdown',
  'python',
  'rust',
  'sql',
  'tsx',
  'typescript',
  'xml',
  'yaml',
] as const

type ShikiHighlighter = {
  codeToHtml: (code: string, options: { lang: string; theme: string }) => string
}

let highlighterPromise: Promise<ShikiHighlighter> | null = null

function loadHighlighter(): Promise<ShikiHighlighter> {
  highlighterPromise ??= Promise.all([
    import('shiki/core'),
    import('shiki/engine/javascript'),
    import('shiki/langs'),
    import('shiki/themes'),
  ]).then(([core, engine, langs, themes]) =>
    core.createHighlighterCore({
      themes: [
        themes.bundledThemes['github-light'],
        themes.bundledThemes['github-dark'],
      ],
      langs: COMMON_LANGUAGES.map((language) => langs.bundledLanguages[language]).filter(
        (language): language is NonNullable<typeof language> => language != null,
      ),
      engine: engine.createJavaScriptRegexEngine(),
    }),
  )
  return highlighterPromise
}

function normalizeLanguage(lang: string): string {
  const normalized = lang.trim().toLowerCase()
  return LANGUAGE_ALIASES[normalized] ?? normalized
}

export function MarkdownCodeBlock({
  code,
  lang,
  syntaxHighlight,
  incomplete = false,
}: MarkdownCodeBlockProps) {
  const resolvedTheme = useResolvedTheme()
  const [html, setHtml] = useState<string | null>(null)
  const [highlightFailed, setHighlightFailed] = useState(false)
  const [copied, setCopied] = useState(false)
  const language = useMemo(() => normalizeLanguage(lang), [lang])
  const shikiTheme = SHIKI_THEME[resolvedTheme]
  const shouldHighlight = syntaxHighlight && !incomplete && code.length > 0

  useEffect(() => {
    let cancelled = false
    setCopied(false)

    if (!shouldHighlight) {
      setHtml(null)
      setHighlightFailed(false)
      return () => {
        cancelled = true
      }
    }

    void loadHighlighter()
      .then((highlighter) => {
        try {
          const highlighted = highlighter.codeToHtml(code, {
            lang: language || 'text',
            theme: shikiTheme,
          })
          if (!cancelled) {
            setHtml(highlighted)
            setHighlightFailed(false)
          }
        } catch {
          if (!cancelled) {
            setHtml(null)
            setHighlightFailed(true)
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHtml(null)
          setHighlightFailed(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [code, language, shikiTheme, shouldHighlight])

  const handleCopy = () => {
    navigator.clipboard
      .writeText(code)
      .then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1200)
      })
      .catch(() => {})
  }

  return (
    <div
      className={[
        'md-code-block',
        syntaxHighlight && !highlightFailed ? '' : 'no-syntax',
        incomplete ? 'md-code-streaming-block' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {lang && (
        <div className="md-code-header">
          <span className="md-code-lang">{lang}</span>
          {incomplete ? (
            <Icons.Spinner size={10} className="md-code-streaming-badge" />
          ) : (
            <Button
              className="md-code-copy"
              type="text"
              size="middle"
              icon={copied ? <Icons.Check size={12} /> : <Icons.Copy size={12} />}
              title={copied ? '已复制' : '复制'}
              onClick={handleCopy}
            />
          )}
        </div>
      )}
      {!lang && !incomplete && (
        <Button
          className="md-code-copy-float"
          type="text"
          size="middle"
          icon={copied ? <Icons.Check size={12} /> : <Icons.Copy size={12} />}
          title={copied ? '已复制' : '复制'}
          onClick={handleCopy}
        />
      )}
      {html != null ? (
        <div className="md-code-highlighted" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className={`md-code${incomplete ? ' md-code-incomplete' : ''}`}>
          <code>{code}</code>
          {incomplete && <span className="md-code-cursor">▌</span>}
        </pre>
      )}
    </div>
  )
}
