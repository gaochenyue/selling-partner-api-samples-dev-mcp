import { readFileSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(__dirname, '../..');  // web/ directory

export const ENV_KEYS_TO_EXPORT = [
  // Bedrock / Agent SDK
  'CLAUDE_CODE_USE_BEDROCK',
  'AWS_REGION',
  'AWS_BEARER_TOKEN_BEDROCK',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_PROFILE',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  // SP-API (so the workflow MCP subprocess can initialize its SP-API client)
  'SP_API_CLIENT_ID',
  'SP_API_CLIENT_SECRET',
  'SP_API_REFRESH_TOKEN',
  'SP_API_REGION',
  'SP_API_BASE_URL',
  'SP_API_OAUTH_URL',
];

const SYSTEM_PROMPT = `You are a workflow building assistant for Amazon SP-API.

You have access to tools for:
- Discovering and exploring SP-API endpoints, their parameters, and response schemas
- Creating, modifying, and validating workflows using Amazon States Language

When the user asks about SP-API capabilities, use the available tools to look up real endpoint information.
When the user wants to build a workflow, use the workflow tools to construct it step by step.

Always validate workflows after building them.

IMPORTANT: If a Task state requires user-provided input (e.g. marketplaceIds,
order IDs, date ranges, seller IDs), add an Input state before it to collect
those values from the user at runtime. Never leave required parameters
unresolved — every Task parameter that uses a JSONPath reference (e.g.
"$.input.marketplaceIds") must have a preceding state that populates that path.

IMPORTANT: When executing a workflow and it requires input (e.g. callbacks,
selections, or any user-provided values), ALWAYS ask the user what value they
want to provide. Never assume or pick default values on the user's behalf.
Wait for the user's response before submitting the callback.`;

const ALLOWED_TOOLS = ['Read', 'Glob', 'Grep', 'Write'];

/**
 * Load agent configuration from .env.json and environment.
 * Returns { bedrockEnvVars, mcpServers, systemPrompt, allowedTools }
 */
export function loadAgentConfig() {
  const envPath = join(__dirname, '../../.env.json');
  let config = {};

  if (existsSync(envPath)) {
    try {
      config = JSON.parse(readFileSync(envPath, 'utf8'));
    } catch (err) {
      console.warn('[agent] Failed to read .env.json:', err.message);
    }
  }

  // Extract env vars from config (only keys that exist)
  const envVars = {};
  for (const key of ENV_KEYS_TO_EXPORT) {
    if (config[key]) {
      envVars[key] = config[key];
    }
  }

  // MCP servers from AGENT_MCP_SERVERS key — resolve relative paths to absolute
  const mcpServers = {};
  for (const [name, server] of Object.entries(config.AGENT_MCP_SERVERS || {})) {
    mcpServers[name] = {
      ...server,
      args: (server.args || []).map(arg =>
        arg.startsWith('/') ? arg : resolve(WEB_ROOT, arg)
      ),
    };
  }

  if (Object.keys(mcpServers).length > 0) {
    console.log('[agent] MCP servers:', Object.keys(mcpServers).join(', '));
  } else {
    console.log('[agent] No MCP servers configured in AGENT_MCP_SERVERS');
  }

  return {
    envVars,
    mcpServers,
    systemPrompt: SYSTEM_PROMPT,
    allowedTools: ALLOWED_TOOLS,
  };
}

/**
 * Apply environment variables to process.env.
 * This ensures both the Agent SDK (Bedrock) and MCP subprocesses
 * (SP-API credentials) pick them up.
 */
export function applyEnvVars(vars) {
  for (const [key, value] of Object.entries(vars)) {
    process.env[key] = value;
  }
}
