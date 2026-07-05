# Agents and Workflows

Spark Agent now supports managed agent profiles and workflow graphs.

## Agent Profiles

The built-in `platform-manager-agent` is the default agent for new conversations. Spark only ships this one built-in agent by default; custom agents can be created from the Agents page and configured with:

- default provider, model, adapter, permission mode, and reasoning effort
- agent prompt
- rule selection
- enabled and disabled skills
- MCP server allow-list
- agent-specific hook overrides for permission requests, user questions, session completion, and failures
- optional workflow binding

From the Agents page, each profile's `快速对话` entry now opens a lightweight project picker before the conversation starts. Users can jump straight into an existing project, create a brand-new project, or enter a temporary chat; the newly opened session is always created with the selected agent instead of reusing the previous project's context by accident.

When a conversation uses an agent, `sessions.agent_id` stores the selected profile. The session runtime patch carries `agentId`, so queued and follow-up turns keep the same agent unless the user changes it.

In the sidebar, the `临时会话` group now behaves more like a normal project group: selecting one of those sessions also switches the active workspace to the no-project context, and the group header exposes a quick-create action plus a small operations menu for creating another temporary session or opening the temporary workspace folder.

## Workflow Graphs

Workflows are stored in `workflows.graph_json` as:

- `nodes`: visual nodes with `kind`, title, position, and config
- `edges`: directed connections between nodes

Node configuration supports prompts, provider/model preference, skill IDs, rule IDs, built-in tool IDs, MCP server IDs, permission mode, retry count, and phase metadata. The visual editor lets users drag nodes, add node kinds, connect nodes, and edit node configuration.

The Workflows view is split into two surfaces:

- a card list page for creating, refreshing, and selecting workflows
- a detail orchestration page for editing one workflow graph with the node palette, canvas, and inspector

This keeps workflow selection out of the graph editor, so the canvas has enough space for practical node arrangement.

The workflow card list now also supports right-click actions, JSON import/export, and batch export of selected workflows. Inside the graph editor, navigation away from an unsaved workflow is guarded before leaving the editor surface or switching to another workflow.

The node palette surfaces each node kind's current runtime mode. The current workflow runtime supports 11 node kinds:

- `input`: parse the user's request into objective, constraints, and deliverables.
- `plan`: produce a read-only plan before any risky action.
- `agent`: dispatch work to a managed Agent profile.
- `subagent`: dispatch a temporary focused worker.
- `skill`: run a temporary restricted worker with only the selected skills attached.
- `tool`: run a temporary restricted worker with built-in tool access narrowed by `toolIds`.
- `mcp`: run a temporary restricted worker with MCP servers narrowed by `mcpServerIds`.
- `approval`: pause for human confirmation.
- `verify`: run configured verification commands.
- `review`: perform a read-only review of outputs and risks.
- `artifact`: assemble the final deliverable, optionally exporting it to a workspace file.

For non-technical users, the safest default shape is:

```text
input -> plan -> approval -> agent -> verify -> review -> artifact
```

For coding workflows, keep `plan` and `review` read-only, put actual edits in the `agent` node, and make sure the execution node can use the required tools (`Read`, `Grep`, `Glob`, `Edit`, `MultiEdit`, and usually `Bash`). If a node explicitly configures `toolIds`, every restrictable tool not listed there is disabled for that dispatch. Leaving `toolIds` empty means "do not apply an extra workflow-level tool restriction".

## Runtime Behavior

If an agent has a workflow, the runtime injects a `[Workflow Execution Plan]` section into the system prompt. Nodes are topologically ordered from the graph edges. Node-level model, skill, rule, tool, MCP, and permission settings are treated as preferred phase configuration.

On the Claude SDK path, Spark now exposes `mcp__spark_team__workflow_run` whenever the workflow graph contains executable nodes. That tool runs the managed workflow for the current objective, persists `workflow_runs` snapshots for resume/audit, dispatches `agent` / `subagent` nodes through the team dispatcher, and executes host-side atomic nodes such as `input`, `approval`, and `verify`. Atomic-only workflows can run through the same tool, so they no longer depend on prompt-only behavior.

`skill`, `tool`, `mcp`, `plan`, `review`, and `artifact` nodes can also run as temporary restricted workers when `config.execution` is not `static`. This lets a workflow express both simple human-readable process steps and enforceable capability boundaries. `input`, `plan`, and `review` are intentionally read-only by default: they filter out write and command tools so the workflow can separate "think/check" phases from "act" phases.

On the Codex path, Spark does not expose `workflow_run`. Instead, the workflow stays as a structured execution prompt: Codex is instructed to follow the graph in topological order, preserve node intent, and report the blocking node if it cannot complete the active path.

Runtime rules are injected as a `[Runtime Rules]` section. This includes active system/project rules, selected agent rules, and workflow node rules. Project instruction files such as `AGENTS.md` and `CLAUDE.md` are loaded through `[Project Instruction Files]`; duplicate file bodies are skipped after the first source so Codex and Claude rules can both be discovered without wasting prompt tokens. Agent-level skill selections are included in the runtime skill catalog, and agent/workflow MCP selections filter the MCP servers passed to the SDK. If no MCP allow-list is configured, all enabled MCP servers remain available.

Agent-specific hooks are optional. When enabled on an agent, they override global hook settings for sessions running that agent. When disabled, global hook settings remain the fallback.

Current SDK execution is still one host turn per user message. When `workflow_run` is available, the host uses one tool call to drive the graph execution and child dispatches. Node model switching remains a preference/override on each dispatched worker rather than a fully separate host SDK run per node.

Common customer-facing templates:

- Coding development: `input -> plan -> approval -> agent -> verify -> review -> artifact`.
- Research report: `input -> plan -> skill(search) -> mcp(web/docs) -> review -> artifact`.
- Release checklist: `input -> agent -> verify -> approval -> review -> artifact`.

## Platform Management Tools

Every session receives the built-in `spark_platform` MCP server. The platform manager skill documents the full `mcp__spark_platform__*` surface and should be updated whenever tools are added or removed.

The platform tool surface currently covers:

- Skills: list, load, search, install, GitHub install, uninstall, toggle
- MCP servers: list, create, update, delete, status
- Providers: list, get, create, update, delete, health check, set default, set default model
- Workflows: list, get, create, update, delete
- Agents: list, get, create, update, delete
- Teams: list, get, create, update, delete
- Settings: get, set, category get, get all
- Sessions: get, switch model/provider/mode/permission/reasoning effort
- Board tasks: list, get, create, update, delete, batch operations, restore, permanent delete

Team CRUD is exposed through `mcp__spark_platform__teams_*` and persists long-lived team definitions in `agent_teams`. Agents should use `agents_list` to resolve host/member IDs before calling `teams_create` or `teams_update`.

## Team Mode (Agent-to-Agent)

Team Mode lets a **Host agent** delegate focused subtasks to **Member agents** during a single conversation, lets members message each other (peer messaging) and hold multi-round discussions, and renders the collaboration as an IM-style group chat. See the full design in `团队模式开发.md` and the A2A upgrade in `todo/团队模式A2A深度协作升级方案.md` / `todo/团队模式成员自由交流v2-实施方案.md`.

### Enabling

In the Composer's agent picker, choose **团队模式（多 Agent 协作）**. The picker label becomes `团队模式 · <Host>`, a **成员 N** chip appears, and the Inspector shows a **团队成员** section where you toggle which agents may be dispatched in this session.

Team config is stored per session in `sessions.metadata.team` (`enabled / hostAgentId / memberAgentIds / maxDepth / allowNesting / maxDiscussionRounds / enablePeerMessaging`) and mirrored to `composer-prefs` as the global last-used default. It is also submitted with each turn via `session:send-turn`'s `teamConfig`.

Saved teams are stored separately in `agent_teams`. They can be created from the Agents view's Teams tab or by the platform management tools, then selected from the Agent Picker as reusable Team Mode presets.

### Tools (the `spark_team` MCP server)

The Host turn injects an in-process MCP server `spark_team` (name kept for compat; planned rename to `spark_orchestrate` under unified-orchestration-kernel M6), exposing the tools defined in `packages/agent-runtime/src/services/team-tool-names.ts`:

| Tool | Purpose |
|---|---|
| `agent_dispatch` / `agent_dispatch_batch` | Host (or a member with `allowNesting`) delegates a focused subtask to one or more members; blocks until the member returns a structured reply. |
| `agent_message` | Peer message between members (and member→Host). Three forms: **broadcast** (no `targetAgentId`, only writes the shared thread, does not trigger execution), **directed `call`** (triggers one synchronous turn for the target), **directed `note`** (async, writes thread only). Gated by `enablePeerMessaging`. |
| `team_round_advance` | Host explicitly advances the discussion to the next round (state machine). |
| `team_conclude` | Host concludes the discussion thread. |

A `[Team Roster]` system-prompt section lists available members and a four-mode collaboration handbook (directly answer / consult then answer / handoff / leave a note). The built-in `Task` tool is disabled so all A2A goes through the dispatcher. **codex members** consume the same tool surface over an HTTP bridge (`127.0.0.1` + Bearer token, Phase 0b) rather than in-process MCP, so claude and codex adapters can be mixed in one team.

### How dispatch & peer messaging work

1. **Dispatch (Host→Member or nested):** `TeamDispatchService.run` validates (member enabled, depth, per-turn budget), persists a `team_dispatches` row, emits `team_dispatch_requested`, and queues member execution per turn so concurrent calls don't race the same workspace/session files. The member runs a one-shot turn with its own provider/model/skills/MCP and an isolated Claude SDK `sdkSessionId`; streaming `assistant_message` events are rebranded to `team_member_message` (tagged with `dispatchId`). On completion a structured `TeamA2AReply` is returned to the caller and emitted as `team_dispatch_completed`.
2. **Peer `call`:** a member calling `agent_message({ targetAgentId, mode: 'call' })` triggers a synchronous one-shot turn for the target inside the same outer turn, billed to an **independent `peerCallCountByTurn` budget** so it doesn't starve Host/workflow dispatch budget. Consult chains are bounded by `consultDepth` (max 3). When remaining time (`deadlineAt`) < 30s, synchronous calls are rejected and the model is steered to a note or a direct answer.
3. **Peer `note` / broadcast:** writes a row to `team_thread_messages` (`delivery='note'`) and emits `team_peer_message.delivery='note'` — no execution. `TeamDiscussionRepository.renderThreadForPrompt(discussionId, tokenBudget, viewerAgentId)` renders the shared thread into each member's prompt; notes addressed to the viewer are surfaced at the end with `[NOTE FOR YOU]` so they aren't lost in long discussions.
4. **Discussion rounds:** `team_round_advance` / `team_conclude` drive the explicit round state machine; the shared discussion thread persists across turns.

### Avatars & timeline UI

- Agent avatars are stored in `agents.metadata.avatar`; user avatars are stored in the `general.data.userAvatar` setting.
- The default avatar source is a DiceBear URL (`https://api.dicebear.com/9.x/{style}/svg?seed={nickname}`), and users can upload a local image that is cropped client-side to a 256px square data URL.
- Team member output is no longer visually nested under the Host. Dispatch events appear as lightweight status rows, raw tool JSON is hidden from the main timeline, and each `team_member_message` renders as an independent chat row: avatar on the left, agent name above the message body. `team_peer_message` bubbles show `sender → receiver`, with a "留言" badge for notes.
- `team_member_message` deltas and completes are merged by `dispatchId`, so a final complete event cannot duplicate an already-streamed answer.

### Nesting, rounds & limits

- `allowNesting=false` (default): members cannot call `agent_dispatch`. With `allowNesting=true`, a member receives `spark_team` at depth+1 and may dispatch while `depth < maxDepth` (max 3). `allowNesting` controls **nested dispatch only**; peer messaging is governed separately by `enablePeerMessaging`.
- Per-turn dispatch budget: **10** (`DEFAULT_MAX_DISPATCHES_PER_TURN`); peer calls have a separate budget of **20/turn**.
- Multi-round discussion: `maxDiscussionRounds` default **6**, hard max **20**; `maxMessagesPerDiscussion` = **40**; per-pair/per-round directed-message cap **8**; auto-mention chain (`maybeAutoDispatchMentions`) bounded by `MAX_AUTO_MENTION_HOPS=6`; consult depth max **3**.
- Each dispatch has a default 120s timeout (max 600s). Cancelling the session aborts all in-flight dispatches and peer calls through the same AbortController.
- Anti-ping-pong: backend hard limits on message volume + rounds + pair caps, plus prompt-level rule "do not immediately ping the sender back".

### Events

Team Mode adds these events to the `AgentEvent` union, distinct from the SDK's built-in `subagent_*` events: `team_dispatch_requested`, `team_member_message`, `team_member_status`, `team_dispatch_completed`, `team_peer_message` (with optional `delivery: 'call' | 'note'`), `team_round_advanced`, `team_discussion_concluded`. History can be queried via `team:list-dispatches`.
