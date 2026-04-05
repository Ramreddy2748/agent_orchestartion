import { MongoClient } from 'mongodb';
import * as dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || 'niaho_standards';
const COLLECTION_NAME = process.env.MONGODB_COLLECTION || 'standards';
const SEARCH_INDEX_NAME = process.env.SEARCH_INDEX_NAME || 'vector_index';
const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
const VOYAGE_EMBEDDINGS_URL = process.env.VOYAGE_EMBEDDINGS_URL || 'https://ai.mongodb.com/v1/embeddings';

if (!MONGODB_URI) {
  throw new Error('MONGODB_URI environment variable is required');
}

function simpleHash(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash;
}

function generateMockEmbedding(text: string): number[] {
  const hash = simpleHash(text);
  const embedding: number[] = [];
  for (let i = 0; i < 1024; i++) {
    embedding.push(Math.sin(hash + i) * Math.cos(hash * i) * 0.1);
  }
  return embedding;
}

async function generateQueryEmbedding(text: string): Promise<number[]> {
  if (!VOYAGE_API_KEY) {
    return generateMockEmbedding(text);
  }

  try {
    const response = await fetch(VOYAGE_EMBEDDINGS_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${VOYAGE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        input: text,
        model: 'voyage-3-large',
        input_type: 'query'
      })
    });

    if (!response.ok) {
      return generateMockEmbedding(text);
    }

    const payload = await response.json() as { data: Array<{ embedding: number[] }> };
    return payload.data[0].embedding;
  } catch {
    return generateMockEmbedding(text);
  }
}

async function main() {
  const client = new MongoClient(MONGODB_URI!);
  await client.connect();

  try {
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);

    const query = process.argv.slice(2).join(' ') || 'quality management policy';
    const queryEmbedding = await generateQueryEmbedding(query);

    console.log('Running vector search for query:', query);

    const pipeline = [
      {
        $vectorSearch: {
          index: SEARCH_INDEX_NAME,
          path: 'embedding',
          queryVector: queryEmbedding,
          numCandidates: 50,
          limit: 5
        }
      },
      {
        $project: {
          chunk_id: 1,
          text: 1,
          metadata: 1,
          score: { $meta: 'vectorSearchScore' }
        }
      },
    ];

    const results = await collection.aggregate(pipeline).toArray();

    if (results.length === 0) {
      console.log('No results returned. Check that the Atlas Search index is built and query vector matches embedding generation.');
      return;
    }

    console.log(`Found ${results.length} results:`);
    for (const doc of results) {
      console.log('---');
      console.log('chunk_id:', doc.chunk_id);
      console.log('chapter:', doc.metadata?.chapter);
      console.log('section:', doc.metadata?.section);
      console.log('score:', doc.score);
      console.log('text:', doc.text.slice(0, 250).replace(/\n/g, ' '));
    }
  } catch (error) {
    console.error('Vector search failed:', error);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
