# Healthcare Standards Agent

The project ingests the DNV NIAHO hospital standards PDF, stores section-aware vectorized chunks in MongoDB Atlas, and exposes an MCP server for exact chapter lookup, section discovery, and semantic search.

This implementation was validated using Claude MCP workflows using the Claude connector with different tools.

## Deliverables Checklist

Implemented in this repository:

- `seed-database.ts` for PDF ingestion, chunking, embeddings, and MongoDB insert
- `src/mcp-server.ts` for the MCP server and tool exposure
- `package.json` and `tsconfig.json` for project configuration
- `.env.example` for required environment variables
- `README.md` for setup, architecture, and design decisions
- `TEST_RESULTS.md` for the required Q&A, citation, and edge-case outputs

Manual assets still to add before final submission package review:

- Atlas cluster screenshot
- Atlas collection screenshot
- Atlas vector search index screenshot
- Claude/Desktop or other MCP-client usage screenshots or screen recording

Suggested location for those manual assets:

- `docs/screenshots/`

## What This Project Does

- Parses the source PDF and maps standards into chapter-aware records
- Chunks content using section-first packing with overlap only inside split sections
- Generates real embeddings with MongoDB Atlas AI Models / Voyage
- Stores vectors and metadata in MongoDB Atlas
- Exposes MCP tools for:
  - semantic search
  - exact chapter retrieval
  - exact chunk retrieval
  - section and chapter listing
- Supports dual retrieval modes:
  - exact citation mode for chapter/chunk lookups
  - semantic retrieval mode for natural-language questions

## Current Status

- Atlas vector search is configured and working
- Seeder is reproducible and supports dry runs
- Current corpus shape after the latest reseed: `755` documents across `184` chapters
- Exact chapter reconstruction includes overlap cleanup and PDF artifact cleanup at render time

## Repository Layout

```text
medlaunch_AI/
├── seed-database.ts
├── vector-search-test.ts
├── mcp-server.ts
├── testing/
│   ├── assertions.ts
│   ├── run-all.ts
│   └── smoke-test.ts
├── src/
│   ├── mcp-server.ts
│   ├── db/
│   │   └── mongo.ts
│   ├── services/
│   │   ├── embeddings.ts
│   │   └── standards.service.ts
│   └── utils/
│       └── formatting.ts
├── docs/
│   └── screenshots/
│       └── README.md
├── .env.example
├── package.json
├── TEST_RESULTS.md
├── tsconfig.json
└── README.md
```

## Architecture

### Data Flow

1. `seed-database.ts` reads the NIAHO PDF.
2. The seeder extracts chapter sections and normalizes them into chapter records.
3. Chapters are split by section/subsection first.
4. Oversized sections are further split into paragraph or bullet-group units.
5. Overlap is applied only when a single oversized unit must be split.
6. Embeddings are generated in conservative batches.
7. Chunk records are written to MongoDB Atlas.
8. The MCP server retrieves either:
   - exact chapter/chunk content, or
   - semantic matches from Atlas `$vectorSearch`.

### Runtime Components

- `src/mcp-server.ts`
  Registers MCP tools and handles tool calls.

- `src/services/standards.service.ts`
  Implements semantic search, chapter lookup, chunk lookup, section listing, result ranking, and exact-wording quote extraction.

- `src/services/embeddings.ts`
  Generates query embeddings through the Atlas AI Models embedding endpoint.

- `src/db/mongo.ts`
  Loads environment variables, creates a singleton Mongo client, and exposes the standards collection.

- `src/utils/formatting.ts`
  Formats evidence, renders verbatim chapters, and removes overlap/PDF artifacts during chapter reconstruction.

## Prerequisites

- Node.js 18+
- MongoDB Atlas cluster
- MongoDB Atlas AI Models API key for embeddings
- The DNV NIAHO PDF in the project root, or a custom path supplied through `NIAHO_PDF_PATH`

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Required values:

```env
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster-url>/?appName=Cluster0
VOYAGE_API_KEY=your_model_api_key_here
VOYAGE_EMBEDDINGS_URL=https://ai.mongodb.com/v1/embeddings
EMBEDDING_MODEL=voyage-3-large
```

Important operational variables:

```env
VOYAGE_REQUESTS_PER_MINUTE=300
VOYAGE_TOKENS_PER_MINUTE=100000
MAX_EMBEDDING_BATCH_TOKENS=50000
MAX_EMBEDDING_BATCH_SIZE=12
EMBEDDING_REQUEST_DELAY_MS=250
EMBEDDING_MAX_RETRIES=5
EMBEDDING_RETRY_DELAY_MS=5000

RESET_COLLECTION=false
DRY_RUN=false
MAX_CHUNKS=0

```

Notes:

- `MAX_CHUNKS=0` means no seeding cap.

## MongoDB Atlas Setup

1. Create a cluster.
2. Create database `niaho_standards`.
3. Use collection `standards`.
4. Allow your current IP or another approved development CIDR.
5. Create an Atlas database user with read/write access.
6. Create an Atlas AI Models API key for embeddings.

### Vector Search Index

Create Atlas Vector Search index `vector_index` on `niaho_standards.standards`:

```json
{
  "fields": [
    {
      "type": "vector",
      "path": "embedding",
      "numDimensions": 1024,
      "similarity": "cosine"
    },
    {
      "type": "filter",
      "path": "metadata.chapter"
    },
    {
      "type": "filter",
      "path": "metadata.chapter_prefix"
    }
  ]
}
```

## Seeding the Database

### Dry run

```bash
npm run seed:dry-run
```

This performs PDF parsing, chunk generation, and batching analysis without requesting embeddings or writing to MongoDB.

### Full seed

```bash
npm run seed
```

### Replace existing collection

```bash
RESET_COLLECTION=true npm run seed
```

### Limit the seed to a small sample

```bash
MAX_CHUNKS=50 npm run seed
```

## Current Chunking Strategy

The current seeder uses a section-first strategy rather than SR-only slicing.

- Primary split: chapter/subchapter sections
- Target chunk range: `400` to `700` tokens
- Hard split threshold: `800` tokens
- Overlap: about `60` tokens, applied only when one oversized unit must be split
- Long sections are split into smaller paragraph or bullet-group units
- Standard sections retain `SR.*` awareness where available

## Testing

Run the lightweight smoke suite:

```bash
npm test
```

Current test coverage:

- semantic retrieval sanity check for patient rights
- exact chapter lookup sanity check for `PR.2`

Why this approach:

- preserves more local context for semantic search
- reduces answer fragmentation from overly small SR-only chunks
- keeps chunk sizes controlled for embedding cost and retrieval quality

## Stored Document Shape

Each document includes vector data plus structured metadata used for ranking, exact lookup, and chapter reconstruction.

```ts
{
  chunk_id: string,
  text: string,
  metadata: {
    document: string,
    section: string,
    chapter: string,
    chapter_prefix: string,
    heading: string,
    sr_id?: string,
    content_type: 'standard' | 'interpretive_guidelines' | 'surveyor_guidance' | 'chapter_intro',
    parent_block_id: string,
    block_order: number,
    subchunk_index: number,
    subchunk_count: number,
    source_file: string,
    seeded_at: string,
    embedding_model: string,
    embedding_provider: string
  },
  embedding: number[],
  token_count: number
}
```

## MCP Server

### Build

```bash
npm run build
```

### Run compiled server

```bash
npm run mcp
```

### Run in development

```bash
npm run mcp:dev
```

## Reviewer Connection Setup

This section is the fastest path for a reviewer to connect the MCP server.

Primary validated review path:

- Claude Desktop on macOS

The project was validated using Claude-compatible MCP workflows during development.

### Option A: Claude Desktop on macOS

This project exposes a local stdio MCP server, so Claude Desktop is the most direct way to review it locally.

1. Build the server:

```bash
npm run build
```

2. Open Claude Desktop config at:

```text
~/Library/Application Support/Claude/claude_desktop_config.json
```

3. Add this exact configuration snippet:

```json
{
  "mcpServers": {
    "healthcare-standards": {
      "command": "node",
      "args": [
        "/Users/varunreddyseelam/Desktop/medlaunch_AI/dist/mcp-server.js"
      ]
    }
  }
}
```

4. Fully quit and restart Claude Desktop.

5. In a new Claude Desktop chat, test with prompts like:

```text
Use only the healthcare-standards connector. Show me chapter LS.2 exactly.
```

```text
Use only the healthcare-standards connector. What are the staff competency assessment requirements?
```

Notes:

- The server reads environment variables from this project’s `.env` file at runtime.
- The absolute path above is correct for this machine and repository location.
- If the reviewer clones the repo somewhere else, they must replace the `args[0]` path with their local `dist/mcp-server.js` path.

### Generic MCP Client Command

For MCP-capable clients that use the same local stdio pattern, the server command is:

```json
{
  "command": "node",
  "args": [
    "/Users/varunreddyseelam/Desktop/medlaunch_AI/dist/mcp-server.js"
  ]
}
```

This repository was validated in Claude-compatible workflows. Other clients may require a different UI-specific import flow, but the command and arguments stay the same.

## Available MCP Tools

Primary challenge-facing tools:

- `search_standards(query, top_k)`
- `get_standard_by_chapter(chapter_id)`
- `list_sections(section_filter)`

Compatibility aliases also exposed:

- `get_standards_by_chapter(chapter)`
- `get_standard_by_chunk_id(chunk_id)`
- `list_chapters()`

### Tool Behavior

- `search_standards`
  - embeds the query
  - runs Atlas vector search when embeddings are available
  - falls back to regex/text search if query embeddings fail
  - includes direct quote extraction for exact-wording style prompts

- `get_standard_by_chapter`
  - returns verbatim chapter output
  - reconstructs chapters in sorted order using `block_order` and `subchunk_index`
  - removes repeated overlap and common PDF artifacts during rendering

- `list_sections`
  - lists chapters
  - can filter by chapter prefix, section name, or heading text

## Claude Desktop Example

For convenience, the same Claude Desktop config is repeated here:

```json
{
  "mcpServers": {
    "healthcare-standards": {
      "command": "node",
      "args": ["/Users/varunreddyseelam/Desktop/medlaunch_AI/dist/mcp-server.js"]
    }
  }
}
```

## Prompts we can use

- `Use only the healthcare-standards connector. Show me chapter QM.1 exactly.`
- `Use only the healthcare-standards connector. Is there a chapter about hand hygiene? Show me the exact wording.`
- `Use only the healthcare-standards connector. Chapters related to patient safety.`
- `Use only the healthcare-standards connector. What are the staff competency assessment requirements?`

## Validation Performed

Manual validation completed during development:

- `npm run build`
- `npm run seed:dry-run`
- `RESET_COLLECTION=true npm run seed`
- direct MongoDB inspection of selected chapters
- exact chapter retrieval checks including `IC.1`, `SM.7`, and `LS.2`
- semantic retrieval checks for:
  - medication errors
  - patient safety chapters
  - patient rights
  - hand hygiene
  - staff competency assessment
- Claude MCP workflow validation through local stdio server usage
- documented test matrix in `TEST_RESULTS.md`

There is currently no automated test suite wired into `npm test`.


## Design Choices

### Dual-mode retrieval

The system supports both exact retrieval and semantic retrieval because the challenge requires both citation-style lookup and broader natural-language search.

### Section-first chunking

Earlier, finer-grained chunks made some answers incomplete. Larger section-scoped chunks improved retrieval context and reduced answer fragmentation.

### Cost-aware batching

Embedding requests are throttled and batched conservatively using RPM/TPM caps and retry delays to avoid rate-limit churn and control spend.

### Exact chapter cleanup at render time

Instead of forcing a reseed to fix every PDF artifact, chapter rendering removes overlap and common PDF header/footer artifacts during reconstruction.

## Known Limitations

- Answer quality still depends on the client model following the retrieved evidence faithfully.
- There is no automated regression test suite yet.
- Some PDF extraction oddities may still survive if they are not part of the currently filtered artifact patterns.

## Troubleshooting

### `MONGODB_URI environment variable is required`

Set `MONGODB_URI` in `.env`.

### Query search falls back to text search

This usually means the embedding request failed or `VOYAGE_API_KEY` is missing.

### Seeder fails on embeddings

Check:

- Atlas AI Models key
- network access
- batch limits in `.env`
- retry settings for rate-limit recovery

### No chapter results returned

Check that:
- the collection is seeded
- the chapter exists in `metadata.chapter`
- the chapter ID format matches the stored form, for example `QM.8` or `LS.2`

## Scripts

```bash
npm run build # builds the MCP server for Claude Desktop
npm run seed # parses the PDF, generates embeddings, and inserts chunks into MongoDB Atlas
npm run seed:dry-run # validates parsing and chunking without embeddings or database writes
npm run search # runs a direct vector-search sanity check against the Atlas collection
npm run mcp # starts the compiled MCP server from dist/
npm run mcp:dev # starts the MCP server directly from TypeScript source for local development
```

## Submission Notes

This implementation targets the MCP-server delivery path and prioritizes:

- clean tool boundaries
- grounded retrieval behavior
- reproducible seeding
- Atlas-native vector search
- operational controls for embedding cost and reliability