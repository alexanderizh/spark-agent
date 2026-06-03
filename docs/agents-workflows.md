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

## Runtime Behavior

If an agent has a workflow, the runtime injects a `[Workflow Execution Plan]` section into the system prompt. Nodes are topologically ordered from the graph edges. Node-level model, skill, rule, tool, MCP, and permission settings are treated as preferred phase configuration.

Runtime rules are injected as a `[Runtime Rules]` section. This includes active system/project rules, project instruction files, selected agent rules, and workflow node rules. Agent-level skill selections are included in the runtime skill catalog, and agent/workflow MCP selections filter the MCP servers passed to the SDK. If no MCP allow-list is configured, all enabled MCP servers remain available.

Agent-specific hooks are optional. When enabled on an agent, they override global hook settings for sessions running that agent. When disabled, global hook settings remain the fallback.

Current SDK execution is one turn per user message. That means node model switching is represented as execution guidance inside the prompt rather than separate SDK child runs. The graph still gives the model a concrete execution order and per-node preferences, while leaving room for a future multi-run workflow executor.
