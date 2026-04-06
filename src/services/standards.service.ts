import { getStandardsCollection, SEARCH_INDEX_NAME } from '../db/mongo';
import { generateQueryEmbedding } from './embeddings';
import { connectorHeader, formatEvidence, renderVerbatimChapter } from '../utils/formatting';

export interface StandardDocument {
  chunk_id: string;
  text: string;
  metadata?: {
    document?: string;
    section?: string;
    chapter?: string;
    chapter_prefix?: string;
    heading?: string;
    sr_id?: string;
    content_type?: 'standard' | 'interpretive_guidelines' | 'surveyor_guidance' | 'chapter_intro';
    parent_block_id?: string;
    block_order?: number;
    subchunk_index?: number;
    subchunk_count?: number;
  };
  token_count?: number;
  score?: number;
}

export interface SearchResultPayload {
  results: StandardDocument[];
  usedVectorSearch: boolean;
}

export const DEFAULT_SEARCH_LIMIT = 8;
const MAX_CHAPTER_RESULTS = 200;
const COMMON_QUERY_TERMS = new Set([
  'about',
  'all',
  'and',
  'chapter',
  'chapters',
  'cite',
  'exact',
  'exactly',
  'find',
  'for',
  'give',
  'is',
  'list',
  'me',
  'please',
  'quote',
  'show',
  'standards',
  'text',
  'the',
  'there',
  'tell',
  'verbatim',
  'what',
  'wording'
]);

const NON_PREFIX_WORDS = new Set([
  'about',
  'all',
  'find',
  'give',
  'list',
  'show',
  'tell',
  'the',
  'what'
]);

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeChapterInput(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, '');
}

function extractChapterReferences(query: string): string[] {
  const numberedMatches = query.match(/\b[A-Z]{2,4}\.\d+(?:\.\d+)*\b/gi) ?? [];
  const appendixMatches = query.match(/\b[A-Z]{2,4}-[A-Z]{1,3}\b/gi) ?? [];
  return [...new Set([...numberedMatches, ...appendixMatches].map((match) => normalizeChapterInput(match)))];
}

function extractChapterPrefix(query: string): string | null {
  const match = query.match(/\b([A-Z]{2,4})\s+chapters\b/i);
  if (!match) {
    return null;
  }

  const candidate = normalizeChapterInput(match[1]);
  if (NON_PREFIX_WORDS.has(candidate.toLowerCase())) {
    return null;
  }

  return candidate;
}

function isExplicitChapterLookupQuery(query: string, chapterReferences: string[]): boolean {
  if (chapterReferences.length === 0) {
    return false;
  }

  return /(exact|verbatim|full text|full chapter|entire chapter|complete chapter|show .*chapter|give me .*chapter|provide .*chapter)/i.test(query);
}

function isExactWordingQuery(query: string): boolean {
  return /(exact wording|exact text|verbatim|quote|show me the exact|show the exact|exact language)/i.test(query);
}

function shouldShortCircuitToExactChapter(query: string, chapterReferences: string[]): boolean {
  if (chapterReferences.length !== 1 || !isExplicitChapterLookupQuery(query, chapterReferences)) {
    return false;
  }

  const strippedQuery = query
    .replace(/\b[A-Z]{2,4}\.\d+(?:\.\d+)*\b/gi, ' ')
    .replace(/\b[A-Z]{2,4}-[A-Z]{1,3}\b/gi, ' ')
    .replace(/\b(show|give|provide|cite|chapter|exact|exactly|verbatim|full|text|entire|complete|me|the|please)\b/gi, ' ');

  const remainingTerms = extractQueryTerms(strippedQuery);
  return remainingTerms.length === 0;
}

function extractQueryTerms(query: string): string[] {
  const terms = query
    .toLowerCase()
    .match(/[a-z]{3,}/g) ?? [];

  return [...new Set(terms.filter((term) => !COMMON_QUERY_TERMS.has(term)))];
}

function extractDirectQuotes(results: StandardDocument[], query: string): Array<{ chapter: string; section: string; quote: string }> {
  const queryTerms = extractQueryTerms(query);
  if (queryTerms.length === 0) {
    return [];
  }

  const queryPatterns = queryTerms.map((term) => new RegExp(`\\b${escapeRegex(term)}\\b`, 'i'));

  const seenQuotes = new Set<string>();
  const quotes: Array<{ chapter: string; section: string; quote: string }> = [];

  for (const doc of results) {
    const lines = doc.text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => line !== doc.metadata?.heading);

    for (const line of lines) {
      if (!queryPatterns.some((pattern) => pattern.test(line))) {
        continue;
      }

      if (seenQuotes.has(line)) {
        continue;
      }

      seenQuotes.add(line);
      quotes.push({
        chapter: doc.metadata?.chapter ?? 'unknown',
        section: doc.metadata?.section ?? 'unknown',
        quote: line
      });

      if (quotes.length >= 6) {
        return quotes;
      }
    }
  }

  return quotes;
}

function looksLikeBoilerplate(doc: StandardDocument): boolean {
  const text = doc.text.trim();
  const tokenCount = doc.token_count ?? 0;

  if (!text) {
    return true;
  }

  if (tokenCount > 0 && tokenCount < 80 && /\.{5,}\s*\d+\s*$/.test(text)) {
    return true;
  }

  if (/^QM\.\d+\s+[A-Z][A-Z\s\-&,()\/]+\.{5,}\s*\d+$/m.test(text)) {
    return true;
  }

  if (/^Page\s+\d+\s+of\s+\d+$/mi.test(text)) {
    return true;
  }

  return false;
}

function rankDocuments(results: StandardDocument[]): StandardDocument[] {
  return [...results].sort((left, right) => {
    const rightScore = right.score ?? 0;
    const leftScore = left.score ?? 0;
    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }

    const rightTokens = right.token_count ?? 0;
    const leftTokens = left.token_count ?? 0;
    if (rightTokens !== leftTokens) {
      return rightTokens - leftTokens;
    }

    return (left.chunk_id || '').localeCompare(right.chunk_id || '');
  });
}

function compareAlphaNumericTokens(left: string, right: string): number {
  const leftMatch = left.match(/^(\d+)?([A-Z]*)$/);
  const rightMatch = right.match(/^(\d+)?([A-Z]*)$/);

  if (!leftMatch || !rightMatch) {
    return left.localeCompare(right);
  }

  const leftNumber = leftMatch[1] ? Number.parseInt(leftMatch[1], 10) : -1;
  const rightNumber = rightMatch[1] ? Number.parseInt(rightMatch[1], 10) : -1;

  if (leftNumber !== rightNumber) {
    return leftNumber - rightNumber;
  }

  return (leftMatch[2] || '').localeCompare(rightMatch[2] || '');
}

function chunkSortKey(doc: StandardDocument): string[] {
  const srId = doc.metadata?.sr_id?.toUpperCase();
  if (srId) {
    return srId.replace(/^SR\./, '').split(/[().-]/).filter(Boolean);
  }

  return doc.chunk_id.toUpperCase().split('_').filter(Boolean);
}

function compareChunkOrder(left: StandardDocument, right: StandardDocument): number {
  const leftBlockOrder = left.metadata?.block_order;
  const rightBlockOrder = right.metadata?.block_order;
  if (typeof leftBlockOrder === 'number' && typeof rightBlockOrder === 'number' && leftBlockOrder !== rightBlockOrder) {
    return leftBlockOrder - rightBlockOrder;
  }

  const leftSubchunkIndex = left.metadata?.subchunk_index;
  const rightSubchunkIndex = right.metadata?.subchunk_index;
  if (typeof leftSubchunkIndex === 'number' && typeof rightSubchunkIndex === 'number' && leftSubchunkIndex !== rightSubchunkIndex) {
    return leftSubchunkIndex - rightSubchunkIndex;
  }

  const leftKey = chunkSortKey(left);
  const rightKey = chunkSortKey(right);
  const maxLength = Math.max(leftKey.length, rightKey.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = leftKey[index];
    const rightPart = rightKey[index];

    if (leftPart === undefined) {
      return -1;
    }

    if (rightPart === undefined) {
      return 1;
    }

    const comparison = compareAlphaNumericTokens(leftPart, rightPart);
    if (comparison !== 0) {
      return comparison;
    }
  }

  return left.chunk_id.localeCompare(right.chunk_id);
}

function sortChapterResults(results: StandardDocument[]): StandardDocument[] {
  return [...results].sort(compareChunkOrder);
}

function filterRelevantResults(results: StandardDocument[]): StandardDocument[] {
  const filtered = results.filter((doc) => !looksLikeBoilerplate(doc));
  return filtered.length > 0 ? filtered : results;
}

function buildSearchableText(doc: StandardDocument): string {
  return [
    doc.metadata?.chapter,
    doc.metadata?.section,
    doc.metadata?.heading,
    doc.metadata?.sr_id,
    doc.text
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function isOutOfScopeQuery(query: string, results: StandardDocument[]): boolean {
  const normalized = query.toLowerCase();
  const topResults = filterRelevantResults(results);

  if (topResults.length === 0) {
    return true;
  }

  const scoreThresholdMiss = topResults.every((doc) => typeof doc.score === 'number' && doc.score < 0.15);
  const topScore = topResults[0]?.score ?? 0;
  const mentionsFire = /fire\s+safety|life\s+safety|nfpa|sprinkler|smoke compartment/i.test(normalized);
  const hasRelevantPe = topResults.some((doc) => doc.metadata?.chapter?.startsWith('PE.'));
  const queryTerms = extractQueryTerms(query).filter((term) => term.length >= 4);
  const topEvidenceText = topResults.slice(0, 3).map(buildSearchableText).join(' ');
  const matchedQueryTerms = queryTerms.filter((term) => topEvidenceText.includes(term));
  const queryCoverage = queryTerms.length === 0 ? 1 : matchedQueryTerms.length / queryTerms.length;
  const hasChapterSpecificIntent = extractChapterReferences(query).length > 0 || extractChapterPrefix(query) !== null;

  if (mentionsFire && !hasRelevantPe) {
    return true;
  }

  if (!hasChapterSpecificIntent && queryTerms.length >= 2 && queryCoverage < 0.5 && topScore < 0.8) {
    return true;
  }

  return scoreThresholdMiss;
}

async function listChaptersByPrefix(prefix: string): Promise<string[]> {
  const collection = await getStandardsCollection<StandardDocument>();
  const normalizedPrefix = normalizeChapterInput(prefix).replace(/\.$/, '');
  const chapters = (await collection.distinct('metadata.chapter', {
    'metadata.chapter': new RegExp(`^${escapeRegex(normalizedPrefix)}\\.`)
  })) as string[];
  return chapters.sort((left, right) => left.localeCompare(right));
}

async function suggestChapters(chapter: string): Promise<string[]> {
  const collection = await getStandardsCollection<StandardDocument>();
  const normalizedChapter = normalizeChapterInput(chapter);
  const prefix = normalizedChapter.split('.')[0];
  const chapters = (await collection.distinct('metadata.chapter')) as string[];

  return chapters
    .filter((item) => item.startsWith(`${prefix}.`) || item.includes(normalizedChapter))
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 8);
}

async function runSemanticSearch(query: string, limit: number): Promise<SearchResultPayload> {
  const collection = await getStandardsCollection<StandardDocument>();
  const queryEmbedding = await generateQueryEmbedding(query);

  if (!queryEmbedding) {
    const regex = new RegExp(query.split(/\s+/).filter(Boolean).map(escapeRegex).join('|'), 'i');
    const results = await collection
      .find({
        $or: [
          { text: regex },
          { 'metadata.chapter': regex },
          { 'metadata.section': regex },
          { 'metadata.heading': regex },
          { 'metadata.sr_id': regex }
        ]
      })
      .limit(limit)
      .toArray() as StandardDocument[];
    return { results, usedVectorSearch: false };
  }

  const pipeline = [
    {
      $vectorSearch: {
        index: SEARCH_INDEX_NAME,
        path: 'embedding',
        queryVector: queryEmbedding,
        numCandidates: Math.max(limit * 10, 20),
        limit
      }
    },
    {
      $project: {
        chunk_id: 1,
        text: 1,
        metadata: 1,
        token_count: 1,
        score: { $meta: 'vectorSearchScore' }
      }
    }
  ];

  try {
    const results = await collection.aggregate<StandardDocument>(pipeline).toArray();
    return { results, usedVectorSearch: true };
  } catch (error) {
    console.error('[MCP] Vector search failed, trying chapter/text fallback:', error);
    const regex = new RegExp(query.split(/\s+/).filter(Boolean).map(escapeRegex).join('|'), 'i');
    const results = await collection
      .find({
        $or: [
          { text: regex },
          { 'metadata.chapter': regex },
          { 'metadata.section': regex },
          { 'metadata.heading': regex },
          { 'metadata.sr_id': regex }
        ]
      })
      .limit(limit)
      .toArray() as StandardDocument[];
    return { results, usedVectorSearch: false };
  }
}

export async function searchStandards(query: string, limit: number = DEFAULT_SEARCH_LIMIT): Promise<string> {
  try {
    const chapterPrefix = extractChapterPrefix(query);
    if (chapterPrefix) {
      const chapters = await listChaptersByPrefix(chapterPrefix);
      if (chapters.length === 0) {
        return [
          connectorHeader('semantic-search'),
          `query: ${query}`,
          'note: No chapters found for that section prefix.',
          'suggestion: Try asking for an exact chapter like QM.1 or use a broader natural-language question.'
        ].join('\n');
      }

      return [
        connectorHeader('semantic-search'),
        `query: ${query}`,
        `section_prefix: ${chapterPrefix}`,
        '',
        ...chapters.map((chapter) => `- ${chapter}`)
      ].join('\n');
    }

    const chapterReferences = extractChapterReferences(query);
    if (shouldShortCircuitToExactChapter(query, chapterReferences)) {
      return getStandardsByChapter(chapterReferences[0]);
    }

    const effectiveLimit = Math.max(limit, DEFAULT_SEARCH_LIMIT);
    const { results, usedVectorSearch } = await runSemanticSearch(query, effectiveLimit);
    const relevantResults = rankDocuments(filterRelevantResults(results)).slice(0, effectiveLimit);

    if (relevantResults.length === 0) {
      return `${connectorHeader('semantic-search')}No standards found matching your query.`;
    }

    const exactChapterPayloads: string[] = [];
    for (const chapter of chapterReferences) {
      exactChapterPayloads.push(await getStandardsByChapter(chapter));
    }

    if (isOutOfScopeQuery(query, relevantResults)) {
      return [
        connectorHeader('semantic-search'),
        `query: ${query}`,
        'note: This question appears to be outside the currently indexed knowledge base or lacks strong support in the retrieved standards.',
        'suggestion: Ask about a known chapter or a topic covered by the indexed standards collection.',
        '',
        ...relevantResults.slice(0, 2).map((doc, index) => [`nearest evidence ${index + 1}`, formatEvidence(doc, true)].join('\n'))
      ].join('\n\n');
    }

    const exactQuotes = isExactWordingQuery(query)
      ? extractDirectQuotes(relevantResults, query)
      : [];

    return [
      connectorHeader('semantic-search'),
      `query: ${query}`,
      `matches: ${relevantResults.length}`,
      `retrieval_mode: ${usedVectorSearch ? 'vector-search' : 'text-fallback'}`,
      ...(exactQuotes.length > 0 ? [
        '',
        'direct_quotes:',
        ...exactQuotes.map((item, index) => [
          `quote ${index + 1}`,
          `chapter_id: ${item.chapter}`,
          `section_name: ${item.section}`,
          `text: ${item.quote}`
        ].join('\n'))
      ] : []),
      '',
      ...relevantResults.map((doc, index) => [`evidence ${index + 1}`, formatEvidence(doc, true)].join('\n')),
      ...(exactChapterPayloads.length > 0 ? [
        '',
        'explicit chapter requests:',
        ...exactChapterPayloads
      ] : [])
    ].join('\n\n');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return `Error searching standards: ${errorMsg}`;
  }
}

export async function getStandardsByChapter(chapter: string): Promise<string> {
  try {
    const collection = await getStandardsCollection<StandardDocument>();
    const normalizedChapter = chapter.trim().toUpperCase();
    const results = sortChapterResults(await collection
      .find({ 'metadata.chapter': normalizedChapter })
      .limit(MAX_CHAPTER_RESULTS)
      .toArray() as StandardDocument[]);

    if (results.length === 0) {
      const suggestions = await suggestChapters(normalizedChapter);
      const fallback = await searchStandards(normalizedChapter, 3);
      return [
        connectorHeader('chapter-lookup'),
        `chapter: ${normalizedChapter}`,
        'exact_match: false',
        'note: No exact chapter match was found. Falling back to semantic search results.',
        ...(suggestions.length > 0 ? [
          'suggestions:',
          ...suggestions.map((item) => `- ${item}`),
          ''
        ] : []),
        '',
        fallback
      ].join('\n');
    }

    return [
      connectorHeader('chapter-lookup'),
      `document: ${results[0]?.metadata?.document ?? 'NIAHO Standards'}`,
      `section: ${results[0]?.metadata?.section ?? 'unknown'}`,
      `chapter: ${normalizedChapter}`,
      'exact_match: true',
      '',
      renderVerbatimChapter(results)
    ].join('\n\n');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return `Error retrieving standards: ${errorMsg}`;
  }
}

export async function getStandardByChunkId(chunkId: string): Promise<string> {
  try {
    const collection = await getStandardsCollection<StandardDocument>();
    const normalizedChunkId = chunkId.trim().toUpperCase();
    const doc = await collection.findOne({ chunk_id: normalizedChunkId }) as StandardDocument | null;

    if (!doc) {
      return `${connectorHeader('chunk-id-lookup')}No standard found for chunk_id ${normalizedChunkId}.`;
    }

    return [
      connectorHeader('chunk-id-lookup'),
      `document: ${doc.metadata?.document ?? 'NIAHO Standards'}`,
      `section: ${doc.metadata?.section ?? 'unknown'}`,
      `chapter: ${doc.metadata?.chapter ?? 'unknown'}`,
      ...(doc.metadata?.heading ? [`heading: ${doc.metadata.heading}`] : []),
      ...(doc.metadata?.sr_id ? [`sr_id: ${doc.metadata.sr_id}`] : []),
      `chunk_id: ${doc.chunk_id}`,
      '',
      doc.text.trim()
    ].join('\n\n');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return `Error retrieving standard by chunk_id: ${errorMsg}`;
  }
}

export async function listSections(sectionFilter?: string): Promise<string> {
  try {
    const collection = await getStandardsCollection<StandardDocument>();
    const chapters = (await collection.distinct('metadata.chapter')) as string[];

    if (chapters.length === 0) {
      return `${connectorHeader('section-list')}No chapters found in the database.`;
    }

    const normalizedFilter = sectionFilter?.trim().toLowerCase();
    let filteredChapters = chapters.sort();

    if (normalizedFilter) {
      const chapterDocs = await collection
        .find({}, { projection: { 'metadata.chapter': 1, 'metadata.section': 1, 'metadata.heading': 1 } })
        .toArray() as StandardDocument[];

      const chapterMetadata = new Map<string, { section?: string; heading?: string }>();
      for (const doc of chapterDocs) {
        const chapter = doc.metadata?.chapter;
        if (!chapter || chapterMetadata.has(chapter)) {
          continue;
        }

        chapterMetadata.set(chapter, {
          section: doc.metadata?.section,
          heading: doc.metadata?.heading
        });
      }

      filteredChapters = filteredChapters.filter((chapter) => {
        const metadata = chapterMetadata.get(chapter);
        return chapter.toLowerCase().includes(normalizedFilter)
          || metadata?.section?.toLowerCase().includes(normalizedFilter)
          || metadata?.heading?.toLowerCase().includes(normalizedFilter);
      });
    }

    if (filteredChapters.length === 0) {
      return [
        connectorHeader('section-list'),
        `section_filter: ${sectionFilter}`,
        'No matching sections or chapters found.'
      ].join('\n');
    }

    return [
      connectorHeader('section-list'),
      ...(sectionFilter ? [`section_filter: ${sectionFilter}`] : []),
      'chapters:',
      ...filteredChapters.map((chapter) => `- ${chapter}`)
    ].join('\n');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return `Error listing sections: ${errorMsg}`;
  }
}
