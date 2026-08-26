import { Box, Text, useApp } from 'ink';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';

import type { AgentEvent } from '../events/schema.js';
import type { LlmDelta } from '../llm/types.js';
import type { InteractiveApprover, PendingApproval } from '../permission/interactive.js';
import type { PermissionDecision, PermissionMode } from '../permission/types.js';
import type { AgentSession } from '../sdk/agent.js';
import { ActiveTools, Transcript } from './components/rows.js';
import { Header } from './components/header.js';
import { InputEditor } from './components/input-editor.js';
import { PermissionCard } from './components/permission-card.js';
import { StatusLine } from './components/status-line.js';
import { projectTranscript } from './projection.js';
import {
  defaultTheme,
  detectTerminalCapabilities,
  type TerminalCapabilities,
  type TuiTheme,
} from './theme.js';

export interface SparkTuiAppProps {
  readonly initialSession: AgentSession;
  readonly initialEvents: readonly AgentEvent[];
  readonly approver: InteractiveApprover;
  readonly createSession: () => Promise<AgentSession>;
  readonly capabilities?: TerminalCapabilities;
  readonly theme?: TuiTheme;
  readonly version?: string;
  readonly model?: string;
  readonly permissionMode?: PermissionMode;
}

export function SparkTuiApp(props: SparkTuiAppProps): ReactElement {
  const { exit } = useApp();
  const capabilities = props.capabilities ?? detectTerminalCapabilities();
  const theme = props.theme ?? defaultTheme;
  const [session, setSession] = useState(props.initialSession);
  const [events, setEvents] = useState<AgentEvent[]>([...props.initialEvents]);
  const [liveText, setLiveText] = useState('');
  const [liveThinking, setLiveThinking] = useState('');
  const [activeTurns, setActiveTurns] = useState(0);
  const [pending, setPending] = useState<PendingApproval>();
  const [notice, setNotice] = useState(
    props.permissionMode === 'bypass'
      ? '危险：权限绕过已启用，已注册工具可不经审批执行。'
      : '',
  );
  const [exitArmed, setExitArmed] = useState(false);
  const controllers = useRef<AbortController[]>([]);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => props.approver.subscribe(setPending), [props.approver]);
  useEffect(
    () => () => {
      for (const controller of controllers.current) controller.abort('TUI closed');
      if (exitTimer.current) clearTimeout(exitTimer.current);
    },
    [],
  );

  const appendEvent = useCallback((event: AgentEvent) => {
    setEvents((current) =>
      current.some((candidate) => candidate.seq === event.seq) ? current : [...current, event],
    );
    if (
      event.type === 'turn.completed' ||
      event.type === 'turn.cancelled' ||
      event.type === 'turn.failed'
    ) {
      setLiveText('');
      setLiveThinking('');
    }
  }, []);

  const handleDelta = useCallback((delta: LlmDelta) => {
    if (delta.type === 'text') setLiveText((current) => current + delta.text);
    else if (delta.type === 'thinking') setLiveThinking((current) => current + delta.text);
  }, []);

  const submit = useCallback(
    (value: string) => {
      if (value.startsWith('/')) {
        void handleCommand(value);
        return;
      }
      const controller = new AbortController();
      controllers.current.push(controller);
      setActiveTurns((count) => count + 1);
      setNotice('');
      void session
        .turn(value, {
          signal: controller.signal,
          onEvent: appendEvent,
          onDelta: handleDelta,
        })
        .finally(() => {
          controllers.current = controllers.current.filter((candidate) => candidate !== controller);
          setActiveTurns((count) => Math.max(0, count - 1));
        });
    },
    [appendEvent, handleDelta, session],
  );

  const handleCommand = async (raw: string): Promise<void> => {
    const [command] = raw.trim().split(/\s+/, 1);
    switch (command) {
      case '/help':
        setNotice('/help /status /model /perm /clear /exit · Enter 发送 · Shift+Enter 换行 · Esc 中断');
        break;
      case '/status':
        setNotice(`session=${session.sessionId} · queued=${session.queuedTurns()} · events=${events.length}`);
        break;
      case '/model':
        setNotice(`当前模型: ${props.model ?? 'unconfigured'}`);
        break;
      case '/perm':
        setNotice(
          `权限模式: ${props.permissionMode ?? session.permissionMode}（未知/策略异常/审批缺失均 fail-closed）`,
        );
        break;
      case '/clear': {
        if (activeTurns > 0) {
          setNotice('当前仍有 turn 运行；请先中断或等待完成，再开启新会话。');
          break;
        }
        const next = await props.createSession();
        const initial: AgentEvent[] = [];
        for await (const event of next.events()) initial.push(event);
        setSession(next);
        setEvents(initial);
        setNotice(`已开启新会话 ${next.sessionId}`);
        break;
      }
      case '/exit':
      case '/quit':
        exit();
        break;
      default:
        setNotice(`未知命令: ${command ?? raw} · 输入 /help 查看命令`);
    }
  };

  const interrupt = useCallback(() => {
    const controller = controllers.current[0];
    if (controller) controller.abort('User interrupted');
  }, []);

  const controlC = useCallback(() => {
    if (activeTurns > 0) {
      interrupt();
      return;
    }
    if (exitArmed) {
      exit();
      return;
    }
    setExitArmed(true);
    setNotice('再按一次 Ctrl+C 退出');
    if (exitTimer.current) clearTimeout(exitTimer.current);
    exitTimer.current = setTimeout(() => {
      setExitArmed(false);
    }, 1_000);
  }, [activeTurns, exit, exitArmed, interrupt]);

  const decide = useCallback(
    (decision: PermissionDecision) => {
      if (pending) props.approver.decide(pending.request.requestId, decision);
    },
    [pending, props.approver],
  );

  const projection = useMemo(
    () => projectTranscript(events, capabilities),
    [capabilities, events],
  );
  const metrics = useMemo(() => deriveMetrics(events), [events]);
  const action = deriveAction(events, liveText, liveThinking, pending);
  const frame = events.length + liveText.length + liveThinking.length;

  return (
    <Box flexDirection="column">
      <Header
        version={props.version ?? '0.1.0'}
        model={props.model ?? 'unconfigured'}
        cwd={session.cwd}
        sessionId={session.sessionId}
        width={capabilities.width}
        theme={theme}
      />
      <Transcript rows={projection.settled} theme={theme} />
      {liveThinking && <Text color={theme.dim}>▍ 思考中 · {liveThinking}</Text>}
      {liveText && <Text>{`  ${liveText}`}</Text>}
      <ActiveTools tools={projection.activeTools} capabilities={capabilities} theme={theme} />
      {pending && (
        <PermissionCard
          pending={pending}
          theme={theme}
          onDecide={decide}
          onNotice={(message) => {
            setNotice(message);
          }}
        />
      )}
      <StatusLine
        busy={activeTurns > 0}
        action={action}
        model={props.model ?? 'unconfigured'}
        step={metrics.steps}
        tokens={metrics.tokens}
        costUsd={metrics.costUsd}
        queued={session.queuedTurns()}
        frame={frame}
        capabilities={capabilities}
        theme={theme}
      />
      {notice && <Text color={theme.warn}>{notice}</Text>}
      <InputEditor
        active
        locked={pending !== undefined}
        theme={theme}
        onSubmit={submit}
        onEscape={interrupt}
        onControlC={controlC}
      />
      <Text color={theme.dim} dimColor>
        /help 帮助 · ↑ 历史 · esc 中断
      </Text>
    </Box>
  );
}

function deriveMetrics(events: readonly AgentEvent[]): {
  readonly steps: number;
  readonly tokens: number;
  readonly costUsd: number;
} {
  let steps = 0;
  let tokens = 0;
  let costUsd = 0;
  for (const event of events) {
    if (event.type === 'step.started') steps += 1;
    else if (event.type === 'assistant.completed') {
      tokens += event.usage.inputTokens + event.usage.outputTokens;
    } else if (event.type === 'turn.completed') costUsd += event.stats.costUsd;
  }
  return { steps, tokens, costUsd };
}

function deriveAction(
  events: readonly AgentEvent[],
  liveText: string,
  liveThinking: string,
  pending: PendingApproval | undefined,
): string {
  if (pending) return '等待权限确认';
  if (liveText) return '生成回答';
  if (liveThinking) return '正在思考';
  const latest = events.at(-1);
  if (latest?.type === 'tool.intent') return `运行工具 ${latest.callId}`;
  if (latest?.type === 'step.started') return '请求模型';
  return '处理中';
}
