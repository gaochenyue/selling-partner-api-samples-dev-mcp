# SP-API Dev Assistant MCP Server

A Model Context Protocol (MCP) server providing developer assistant tools for the Amazon Selling Partner API (SP-API).

## Tools

| Tool                           | Description                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------ |
| `sp_api_migration_assistant`   | Assists with API version migrations (Orders API v0 → v2026-01-01). Analyzes code and generates refactored implementations. |
| `sp_api_generate_code_sample`  | Generates code samples for SP-API across multiple languages (Python, Java, JavaScript, PHP, C#). |
| `sp_api_reference`             | Looks up authoritative SP-API documentation via semantic search over the official developer docs. |
| `sp_api_optimize`              | Performs a well-architected review of SP-API integration code across 9 optimization categories.   |

## Resources

| Resource                    | URI                            | Description                                                    |
| --------------------------- | ------------------------------ | -------------------------------------------------------------- |
| `orders-api-migration-data` | `sp-api://migration/orders-api` | Migration mapping data for Orders API v0 to v2026-01-01.       |

## Development

```bash
npm install
npm run build
npm test
```

## License

Apache-2.0
