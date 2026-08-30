import {
  parseDiffCodeLines,
  parseLogCodeLines,
  parseTerminalCodeLines,
  type SemanticCodeBlockMode,
} from './codeBlockSemantics'

const EMPTY_LINE = '​'
const EMPTY_MARKER = ' '

type SemanticCodeBodyProps = {
  code: string
  mode: SemanticCodeBlockMode
}

export function SemanticCodeBody({ code, mode }: SemanticCodeBodyProps) {
  switch (mode) {
    case 'diff':
      return <DiffCodeBody code={code} />
    case 'terminal':
      return <TerminalCodeBody code={code} />
    case 'log':
      return <LogCodeBody code={code} />
  }
}

function DiffCodeBody({ code }: { code: string }) {
  const lines = parseDiffCodeLines(code)

  return (
    <pre className="md-code-semantic md-code-semantic--diff" data-code-mode="diff">
      <code>
        {lines.map((line, index) => (
          <span
            key={index}
            className={`md-code-semantic-line md-code-diff-line md-code-diff-line--${line.kind}`}
          >
            <span className="md-code-diff-marker" aria-hidden="true">
              {line.marker || EMPTY_MARKER}
            </span>
            <span className="md-code-semantic-text">{line.text || EMPTY_LINE}</span>
          </span>
        ))}
      </code>
    </pre>
  )
}

function TerminalCodeBody({ code }: { code: string }) {
  const lines = parseTerminalCodeLines(code)

  return (
    <pre className="md-code-semantic md-code-semantic--terminal" data-code-mode="terminal">
      <code>
        {lines.map((line, index) => (
          <span
            key={index}
            className={[
              'md-code-semantic-line',
              'md-code-terminal-line',
              `md-code-terminal-line--${line.kind}`,
              `md-code-semantic-line--${line.tone}`,
            ].join(' ')}
          >
            {line.prompt && (
              <span className="md-code-terminal-prompt" aria-hidden="true">
                {line.prompt}
              </span>
            )}
            <span className="md-code-semantic-text">{line.text || EMPTY_LINE}</span>
          </span>
        ))}
      </code>
    </pre>
  )
}

function LogCodeBody({ code }: { code: string }) {
  const lines = parseLogCodeLines(code)

  return (
    <pre className="md-code-semantic md-code-semantic--log" data-code-mode="log">
      <code>
        {lines.map((line, index) => (
          <span
            key={index}
            className={`md-code-semantic-line md-code-log-line md-code-semantic-line--${line.tone}`}
          >
            <span className="md-code-semantic-text">{line.text || EMPTY_LINE}</span>
          </span>
        ))}
      </code>
    </pre>
  )
}
