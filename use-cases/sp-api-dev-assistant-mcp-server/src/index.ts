#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SPAPIMigrationAssistantTool } from "./tools/migration-assistant-tools/migration-tools.js";
import { migrationAssistantSchema } from "./zod-schemas/migration-schemas.js";
import { masterCodeGenerationSchema } from "./zod-schemas/code-generation-schemas.js";
import { CodeGenerationTool } from "./tools/code-generation-tools/code-generation-tool.js";
import { searchSchema } from "./zod-schemas/search-schemas.js";
import { OptimizationTool } from "./tools/optimization-tools/optimization-tool.js";
import { optimizationSchema } from "./zod-schemas/optimization-schemas.js";
import { createSearchTool } from "./tools/search-tools/setup.js";
import type { SearchToolSetup } from "./tools/search-tools/setup.js";
import { config } from "dotenv";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class SPAPIDevMCPServer {
  private server: McpServer;
  private migrationAssistantTool: SPAPIMigrationAssistantTool;
  private CodeGenerationTool: CodeGenerationTool;
  private optimizationTool: OptimizationTool;
  private search: SearchToolSetup;

  constructor() {
    this.server = new McpServer({
      name: "selling-partner-api-dev-mcp",
      version: "1.2.0",
    });

    this.migrationAssistantTool = new SPAPIMigrationAssistantTool();
    this.CodeGenerationTool = new CodeGenerationTool();
    this.optimizationTool = new OptimizationTool();
    this.search = createSearchTool(__dirname);

    this.setupResources();
    this.setupTools();
  }

  private setupResources(): void {
    // Register Orders API Migration Data Resource
    this.server.registerResource(
      "orders-api-migration-data",
      "sp-api://migration/orders-api",
      {
        description:
          "Migration mapping data for Orders API v0 to v2026-01-01. Contains deprecated attributes, unsupported fields, attribute mappings, new features, and API method mappings.",
        mimeType: "application/json",
      },
      async () => {
        const resourcePath = join(
          __dirname,
          "resources",
          "orders-api-migration-data.json",
        );
        const content = readFileSync(resourcePath, "utf-8");
        return {
          contents: [
            {
              uri: "sp-api://migration/orders-api",
              mimeType: "application/json",
              text: content,
            },
          ],
        };
      },
    );
  }

  private setupTools(): void {
    // Register Migration Assistant Tool
    this.server.registerTool(
      "sp_api_migration_assistant",
      {
        description:
          "Assists with API version migrations. Can provide general migration guidance or analyze existing code and generate refactored implementations. " +
          "When source_files is provided: returns detailed analysis with deprecated endpoints, breaking changes, refactored code, and migration checklist. " +
          "When source_code is provided: same analysis for a single code snippet. " +
          "When neither is provided: returns comprehensive migration guide with API mappings, attribute changes, code examples, and best practices. " +
          "IMPORTANT: When analyzing files from a project, always use source_files (array of {fileName, code} objects) " +
          "instead of source_code to get accurate per-file line numbers. " +
          "Only use source_code when the user pastes a code snippet directly. " +
          "Do NOT strip comments, blank lines, or reformat the code — preserve it exactly as-is. " +
          "Supported Migrations: Orders API v0 → v2026-01-01",
        inputSchema: migrationAssistantSchema,
      },
      async (args: any) => {
        return await this.migrationAssistantTool.migrationAssistant(args);
      },
    );

    // Register Master Code Generation Tool
    this.server.registerTool(
      "sp_api_generate_code_sample",
      {
        description: `SP-API Code Generation Tool — generates code samples for the Amazon Selling Partner API.

Call this tool with different "action" values to step through the code generation workflow.

RECOMMENDED WORKFLOW SEQUENCE:
  1. action: "get_workflow_guide" — Get the step-by-step guide (call this FIRST)
  2. action: "clone_repo" — Ensure the SDK repository is cloned locally
  3. action: "get_basic_usage" — Get SDK setup and auth instructions for a language
  4. action: "get_categories" — Discover API categories; response contains operationsPath and modelsPath
  5. action: "get_operations" — Get operations for a category (requires operationsPath from step 4)
  6. action: "get_models" — Get data models for a category (requires modelsPath from step 4). DO NOT SKIP.

ACTIONS AND PARAMETERS:

  get_workflow_guide:
    Optional: step (one of: "basic-usage", "categories", "operations", "models", "all")
    Returns: Workflow sequence, per-step guidance, common mistakes, supported languages.

  clone_repo:
    Optional: repositoryUrl (custom Git URL), targetPath (local directory)
    Returns: Success message (already cloned or freshly cloned).

  get_basic_usage:
    Required: language (python | java | javascript | php | csharp)
    Returns: SDK installation, authentication setup, basic code examples.

  get_categories:
    Required: language
    Returns: Array of categories, each with: name, description, operationsPath, modelsPath, importPath.
    IMPORTANT: Save operationsPath and modelsPath for the next two actions.

  get_operations:
    Required: language, filePath (use operationsPath from get_categories response)
    Optional: page (default 1), pageSize (default 50, max 100), operations (comma-separated filter), includedData
    Returns: Operations array with pagination metadata.

  get_models:
    Required: language, directoryPath (use modelsPath from get_categories response)
    Optional: page (default 1), pageSize (default 50, max 100), models (comma-separated filter), includedData
    Returns: Models array with pagination metadata.

OUTPUT CHAINING:
  - get_categories returns operationsPath → use as filePath in get_operations
  - get_categories returns modelsPath → use as directoryPath in get_models
  - Use the same language value across all actions in a workflow`,
        inputSchema: masterCodeGenerationSchema,
      },
      async (args: any) => {
        return await this.CodeGenerationTool.execute(args);
      },
    );

    // Register SP-API Reference Search Tool
    this.server.registerTool(
      "sp_api_reference",
      {
        description:
          "Look up authoritative Amazon Selling Partner API (SP-API) documentation. Returns official reference content from the SP-API developer docs. " +
          "IMPORTANT: You MUST call this tool for ANY question related to Amazon selling, SP-API, Amazon marketplace, FBA, FBM, AWD, " +
          "seller/vendor operations, order management, listings, feeds, reports, notifications, fulfillment, shipping, pricing, catalog, " +
          "or any Amazon e-commerce integration topic. This tool has the latest official documentation that may differ from your training data. " +
          "Do not rely on your own knowledge for SP-API topics — always verify with this tool first. " +
          "Use this to look up: rate limits, throttling policies, API specifications, best practices, " +
          "recommended polling intervals, pagination patterns, error handling guidance, and any SP-API operational details.",
        inputSchema: searchSchema,
      },
      async (args: any) => {
        return await this.search.searchTool.search(args);
      },
    );

    // Register SP-API Optimization Tool
    this.server.registerTool(
      "sp_api_optimize",
      {
        description:
          "Performs a well-architected review of SP-API integration code. " +
          "Analyzes source code across 9 optimization categories (call reduction, batching, " +
          "notifications, caching, pagination, scheduling, reports, error handling, rate limiting). " +
          "Returns severity-rated findings and actionable recommendations with implementation details. " +
          "Use optimization_goals to focus on specific categories. " +
          "IMPORTANT: When analyzing files from a project, always use source_files (array of {fileName, code} objects) " +
          "instead of source_code to get accurate per-file line numbers. " +
          "Only use source_code when the user pastes a code snippet directly. " +
          "Do NOT strip comments, blank lines, or reformat the code — preserve it exactly as-is. " +
          "Works without source input to return general best practices.",
        inputSchema: optimizationSchema,
      },
      async (args: any) => {
        return await this.optimizationTool.handleRequest(args);
      },
    );
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    // Pre-load embedding model and initialize search index (non-blocking background tasks)
    this.search.embeddingService.preload().catch(() => {});
    this.search.indexManager.initialize().catch(() => {});
  }
}

try {
  const server = new SPAPIDevMCPServer();
  await server.run();
} catch (error) {
  process.exit(1);
}
