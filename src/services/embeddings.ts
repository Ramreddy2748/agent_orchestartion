const VOYAGE_EMBEDDINGS_URL = process.env.VOYAGE_EMBEDDINGS_URL || 'https://ai.mongodb.com/v1/embeddings';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'voyage-3-large';

export async function generateQueryEmbedding(text: string): Promise<number[] | null> {
  const voyageApiKey = process.env.VOYAGE_API_KEY;

  if (!voyageApiKey) {
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
      return null;
    }

    const payload = await response.json() as { data: Array<{ embedding: number[] }> };
    return payload.data[0]?.embedding ?? null;
  } catch (error) {
    console.error('[MCP] Query embedding failed:', error);
    return null;
  }
}
