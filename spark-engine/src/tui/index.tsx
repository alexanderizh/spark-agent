import { render, type RenderOptions } from 'ink';
import React from 'react';

import { createDefaultEnv } from '../env.js';
import type { PermissionMode } from '../permission/types.js';
import type { LlmService } from '../seams.js';
import { InteractiveApprover } from '../permission/interactive.js';
import { Agent, type AgentSession } from '../sdk/agent.js';
import type { AgentEvent } from '../events/schema.js';
import { SparkTuiApp } from './app.js';
import { detectTerminalCapabilities } from './theme.js';

export interface RunTuiOptions {
  readonly cwd?: string;
  readonly dataRoot?: string;
  readonly stdout?: NodeJS.WriteStream;
  readonly stdin?: NodeJS.ReadStream;
  readonly llm: LlmService;
  readonly model: string;
  readonly permissionMode?: PermissionMode;
}

export async function runTui(options: RunTuiOptions): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const approver = new InteractiveApprover();
  const env = createDefaultEnv({
    cwd,
    approver,
    llm: options.llm,
    ...(options.dataRoot === undefined ? {} : { dataRoot: options.dataRoot }),
  });
  const agent = Agent.open({ cwd, env });
  const permissionMode = options.permissionMode ?? 'default';
  const session = await agent.newSession({ permissionMode, model: options.model });
  const initialEvents = await collect(session);
  const stdout = options.stdout ?? process.stdout;
  const renderOptions: RenderOptions = {
    stdout,
    stdin: options.stdin ?? process.stdin,
    exitOnCtrlC: false,
    maxFps: 30,
    incrementalRendering: true,
    alternateScreen: false,
  };
  const instance = render(
    <SparkTuiApp
      initialSession={session}
      initialEvents={initialEvents}
      approver={approver}
      createSession={async () =>
        agent.newSession({ permissionMode, model: options.model })
      }
      model={options.model}
      permissionMode={permissionMode}
      capabilities={detectTerminalCapabilities(stdout)}
    />,
    renderOptions,
  );
  await instance.waitUntilExit();
}

async function collect(session: AgentSession): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of session.events()) events.push(event);
  return events;
}

export * from './app.js';
export * from './ime-guard.js';
export * from './projection.js';
export * from './theme.js';
export * from './components/header.js';
export * from './components/input-editor.js';
export * from './components/permission-card.js';
export * from './components/rows.js';
export * from './components/status-line.js';
