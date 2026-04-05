import { Document, MongoClient } from 'mongodb';
import * as fs from 'fs';
import * as path from 'path';

const DB_NAME = 'niaho_standards';
const COLLECTION_NAME = 'standards';
const SEARCH_INDEX_NAME = 'vector_index';

let mongoClient: MongoClient | undefined;
let envLoaded = false;

function loadEnv(): void {
  if (envLoaded) {
    return;
  }

  try {
    const scriptDir = __dirname;
    const projectRoot = scriptDir.includes(`${path.sep}dist${path.sep}`)
      ? path.resolve(scriptDir, '..', '..', '..')
      : path.resolve(scriptDir, '..', '..');
    const envPath = path.join(projectRoot, '.env');

    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      const envVars: Record<string, string> = {};

      for (const line of envContent.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
          continue;
        }

        const [key, ...valueParts] = trimmed.split('=');
        if (!key || valueParts.length === 0) {
          continue;
        }

        envVars[key.trim()] = valueParts.join('=').trim();
      }

      Object.assign(process.env, envVars);
    }
  } catch {
    // Avoid stdout/stderr noise for MCP startup.
  }

  envLoaded = true;
}

export async function getMongoClient(): Promise<MongoClient> {
  loadEnv();

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI environment variable is required');
  }

  if (!mongoClient) {
    mongoClient = new MongoClient(mongoUri);
    await mongoClient.connect();
    console.error('[MCP] Connected to MongoDB Atlas');
  }

  return mongoClient;
}

export async function getStandardsCollection<TSchema extends Document = Document>() {
  const client = await getMongoClient();
  return client.db(DB_NAME).collection<TSchema>(COLLECTION_NAME);
}

export { COLLECTION_NAME, DB_NAME, SEARCH_INDEX_NAME, loadEnv };
