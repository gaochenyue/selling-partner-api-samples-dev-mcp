# Design Doc: Workflow Context Architecture

**Status:** Proposed
**Date:** 2026-04-15
**Author:** chenyue

## Problem

The current web app conflates two distinct concerns into a single "chat session":

1. **Workflow context** — the workflow schema, diagram, file path, and workflow ID
2. **Chat session history** — the conversation messages between user and agent

This leads to several UX and architectural issues:

- **No workflow-first entry point.** Users land on either a workflow picker (for execution only) or a chat panel (for building). There's no unified place to "enter" a workflow and do everything — edit, visualize, and run.
- **Stale snapshots.** The session stores copies of the schema and diagram at save time. If the workflow is modified externally (via MCP tools, another session, or direct file edit), the session's snapshot becomes stale.
- **Execution is disconnected.** The workflow execution player (`/run/:workflowId`) is a separate route with no connection to the chat or editing experience. Users must navigate away to run a workflow.
- **No workflow identity.** Workflows created via chat are ephemeral until the agent happens to call `get_workflow_schema`, which triggers an auto-save. There's no explicit "name this workflow" step.

## Goal

Restructure the web app around a **workflow context** — a first-class, named entity that users create or select before interacting. Chat sessions and executions become scoped views within that context.

## Design

### Core Concept: Workflow Context

A workflow context is the top-level navigation unit. It wraps:

```
WorkflowContext
  ├── identity    (workflowId, name, created/updated timestamps)
  ├── schema      (live from WorkflowStore — never a snapshot)
  ├── diagram     (derived from schema on demand)
  ├── chat        (current and past chat sessions scoped to this workflow)
  └── executions  (run history scoped to this workflow)
```

The workflow store (`.data/workflows/`) remains the **single source of truth** for schema and state. The session store only persists chat messages and a `workflowId` pointer — no more schema/diagram snapshots.

### User Flow

```
Landing Page (/workflows)
  │
  ├── [Create New] → prompt for name → create empty workflow → enter context
  ├── [Import JSON] → upload file + name → import into store → enter context
  └── [Select existing] → pick from list → enter context
  │
  ▼
Workflow Context (/workflows/:workflowId)
  │
  ├── [Chat tab]      — agent chat for building/editing the workflow
  ├── [Diagram tab]   — live Mermaid visualization (read from store)
  ├── [Schema tab]    — live ASL JSON (read from store)
  └── [Execute tab]   — run workflow, view events, handle callbacks, past runs
```

### What Changes

#### 1. Landing Page (replaces current WorkflowPicker + chat nav)

The landing page becomes a **workflow manager**:

- Lists all workflows with name, state count, last modified
- "Create New" button — opens a dialog for name (required) and optional description
- "Import JSON" button — file upload + name input, imports into WorkflowStore
- Clicking a workflow navigates to `/workflows/:workflowId`

No more separate `/chat` entry point. Chat lives inside the workflow context.

#### 2. Workflow Context Page (new)

A single page at `/workflows/:workflowId` with a tabbed or panel layout:

| Panel    | Content                                             | Data Source                   |
|----------|-----------------------------------------------------|-------------------------------|
| Chat     | Agent conversation for this workflow                | Session store (messages only) |
| Diagram  | Mermaid visualization                               | Live from WorkflowStore       |
| Schema   | ASL JSON viewer                                     | Live from WorkflowStore       |
| Execute  | Run button, progress, inputs, events, past runs    | Execution store               |

**Layout:** Left panel = chat. Right panel = tabbed view (Diagram / Schema / Execute). This is close to the current ChatPanel layout but with Execute added and all data sourced from the workflow store.

#### 3. Session Store Changes

**Before (current):**
```json
{
  "id": "msg_abc123",
  "title": "Create order workflow",
  "messages": [...],
  "diagram": { "workflowId": "wf_x", "mermaid": "...", "stateCount": 5 },
  "schema": { "workflowId": "wf_x", "asl": {...}, "name": "..." },
  "workflowPath": "workflows/order-processing.json"
}
```

**After (proposed):**
```json
{
  "id": "msg_abc123",
  "workflowId": "wf_x",
  "title": "Create order workflow",
  "messages": [...]
}
```

The session becomes a lightweight conversation log. Schema, diagram, and workflow path are read from the workflow store at load time. A workflow can have multiple sessions (different editing conversations over time).

#### 4. AgentService Changes

The `AgentService` currently tracks `diagram`, `schema`, and `workflowPath` as instance state and saves them into sessions. These fields are removed.

Instead:
- The agent's system prompt includes the active `workflowId` so it knows which workflow to operate on.
- Tool results like `get_workflow_schema` and `workflow_to_mermaid` still flow through SSE, but the frontend reads them as live workflow state rather than caching them in the session.
- `autoSaveSchema()` is removed — workflows are already persisted in the workflow store. The `workflows/` directory becomes a secondary export location, not the primary store.

#### 5. Execution Integration

The current `WorkflowPlayer` at `/run/:workflowId` moves into the workflow context as the "Execute" tab:

- **Start execution** — same as today, calls `/api/executions` with the workflow ID
- **Input handling** — same `InputRenderer` for human-in-the-loop callbacks
- **Event timeline** — same `EventTimeline` and `ApiCallPanel`
- **Past runs** — list previous executions for this workflow (filter by `workflowId`)
- **Restart** — re-run the workflow without leaving the context

The `WorkflowPlayer` component is reused largely as-is, but rendered inside the workflow context page instead of as a standalone route.

#### 6. Route Changes

| Current Route              | New Route                     | Purpose                      |
|----------------------------|-------------------------------|------------------------------|
| `/`                        | `/`                           | Workflow list (landing page) |
| `/chat`                    | *(removed)*                   | —                            |
| `/run/:workflowId`         | *(removed)*                   | —                            |
| *(new)*                    | `/workflows/:workflowId`     | Workflow context (all tabs)  |

#### 7. API Changes

**New endpoints:**
- `POST /api/workflows` — create a new empty workflow with a name
- `GET /api/workflows/:id/sessions` — list chat sessions for a workflow
- `GET /api/executions?workflowId=:id` — list executions for a workflow

**Modified endpoints:**
- `POST /api/agent/chat` — accepts `workflowId` instead of relying on session state for workflow identity. The agent is always scoped to a workflow.

**Removed:**
- `PATCH /api/agent/sessions/:id` — no longer needed; sessions don't store workflow artifacts.

### Data Flow

#### Creating a workflow and building it via chat:

```
1. User clicks "Create New", enters name "Order Processing"
     → POST /api/workflows { name: "Order Processing" }
     → Returns { workflow_id: "wf_abc" }
     → Navigate to /workflows/wf_abc

2. User types "Add a task state to fetch orders from SP-API"
     → POST /api/agent/chat { message: "...", workflowId: "wf_abc" }
     → Agent calls MCP: add_task_state(workflow_id="wf_abc", ...)
     → WorkflowStore updated in-memory and on disk
     → SSE streams tool calls and text to frontend

3. Frontend auto-refreshes diagram and schema from workflow store
     → GET /api/workflows/wf_abc (or SSE event triggers re-fetch)
     → Diagram and schema panels update with live data

4. User switches to Execute tab, clicks "Start Workflow"
     → POST /api/executions { workflowId: "wf_abc" }
     → Same execution flow as today
```

#### Resuming work on an existing workflow:

```
1. User visits /, sees "Order Processing" in the list
     → Clicks it → navigates to /workflows/wf_abc

2. Workflow context loads:
     → GET /api/workflows/wf_abc          (schema, diagram)
     → GET /api/workflows/wf_abc/sessions (past chat sessions)
     → GET /api/executions?workflowId=wf_abc (past runs)

3. User can:
     - Start a new chat session to continue editing
     - Review past chat sessions (read-only)
     - Run the workflow
     - View past execution results
```

### Component Hierarchy

```
App
└── Routes
    ├── "/" → WorkflowList
    │         ├── CreateWorkflowDialog
    │         └── ImportWorkflowDialog
    │
    └── "/workflows/:workflowId" → WorkflowContext
              ├── ChatPanel (left)
              │     ├── SessionList (scoped to this workflow)
              │     ├── MessageList
              │     └── ChatInput
              │
              └── DetailPanel (right, tabbed)
                    ├── DiagramTab → WorkflowDiagram
                    ├── SchemaTab → SchemaViewer
                    └── ExecuteTab → WorkflowPlayer
                          ├── RunControls
                          ├── ProgressBar
                          ├── InputRenderer
                          ├── ResultScreen
                          └── EventTimeline / ApiCallPanel
```

### Migration Path

This can be implemented incrementally:

1. **Add `POST /api/workflows` endpoint** for creating empty named workflows.
2. **Build `WorkflowContext` page** — start with just chat + diagram/schema tabs, sourcing data from the workflow store instead of session snapshots.
3. **Move execution into the context** — embed `WorkflowPlayer` as a tab.
4. **Slim down session store** — remove `diagram`, `schema`, `workflowPath` fields; add `workflowId`.
5. **Update landing page** — merge WorkflowPicker with workflow creation/import; remove `/chat` nav link.
6. **Clean up** — remove standalone `/chat` and `/run/:id` routes, remove `autoSaveSchema` from AgentService.

### Open Questions

1. **Should we support a "scratchpad" mode?** Users might want to ask general questions (e.g., "what SP-API endpoints exist?") without committing to a workflow first. Options: (a) force workflow selection always, (b) allow a special "scratchpad" context that isn't tied to a workflow, (c) let users create a workflow lazily when the agent first calls `create_workflow`.

2. **Multi-session agent state.** The Claude Agent SDK session is currently a single global instance in `AgentService`. With per-workflow chat, do we need one SDK session per workflow, or can we continue with a single session that gets reset when switching workflows?

3. **Workflow deletion.** When a workflow is deleted, what happens to its chat sessions and executions? Options: cascade delete, orphan them, or soft-delete the workflow.
