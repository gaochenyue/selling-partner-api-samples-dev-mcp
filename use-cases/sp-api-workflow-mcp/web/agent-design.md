# Design Doc: Conversational Agent for SP-API Workflow Builder

## Status: Draft

## Problem

The current web app provides a form-driven UI for executing pre-built workflows. Users who want to **discover** SP-API endpoints or **build** new workflows must switch to Claude Code CLI with the MCP servers attached. There is no way to explore SP-API capabilities and construct workflows through natural language conversation within the web app itself.

## Goal

Add a conversational agent to the web app that connects to both the **SP-API MCP server** and the **Workflow Builder MCP server**. Users chat with the agent to:

1. Discover SP-API endpoints (e.g., "What endpoints are available for inbound shipments?")
2. Build workflows interactively (e.g., "Create a workflow that creates an inbound plan, then lists shipment items")
3. Modify existing workflows (e.g., "Add error handling if the createInboundPlan call fails")

The agent runs on **AWS Bedrock** via the Claude Agent SDK.

## Architecture

```
 Browser (React)                 Express Server (:3001)
 +-----------------+             +---------------------------+
 |                 |   SSE/POST  |                           |
 | ChatPanel.jsx   | ----------> | POST /api/agent/chat      |
 |  - message list |             |  - creates/resumes session|
 |  - input box    | <---------- |  - streams agent messages |
 |  - tool calls   |   SSE       |                           |
 |                 |             | AgentService              |
 +-----------------+             |  - manages sessions       |
                                 |  - calls query()          |
                                 |                           |
                                 |   +-------------------+   |
                                 |   | Claude Agent SDK  |   |
                                 |   |  query({          |   |
                                 |   |    prompt,        |   |
                                 |   |    mcpServers,    |   |
                                 |   |    resume         |   |
                                 |   |  })               |   |
                                 |   +--------+----------+   |
                                 |            |              |
                                 +------------|------+-------+
                                              |      |
                             +----------------+      +----------------+
                             |                                        |
                    MCP: SP-API Server                     MCP: Workflow Builder
                    (stdio subprocess)                     (stdio subprocess)
                    - list endpoints                       - create_workflow
                    - describe endpoint                    - add_task_state
                    - search endpoints                     - add_choice_state
                                                           - connect_states
                                                           - validate_workflow
                                                           - ... (28 builder tools)
                                                           - ... (7 interpreter tools)
                                                           - ... (4 callback tools)
```

## Key Design Decisions

### 1. Agent runs server-side

The Claude Agent SDK spawns a subprocess that needs access to MCP servers, AWS credentials, and the filesystem. The browser is a thin client that sends messages and renders streamed responses.

### 2. Bedrock authentication via environment variables

The Agent SDK picks up Bedrock config from `process.env` automatically. No SDK-level Bedrock configuration is needed.

Required env vars (loaded in `app.js` alongside existing SP-API credential loading):

```
CLAUDE_CODE_USE_BEDROCK=1
AWS_REGION=us-east-1
AWS_BEARER_TOKEN_BEDROCK=<bedrock-api-key>   # or IAM creds
```

Optional model pinning:

```
ANTHROPIC_DEFAULT_SONNET_MODEL=us.anthropic.claude-sonnet-4-6
ANTHROPIC_DEFAULT_HAIKU_MODEL=us.anthropic.claude-haiku-4-5-20251001-v1:0
```

These can live in the existing `web/.env.json` file alongside the SP-API credentials, and be assigned to `process.env` at server startup.

### 3. MCP server configuration is externalized

MCP servers are **not bundled** into the agent at build time. The agent config module (`agent-config.js`) reads MCP server definitions from `web/.env.json` (or env vars), so servers can be added, removed, or reconfigured without code changes.

Config shape in `.env.json`:

```json
{
  "CLAUDE_CODE_USE_BEDROCK": "1",
  "AWS_REGION": "us-east-1",
  "AWS_BEARER_TOKEN_BEDROCK": "...",
  "AGENT_MCP_SERVERS": {
    "workflow": {
      "command": "node",
      "args": ["/absolute/path/to/workflow-mcp/index.js"]
    },
    "sp-api": {
      "command": "node",
      "args": ["/absolute/path/to/sp-api-mcp/index.js"]
    }
  }
}
```

The `AGENT_MCP_SERVERS` object is passed directly to the Agent SDK's `mcpServers` option. Each key becomes a server name, and the agent sees a merged tool list from all configured servers. Servers can be added later without touching agent code.

### 4. Single session with resume

One active chat session at a time. The server holds the current `agentSessionId` in memory:

- First message: `query({ prompt, options: { mcpServers, allowedTools } })` — captures `session_id` from the init event
- Subsequent messages: `query({ prompt, options: { resume: sessionId } })` — resumes with full conversation history
- A "New Chat" action on the client clears the session ID and starts fresh

### 5. Streaming via Server-Sent Events (SSE)

Agent responses stream token-by-token. The Express endpoint opens an SSE connection:

```
POST /api/agent/chat
  Body: { sessionId?, message }
  Response: SSE stream of agent events
```

Event types streamed to the client:

| Event              | Payload                              | Purpose                              |
|--------------------|--------------------------------------|--------------------------------------|
| `session`          | `{ sessionId }`                      | Session ID for resume                |
| `text`             | `{ content }`                        | Streamed text tokens                 |
| `tool_use`         | `{ tool, input }`                    | Agent is calling an MCP tool         |
| `tool_result`      | `{ tool, output }`                   | Tool call completed                  |
| `workflow_diagram` | `{ workflowId, mermaid, stateCount }`| Live diagram update (see section 8)  |
| `result`           | `{ content }`                        | Final agent response                 |
| `error`            | `{ message }`                        | Error occurred                       |

### 6. Allowed tools — scoped for safety

The agent should be able to read and build but not execute workflows autonomously or modify files on disk. Allowed tools:

```js
allowedTools: [
  // All MCP tools are auto-allowed
  // Built-in tools:
  "Read",
  "Glob",
  "Grep",
  "Write"   // for exporting workflow JSON to workflows/
]
```

The 39 MCP tools (28 builder + 7 interpreter + 4 callback) are available through the MCP server connections. Workflow execution can be offered but should require user confirmation through the existing web UI — the agent builds the workflow, the user runs it via the WorkflowPlayer.

### 7. System prompt

The agent needs context about what it can do:

```
You are a workflow building assistant for Amazon SP-API.

You have access to two sets of tools:
- SP-API tools: discover and explore SP-API endpoints, their parameters, and response schemas
- Workflow tools: create, modify, and validate workflows using Amazon States Language

When the user asks about SP-API capabilities, use the SP-API tools to look up real endpoint information.
When the user wants to build a workflow, use the workflow tools to construct it step by step.

Always validate workflows after building them.

IMPORTANT — After EVERY workflow mutation (adding a state, connecting states,
removing a state, changing start state), call workflow_to_mermaid so the user
sees the diagram update in real time. Do this after each individual change,
not just at the end.

IMPORTANT — After building or modifying a workflow, you MUST export it:
1. Call get_workflow_schema to get the ASL JSON
2. Write the JSON to the workflows/ directory using the Write tool
   File name: workflows/{workflow-name-in-kebab-case}.json
This makes the workflow available in the workflow player UI.
```

## New Files

```
web/
  server/
    agent/
      agent-service.js       # AgentService class — session mgmt, query() wrapper
      agent-config.js        # Loads MCP servers from .env.json AGENT_MCP_SERVERS, env vars, system prompt
    routes/
      agent.js               # POST /api/agent/chat SSE endpoint, emits workflow_diagram events
  client/
    ChatPanel.jsx            # Chat UI — split layout: messages left, diagram right
    WorkflowDiagram.jsx      # Renders Mermaid string to SVG via mermaid library
    hooks/
      useAgentChat.js        # SSE client hook — send message, consume streamed events + diagram state
```

## Changes to Existing Files

| File                   | Change                                                   |
|------------------------|----------------------------------------------------------|
| `web/package.json`     | Add `@anthropic-ai/claude-agent-sdk` dependency          |
| `web/server/app.js`    | Import agent routes, load Bedrock env vars from .env.json, mount `/api/agent` |
| `web/client/App.jsx`   | Add `/chat` route pointing to ChatPanel                  |

## API Contract

### POST /api/agent/chat

**Request:**
```json
{
  "sessionId": "optional-existing-session-id",
  "message": "What SP-API endpoints handle inbound shipments?"
}
```

**Response:** SSE stream

```
event: session
data: {"sessionId":"sess_abc123"}

event: tool_use
data: {"tool":"mcp__sp-api__list_endpoints","input":{"category":"inbound"}}

event: tool_result
data: {"tool":"mcp__sp-api__list_endpoints","output":{...}}

event: text
data: {"content":"There are several SP-API endpoints for inbound shipments:\n\n1. ..."}

event: result
data: {"content":"There are several SP-API endpoints..."}
```

## Example Conversation Flow

```
User: What SP-API endpoints can I use for FBA inbound?

Agent: [calls sp-api.list_endpoints({category: "fulfillmentInbound"})]
       Here are the FBA inbound endpoints:
       1. createInboundPlan - Creates a new inbound plan
       2. listInboundPlanItems - Lists items in a plan
       3. getShipment - Gets shipment details
       ...
       (no diagram — no workflow yet)

User: Build me a workflow that creates an inbound plan and then gets the shipment details

Agent: [calls workflow.create_workflow({name: "FBA Inbound Plan"})]
       [calls workflow.add_task_state({name: "CreatePlan", ...})]
       [calls workflow.workflow_to_mermaid({...})]
         → SSE: workflow_diagram  ──►  diagram panel appears: [CreatePlan]
       [calls workflow.add_task_state({name: "GetShipment", ...})]
       [calls workflow.workflow_to_mermaid({...})]
         → SSE: workflow_diagram  ──►  diagram updates: [CreatePlan]  [GetShipment]
       [calls workflow.connect_states({from: "CreatePlan", to: "GetShipment"})]
       [calls workflow.workflow_to_mermaid({...})]
         → SSE: workflow_diagram  ──►  diagram updates: [CreatePlan] → [GetShipment]
       [calls workflow.validate_workflow({...})]
       [calls workflow.get_workflow_schema({...})]
       [writes workflows/fba-inbound-plan.json]

       I've created the "FBA Inbound Plan" workflow with 2 states.
       It's ready to run — you can switch to the workflow player to execute it.

User: Add error handling if CreatePlan fails

Agent: [calls workflow.add_fail_state({name: "PlanFailed", ...})]
       [calls workflow.workflow_to_mermaid({...})]
         → SSE: workflow_diagram  ──►  diagram updates: CreatePlan → GetShipment
                                                         └──(error)──→ PlanFailed
       [calls workflow.get_workflow_schema({...})]
       [writes workflows/fba-inbound-plan.json]

       Done. If CreatePlan returns an error, the workflow now routes to a
       PlanFailed state with the error details.
```

## Dependencies

| Package                          | Version | Purpose                             |
|----------------------------------|---------|-------------------------------------|
| `@anthropic-ai/claude-agent-sdk` | latest  | Agent SDK with MCP support          |
| `mermaid`                        | latest  | Client-side Mermaid diagram renderer |

## IAM Permissions (Bedrock)

The AWS credentials used need:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream",
        "bedrock:ListInferenceProfiles"
      ],
      "Resource": [
        "arn:aws:bedrock:*:*:inference-profile/*",
        "arn:aws:bedrock:*:*:foundation-model/*"
      ]
    }
  ]
}
```

## Real-Time Workflow Visualization

The chat UI shows a live Mermaid diagram of the workflow as the agent builds it. Every time the agent adds a state, connects states, or modifies the workflow, the diagram updates in place.

### How it works

The workflow MCP server already has a `workflow_to_mermaid` tool that converts an ASL schema to a Mermaid flowchart string. The agent route handler watches the SSE stream for `tool_result` events from workflow-mutating tools, and when it sees one, it emits a `workflow_diagram` SSE event containing the Mermaid string. The client renders it.

```
Agent calls add_task_state(...)
       │
       ▼
tool_result from MCP  ──────────────────────► SSE: tool_result (normal)
       │
       │  route handler detects mutating tool
       │  extracts workflow_id from result
       │  calls workflow_to_mermaid via same MCP session
       ▼
mermaid string returned ─────────────────────► SSE: workflow_diagram
       │
       ▼
Client re-renders Mermaid diagram in side panel
```

### Mutating tools that trigger a diagram update

These are the workflow MCP tools that change the schema and should trigger a re-render:

| Tool | Returns `workflow_id` in |
|------|--------------------------|
| `create_workflow` | `result.workflow_id` |
| `import_workflow` | `result.workflow_id` |
| `add_task_state` | `result.workflow_id` |
| `add_fetch_state` | `result.workflow_id` |
| `add_choice_state` | `result.workflow_id` |
| `add_succeed_state` | `result.workflow_id` |
| `add_fail_state` | `result.workflow_id` |
| `add_wait_state` | `result.workflow_id` |
| `add_pass_state` | `result.workflow_id` |
| `add_input_state` | `result.workflow_id` |
| `connect_states` | `result.workflow_id` |
| `set_start_state` | `result.workflow_id` |
| `remove_state` | `result.workflow_id` |

### Server-side: agent route handler

The agent route handler (`routes/agent.js`) intercepts `tool_result` messages from the Agent SDK stream. When the tool name matches a mutating tool:

1. Extract `workflow_id` from the tool result
2. The agent's system prompt already instructs it to call `workflow_to_mermaid` after mutations
3. When the handler sees a `workflow_to_mermaid` tool result, emit a `workflow_diagram` SSE event:

```
event: workflow_diagram
data: {"workflowId":"wf_abc","mermaid":"graph TD\n  CreatePlan[CreatePlan]-->GetShipment[GetShipment]","stateCount":2}
```

This approach keeps the diagram generation inside the agent's tool loop — no separate MCP connection needed from the route handler.

### Client-side: diagram panel

The `ChatPanel.jsx` has a split layout:

```
+------------------------------------+---------------------------+
|                                    |                           |
|  Chat messages                     |  Workflow Diagram         |
|  - user messages                   |  (Mermaid rendered)       |
|  - agent text                      |                           |
|  - tool call indicators            |  ┌─────────────┐         |
|                                    |  │ CreatePlan  │         |
|                                    |  └──────┬──────┘         |
|                                    |         │                |
|                                    |  ┌──────▼──────┐         |
|                                    |  │ GetShipment │         |
|                                    |  └─────────────┘         |
|                                    |                           |
|  [message input box           ]    |  2 states                |
+------------------------------------+---------------------------+
```

- **Diagram panel** is hidden when no workflow is being built, shown on first `workflow_diagram` event
- Each `workflow_diagram` event replaces the previous render
- Uses a Mermaid rendering library (e.g. `mermaid` npm package) to render the diagram string to SVG in the browser
- State count shown below the diagram

### System prompt addition

```
After EVERY workflow mutation (adding states, connecting states, removing states,
changing start state), call workflow_to_mermaid to generate an updated diagram.
Do this after each individual change, not just at the end.
```

### New files / changes

| Where | What |
|-------|------|
| `web/client/WorkflowDiagram.jsx` | New component — renders Mermaid string to SVG |
| `web/client/ChatPanel.jsx` | Split layout: chat left, diagram right |
| `web/client/hooks/useAgentChat.js` | Handle `workflow_diagram` SSE events, expose `diagram` state |
| `web/package.json` | Add `mermaid` dependency |
| Agent system prompt | Add instruction to call `workflow_to_mermaid` after every mutation |

## Workflow Store Sync

The agent's MCP server runs as a separate subprocess with its own in-memory `WorkflowStore`. Workflows built by the agent don't automatically appear in the Express server's store or the web UI. The sync mechanism uses the filesystem (`workflows/` directory) as the shared source of truth.

### How it works

```
Agent MCP subprocess                     Express server
+-------------------+                    +-------------------+
| WorkflowStore     |                    | WorkflowStore     |
|  (in-memory)      |                    |  (in-memory)      |
|                   |                    |                   |
| create_workflow   |                    |                   |
| add_task_state    |                    |                   |
| get_workflow_schema ──> ASL JSON       |                   |
+-------------------+        |           +-------------------+
                             |                    ^
                             v                    |
                     +--------------+             |
                     | workflows/   | ── reload ──+
                     |  *.json      |
                     +--------------+
```

### Steps

1. **Agent system prompt** instructs the agent: after building or modifying a workflow, call `get_workflow_schema` to get the ASL JSON, then write it to `workflows/{name}.json` using the built-in `Write` tool.

2. **Express server** exposes a reload endpoint:

   ```
   POST /api/workflows/reload
   ```

   This re-scans `workflows/` and imports any new or updated JSON files into the server's `WorkflowStore` (same logic as the existing `loadWorkflows()` in `app.js`).

3. **Client** calls `/api/workflows/reload` after the agent's `result` event, so any workflow the agent just built appears immediately in the WorkflowPicker.

### Why this approach

- **No IPC or shared memory** between the MCP subprocess and Express — they remain fully decoupled.
- **`workflows/` already works** — the Express server loads from it at startup (`loadWorkflows()` in `app.js`). The reload endpoint just re-runs that logic on demand.
- **Durable** — workflows persist as JSON files. Server restarts, agent subprocess restarts, none lose data.
- **The tools exist** — the MCP server already has `get_workflow_schema` (returns ASL JSON via `toASL()`), and the Agent SDK provides the built-in `Write` tool.

### Changes required

| Where | What |
|-------|------|
| `web/server/routes/workflows.js` | Add `POST /api/workflows/reload` endpoint |
| `web/server/app.js` | Extract `loadWorkflows()` so it can be called from the reload route |
| Agent system prompt | Add instruction: "After building a workflow, export it to `workflows/` using `get_workflow_schema` + `Write`" |
| Agent allowed tools | Add `Write` (scoped — only `workflows/` directory) |
| `web/client/hooks/useAgentChat.js` | Call `/api/workflows/reload` on `result` event |
