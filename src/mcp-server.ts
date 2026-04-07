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

// Initialize the Model Context Protocol (MCP) server for the healthcare standards agent
const server = new Server(
  {
    // name and version of this MCP server
    name: 'healthcare-standards-agent',
    version: '1.0.0'
  },
  {
    // capabilities will tell the MCP runtime what capabilities this agent has, e.g., what tools it can call
    capabilities: {
    // we can have a different capabilities like: we can add resources, memory, or other capabilities that this agent can expose to the MCP runtime
      tools: {} // declared the tools capability for tellinh the MCP server what tools this agent having so that the MCP runtime knows what tools this agent can call
    }
  }
);

// Here we are adding a request handler for the ListToolsRequestSchema so that when the MCP runtime asks this agent what tools it has, we will send  with a list of tools this agent can call
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools: Tool[] = [
    {
        // tool that performs semantic vector search over the standards knowledge base
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
