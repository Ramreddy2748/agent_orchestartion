const VOYAGE_EMBEDDINGS_URL = process.env.VOYAGE_EMBEDDINGS_URL || 'https://ai.mongodb.com/v1/embeddings';
// const ALLOW_MOCK_EMBEDDINGS = process.env.ALLOW_MOCK_EMBEDDINGS === 'true';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'voyage-3-large';

// function simpleHash(text: string): number {
//   let hash = 0;
//   for (let index = 0; index < text.length; index += 1) {
//     const char = text.charCodeAt(index);
//     hash = ((hash << 5) - hash) + char;
//     hash |= 0;
//   }
//   return hash;
// }

// Mock embeddings are intentionally disabled for challenge and production use.
// export function generateMockEmbedding(text: string): number[] {
//   const hash = simpleHash(text);
//   const embedding: number[] = [];
//
//   for (let index = 0; index < 1024; index += 1) {
//     embedding.push(Math.sin(hash + index) * Math.cos(hash * index) * 0.1);
//   }
//
//   return embedding;
// }

export async function generateQueryEmbedding(text: string): Promise<number[] | null> {
  const voyageApiKey = process.env.VOYAGE_API_KEY;

  if (!voyageApiKey) {
    // if (ALLOW_MOCK_EMBEDDINGS) {
    //   console.error('[MCP] VOYAGE_API_KEY missing, using mock query embedding because ALLOW_MOCK_EMBEDDINGS=true');
    //   return generateMockEmbedding(text);
    // }

    return null;
  }

  try {
    const response = await fetch(VOYAGE_EMBEDDINGS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${voyageApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        input: text,
        model: EMBEDDING_MODEL,
        input_type: 'query'
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[MCP] Query embedding request failed:', errorText);
      // return ALLOW_MOCK_EMBEDDINGS ? generateMockEmbedding(text) : null;
      return null;
    }

    const payload = await response.json() as { data: Array<{ embedding: number[] }> };
    return payload.data[0]?.embedding ?? null;
  } catch (error) {
    console.error('[MCP] Query embedding failed:', error);
    // return ALLOW_MOCK_EMBEDDINGS ? generateMockEmbedding(text) : null;
    return null;
  }
}
