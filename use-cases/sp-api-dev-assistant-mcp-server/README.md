# Amazon SP-API Developer MCP Server

A Model Context Protocol (MCP) server that provides tools for interacting with Amazon's Selling Partner API (SP-API), including migration assistance, code generation, code optimization and documentation search.

## Features

### SP-API Reference Search

- `sp_api_reference` - Search official SP-API documentation using natural language
  - Returns relevant documentation excerpts with source links
  - Powered by local vector search (no remote API calls)
  - Ships with a pre-built index — works immediately on first use

**Parameters**:

| Parameter | Required | Description |
|-----------|----------|-------------|
| `query` | Yes | Natural language search query about SP-API |
| `top_k` | No | Number of results to return (default: 15) |

### Migration Assistant

- `sp_api_migration_assistant` - Assists with API version migrations
  - Provides general migration guidance (without source code)
  - Analyzes existing code and generates refactored implementations
  - Supports multi-file analysis via `source_files` parameter
  - Supports analysis-only mode (`analysis_only: true`) for review without code generation
  - Supports: Orders API v0 → v2026-01-01
  - Languages: Java, JavaScript, Python, PHP, C#

**Parameters**:

| Parameter | Required | Description |
|-----------|----------|-------------|
| `source_version` | Yes | Current API version (e.g., `"orders-v0"`) |
| `target_version` | Yes | Target API version (e.g., `"orders-2026-01-01"`) |
| `source_files` | No | Array of `{fileName, code}` objects. Preferred for multi-file analysis. |
| `source_code` | No | Single code snippet. Use when pasting code directly. |
| `language` | No | Programming language of the source code |
| `analysis_only` | No | `true` for analysis without refactored code (default: `false`) |

### Code Generation Tools

All code generation actions are accessed through a single tool: `sp_api_generate_code_sample`. Call it with different `action` values to step through the workflow.

Supports: Python, JavaScript, Java, C#, PHP.

**Mandatory Workflow Sequence**:

1. `get_workflow_guide` — Get the step-by-step guide (start here)
2. `clone_repo` — Clone the SP-API SDK repository locally
3. `get_basic_usage` — SDK setup and authentication instructions
4. `get_categories` — Discover API categories (returns `operationsPath` and `modelsPath`)
5. `get_operations` — Get operations for a category (requires `operationsPath` from step 4)
6. `get_models` — Get data models for a category (requires `modelsPath` from step 4)

**Parameters**:

| Parameter | Required | Description |
|-----------|----------|-------------|
| `action` | Yes | Workflow step: `get_workflow_guide`, `clone_repo`, `get_basic_usage`, `get_categories`, `get_operations`, `get_models` |
| `language` | Varies | Required for `get_basic_usage`, `get_categories`, `get_operations`, `get_models`. One of: `python`, `java`, `javascript`, `php`, `csharp` |
| `filePath` | Varies | Required for `get_operations`. Use `operationsPath` from `get_categories` response. |
| `directoryPath` | Varies | Required for `get_models`. Use `modelsPath` from `get_categories` response. |
| `step` | No | For `get_workflow_guide`: get guidance for a specific step (`basic-usage`, `categories`, `operations`, `models`) |
| `page` | No | Page number for paginated results (default: 1) |
| `pageSize` | No | Items per page (default: 50, max: 100) |

### SP-API Optimization Tool

- `sp_api_optimize` - Performs a well-architected review of SP-API integration code
  - Analyzes source code across 9 optimization categories
  - Returns severity-rated findings with actionable recommendations
  - Supports multi-file analysis via `source_files` parameter with per-file line numbers
  - Works without source code to return general best practices
  - Languages: Java, JavaScript, Python, PHP, C#

**Optimization Categories**: scheduling, api modernness, error handling, rate limiting, batching, pagination, caching, notifications, reports

**Parameters**:

| Parameter            | Description                                                         |
| -------------------- | ------------------------------------------------------------------- |
| `source_files`       | Array of `{fileName, code}` objects. Preferred for multi-file analysis. |
| `source_code`        | Single code snippet. Use when pasting code directly.                |
| `optimization_goals` | Focus on specific categories (e.g., `["batching", "caching"]`)      |
| `apiSection`         | Filter best practices by API section (e.g., `Orders`)               |
| `language`           | Programming language (`python`, `javascript`, `typescript`, `java`) |

## Usage with MCP Clients

### Claude Desktop / Kiro

```json
{
  "mcpServers": {
    "sp-api-dev-mcp": {
      "command": "npx",
      "args": ["-y", "sp-api-dev-assistant-mcp-server@latest"],
      "autoApprove": [
        "sp_api_reference",
        "sp_api_optimize",
        "sp_api_generate_code_sample",
        "sp_api_migration_assistant"
      ]
    }
  }
}
```

No API credentials or environment variables are required. All tools work locally without SP-API access.

## Usage Examples

### SP-API Reference Search

#### Prompt:

```
What are the rate limits for the Orders API?
```

The LLM automatically triggers `sp_api_reference` and uses the retrieved documentation to answer.

#### Tool args:

```typescript
{
  "query": "rate limits Orders API",
  "top_k": 15
}
```

### Migration Assistant - General Guidance

#### Prompt:

```
Guide me through the processes to migrate from orders V0 to V1.
```

#### Tool args:

```typescript
{
  "source_version": "orders-v0",
  "target_version": "orders-2026-01-01"
}
```

### Migration Assistant - Code Analysis

#### Prompt:

```
Help me refactor my orders V0 code
<Code snippet>
```

#### Tool args:

```typescript
{
  "source_files": [
    { "fileName": "ordersService.js", "code": "your existing code here" }
  ],
  "source_version": "orders-v0",
  "target_version": "orders-2026-01-01",
  "language": "javascript"
}
```

### Code Generation - Workflow Guide

#### Prompt:

```
Show me how to use the code generation tools
```

#### Tool args:

```typescript
{
  // Get complete workflow guide
}
```

or

```typescript
{
  "step": "categories"  // Get details for a specific step
}
```

### Code Generation - Explore Python SDK

#### Prompt:

```
Help me explore the Orders API in Python
```

#### Workflow:

```typescript
// Step 1: Get basic usage
{ "action": "get_basic_usage", "language": "python" }

// Step 2: Get categories
{ "action": "get_categories", "language": "python" }

// Step 3: Get operations (using operationsPath from step 2)
{ "action": "get_operations", "language": "python", "filePath": "<operationsPath from step 2>" }

// Step 4: Get models (using modelsPath from step 2)
{ "action": "get_models", "language": "python", "directoryPath": "<modelsPath from step 2>" }
```

### SP-API Optimization - Code Review

#### Prompt:

```
Review my SP-API integration code for optimization opportunities
```

#### Tool args:

```typescript
{
  "source_files": [
    { "fileName": "ordersService.js", "code": "const orders = await axios.get('/orders/v0/orders/' + id, { headers }); ..." }
  ],
  "optimization_goals": ["error_handling", "rate_limiting", "batching"],
  "language": "javascript"
}
```

### SP-API Optimization - Best Practices

#### Prompt:

```
What are the best practices for the Orders API?
```

#### Tool args:

```typescript
{
  "apiSection": "Orders"
}
```

## Data Storage

The MCP server stores data in `~/.sp-api-dev-mcp/`:

| Directory | Purpose |
|-----------|---------|
| `selling-partner-api-sdk/` | Cloned SP-API SDK repository (for code generation) |
| `contextual-search-tool/` | Search index and document cache |
