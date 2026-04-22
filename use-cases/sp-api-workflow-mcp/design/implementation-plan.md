# Implementation Plan: Workflow Context Architecture

**Companion to:** [workflow-context-architecture.md](./workflow-context-architecture.md)
**Date:** 2026-04-15

---

## Overview

5 phases, each independently deployable. The app works at every step — old routes stay alive until Phase 5.

| Phase | What | Files touched |
|-------|------|---------------|
| 1 | Backend — new endpoints | 4 modified |
| 2 | Backend — session store adds `workflowId` | 2 modified |
| 3 | Frontend — new components and routes | 4 created, 3 modified |
| 4 | Backend cleanup — remove deprecated fields | 3 modified |
| 5 | Frontend cleanup — remove old components/routes | 4 deleted, 2 modified |

---

## Phase 1: Backend — New Endpoints

**Goal:** Add new API endpoints without changing any existing behavior.

### Step 1.1: Add `POST /api/workflows` — create empty named workflow

**Modify:** `web/server/routes/workflows.js`

- Add `router.post('/')` handler before the existing `/import` route.
- Accept `{ name, description }` in request body. Require `name`.
- Call `workflowStore.create(name, description)` (method already exists on WorkflowStore).
- Return `201` with `{ workflow_id, name, created_at }`.

### Step 1.2: Add `GET /api/workflows/:id/diagram` — live mermaid generation

**Modify:** `web/server/routes/workflows.js`

- Add `router.get('/:id/diagram')`.
- Fetch workflow, call `workflowStore.toASL(id)`, then `convertToMermaid(schema)` (already imported).
- Return `{ workflowId, mermaid, stateCount }`.
- Return 404 if workflow not found, return `{ mermaid: null }` if workflow has no states yet.

### Step 1.3: Add `GET /api/agent/sessions/by-workflow/:workflowId` — scoped session list

**Modify:** `web/server/agent/session-store.js`

- Add `listByWorkflow(workflowId)` method — same as `list()` but filters where `session.workflowId === workflowId`.
- Include `workflowId` in the returned summary objects.

**Modify:** `web/server/routes/agent.js`

- Add `router.get('/sessions/by-workflow/:workflowId')` **before** the existing `router.get('/sessions/:id')` to avoid route conflict.
- Call `sessionStore.listByWorkflow(req.params.workflowId)`.

### Step 1.4: Modify `POST /api/agent/chat` to accept `workflowId`

**Modify:** `web/server/routes/agent.js`

- Extract `workflowId` from `req.body` alongside `message` and `sessionId`.
- Pass it to `agentService.chat(message, abortController, { workflowId })`.

**Modify:** `web/server/agent/agent-service.js`

- Change signature to `async *chat(message, abortController, options = {})`.
- Extract `workflowId` from `options`. Store as `this.workflowId` if provided.
- In the `finally` block, include `workflowId: this.workflowId` in the `sessionStore.save()` call.
- **Additive only** — when `workflowId` is not provided, behavior is identical to today.

---

## Phase 2: Backend — Session Store Adds `workflowId`

**Goal:** Sessions gain a `workflowId` field. Old fields remain for backward compatibility.

### Step 2.1: Persist `workflowId` in session store

**Modify:** `web/server/agent/session-store.js`

- In `save()`, accept and persist `workflowId`:
  ```js
  workflowId: data.workflowId || existing?.workflowId || null,
  ```
- In `list()`, include `workflowId` in summary objects.

### Step 2.2: Track `workflowId` in AgentService lifecycle

**Modify:** `web/server/agent/agent-service.js`

- Add `this.workflowId = null` in constructor.
- In `restoreSession()`, restore `this.workflowId` from `session.workflowId`.
- In `reset()`, set `this.workflowId = null`.
- **Do NOT yet remove** `diagram`/`schema`/`workflowPath` tracking — that's Phase 4.

---

## Phase 3: Frontend — New Components and Routes

**Goal:** Build the new workflow-centric UI. Old routes stay alive.

### Step 3.1: Create `WorkflowList.jsx`

**Create:** `web/client/WorkflowList.jsx`

Based on `WorkflowPicker.jsx` with these changes:
- Clicking a workflow navigates to `/workflows/${wf.workflow_id}` (not `/run/...`).
- **"Create New" button** — shows inline input or modal for workflow name, calls `POST /api/workflows { name }`, navigates to `/workflows/${result.workflow_id}` on success.
- **"Import JSON" button** — same file upload flow, but navigates to `/workflows/${result.workflow_id}` after import.
- Shows `updated_at` timestamp on each card.

### Step 3.2: Create `useWorkflowData.js` hook

**Create:** `web/client/hooks/useWorkflowData.js`

```
useWorkflowData(workflowId) → { workflow, schema, diagram, loading, error, refresh }
```

- Fetches `GET /api/workflows/:id` (name, description, schema/ASL).
- Fetches `GET /api/workflows/:id/diagram` (mermaid, stateCount).
- `refresh()` re-fetches both endpoints.
- Auto-fetches on mount and when `workflowId` changes.
- **This is the live data source** — replaces stale snapshots from session store.

### Step 3.3: Modify `useAgentChat.js` — accept `workflowId`, add `onToolResult` callback

**Modify:** `web/client/hooks/useAgentChat.js`

This is the most complex change. To maintain backward compatibility during the transition:

- Accept optional `workflowId` parameter: `useAgentChat(workflowId)`.
- Accept optional `onToolResult` callback ref (or expose via returned object).
- **When `workflowId` is provided (new mode):**
  - Include `workflowId` in the POST body to `/api/agent/chat`.
  - Do NOT track `diagram`, `schema`, `workflowPath` state.
  - On `tool_result` SSE events for workflow-mutating tools, call `onToolResult` so the parent can call `refresh()`.
  - On `result` SSE events, call `onToolResult` as well.
  - Remove session metadata fetch on `session` SSE event.
  - Return: `{ messages, loading, sessionId, error, sendMessage, stopChat, resetChat, loadSession }`.
- **When `workflowId` is NOT provided (legacy mode):**
  - Behave exactly as today — track diagram/schema/workflowPath, return them.
  - This keeps the old `ChatPanel` working until Phase 5.

### Step 3.4: Create `WorkflowSessionHistory.jsx`

**Create:** `web/client/WorkflowSessionHistory.jsx`

- Similar to `SessionHistory.jsx` but fetches from `GET /api/agent/sessions/by-workflow/:workflowId`.
- Props: `workflowId`, `currentSessionId`, `onSelectSession`, `onNewChat`.
- Shows only sessions for the current workflow.

### Step 3.5: Create `ExecuteTab.jsx`

**Create:** `web/client/ExecuteTab.jsx`

Extracted from `WorkflowPlayer.jsx`:
- Props: `workflowId`, `workflow` (name/description/schema) — no self-fetching.
- Removes workflow fetch logic (parent provides the data).
- Removes player-header (parent shows workflow name).
- Replaces `navigate('/')` in SuccessScreen/FailureScreen with a tab-switch action or removes the "Back" button.
- Adds an **execution history list** (from `GET /api/executions?workflowId=:id`) shown when idle.
- Keeps: `useWorkflowExecution`, `ProgressBar`, `InputRenderer`, `EventTimeline`, `ApiCallPanel`, `SuccessScreen`, `FailureScreen`.

### Step 3.6: Create `WorkflowContext.jsx`

**Create:** `web/client/WorkflowContext.jsx`

The main new page at `/workflows/:workflowId`:

```
WorkflowContext
├── Header (workflow name, back link to /)
├── Left Column: Chat
│   ├── WorkflowSessionHistory
│   ├── Message list
│   └── Chat input
└── Right Column: Tabbed Panel
    ├── Diagram tab → WorkflowDiagram (from useWorkflowData)
    ├── Schema tab → JSON viewer (from useWorkflowData)
    └── Execute tab → ExecuteTab
```

- Gets `workflowId` from `useParams()`.
- Uses `useWorkflowData(workflowId)` for live schema/diagram.
- Uses `useAgentChat(workflowId)` for chat.
- Wires `onToolResult` callback → calls `useWorkflowData.refresh()`.
- Tab state managed by `useState('diagram')`.

### Step 3.7: Update routes in `App.jsx`

**Modify:** `web/client/App.jsx`

```jsx
<Routes>
  <Route path="/" element={<WorkflowList />} />
  <Route path="/workflows/:workflowId" element={<WorkflowContext />} />
  {/* Legacy routes — kept temporarily */}
  <Route path="/run/:workflowId" element={<WorkflowPlayer />} />
  <Route path="/chat" element={<ChatPanel />} />
</Routes>
```

- Update nav: remove "Agent Chat" link. Keep "Workflows" pointing to `/`.

### Step 3.8: Add CSS styles

**Modify:** `web/client/styles.css`

- Add `.workflow-context` — two-column flex layout.
- Add `.workflow-tabs`, `.workflow-tab`, `.workflow-tab-active`.
- Add `.workflow-list` — landing page grid (similar to `.picker`).
- Add `.workflow-context-header`.
- Use **new class names** — don't modify existing `.chat-panel` / `.picker` / `.player` styles yet (old routes still active).

---

## Phase 4: Backend Cleanup — Remove Deprecated Fields

**Goal:** Remove diagram/schema/workflowPath tracking now that the frontend no longer reads them.

**Prerequisite:** Phase 3 complete and verified working.

### Step 4.1: Strip AgentService of diagram/schema/workflowPath

**Modify:** `web/server/agent/agent-service.js`

Remove:
- `this.diagram`, `this.schema`, `this.workflowPath` from constructor.
- `autoSaveSchema()` function and its call.
- `parseSchemaResult()`, `parseImportResult()`, `parseMermaidResult()` functions.
- The blocks inside `chat()` that detect `workflow_to_mermaid`, `get_workflow_schema`, `import_workflow` tool results and emit `workflow_diagram`/`workflow_schema` SSE events.
- Restoration of `diagram`/`schema`/`workflowPath` in `restoreSession()`.
- Clearing of those fields in `reset()`.
- Passing those fields to `sessionStore.save()`.

Keep: `workflowId` tracking and persistence.

### Step 4.2: Remove `PATCH /api/agent/sessions/:id`

**Modify:** `web/server/routes/agent.js`

- Delete the `router.patch('/sessions/:id')` handler.

### Step 4.3: Simplify SessionStore

**Modify:** `web/server/agent/session-store.js`

- In `save()`, remove `diagram`, `schema`, `workflowPath` fields.
- Session object: `{ id, title, createdAt, updatedAt, messages, workflowId }`.
- Old files on disk with extra fields still load fine (extra fields are ignored on read).

---

## Phase 5: Frontend Cleanup — Remove Old Components and Routes

**Goal:** Delete deprecated code.

**Prerequisite:** Phase 4 complete.

### Step 5.1: Remove legacy routes

**Modify:** `web/client/App.jsx`

- Remove `<Route path="/run/:workflowId" .../>` and `<Route path="/chat" .../>`.
- Remove imports of `WorkflowPicker`, `WorkflowPlayer`, `ChatPanel`.
- Final routes:
  ```
  /                        → WorkflowList
  /workflows/:workflowId   → WorkflowContext
  ```

### Step 5.2: Delete deprecated components

**Delete:**
- `web/client/WorkflowPicker.jsx` — replaced by `WorkflowList.jsx`
- `web/client/WorkflowPlayer.jsx` — replaced by `ExecuteTab.jsx`
- `web/client/ChatPanel.jsx` — absorbed into `WorkflowContext.jsx`
- `web/client/SessionHistory.jsx` — replaced by `WorkflowSessionHistory.jsx`

### Step 5.3: Remove legacy mode from `useAgentChat.js`

**Modify:** `web/client/hooks/useAgentChat.js`

- Remove the "when `workflowId` is not provided" legacy code path.
- Make `workflowId` a required parameter.
- Remove `diagram`, `schema`, `workflowPath` state and any remaining references.

### Step 5.4: Clean up CSS

**Modify:** `web/client/styles.css`

- Remove `.picker` styles (replaced by `.workflow-list`).
- Remove standalone `.player` layout styles.
- Audit `.chat-panel` three-column layout styles — remove if no longer referenced.
- Rename/consolidate as needed.

---

## File Change Summary

| File | Phase | Action |
|------|-------|--------|
| `web/server/routes/workflows.js` | 1 | Modify — add POST / and GET /:id/diagram |
| `web/server/agent/session-store.js` | 1, 2, 4 | Modify — add listByWorkflow, add workflowId, remove old fields |
| `web/server/routes/agent.js` | 1, 4 | Modify — add session-by-workflow route, pass workflowId, remove PATCH |
| `web/server/agent/agent-service.js` | 1, 2, 4 | Modify — accept workflowId, track it, then remove old tracking |
| `web/client/WorkflowList.jsx` | 3 | **Create** |
| `web/client/hooks/useWorkflowData.js` | 3 | **Create** |
| `web/client/WorkflowSessionHistory.jsx` | 3 | **Create** |
| `web/client/ExecuteTab.jsx` | 3 | **Create** |
| `web/client/WorkflowContext.jsx` | 3 | **Create** |
| `web/client/hooks/useAgentChat.js` | 3, 5 | Modify — add workflowId support, then remove legacy mode |
| `web/client/App.jsx` | 3, 5 | Modify — add new routes, then remove old routes |
| `web/client/styles.css` | 3, 5 | Modify — add new styles, then remove old styles |
| `web/client/WorkflowPicker.jsx` | 5 | **Delete** |
| `web/client/WorkflowPlayer.jsx` | 5 | **Delete** |
| `web/client/ChatPanel.jsx` | 5 | **Delete** |
| `web/client/SessionHistory.jsx` | 5 | **Delete** |

**Unchanged** (no modifications needed):
- `index.js` (MCP server)
- `src/` (all core modules — builder, interpreter, callback, schema, sp-api-core, utils)
- `web/server/app.js` (Express setup — routes are added via existing pattern)
- `web/server/routes/executions.js`, `web/server/routes/callbacks.js`
- `web/server/agent/agent-config.js`
- All input/display components (`web/client/inputs/`, `web/client/displays/`)
- `web/client/WorkflowDiagram.jsx`, `web/client/EventTimeline.jsx`, `web/client/ApiCallPanel.jsx`, `web/client/ProgressBar.jsx`, `web/client/InputRenderer.jsx`

---

## Key Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| **Step 3.3 breaks existing ChatPanel** during transition | `useAgentChat` supports both modes: with `workflowId` (new) and without (legacy). Old ChatPanel keeps working until Phase 5. |
| **CSS conflicts** between old and new layouts | New components use new class names (`.workflow-context`, `.workflow-list`) — never modify existing classes until Phase 5. |
| **Old session files** lack `workflowId` | `listByWorkflow()` simply doesn't match them. They appear in the global list but not in any workflow-scoped list. Acceptable for pre-migration data. |
| **`useWorkflowData` refresh races** with in-progress tool calls | The workflow store is updated synchronously by MCP tool handlers before the tool result is returned. By the time the frontend calls `refresh()`, the store already has the new state. |
