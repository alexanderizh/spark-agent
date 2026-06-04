# Agents and Workflows

Spark Agent now supports managed agent profiles and workflow graphs.

## Agent Profiles

The built-in `code-agent` remains the default agent for new conversations. Custom agents can be created from the Agents page and configured with:

- default provider, model, adapter, permission mode, and reasoning effort
- agent prompt
- rule selection
- enabled and disabled skills
- MCP server allow-list
- agent-specific hook overrides for permission requests, user questions, session completion, and failures
- optional workflow binding

When a conversation uses an agent, `sessions.agent_id` stores the selected profile. The session runtime patch carries `agentId`, so queued and follow-up turns keep the same agent unless the user changes it.

## Workflow Graphs

Workflows are stored in `workflows.graph_json` as:

- `nodes`: visual nodes with `kind`, title, position, and config
- `edges`: directed connections between nodes

Node configuration supports prompts, provider/model preference, skill IDs, rule IDs, built-in tool IDs, MCP server IDs, permission mode, retry count, and phase metadata. The visual editor lets users drag nodes, add node kinds, connect nodes, and edit node configuration.

The Workflows view is split into two surfaces:

- a card list page for creating, refreshing, and selecting workflows
- a detail orchestration page for editing one workflow graph with the node palette, canvas, and inspector

This keeps workflow selection out of the graph editor, so the canvas has enough space for practical node arrangement.

## Runtime Behavior

If an agent has a workflow, the runtime injects a `[Workflow Execution Plan]` section into the system prompt. Nodes are topologically ordered from the graph edges. Node-level model, skill, rule, tool, MCP, and permission settings are treated as preferred phase configuration.

Runtime rules are injected as a `[Runtime Rules]` section. This includes active system/project rules, project instruction files, selected agent rules, and workflow node rules. Agent-level skill selections are included in the runtime skill catalog, and agent/workflow MCP selections filter the MCP servers passed to the SDK. If no MCP allow-list is configured, all enabled MCP servers remain available.

Agent-specific hooks are optional. When enabled on an agent, they override global hook settings for sessions running that agent. When disabled, global hook settings remain the fallback.

Current SDK execution is one turn per user message. That means node model switching is represented as execution guidance inside the prompt rather than separate SDK child runs. The graph still gives the model a concrete execution order and per-node preferences, while leaving room for a future multi-run workflow executor.

## Team Mode (Agent-to-Agent)

Team Mode lets a **Host agent** delegate focused subtasks to **Member agents** during a single conversation, and renders the collaboration as an IM-style group chat. See the full design in `团队模式开发.md`.

### Enabling

In the Composer's agent picker, choose **团队模式（多 Agent 协作）**. The picker label becomes `团队模式 · <Host>`, a **成员 N** chip appears, and the Inspector shows a **团队成员** section where you toggle which agents may be dispatched in this session.

Team config is stored per session in `sessions.metadata.team` (`enabled / hostAgentId / memberAgentIds / maxDepth / allowNesting`) and mirrored to `composer-prefs` as the global last-used default. It is also submitted with each turn via `session:send-turn`'s `teamConfig`.

### How dispatch works

1. The Host turn injects an in-process MCP server `spark_team` exposing the tool `mcp__spark_team__agent_dispatch`, plus a `[Team Roster]` system-prompt section listing available members. The built-in `Task` tool is disabled so all A2A goes through the dispatcher.
2. When the Host calls `agent_dispatch`, `TeamDispatchService` validates (member enabled, depth, per-turn budget of 5), persists a `team_dispatches` row, and emits `team_dispatch_requested`.
3. The member runs a one-shot turn with its own provider/model/skills/MCP. Its streaming `assistant_message` events are rebranded to `team_member_message` (tagged with `dispatchId`) so the UI renders them as an indented, color-barred member bubble.
4. On completion, a structured `TeamA2AReply` is returned to the Host (and emitted as `team_dispatch_completed`). The Host decides whether to dispatch again or synthesize a final answer.

### Nesting & limits

- `allowNesting=false` (default): members cannot dispatch. With `allowNesting=true`, a member receives `spark_team` at depth+1 and may dispatch while `depth < maxDepth` (max 3).
- Soft budget of 5 dispatches per turn; exceeding it returns a `Dispatch budget exceeded` error to the Host.
- Each dispatch has a default 120s timeout (max 600s). Cancelling the session aborts all in-flight dispatches.

### Events

Team Mode adds four events to the `AgentEvent` union, distinct from the SDK's built-in `subagent_*` events: `team_dispatch_requested`, `team_member_message`, `team_member_status`, `team_dispatch_completed`. History can be queried via `team:list-dispatches`.
