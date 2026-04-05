import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, Tool } from '@modelcontextprotocol/sdk/types.js';
import { loadEnv } from './db/mongo';
import {
  DEFAULT_SEARCH_LIMIT,
  getStandardByChunkId,
  getStandardsByChapter,
  listSections,
  searchStandards
} from './services/standards.service';

loadEnv();

const server = new Server(
  {
    name: 'healthcare-standards-agent',
    version: '1.0.0'
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools: Tool[] = [
    {
      name: 'search_standards',
      description: 'Semantic vector search across all standards. Embeds the query, runs vector search, and returns the top matching evidence.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: {
            type: 'string',
            description: 'Natural language query to search for (e.g., "quality management policy", "patient safety")'
          },
          top_k: {
            type: 'number',
            description: 'Maximum number of results to return (default: 5)',
            default: 5
          }
        },
        required: ['query']
      }
    },
    {
      name: 'get_standard_by_chapter',
      description: 'Exact lookup by chapter ID. Returns the verbatim text for a specific chapter.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          chapter_id: {
            type: 'string',
            description: 'Chapter identifier (e.g., QM.1, LS.2, IC.3, HR.1, MS.1, EC.1, GL.1)'
          }
        },
        required: ['chapter_id']
      }
    },
    {
      name: 'get_standards_by_chapter',
      description: 'Backward-compatible alias for exact chapter lookup by chapter ID.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          chapter: {
            type: 'string',
            description: 'Chapter identifier (e.g., QM.1, LS.2, IC.3, HR.1, MS.1, EC.1, GL.1)'
          }
        },
        required: ['chapter']
      }
    },
    {
      name: 'list_sections',
      description: 'Returns all available sections and chapters in the knowledge base for discovery.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          section_filter: {
            type: 'string',
            description: 'Optional filter applied to chapter IDs, section names, or headings.'
          }
        }
      }
    },
    {
      name: 'get_standard_by_chunk_id',
      description: 'Retrieve one exact standard chunk by chunk_id (e.g., QM_1_001). Use this for precise citation lookups.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          chunk_id: {
            type: 'string',
            description: 'Exact chunk identifier (e.g., QM_1_001)'
          }
        },
        required: ['chunk_id']
      }
    },
    {
      name: 'list_chapters',
      description: 'Backward-compatible alias for listing all available chapters.',
      inputSchema: {
        type: 'object' as const,
        properties: {}
      }
    }
  ];

  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: string;

    switch (name) {
      case 'search_standards':
        result = await searchStandards(
          (args as any).query,
          (args as any).top_k || (args as any).limit || 5
        );
        break;

      case 'get_standard_by_chapter':
        result = await getStandardsByChapter((args as any).chapter_id || (args as any).chapter);
        break;

      case 'get_standards_by_chapter':
        result = await getStandardsByChapter((args as any).chapter);
        break;

      case 'list_sections':
        result = await listSections((args as any).section_filter);
        break;

      case 'get_standard_by_chunk_id':
        result = await getStandardByChunkId((args as any).chunk_id);
        break;

      case 'list_chapters':
        result = await listSections();
        break;

      default:
        return {
          content: [
            {
              type: 'text' as const,
              text: `Unknown tool: ${name}`
            }
          ],
          isError: true
        };
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: result
        }
      ]
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error executing tool: ${errorMsg}`
        }
      ],
      isError: true
    };
  }
});

export async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[MCP] Healthcare Standards Agent MCP Server ready');
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { DEFAULT_SEARCH_LIMIT };
