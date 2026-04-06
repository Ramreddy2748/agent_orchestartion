import { MongoClient, Db } from 'mongodb';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

const pdfParse = require('pdf-parse');

// Load environment variables
dotenv.config();

// Interface representing a chunk of text extracted from the PDF along with its metadata
interface ChunkRecord {
  text: string; // The text content extracted from the PDF chunk
  chapter: string;
  section: string;
  chapter_prefix: string; // prefix part like QM, IC  (filters through chapter)
  heading: string; // its basically the title of chapter
  // optional id for the source/reference of this chunk it can be missing also
  sr_id?: string;
  content_type: 'standard' | 'interpretive_guidelines' | 'surveyor_guidance' | 'chapter_intro';
  parent_block_id: string;
  block_order: number;
  subchunk_index: number; // this tells u chunks for single part
  subchunk_count: number; // tells how many parts this chunk is split into
}

interface PreparedChunk extends ChunkRecord {
  chunk_id: string;
  token_count: number;
}

const DEFAULT_CHAPTER_SECTION_MAP: Record<string, string> = {
  QM: 'Quality Management',
  GB: 'Governing Body',
  CE: 'Chief Executive',
  MS: 'Medical Staff',
  NS: 'Nursing Services',
  SM: 'Staff Management',
  MM: 'Medication Management',
  SS: 'Surgical Services',
  AS: 'Anesthesia Services',
  OB: 'Obstetrical Services',
  LS: 'Laboratory Services',
  RC: 'Respiratory Care',
  MI: 'Medical Imaging',
  NM: 'Nuclear Medicine',
  RS: 'Rehabilitation Services',
  ES: 'Emergency Services',
  OS: 'Outpatient Services',
  DS: 'Dietetic Services',
  PR: 'Patient Rights',
  IC: 'Infection Control',
  MR: 'Medical Records',
  DC: 'Discharge Planning',
  UR: 'Utilization Review',
  PE: 'Physical Environment',
  TO: 'Transplant and Organ Donation',
  SB: 'Swing Beds',
  TD: 'Transfer and Discharge',
  PC: 'Patient Care',
  RR: 'Residents Rights',
  FS: 'Facility Services',
  RN: 'Resident Nutrition',
  HR: 'Human Resources',
  EC: 'Environment of Care',
  GL: 'Governance and Leadership',
  'PH-GR': 'Psychiatric Services - General Requirements',
  'PH-MR': 'Psychiatric Services - Medical Records Service',
  'PH-E': 'Psychiatric Services - Psychiatric Evaluation',
  'PH-NE': 'Psychiatric Services - Neurological Examination',
  'PH-TP': 'Psychiatric Services - Treatment Plan',
  'PH-PN': 'Psychiatric Services - Progress Notes',
  'PH-DP': 'Psychiatric Services - Discharge Planning',
  'PH-PR': 'Psychiatric Services - Personnel Resources',
  'PH-MS': 'Psychiatric Services - Medical Staff',
  'PH-NS': 'Psychiatric Services - Nursing Services',
  'PH-PS': 'Psychiatric Services - Psychological Services',
  'PH-SS': 'Psychiatric Services - Social Work Services',
  'PH-PA': 'Psychiatric Services - Psychosocial Assessment',
  'PH-TA': 'Psychiatric Services - Therapeutic Activities'
};


// function for extracting value from .env file
function getNumberEnv(name: string, fallback: number): number {
  const rawValue = process.env[name];
  if (!rawValue) {
    return fallback;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a valid number`);
  }

  return parsed;
}

function getBooleanEnv(name: string, fallback: boolean): boolean {
  const rawValue = process.env[name];
  if (!rawValue) {
    return fallback;
  }

  return rawValue === 'true';
}

function getStringEnv(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

const VOYAGE_REQUESTS_PER_MINUTE = getNumberEnv('VOYAGE_REQUESTS_PER_MINUTE', 300);
const VOYAGE_TOKENS_PER_MINUTE = getNumberEnv('VOYAGE_TOKENS_PER_MINUTE', 100000);
const MAX_EMBEDDING_BATCH_TOKENS = getNumberEnv('MAX_EMBEDDING_BATCH_TOKENS', 50000);
const MAX_EMBEDDING_BATCH_SIZE = getNumberEnv('MAX_EMBEDDING_BATCH_SIZE', 12);
const EMBEDDING_REQUEST_DELAY_MS = getNumberEnv('EMBEDDING_REQUEST_DELAY_MS', 250);
const EMBEDDING_MAX_RETRIES = getNumberEnv('EMBEDDING_MAX_RETRIES', 5);
const EMBEDDING_RETRY_DELAY_MS = getNumberEnv('EMBEDDING_RETRY_DELAY_MS', 5000);
const RESET_COLLECTION = getBooleanEnv('RESET_COLLECTION', false);
const DRY_RUN = getBooleanEnv('DRY_RUN', false);
const EMBEDDING_MODEL = getStringEnv('EMBEDDING_MODEL', 'voyage-3-large');

interface StandardDocument {
  chunk_id: string;
  text: string;
  metadata: {
    document: string;
    section: string;
    chapter: string;
    chapter_prefix: string;
    heading: string;
    sr_id?: string;
    content_type: 'standard' | 'interpretive_guidelines' | 'surveyor_guidance' | 'chapter_intro';
    parent_block_id: string;
    block_order: number;
    subchunk_index: number;
    subchunk_count: number;
    source_file: string;
    seeded_at: string;
    embedding_model: string;
    embedding_provider: string;
  };
  embedding: number[];
  token_count: number;
}

const VOYAGE_EMBEDDINGS_URL = process.env.VOYAGE_EMBEDDINGS_URL || 'https://ai.mongodb.com/v1/embeddings';
const TARGET_CHUNK_MIN_TOKENS = Number(process.env.TARGET_CHUNK_MIN_TOKENS || 400);
const TARGET_CHUNK_MAX_TOKENS = Number(process.env.TARGET_CHUNK_MAX_TOKENS || 700);
const HARD_CHUNK_SPLIT_THRESHOLD = Number(process.env.HARD_CHUNK_SPLIT_THRESHOLD || 800);
const OVERSIZED_BLOCK_OVERLAP_TOKENS = Number(process.env.OVERSIZED_BLOCK_OVERLAP_TOKENS || 60);

class DatabaseSeeder {
  private client: MongoClient;
  private db: Db;
  private chapterSectionMap: Record<string, string>;

  constructor() {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error('MONGODB_URI environment variable is required');
    }

   
    this.client = new MongoClient(mongoUri);
    this.db = this.client.db('niaho_standards');
    this.chapterSectionMap = { ...DEFAULT_CHAPTER_SECTION_MAP };
  }

  async connect(): Promise<void> {
    try {
      await this.client.connect();
      console.log('Connected to MongoDB Atlas');
    } catch (error) {
      console.error('Failed to connect to MongoDB:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    await this.client.close();
    console.log('Disconnected from MongoDB');
  }

  async generateEmbeddings(texts: string[], inputType: 'document' | 'query' = 'document'): Promise<number[][]> {
    const voyageApiKey = process.env.VOYAGE_API_KEY;
    if (!voyageApiKey) {
      throw new Error('VOYAGE_API_KEY environment variable is required');
    }

    for (let attempt = 1; attempt <= EMBEDDING_MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(VOYAGE_EMBEDDINGS_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${voyageApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            input: texts,
            model: EMBEDDING_MODEL,
            input_type: inputType
          })
        });

        if (response.ok) {
          const data = await response.json() as { data: Array<{ embedding: number[] }> };
          return data.data.map((item) => item.embedding);
        }

        const errorText = await response.text();
        console.error(`Voyage AI API error details (attempt ${attempt}/${EMBEDDING_MAX_RETRIES}):`, errorText);

        const shouldRetry = response.status === 429 || (response.status === 403 && /payment method|rate limits|TPM|RPM/i.test(errorText));
        if (shouldRetry && attempt < EMBEDDING_MAX_RETRIES) {
          const retryDelay = EMBEDDING_RETRY_DELAY_MS * attempt;
          console.log(`Embedding request hit a free-tier limit. Waiting ${retryDelay}ms before retry ${attempt + 1}/${EMBEDDING_MAX_RETRIES}...`);
          await this.sleep(retryDelay);
          continue;
        }

    

        throw new Error(`Embedding request failed with status ${response.status}: ${errorText}`);
      } catch (error) {
        console.error(`Failed to generate embedding (attempt ${attempt}/${EMBEDDING_MAX_RETRIES}):`, error);

        if (attempt < EMBEDDING_MAX_RETRIES) {
          const retryDelay = EMBEDDING_RETRY_DELAY_MS * attempt;
          console.log(`Embedding request failed transiently. Waiting ${retryDelay}ms before retry ${attempt + 1}/${EMBEDDING_MAX_RETRIES}...`);
          await this.sleep(retryDelay);
          continue;
        }

        throw error;
      }
    }

    throw new Error('Failed to generate embeddings after exhausting retries');
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async reconnect(): Promise<void> {
    try {
      await this.client.close();
    } catch {
      // Ignore close errors while resetting the connection pool.
    }

    await this.client.connect();
    this.db = this.client.db('niaho_standards');
    console.log('Reconnected to MongoDB Atlas');
  }

  isRetryableMongoError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const maybeLabeled = error as Error & { errorLabelSet?: Set<string> };
    if (maybeLabeled.errorLabelSet?.has('RetryableWriteError') || maybeLabeled.errorLabelSet?.has('ResetPool')) {
      return true;
    }

    return /ssl\/tls alert bad record mac|MongoNetworkError|ECONNRESET|connection/i.test(error.message);
  }

  async writeBatch(documents: StandardDocument[], batchLabel: string): Promise<void> {
    for (let attempt = 1; attempt <= EMBEDDING_MAX_RETRIES; attempt++) {
      try {
        const collection = this.db.collection('standards');
        await collection.bulkWrite(
          documents.map((document) => ({
            updateOne: {
              filter: { chunk_id: document.chunk_id },
              update: { $set: document },
              upsert: true
            }
          })),
          { ordered: false }
        );
        return;
      } 
      catch (error) {
        if (!this.isRetryableMongoError(error) || attempt === EMBEDDING_MAX_RETRIES) {
          throw error;
        }

        const retryDelay = EMBEDDING_RETRY_DELAY_MS * attempt;
        console.warn(`Retryable MongoDB write failure on ${batchLabel}. Retrying in ${retryDelay}ms (${attempt}/${EMBEDDING_MAX_RETRIES})...`);
        await this.sleep(retryDelay);
        await this.reconnect();
      }
    }
  }

 

  resolvePdfPath(): string {
    const explicitPath = process.env.NIAHO_PDF_PATH;
    const candidatePaths = [
      explicitPath,
      path.join(process.cwd(), 'DNV_NIAHO_Accreditation_Requirements_for_Hospitals_Rev25-1.pdf'),
      path.join(__dirname, 'DNV_NIAHO_Accreditation_Requirements_for_Hospitals_Rev25-1.pdf'),
      path.join(path.dirname(__dirname), 'DNV_NIAHO_Accreditation_Requirements_for_Hospitals_Rev25-1.pdf')
    ].filter((candidate): candidate is string => Boolean(candidate));

    const pdfPath = candidatePaths.find((candidate) => fs.existsSync(candidate));

    if (!pdfPath) {
      throw new Error('Could not find the NIAHO PDF. Set NIAHO_PDF_PATH or place the PDF in the project root.');
    }

    return pdfPath;
  }

  async parsePDFText(pdfBuffer: Buffer): Promise<string> {
    const parsed = await pdfParse(pdfBuffer);
    return parsed.text
      .replace(/\r/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+\n/g, '\n')
      .trim();
  }

  isBoilerplateLine(line: string): boolean {
    const trimmed = line.trim();

    if (!trimmed) {
      return true;
    }

    if (/^Page\s+[ivxlcdm\d]+\s+of\s+\d+$/i.test(trimmed)) {
      return true;
    }

    if (/^Revision\s+\d+/i.test(trimmed)) {
      return true;
    }

    if (/^NIAHO/i.test(trimmed)) {
      return true;
    }

    if (trimmed === '®') {
      return true;
    }

    if (/^Accreditation Requirements, Interpretive Guidelines/i.test(trimmed)) {
      return true;
    }

    if (/\.{5,}\s*\d+\s*$/.test(trimmed)) {
      return true;
    }

    return false;
  }

  findContentStartIndex(lines: string[]): number {
    const firstMainChapterIndex = lines.findIndex((line) => /^QM\.1\s+[A-Z]/.test(line));
    return firstMainChapterIndex >= 0 ? firstMainChapterIndex : 0;
  }

  toTitleCaseLabel(value: string): string {
    return value
      .toLowerCase()
      .replace(/\b([a-z])/g, (_, char: string) => char.toUpperCase())
      .replace(/\bOf\b/g, 'of')
      .replace(/\bAnd\b/g, 'and')
      .replace(/\bFor\b/g, 'for')
      .replace(/\bTo\b/g, 'to');
  }

  buildChapterSectionMap(text: string): Record<string, string> {
    const extractedMap: Record<string, string> = {};
    const tocLineRegex = /^([A-Z][A-Z\s/&,'\-]+?)\s+\(([A-Z]{2,4}(?:-[A-Z]{1,3})?)\)\s*\.{3,}\s*\d+\s*$/;

    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim().replace(/\s+/g, ' ');
      const match = line.match(tocLineRegex);

      if (!match) {
        continue;
      }

      const label = this.toTitleCaseLabel(match[1].trim());
      const code = match[2].trim().toUpperCase();
      extractedMap[code] = label;
    }

    return {
      ...DEFAULT_CHAPTER_SECTION_MAP,
      ...extractedMap
    };
  }

  splitIntoChunks(text: string): ChunkRecord[] {
    const chapterChunks: ChunkRecord[] = [];
    const numberedChapterRegex = /^([A-Z]{2,4})\.(\d+(?:\.\d+)*)\b\s+[A-Z]/;
    const appendixChapterRegex = /^(?:[A-Z][A-Z\s/&,'\-]+\s+)?\((PH-[A-Z]{1,3})\)\s*$/;
    const cleanedLines = text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line === '' || !this.isBoilerplateLine(line));
    const lines = cleanedLines.slice(this.findContentStartIndex(cleanedLines));

    let currentChapter = '';
    let currentSection = '';
    let currentChapterPrefix = '';
    let currentChunkLines: string[] = [];

    for (const line of lines) {
      const numberedChapterMatch = line.match(numberedChapterRegex);
      const appendixChapterMatch = line.match(appendixChapterRegex);
      const chapterCode = numberedChapterMatch
        ? `${numberedChapterMatch[1]}.${numberedChapterMatch[2]}`
        : appendixChapterMatch?.[1];
      const chapterPrefix = chapterCode?.split('.')[0];
      const isRecognizedChapter = Boolean(
        chapterCode && chapterPrefix !== 'SR' && (this.chapterSectionMap[chapterCode] || this.chapterSectionMap[chapterPrefix!])
      );

      if (chapterCode && isRecognizedChapter) {
        if (currentChunkLines.length > 0 && currentChapter) {
          chapterChunks.push({
            text: currentChunkLines.join('\n').trim(),
            chapter: currentChapter,
            section: currentSection,
            chapter_prefix: currentChapterPrefix,
            heading: currentChunkLines[0],
            content_type: 'chapter_intro',
            parent_block_id: `${currentChapter.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}_CHAPTER`,
            block_order: 0,
            subchunk_index: 1,
            subchunk_count: 1
          });
        }

        currentChapter = chapterCode;
        currentSection = this.extractSectionName(currentChapter);
        currentChapterPrefix = chapterPrefix!;
        currentChunkLines = [line];
      } else {
        if (currentChunkLines.length > 0) {
          currentChunkLines.push(line);
        }
      }
    }

    if (currentChunkLines.length > 0 && currentChapter) {
      chapterChunks.push({
        text: currentChunkLines.join('\n').trim(),
        chapter: currentChapter,
        section: currentSection,
        chapter_prefix: currentChapterPrefix,
        heading: currentChunkLines[0],
        content_type: 'chapter_intro',
        parent_block_id: `${currentChapter.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}_CHAPTER`,
        block_order: 0,
        subchunk_index: 1,
        subchunk_count: 1
      });
    }

    return chapterChunks.flatMap((chunk) => this.splitChapterIntoSubchunks(chunk));
  }

  splitChapterIntoSubchunks(chunk: ChunkRecord): ChunkRecord[] {
    const lines = chunk.text
      .split('\n')
      .map((line) => line.trim());

    if (lines.length <= 1) {
      return [chunk];
    }

    const heading = lines[0];
    const bodyLines = lines.slice(1);
    const interpretiveRegex = /^Interpretive Guidelines:?$/i;
    const surveyorRegex = /^Surveyor Guidance:?$/i;
    const sections: Array<{
      content_type: ChunkRecord['content_type'];
      parent_block_id: string;
      block_order: number;
      lines: string[];
    }> = [];

    let currentBlock: {
      content_type: ChunkRecord['content_type'];
      parent_block_id: string;
      block_order: number;
      lines: string[];
    } | null = null;
    let blockOrder = 0;

    const flushBlock = () => {
      if (currentBlock && currentBlock.lines.some((line) => line.trim().length > 0)) {
        sections.push(currentBlock);
      }
      currentBlock = null;
    };

    for (const line of bodyLines) {
      if (interpretiveRegex.test(line)) {
        flushBlock();
        blockOrder += 1;
        currentBlock = {
          content_type: 'interpretive_guidelines',
          parent_block_id: `${chunk.chapter.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}_INTERPRETIVE_GUIDELINES`,
          block_order: blockOrder,
          lines: ['Interpretive Guidelines:']
        };
        continue;
      }

      if (surveyorRegex.test(line)) {
        flushBlock();
        blockOrder += 1;
        currentBlock = {
          content_type: 'surveyor_guidance',
          parent_block_id: `${chunk.chapter.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}_SURVEYOR_GUIDANCE`,
          block_order: blockOrder,
          lines: ['Surveyor Guidance:']
        };
        continue;
      }

      if (!currentBlock) {
        blockOrder += 1;
        currentBlock = {
          content_type: 'standard',
          parent_block_id: `${chunk.chapter.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}_STANDARD`,
          block_order: blockOrder,
          lines: []
        };
      }

      currentBlock.lines.push(line);
    }

    flushBlock();

    return sections.flatMap((section) => this.createSectionChunks({
      ...chunk,
      heading,
      sr_id: undefined,
      content_type: section.content_type,
      parent_block_id: section.parent_block_id,
      block_order: section.block_order,
      subchunk_index: 1,
      subchunk_count: 1,
      text: [heading, ...section.lines].join('\n').replace(/\n{3,}/g, '\n\n').trim()
    }, section.lines));
  }

  createSectionChunks(chunk: ChunkRecord, sectionLines: string[]): ChunkRecord[] {
    const units = this.buildSectionUnits(sectionLines, chunk.content_type)
      .flatMap((unit) => this.splitOversizedUnit(unit));

    if (units.length === 0) {
      return [{ ...chunk, subchunk_index: 1, subchunk_count: 1 }];
    }

    const groupedUnits: Array<Array<{ text: string; sr_id?: string }>> = [];
    let currentGroup: Array<{ text: string; sr_id?: string }> = [];
    let currentTokens = this.estimateTokenCount(chunk.heading);

    for (const unit of units) {
      const unitTokens = this.estimateTokenCount(unit.text);
      const canStayUnderHardLimit = currentTokens + unitTokens <= HARD_CHUNK_SPLIT_THRESHOLD;
      const shouldKeepGrowing = currentTokens < TARGET_CHUNK_MIN_TOKENS && canStayUnderHardLimit;
      const shouldSplit = currentGroup.length > 0 && !shouldKeepGrowing && currentTokens + unitTokens > TARGET_CHUNK_MAX_TOKENS;

      if (shouldSplit) {
        groupedUnits.push(currentGroup);
        currentGroup = [];
        currentTokens = this.estimateTokenCount(chunk.heading);
      }

      currentGroup.push(unit);
      currentTokens += unitTokens;
    }

    if (currentGroup.length > 0) {
      groupedUnits.push(currentGroup);
    }

    if (groupedUnits.length > 1) {
      const lastGroup = groupedUnits[groupedUnits.length - 1];
      const lastTokens = this.estimateTokenCount([chunk.heading, ...lastGroup.map((item) => item.text)].join('\n\n'));
      if (lastTokens < TARGET_CHUNK_MIN_TOKENS / 2) {
        const previousGroup = groupedUnits[groupedUnits.length - 2];
        groupedUnits[groupedUnits.length - 2] = [...previousGroup, ...lastGroup];
        groupedUnits.pop();
      }
    }

    return groupedUnits.map((group, index) => {
      const distinctSrIds = [...new Set(group.map((item) => item.sr_id).filter((value): value is string => Boolean(value)))];

      return {
        ...chunk,
        sr_id: distinctSrIds.length === 1 ? distinctSrIds[0] : undefined,
        text: [chunk.heading, ...group.map((item) => item.text)].join('\n\n').trim(),
        subchunk_index: index + 1,
        subchunk_count: groupedUnits.length
      };
    });
  }

  buildSectionUnits(lines: string[], contentType: ChunkRecord['content_type']): Array<{ text: string; sr_id?: string }> {
    if (contentType === 'standard') {
      return this.buildStandardUnits(lines);
    }

    return this.buildParagraphUnits(lines);
  }

  buildStandardUnits(lines: string[]): Array<{ text: string; sr_id?: string }> {
    const srRegex = /^(SR\.\d+[a-z]?(?:\([^)]+\))*)(?=\s|$)/i;
    const units: Array<{ text: string; sr_id?: string }> = [];
    let currentLines: string[] = [];
    let currentSrId: string | undefined;

    const flushUnit = () => {
      const text = currentLines.join('\n').trim();
      if (text) {
        units.push({ text, sr_id: currentSrId });
      }
      currentLines = [];
      currentSrId = undefined;
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }

      const srMatch = line.match(srRegex);
      if (srMatch) {
        flushUnit();
        currentSrId = srMatch[1].toUpperCase();
        currentLines = [line];
        continue;
      }

      if (currentLines.length === 0) {
        currentLines = [line];
      } else {
        currentLines.push(line);
      }
    }

    flushUnit();
    return units;
  }

  buildParagraphUnits(lines: string[]): Array<{ text: string; sr_id?: string }> {
    const units: Array<{ text: string; sr_id?: string }> = [];
    const bulletRegex = /^(?:[•*-]|o\b|\d+\.)\s+/;
    let currentLines: string[] = [];

    const flushUnit = () => {
      const text = currentLines.join('\n').trim();
      if (text) {
        units.push({ text });
      }
      currentLines = [];
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();

      if (!line) {
        flushUnit();
        continue;
      }

      if (bulletRegex.test(line)) {
        flushUnit();
        currentLines = [line];
        continue;
      }

      if (currentLines.length === 0) {
        currentLines = [line];
      } else {
        currentLines.push(line);
      }
    }

    flushUnit();
    return units;
  }

  getLastTokens(text: string, tokenCount: number): string {
    const tokens = text.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
      return '';
    }

    return tokens.slice(-tokenCount).join(' ');
  }

  splitOversizedUnit(unit: { text: string; sr_id?: string }): Array<{ text: string; sr_id?: string }> {
    if (this.estimateTokenCount(unit.text) <= HARD_CHUNK_SPLIT_THRESHOLD) {
      return [unit];
    }

    const tokens = unit.text.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
      return [];
    }

    const segments: Array<{ text: string; sr_id?: string }> = [];
    let startIndex = 0;

    while (startIndex < tokens.length) {
      let endIndex = Math.min(tokens.length, startIndex + TARGET_CHUNK_MAX_TOKENS);
      let segmentTokens = tokens.slice(startIndex, endIndex);

      while (segmentTokens.length > 1 && this.estimateTokenCount(segmentTokens.join(' ')) > HARD_CHUNK_SPLIT_THRESHOLD) {
        endIndex -= 1;
        segmentTokens = tokens.slice(startIndex, endIndex);
      }

      if (segmentTokens.length === 0) {
        endIndex = Math.min(tokens.length, startIndex + 1);
        segmentTokens = tokens.slice(startIndex, endIndex);
      }

      const segmentText = segmentTokens.join(' ').trim();
      if (segmentText) {
        segments.push({ text: segmentText, sr_id: unit.sr_id });
      }

      if (endIndex >= tokens.length) {
        break;
      }

      const overlapText = this.getLastTokens(segmentText, OVERSIZED_BLOCK_OVERLAP_TOKENS);
      const overlapCount = overlapText ? overlapText.split(/\s+/).filter(Boolean).length : 0;
      startIndex = Math.max(startIndex + 1, endIndex - overlapCount);
    }

    return segments;
  }

  extractSectionName(chapter: string): string {
    const prefix = chapter.split('.')[0];
    return this.chapterSectionMap[chapter] || this.chapterSectionMap[prefix] || `${prefix} Standards`;
  }

  estimateTokenCount(text: string): number {
    return Math.ceil(text.length / 4);
  }

  prepareChunks(chunks: ChunkRecord[]): PreparedChunk[] {
    const seenChunkIds = new Map<string, number>();

    return chunks.map((chunk, index) => {
      const baseChunkId = chunk.subchunk_count > 1
        ? `${chunk.parent_block_id}_PART_${String(chunk.subchunk_index).padStart(3, '0')}`
        : chunk.parent_block_id || `${chunk.chapter.replace(/\./g, '_')}_${String(index + 1).padStart(3, '0')}`;

      const duplicateCount = (seenChunkIds.get(baseChunkId) || 0) + 1;
      seenChunkIds.set(baseChunkId, duplicateCount);

      return {
        ...chunk,
        chunk_id: duplicateCount === 1 ? baseChunkId : `${baseChunkId}_${String(duplicateCount).padStart(3, '0')}`,
        token_count: this.estimateTokenCount(chunk.text)
      };
    });
  }

  createEmbeddingBatches(chunks: PreparedChunk[]): PreparedChunk[][] {
    const batches: PreparedChunk[][] = [];
    let currentBatch: PreparedChunk[] = [];
    let currentBatchTokens = 0;

    for (const chunk of chunks) {
      const wouldExceedBatchSize = currentBatch.length >= MAX_EMBEDDING_BATCH_SIZE;
      const wouldExceedTokenLimit = currentBatchTokens + chunk.token_count > MAX_EMBEDDING_BATCH_TOKENS;

      if (currentBatch.length > 0 && (wouldExceedBatchSize || wouldExceedTokenLimit)) {
        batches.push(currentBatch);
        currentBatch = [];
        currentBatchTokens = 0;
      }

      currentBatch.push(chunk);
      currentBatchTokens += chunk.token_count;
    }

    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    return batches;
  }

  summarizeChunks(chunks: PreparedChunk[]): Record<string, number> {
    return chunks.reduce<Record<string, number>>((summary, chunk) => {
      summary[chunk.chapter] = (summary[chunk.chapter] || 0) + 1;
      return summary;
    }, {});
  }

  async seedDatabase(): Promise<void> {
    try {
      const pdfPath = this.resolvePdfPath();
      const sourceFile = path.basename(pdfPath);
      const seededAt = new Date().toISOString();
      const pdfBuffer = fs.readFileSync(pdfPath);
      console.log(`Using PDF: ${pdfPath}`);

      const fullText = await this.parsePDFText(pdfBuffer);
      console.log('PDF text extracted, length:', fullText.length);

      this.chapterSectionMap = this.buildChapterSectionMap(fullText);
      console.log(`Loaded ${Object.keys(this.chapterSectionMap).length} chapter/section mappings`);

      const chunks = this.splitIntoChunks(fullText);
      console.log(`Split into ${chunks.length} chunks`);

      if (chunks.length === 0) {
        throw new Error('No chapter chunks were extracted from the PDF text.');
      }

      const preparedChunks = this.prepareChunks(chunks);
      const chapterSummary = this.summarizeChunks(preparedChunks);
      const limitedBatches = this.createEmbeddingBatches(preparedChunks);
      console.log(
        `Embedding profile: ${VOYAGE_REQUESTS_PER_MINUTE} RPM, ${VOYAGE_TOKENS_PER_MINUTE} TPM, ` +
        `${MAX_EMBEDDING_BATCH_TOKENS} max tokens per batch, ${MAX_EMBEDDING_BATCH_SIZE} max chunks per batch`
      );
      console.log(`Prepared ${preparedChunks.length} chunks across ${limitedBatches.length} embedding batches`);
      console.log(`Detected ${Object.keys(chapterSummary).length} chapters after chunking`);

      if (DRY_RUN) {
        console.log('Dry run enabled. No embeddings will be requested and no database writes will occur.');
        console.log('Top chapters by chunk count:', Object.entries(chapterSummary).sort((a, b) => b[1] - a[1]).slice(0, 12));
        return;
      }

      const collection = this.db.collection('standards');
      await collection.createIndex({ chunk_id: 1 }, { unique: true });
      await collection.createIndex({ 'metadata.chapter': 1, chunk_id: 1 });
      await collection.createIndex({ 'metadata.chapter_prefix': 1, 'metadata.chapter': 1 });
      await collection.createIndex({ 'metadata.sr_id': 1 }, { sparse: true });
      await collection.createIndex({ 'metadata.chapter': 1, 'metadata.block_order': 1, 'metadata.subchunk_index': 1 });
      await collection.createIndex({ 'metadata.parent_block_id': 1, 'metadata.subchunk_index': 1 });
      await collection.createIndex({ 'metadata.content_type': 1, 'metadata.chapter': 1 });

      if (RESET_COLLECTION) {
        await collection.deleteMany({});
        console.log('Cleared existing standards collection');
      } else {
        console.log('Resume mode enabled: existing documents will be updated or skipped by chunk_id');
      }

      let processedCount = 0;

      for (let batchIndex = 0; batchIndex < limitedBatches.length; batchIndex++) {
        const batch = limitedBatches[batchIndex];
        console.log(`Processing embedding batch ${batchIndex + 1}/${limitedBatches.length} with ${batch.length} chunks`);

        const embeddings = await this.generateEmbeddings(batch.map((chunk) => chunk.text));
        const documents: StandardDocument[] = batch.map((chunk, index) => ({
          chunk_id: chunk.chunk_id,
          text: chunk.text,
          metadata: {
            document: 'NIAHO Standards',
            section: chunk.section,
            chapter: chunk.chapter,
            chapter_prefix: chunk.chapter_prefix,
            heading: chunk.heading,
            sr_id: chunk.sr_id,
            content_type: chunk.content_type,
            parent_block_id: chunk.parent_block_id,
            block_order: chunk.block_order,
            subchunk_index: chunk.subchunk_index,
            subchunk_count: chunk.subchunk_count,
            source_file: sourceFile,
            seeded_at: seededAt,
            embedding_model: EMBEDDING_MODEL,
            embedding_provider: VOYAGE_EMBEDDINGS_URL.includes('mongodb.com') ? 'mongodb-atlas-ai' : 'voyage'
          },
          embedding: embeddings[index],
          token_count: chunk.token_count
        }));

        await this.writeBatch(documents, `embedding batch ${batchIndex + 1}`);
        processedCount += documents.length;
        console.log(`Inserted batch ${batchIndex + 1}: ${documents.length} documents (${processedCount}/${preparedChunks.length} total)`);

        if (batchIndex < limitedBatches.length - 1) {
          console.log(`Waiting ${EMBEDDING_REQUEST_DELAY_MS}ms to respect embedding API rate limits...`);
          await this.sleep(EMBEDDING_REQUEST_DELAY_MS);
        }
      }

      console.log('Database seeding completed successfully!');
      console.log(`Total documents inserted: ${await collection.countDocuments()}`);

    } catch (error) {
      console.error('Error seeding database:', error);
      throw error;
    }
  }
}

async function main() {
  const seeder = new DatabaseSeeder();
  const shouldConnect = !DRY_RUN;

  try {
    if (shouldConnect) {
      await seeder.connect();
    }
    await seeder.seedDatabase();
  } catch (error) {
    console.error('Seeding failed:', error);
    process.exit(1);
  } finally {
    if (shouldConnect) {
      await seeder.disconnect();
    }
  }
}

// Run the seeder if this file is executed directly
if (require.main === module) {
  main();
}

export { DatabaseSeeder };