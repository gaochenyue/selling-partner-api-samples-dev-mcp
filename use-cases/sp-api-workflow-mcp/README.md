# Workflow MCP Server

Build and execute Amazon SP-API workflows using natural language with any MCP-compatible AI assistant. Describe what you want — the AI discovers the right SP-API endpoints, builds the workflow step-by-step, and executes it when you're ready.

This project provides two interfaces:
- **MCP Server** — integrate with any MCP-compatible AI assistant (Claude Desktop, Cursor, VS Code, Kiro, etc.)
- **Web UI** — a browser-based interface with an embedded AI chat, visual workflow diagrams, and interactive execution

> **Recommended:** Use alongside the [SP-API MCP Server](https://github.com/amzn/selling-partner-api-samples/tree/main/use-cases/sp-api-mcp-server), which gives your AI assistant live access to SP-API specs and documentation. Together, they enable accurate workflow building without manual API lookup.

## Quick Start

### Prerequisites

- Node.js 18+
- Amazon SP-API credentials (Client ID, Secret, Refresh Token) — only needed for live SP-API calls

### Option A: MCP Server (AI Assistant Integration)

Use this option to build and run workflows through any MCP-compatible client.

#### 1. Install

```bash
git clone <repo-url>
cd use-cases/sp-api-workflow-mcp
npm install
```

#### 2. Configure Your MCP Client

Add the server to your MCP client configuration:

```json
{
  "mcpServers": {
    "workflow-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/sp-api-workflow-mcp/index.js"],
      "env": {
        "SP_API_CLIENT_ID": "amzn1.application-oa2-client.xxx",
        "SP_API_CLIENT_SECRET": "your-secret",
        "SP_API_REFRESH_TOKEN": "Atzr|xxx",
        "SP_API_REGION": "na"
      }
    },
    "sp-api-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/sp-api-mcp-server/index.js"]
    }
  }
}
```

**Config file locations by client:**

| Client | Config file |
|--------|-------------|
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Linux) | `~/.config/Claude/claude_desktop_config.json` |
| Claude Code | `.mcp.json` in your project root |
| Cursor | `.cursor/mcp.json` in your project or `~/.cursor/mcp.json` globally |
| VS Code (MCP extension) | `.vscode/mcp.json` in your project |
| Kiro | `.kiro/settings/mcp.json` in your project |

#### 3. Restart Your MCP Client

#### 4. Your First Workflow

Open your AI assistant and try:

```
You: Create a workflow that requests a sales report, polls until it's ready,
     then downloads the document.

AI: I'll build that step by step...
  -> create_workflow("DownloadSalesReport")
  -> add_task_state("CreateReport", POST /reports/2021-06-30/reports, ...)
  -> add_wait_state("WaitForReport", seconds=30)
  -> add_task_state("CheckStatus", GET /reports/2021-06-30/reports/{reportId}, ...)
  -> add_choice_state("IsReady",
       if $.reportStatus.processingStatus == "DONE" -> GetDocument,
       default -> WaitForReport)
  -> add_task_state("GetDocument", GET /reports/2021-06-30/documents/{documentId}, ...)
  -> add_succeed_state("Done")
  -> connect_states(...), validate_workflow()

  Workflow ready. Want me to execute it?

You: Yes, run it.

AI: execute_workflow(input={ "marketplaceId": "ATVPDKIKX0DER" })
  -> CreateReport: reportId=RPT-12345
  -> WaitForReport (30s) x 2
  -> CheckStatus: processingStatus=DONE
  -> GetDocument: download URL retrieved
  -> Status: SUCCEEDED
```

### Option B: Web UI

Use this option for a browser-based experience with visual diagrams, interactive execution, and an embedded AI chat powered by the Claude Agent SDK.

#### 1. Install

```bash
git clone <repo-url>
cd use-cases/sp-api-workflow-mcp
npm install
cd web
npm install
```

#### 2. Configure Credentials

Create `web/.env.json` with your credentials and agent configuration:

```json
{
  "CLAUDE_CODE_USE_BEDROCK": "1",
  "AWS_REGION": "us-west-2",
  "AWS_PROFILE": "your-profile",
  "SP_API_CLIENT_ID": "amzn1.application-oa2-client.xxx",
  "SP_API_CLIENT_SECRET": "your-secret",
  "SP_API_REFRESH_TOKEN": "Atzr|xxx",
  "SP_API_REGION": "na",
  "AGENT_MCP_SERVERS": {
    "workflow-mcp": {
      "command": "node",
      "args": ["../index.js"]
    }
  }
}
```

Alternatively, set these as environment variables.

#### 3. Build and Run

**Development** (hot-reload):

```bash
cd web
npm run dev
```

This starts the Express backend on port 3001 and the Vite dev server on port 5173. Open http://localhost:5173.

**Production**:

```bash
cd web
npm run build
npm start
```

This serves the built frontend and API from http://localhost:3001.

#### 4. Using the Web UI

The web UI has four main pages:

- **Workflow List** (`/`) — create new workflows, import existing ones, or select a workflow to work on.
- **Workflow Context** (`/workflows/:id`) — the main workspace with tabs for:
  - **Chat** — converse with the AI agent to build and modify workflows
  - **Diagram** — live Mermaid visualization of the workflow
  - **Schema** — raw ASL JSON view
- **Execute** (`/run/:id`) — run the workflow with interactive input forms, approval dialogs, and a real-time event timeline.
- **Settings** (`/settings`) — configure SP-API credentials and other options.

---

## How It Works

```
+-----------------+     +------------------+     +-----------------+
|  AI Assistant   |---->|  Workflow MCP    |---->|    SP-API       |
|                 |     |     Server       |     |                 |
| - Understands   |     | - Builds ASL     |     | - Orders API    |
|   your request  |     | - Executes       |     | - Inventory API |
| - Discovers API |     | - Tracks state   |     | - Feeds API     |
|   specs         |     | - Human approval |     | - Reports API   |
+-----------------+     +------------------+     +-----------------+
```

1. **You describe** what you want in plain English
2. **The AI discovers** the SP-API endpoints needed (via SP-API Discovery MCP)
3. **The AI builds** the workflow using this server's MCP tools
4. **You review** the workflow diagram and schema
5. **You execute** the workflow — with human-in-the-loop approval where needed

Workflows are defined in [Amazon States Language (ASL)](https://states-language.net/spec.html), the same format used by AWS Step Functions. They can be exported as standalone Node.js scripts for deployment outside of the MCP server.

---

## User Guide

### Building Workflows

#### Create a Workflow

```
You: Create a new workflow called "Order Processing"

AI: create_workflow(name="Order Processing", description="Process incoming orders")
-> Created workflow wf_abc123
```

#### Add SP-API Tasks

The AI uses full endpoint specifications learned from SP-API Discovery:

```
You: Add a step to get order details

AI: add_task_state(
  workflow_id="wf_abc123",
  state_name="GetOrder",
  method="GET",
  path="/orders/v0/orders/{orderId}",
  path_params={ "orderId.$": "$.input.orderId" },
  result_path="$.orderData"
)
```

**Task Parameters:**

| Parameter | Description | Example |
|-----------|-------------|---------|
| `method` | HTTP method | `GET`, `POST`, `PUT`, `DELETE` |
| `path` | API endpoint path | `/orders/v0/orders/{orderId}` |
| `path_params` | URL path variables | `{ "orderId": "123-456" }` |
| `query_params` | Query string params | `{ "MarketplaceIds": ["ATVPDKIKX0DER"] }` |
| `body` | Request body (POST/PUT) | `{ "feedType": "POST_PRODUCT_DATA" }` |
| `result_path` | Where to store result | `$.orderData` |

#### Add Conditional Logic

```
You: If the order total is over $500, require approval

AI: add_choice_state(
  workflow_id="wf_abc123",
  state_name="CheckValue",
  choices=[{
    "variable": "$.orderData.OrderTotal.Amount",
    "comparison": "NumericGreaterThan",
    "value": 500,
    "next": "RequireApproval"
  }],
  default="AutoProcess"
)
```

**Supported Comparisons:**
- `StringEquals`, `StringLessThan`, `StringGreaterThan`
- `NumericEquals`, `NumericLessThan`, `NumericGreaterThan`
- `BooleanEquals`
- `IsNull`, `IsPresent`, `IsString`, `IsNumeric`

#### Add Human Input

Collect data from users at runtime with 10 input types:

```
You: Ask the user which marketplace to use

AI: add_input_state(
  workflow_id="wf_abc123",
  state_name="SelectMarketplace",
  input_type="SingleSelect",
  title="Select Marketplace",
  config={
    "options": [
      { "label": "US", "value": "ATVPDKIKX0DER" },
      { "label": "UK", "value": "A1F83G8C2ARO7P" }
    ]
  },
  result_path="$.marketplaceId"
)
```

**Input Types:** `SingleSelect`, `MultiSelect`, `Boolean`, `Text`, `Number`, `Date`, `Form`, `Confirm`, `Table`, `JSON`

#### Add Human Approval

```
You: Add an approval step for high-value orders

AI: add_task_state(
  workflow_id="wf_abc123",
  state_name="RequireApproval",
  resource="callback",
  prompt="High-value order requires approval",
  details={ "orderId.$": "$.input.orderId", "total.$": "$.orderData.OrderTotal" },
  timeout_seconds=3600
)
```

The workflow pauses until someone approves:

```
You: list_pending_callbacks
-> Callback cb_xyz789: "High-value order requires approval"

You: submit_callback(callback_id="cb_xyz789", approved=true, comment="Approved by manager")
-> Workflow resumes
```

#### Connect States

```
You: Connect GetOrder to CheckValue, then to the terminal states

AI:
  connect_states(workflow_id="wf_abc123", from_state="GetOrder", to_state="CheckValue")
  connect_states(workflow_id="wf_abc123", from_state="AutoProcess", to_state="Done")
```

#### Fetch External Data

Download from URLs (presigned S3 links, report documents, etc.):

```
You: Add a step to download the report document

AI: add_fetch_state(
  workflow_id="wf_abc123",
  state_name="DownloadReport",
  url_path="$.document.url",
  result_path="$.reportContent"
)
```

#### Export as Node.js

```
You: Export this workflow as a standalone script

AI: workflow_to_nodejs(workflow_id="wf_abc123")
-> Generates a self-contained Node.js script you can run independently
```

### Executing Workflows

#### Run a Workflow

```
You: Execute the order processing workflow for order 123-456-789

AI: execute_workflow(
  workflow_id="wf_abc123",
  input={ "orderId": "123-456-789" }
)
-> Execution exec_def456 started
```

#### Check Status

```
You: What's the status of that execution?

AI: get_execution_status(execution_id="exec_def456")
-> Status: SUCCEEDED, Output: { orderData: {...}, result: "processed" }
```

#### View Execution History

```
You: Show me what happened during execution

AI: get_execution_events(execution_id="exec_def456")
-> [StateEntered: GetOrder, StateExited: GetOrder, StateEntered: CheckValue, ...]
```

### JSONPath for Dynamic Data

Use JSONPath to pass data between states:

```javascript
// Reference input data
"orderId.$": "$.input.orderId"

// Reference previous state output
"orderTotal.$": "$.orderData.OrderTotal.Amount"

// Static value (no .$ suffix)
"marketplaceId": "ATVPDKIKX0DER"
```

---

## MCP Tools Reference

### Builder Tools

| Tool | Description |
|------|-------------|
| `create_workflow` | Create a new workflow |
| `import_workflow` | Import workflow from ASL JSON |
| `add_task_state` | Add SP-API HTTP call |
| `add_fetch_state` | Add URL download (S3, documents) |
| `add_choice_state` | Add conditional branching |
| `add_input_state` | Add human input collection (10 types) |
| `add_pass_state` | Add data transformation |
| `add_wait_state` | Add delay (max 60s) |
| `add_succeed_state` | Add success endpoint |
| `add_fail_state` | Add failure endpoint |
| `connect_states` | Link two states |
| `set_start_state` | Set entry point |
| `remove_state` | Delete a state |
| `get_workflow_schema` | Export ASL JSON |
| `validate_workflow` | Check for errors |
| `list_workflows` | List all workflows |
| `delete_workflow` | Delete a workflow |
| `workflow_to_mermaid` | Generate Mermaid diagram |
| `workflow_to_nodejs` | Export as standalone Node.js script |

### Execution Tools

| Tool | Description |
|------|-------------|
| `execute_workflow` | Run a workflow with input |
| `get_execution_status` | Check current execution state |
| `list_executions` | List past executions (filterable) |
| `get_execution_events` | Get full event log (with pagination) |
| `tail_execution_events` | Get recent events (like `tail -f`) |
| `abort_execution` | Stop a running execution |
| `resume_execution` | Continue after input/callback pause |

### Callback Tools

| Tool | Description |
|------|-------------|
| `list_pending_callbacks` | List awaiting approvals |
| `get_callback_details` | Get callback info |
| `submit_callback` | Approve or reject |
| `extend_callback_timeout` | Add more time |

---

## Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `SP_API_CLIENT_ID` | SP-API app client ID | For SP-API calls |
| `SP_API_CLIENT_SECRET` | SP-API app secret | For SP-API calls |
| `SP_API_REFRESH_TOKEN` | Seller refresh token | For SP-API calls |
| `SP_API_REGION` | Region: `na`, `eu`, `fe` | No (default: `na`) |
| `SP_API_BASE_URL` | Custom SP-API base URL | No |
| `SP_API_OAUTH_URL` | Custom OAuth token endpoint | No |
| `PORT` | Web server port | No (default: `3001`) |

### Web UI Configuration (`web/.env.json`)

The web UI reads configuration from `web/.env.json`. This file configures:

- **Claude Agent SDK** — Bedrock credentials for the embedded AI chat (`CLAUDE_CODE_USE_BEDROCK`, `AWS_REGION`, `AWS_PROFILE`, etc.)
- **SP-API credentials** — passed to both the web server and the MCP subprocess
- **MCP servers** — the `AGENT_MCP_SERVERS` key defines which MCP servers the embedded agent can use

---

## Examples

### Example 1: Report Download with Polling

```
You: Create a workflow that requests a report, waits, then downloads it

AI creates:
1. SelectReportType -> user picks from a list of report types
2. SelectMarketplace -> user picks their marketplace
3. CreateReport -> POST /reports/2021-06-30/reports
4. Wait -> wait 30 seconds
5. CheckStatus -> GET /reports/2021-06-30/reports/{reportId}
6. Choice -> if status != "DONE", go back to Wait
7. GetDocument -> GET /reports/2021-06-30/documents/{documentId}
8. DownloadReport -> fetch the presigned URL
9. Done -> return report data
```

### Example 2: Order Processing with Approval

```
You: Create an order processing workflow that requires approval for orders over $500

AI creates:
1. GetOrder -> calls /orders/v0/orders/{orderId}
2. CheckValue -> if total > 500, go to Approval
3. Approval -> callback task, waits for human
4. Process -> marks order as processed
5. Done -> success state
```

### Example 3: FBA Inbound Shipment

```
You: Create a workflow to set up an FBA inbound shipment

AI creates:
1. CollectShipmentDetails -> form input for items, quantities, ship-from address
2. CreateInboundPlan -> POST /inbound/fba/2024-03-20/inboundPlans
3. ReviewPlan -> display plan details, confirm to proceed
4. GenerateLabels -> GET item labels for the shipment
5. Done -> return shipment ID and label URLs
```

Pre-built example workflows are available in the `workflows/` directory.

---

## Troubleshooting

### "SP-API client is not configured"

Set the environment variables in your MCP client config or in `web/.env.json`:
```json
{
  "SP_API_CLIENT_ID": "...",
  "SP_API_CLIENT_SECRET": "...",
  "SP_API_REFRESH_TOKEN": "..."
}
```

### "Workflow validation failed"

Check that:
- All states are connected (no orphans)
- `StartAt` points to a valid state
- Choice states have valid `Next` references
- Terminal states (`Succeed`, `Fail`) don't have `Next`

### Web UI: "No MCP servers configured"

Ensure `web/.env.json` includes the `AGENT_MCP_SERVERS` key with at least the workflow MCP server:
```json
{
  "AGENT_MCP_SERVERS": {
    "workflow-mcp": {
      "command": "node",
      "args": ["../index.js"]
    }
  }
}
```

### Web UI: Agent chat not responding

The embedded agent requires Claude Agent SDK credentials. Configure Bedrock access:
```json
{
  "CLAUDE_CODE_USE_BEDROCK": "1",
  "AWS_REGION": "us-west-2",
  "AWS_PROFILE": "your-profile"
}
```

---

## Development

### Run Tests

```bash
npm test
```

### Project Structure

```
sp-api-workflow-mcp/
|-- index.js                  # MCP server entry point (stdio transport)
|-- package.json
|-- src/
|   |-- builder/              # Workflow construction (create, add states, connect, validate)
|   |   |-- index.js          # MCP tool definitions and handlers
|   |   |-- workflow-store.js # Workflow storage with file persistence
|   |   |-- state-factory.js  # ASL state creation for all state types
|   |   +-- nodejs-generator.js  # Export workflows as standalone Node.js scripts
|   |-- interpreter/          # Workflow execution engine
|   |   |-- index.js          # Execution MCP tools
|   |   |-- executor.js       # State machine loop, transitions, event emission
|   |   |-- execution-store.js # Execution history with file persistence
|   |   +-- task-handlers.js  # Handlers for Task, Fetch, Choice, Input, Pass, Wait
|   |-- callback/             # Human-in-the-loop approval system
|   |   |-- index.js          # Callback MCP tools
|   |   |-- callback-handler.js  # Manages pending approvals
|   |   +-- callback-store.js    # Callback persistence
|   |-- schema/               # Input state validation (10 input types)
|   |-- sp-api-core/          # Generic SP-API HTTP client (OAuth2, regional endpoints)
|   +-- utils/                # JSONPath, ASL validation, file storage, UUID
|-- web/                      # Web UI (browser-based interface)
|   |-- server/               # Express backend
|   |   |-- app.js            # Server setup, route mounting, credential loading
|   |   |-- agent/            # Claude Agent SDK integration
|   |   |   |-- agent-service.js   # Multi-turn agent orchestration
|   |   |   |-- agent-config.js    # System prompt, MCP server config
|   |   |   +-- session-store.js   # Chat session persistence
|   |   +-- routes/           # REST API
|   |       |-- workflows.js  # Workflow CRUD
|   |       |-- executions.js # Execution management
|   |       |-- callbacks.js  # Callback submission
|   |       |-- agent.js      # Agent chat (SSE streaming)
|   |       +-- settings.js   # Configuration
|   |-- client/               # React 19 frontend (built with Vite)
|   |   |-- App.jsx           # Router and layout
|   |   |-- WorkflowList.jsx  # Landing page (create, import, select)
|   |   |-- WorkflowContext.jsx  # Main workspace (Chat, Diagram, Schema tabs)
|   |   |-- WorkflowPlayer.jsx  # Execution runner with input forms
|   |   |-- components/       # Shared UI (WorkflowDiagram, EventTimeline, InputRenderer, etc.)
|   |   +-- hooks/            # React hooks (useAgentChat, useWorkflowExecution, etc.)
|   +-- dist/                 # Production build output
|-- workflows/                # Pre-built example workflow JSON files
|-- test/                     # Unit tests
+-- .data/                    # Runtime data (gitignored)
    |-- workflows/            # Persisted workflow definitions
    |-- executions/           # Execution records and event logs
    +-- callbacks/            # Pending callback state
```

### Architecture Notes

- **File-based persistence** — all data (workflows, executions, callbacks, sessions) is stored as JSON files in `.data/` and `web/data/`. No database required.
- **Shared stores** — the MCP server and web server use the same `.data/workflows/` directory, so workflows created via AI assistant are visible in the web UI and vice versa.
- **ASL format** — workflows use Amazon States Language, compatible with AWS Step Functions. They can be exported as standalone Node.js scripts via `workflow_to_nodejs`.
- **Generic SP-API client** — the HTTP client takes full endpoint paths and methods from the workflow definition, so new SP-API endpoints work without code changes.

---

## License

MIT-0
