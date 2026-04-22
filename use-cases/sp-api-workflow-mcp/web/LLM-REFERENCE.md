# Web App — LLM Reference Guide

> This document is designed for LLMs working on this codebase. It provides the architectural context, component inventory, data flow, and conventions needed to make informed changes without re-exploring the entire project.

## What This Project Is

**Sp-api-workflow-mcp** is a system for building and executing Amazon SP-API workflows using Amazon States Language (ASL). The `web/` directory contains a React + Express web application that provides:

1. **Conversational workflow building** — Chat with a Claude agent (via Bedrock) that uses MCP tools to construct ASL workflows
2. **Live diagram visualization** — Mermaid diagrams update in real-time as the agent modifies workflows
3. **Workflow execution** — Run workflows with human-in-the-loop input handling (10 input types)
4. **Session management** — Persistent chat sessions scoped to workflows

---

## Architecture Overview

```
Browser (React, :5173 dev / :3001 prod)
    │
    ├── REST API (fetch)  ──►  Express Server (:3001)
    │                              │
    ├── SSE stream (agent chat) ──►├── Routes (workflows, executions, callbacks, agent)
    │                              ├── AgentService → Claude Agent SDK → Bedrock
    │                              │     └── spawns MCP stdio subprocesses:
    │                              │           ├── Workflow MCP (index.js at repo root)
    │                              │           └── SP-API MCP (separate repo)
    │                              │
    │                              └── Core modules (imported directly from ../../src/)
    │                                    ├── WorkflowStore    (.data/workflows/)
    │                                    ├── WorkflowExecutor (.data/executions/)
    │                                    └── CallbackHandler  (.data/callbacks/)
```

**Key insight:** The Express server imports core modules (`src/builder/`, `src/interpreter/`, `src/callback/`) as JavaScript libraries. The MCP server (`index.js`) wraps those same modules for AI tool use. They share the `.data/` filesystem for persistence.

---

## Directory Structure

```
web/
├── client/                          # React frontend
│   ├── main.jsx                     # Entry: createRoot, BrowserRouter
│   ├── App.jsx                      # Routes: /, /workflows/:id, /run/:id
│   ├── styles.css                   # All styles (single file)
│   │
│   ├── WorkflowList.jsx             # Landing page: grid of workflows, create/import
│   ├── WorkflowContext.jsx          # Main edit page: chat + tabbed diagram/schema/execute
│   ├── WorkflowPlayer.jsx           # Standalone execution page (legacy, being absorbed)
│   ├── WorkflowDiagram.jsx          # Mermaid SVG renderer with pan/zoom
│   │
│   ├── ChatSessionDropdown.jsx      # Session picker dropdown per workflow
│   ├── EventTimeline.jsx            # Execution event log (reverse-chronological)
│   ├── ApiCallPanel.jsx             # Filtered view of Task API calls
│   ├── ProgressBar.jsx              # Workflow state progress visualization
│   ├── InputRenderer.jsx            # Routes inputType → specific component
│   ├── ExecuteTab.jsx               # Execute tab within WorkflowContext
│   │
│   ├── hooks/
│   │   ├── useAgentChat.js          # SSE client: send message, parse events, manage session
│   │   ├── useWorkflowExecution.js  # Execution lifecycle: start, poll, submit, terminal
│   │   └── useWorkflowData.js       # Fetch workflow schema + diagram, refresh()
│   │
│   ├── inputs/                      # 10 input components for human-in-the-loop
│   │   ├── BooleanInput.jsx         # Toggle true/false
│   │   ├── ConfirmInput.jsx         # Yes/No confirmation
│   │   ├── DateInput.jsx            # Date picker
│   │   ├── FormInput.jsx            # Dynamic multi-field form
│   │   ├── JSONInput.jsx            # Raw JSON editor
│   │   ├── MultiSelectInput.jsx     # Checkbox list
│   │   ├── NumberInput.jsx          # Numeric input with min/max
│   │   ├── SingleSelectInput.jsx    # Radio button list
│   │   ├── TableInput.jsx           # Table with selectable rows
│   │   └── TextInput.jsx            # Text/textarea input
│   │
│   └── displays/
│       ├── SuccessScreen.jsx        # Terminal success state with output
│       └── FailureScreen.jsx        # Terminal failure state with error
│
├── server/
│   ├── app.js                       # Express entry: init stores, mount routes, serve static
│   │
│   ├── agent/
│   │   ├── agent-service.js         # AgentService: Claude Agent SDK session management
│   │   ├── agent-config.js          # Loads Bedrock config + MCP server defs from .env.json
│   │   └── session-store.js         # SessionStore: persist chat sessions as JSON files
│   │
│   └── routes/
│       ├── workflows.js             # CRUD for workflow definitions
│       ├── executions.js            # Start/poll/list workflow executions
│       ├── callbacks.js             # Submit human input for paused workflows
│       └── agent.js                 # Agent chat SSE endpoint + session management
│
├── data/sessions/                   # Persisted chat session JSON files
├── dist/                            # Vite build output (production)
├── .env.json                        # Credentials (Bedrock, SP-API, MCP server paths)
├── index.html                       # HTML entry point
├── package.json                     # Dependencies
├── vite.config.js                   # Vite: proxy /api → :3001 in dev
└── agent-design.md                  # Agent architecture design doc
```

---

## Routes

### Client-Side (React Router)

| Route | Component | Purpose |
|-------|-----------|---------|
| `/` | `WorkflowList` | Landing page: list all workflows, create new, import JSON |
| `/workflows/:workflowId` | `WorkflowContext` | Edit workflow: chat + diagram/schema/execute tabs |
| `/run/:workflowId` | `WorkflowPlayer` | Legacy standalone execution (being replaced by ExecuteTab) |

### Server API

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/workflows` | GET | List all workflows |
| `/api/workflows` | POST | Create new empty workflow `{ name, description }` |
| `/api/workflows/:id` | GET | Get workflow schema (ASL JSON) |
| `/api/workflows/:id/diagram` | GET | Get Mermaid diagram for workflow |
| `/api/workflows/import` | POST | Import workflow from ASL JSON file |
| `/api/workflows/reload` | POST | Reload workflows from disk (picks up MCP changes) |
| `/api/executions` | GET | List executions (filterable by `?workflowId=`) |
| `/api/executions` | POST | Start new execution `{ workflowId, input }` |
| `/api/executions/:id` | GET | Get execution status |
| `/api/executions/:id/events` | GET | Get execution event timeline |
| `/api/callbacks/:id/submit` | POST | Submit callback input and resume execution |
| `/api/agent/chat` | POST | Chat with agent (SSE stream) `{ message, sessionId?, workflowId? }` |
| `/api/agent/reset` | POST | Reset agent session |
| `/api/agent/sessions` | GET | List all saved chat sessions |
| `/api/agent/sessions/:id` | GET | Get single session |
| `/api/agent/sessions/:id` | DELETE | Delete session |
| `/api/agent/sessions/by-workflow/:workflowId` | GET | Sessions scoped to a workflow |

---

## State Management

No global state library. State is managed through:

1. **React hooks (useState)** — Component-local UI state
2. **Custom hooks** — Encapsulate data fetching and lifecycle:
   - `useWorkflowData(workflowId)` → `{ workflow, schema, diagram, loading, error, refresh }`
   - `useWorkflowExecution(workflowId)` → `{ status, events, callbackInfo, start, submit, ... }`
   - `useAgentChat(workflowId)` → `{ messages, loading, sessionId, sendMessage, stopChat, resetChat, loadSession }`
3. **Server-side stores** — File-based persistence:
   - `WorkflowStore` → `.data/workflows/*.json`
   - `ExecutionStore` → `.data/executions/*.json`
   - `CallbackHandler` → `.data/callbacks/*.json`
   - `SessionStore` → `web/data/sessions/*.json`

---

## Agent Chat: SSE Event Protocol

`POST /api/agent/chat` returns `Content-Type: text/event-stream`.

| SSE Event | Payload | Purpose |
|-----------|---------|---------|
| `session` | `{ sessionId }` | Session ID for resume |
| `text` | `{ content }` | Streamed text tokens |
| `tool_use` | `{ tool, input }` | Agent calling an MCP tool |
| `tool_result` | `{ tool, output }` | Tool call completed |
| `workflow_diagram` | `{ workflowId, mermaid, stateCount }` | Live diagram update |
| `result` | `{ content }` | Final agent response |
| `error` | `{ message }` | Error occurred |

**Client-side handling:** `useAgentChat.js` reads the stream via `fetch` + `ReadableStream`, parses SSE events, and updates state. An `AbortController` allows cancellation.

---

## Execution Lifecycle

```
IDLE → POST /api/executions → RUNNING → poll /events every 2s
                                           │
                              ┌─────────────┼──────────────┐
                              ▼             ▼              ▼
                         SUCCEEDED    WAITING_FOR_INPUT   FAILED
                              │             │              │
                              ▼             ▼              ▼
                        SuccessScreen  InputRenderer   FailureScreen
                                            │
                                  POST /api/callbacks/:id/submit
                                            │
                                            ▼
                                         RUNNING (resumes)
```

**Polling:** `useWorkflowExecution` polls `/api/executions/:id/events` every 2 seconds while `RUNNING`. Stops on terminal states or `WAITING_FOR_INPUT`.

---

## Input Types (Human-in-the-Loop)

When a workflow reaches an `InputState`, execution pauses. The callback includes an `inputType` that determines which component renders:

| inputType | Component | Description |
|-----------|-----------|-------------|
| `singleSelect` | SingleSelectInput | Radio buttons from options list |
| `multiSelect` | MultiSelectInput | Checkboxes from options list |
| `boolean` | BooleanInput | Toggle true/false |
| `text` | TextInput | Text input or textarea |
| `number` | NumberInput | Numeric with min/max validation |
| `date` | DateInput | Date picker |
| `form` | FormInput | Dynamic multi-field form |
| `confirm` | ConfirmInput | Yes/No confirmation |
| `table` | TableInput | Table with selectable rows |
| `json` | JSONInput | Raw JSON editor |

`InputRenderer.jsx` routes `inputType` to the appropriate component. Each component handles its own validation and calls `onSubmit(value)`.

---

## MCP Connection Model

The agent doesn't call MCP tools directly. The flow is:

1. `AgentService.chat()` calls `query()` from Claude Agent SDK
2. Agent SDK spawns MCP servers as **stdio subprocesses** (configured in `.env.json`)
3. Agent (Claude on Bedrock) decides which MCP tools to call
4. Tool results stream back through SSE to the browser

**MCP servers are configured in `.env.json`:**
```json
{
  "AGENT_MCP_SERVERS": {
    "workflow": { "command": "node", "args": ["/path/to/index.js"] },
    "sp-api": { "command": "node", "args": ["/path/to/sp-api/index.js"] }
  }
}
```

**Workflow store sync:** The MCP subprocess and Express server both access `.data/workflows/`. The Express server calls `workflowStore.reload(id)` before reads to pick up MCP changes.

---

## Development

```bash
cd web
npm install
npm run dev          # Both client (:5173) and server (:3001) concurrently
npm run dev:client   # Vite dev server only
npm run dev:server   # Express server only
npm run build        # Production build to dist/
npm start            # Production: serves dist/ + API from :3001
```

**Vite proxy:** In dev mode, `/api/*` requests proxy from `:5173` → `:3001`.

---

## Active Refactor: Workflow Context Architecture

**Status:** In Progress (Phase 3 of 5)
**Design docs:** `design/workflow-context-architecture.md`, `design/implementation-plan.md`

### What's changing

The app is being restructured around a **workflow context** — a unified page at `/workflows/:workflowId` that combines chat, diagram, schema, and execution into one tabbed view.

### Phase status

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Backend — new endpoints (POST /workflows, GET /diagram, sessions by workflow) | Done |
| 2 | Backend — session store adds `workflowId` | Done |
| 3 | Frontend — new components (WorkflowList, WorkflowContext, ExecuteTab, useWorkflowData) | **In Progress** |
| 4 | Backend cleanup — remove deprecated diagram/schema/workflowPath from sessions | Not Started |
| 5 | Frontend cleanup — delete old ChatPanel, WorkflowPicker, WorkflowPlayer, SessionHistory | Not Started |

### Key principle during transition

Old routes (`/chat`, `/run/:id`) and components stay alive until Phase 5. New components use new CSS class names (`.workflow-context`, `.workflow-list`) to avoid conflicts. `useAgentChat` supports both modes (with and without `workflowId`).

### Components created in Phase 3

- `WorkflowList.jsx` — replaces WorkflowPicker
- `WorkflowContext.jsx` — new unified page
- `ExecuteTab.jsx` — execution embedded in WorkflowContext
- `useWorkflowData.js` — live data hook (replaces stale session snapshots)
- `WorkflowSessionHistory.jsx` — sessions scoped to a workflow

### Components to be deleted in Phase 5

- `ChatPanel.jsx` → absorbed into WorkflowContext
- `WorkflowPicker.jsx` → replaced by WorkflowList
- `WorkflowPlayer.jsx` → replaced by ExecuteTab
- `SessionHistory.jsx` → replaced by WorkflowSessionHistory/ChatSessionDropdown

---

## Key Conventions

1. **ES Modules throughout** — `"type": "module"` in package.json; use `import`/`export`
2. **No global state library** — React hooks + server stores; no Redux/Zustand
3. **Single CSS file** — `styles.css` contains all styles; use BEM-ish class names
4. **File-based persistence** — JSON files in `.data/` directories; no database
5. **SSE for streaming** — Agent chat uses Server-Sent Events, not WebSockets
6. **Shared core modules** — `src/` is shared between MCP server and web server; changes there affect both
7. **Workflow store is source of truth** — Never cache workflow schema in sessions; always read from store
8. **Diagram via Mermaid** — `workflow_to_mermaid` MCP tool generates Mermaid strings; rendered client-side

---

## Credentials & Environment

Loaded from `web/.env.json` (fallback) or environment variables (priority):

| Variable | Purpose |
|----------|---------|
| `CLAUDE_CODE_USE_BEDROCK` | Enable Bedrock (`1`) |
| `AWS_REGION` | Bedrock region |
| `AWS_BEARER_TOKEN_BEDROCK` | Bedrock auth token |
| `SP_API_CLIENT_ID` | Amazon SP-API client ID |
| `SP_API_CLIENT_SECRET` | Amazon SP-API client secret |
| `SP_API_REFRESH_TOKEN` | Amazon SP-API refresh token |
| `SP_API_REGION` | SP-API marketplace region |
| `AGENT_MCP_SERVERS` | MCP server definitions (JSON object) |

---

## File Dependencies Graph (Key Import Chains)

```
client/App.jsx
  └── client/WorkflowList.jsx
  └── client/WorkflowContext.jsx
        ├── hooks/useAgentChat.js         (SSE to /api/agent/chat)
        ├── hooks/useWorkflowData.js      (fetch /api/workflows/:id)
        ├── WorkflowDiagram.jsx           (mermaid rendering)
        └── ExecuteTab.jsx
              ├── hooks/useWorkflowExecution.js  (fetch /api/executions)
              ├── InputRenderer.jsx → inputs/*.jsx
              ├── EventTimeline.jsx
              ├── ApiCallPanel.jsx
              ├── ProgressBar.jsx
              └── displays/SuccessScreen.jsx, FailureScreen.jsx

server/app.js
  ├── routes/workflows.js     → ../../src/builder/workflow-store.js
  ├── routes/executions.js    → ../../src/interpreter/executor.js, execution-store.js
  ├── routes/callbacks.js     → ../../src/callback/callback-handler.js
  └── routes/agent.js         → agent/agent-service.js
                                    └── agent/agent-config.js
                                    └── agent/session-store.js
```
