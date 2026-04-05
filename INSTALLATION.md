# Healthcare Standards Agent - MCP Server Installation Log
Project: medlaunch_AI
Date: April 4, 2026

## Installed Dependencies

### Core Dependencies
- @modelcontextprotocol/sdk: ^1.29.0        (Model Context Protocol for Claude.ai/ChatGPT integration)
- mongodb: ^7.1.1                            (MongoDB database driver)
- typescript: ^6.0.2                         (TypeScript compiler)
- dotenv: ^17.4.0                            (Environment variable management)

### Development Dependencies
- ts-node: ^10.9.2                           (TypeScript Node.js execution)
- @types/node: ^25.5.2                       (TypeScript type definitions for Node.js)

### Additional Packages (for PDF processing - may not be used)
- pdf2pic: ^3.2.0                            (PDF to image conversion)
- tesseract.js: ^7.0.0                       (OCR/text extraction)

## npm Scripts
- npm run build                              (Compile TypeScript to JavaScript)
- npm run seed                               (Run database seeder - populates MongoDB with standards)
- npm run search                             (Test vector search functionality)
- npm run mcp                                (Start MCP server) [TO BE ADDED]

## Project Structure
- seed-database.ts                           (Data ingestion script)
- vector-search-test.ts                      (Vector search validation)
- mcp-server.ts                              (MCP server implementation)
- tsconfig.json                              (TypeScript configuration)
- .env                                       (Environment variables: MONGODB_URI, VOYAGE_API_KEY)

## Key Libraries
- MCP SDK: Enables tool definitions and stdio transport for Claude.ai/ChatGPT
- MongoDB: Cloud database with vector search support
- TypeScript: Type-safe development

## Notes
- Voyage AI API key: Having 403 Forbidden issues - using mock embeddings as fallback
- Atlas Vector Search index: Pending/Building (knnVector type, 1024 dimensions, cosine similarity)
- MCP Server: Ready to connect to Claude.ai or ChatGPT via stdio transport
