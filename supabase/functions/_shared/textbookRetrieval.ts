// Page-level textbook retrieval shared by companion_llm_proxy and miga_stream.
// Embeds with the Edge runtime's built-in gte-small model (no API key, no cost)
// and queries public.match_textbook_pages.

export type TextbookScope = {
  board?: string | null;
  classLevel?: number | null;
  subject?: string | null;
  language?: string | null;
};

export type TextbookCitation = {
  ref: number;            // [n] marker the model uses inline
  chunkId: string;
  bookTitle: string;
  board: string;
  classLevel: number;
  subject: string;
  chapterNumber: number | null;
  chapterTitle: string | null;
  page: number;
  similarity: number;
  excerpt: string;
};

let session: any = null;
const getSession = () => (session ??= new (globalThis as any).Supabase.ai.Session('gte-small'));

export async function embedText(text: string): Promise<number[]> {
  const input = String(text || '').slice(0, 2000);
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const out = await getSession().run(input, { mean_pool: true, normalize: true });
      return Array.from(out as ArrayLike<number>);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('embedding failed');
}

export function normaliseScope(raw: any): TextbookScope {
  if (!raw || typeof raw !== 'object') return {};
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().toLowerCase() : null);
  const cls = Number(raw.classLevel ?? raw.class_level ?? raw.class);
  return {
    board: str(raw.board),
    classLevel: Number.isInteger(cls) && cls >= 1 && cls <= 12 ? cls : null,
    subject: str(raw.subject),
    language: str(raw.language),
  };
}

export async function retrieveTextbookPages(
  client: any,
  query: string,
  scope: TextbookScope,
  opts: { count?: number; minSimilarity?: number } = {},
): Promise<TextbookCitation[]> {
  if (!query || query.trim().length < 3) return [];
  const embedding = await embedText(query);
  const args = {
    query_embedding: embedding,
    match_count: opts.count ?? 6,
    filter_board: scope.board ?? null,
    filter_class: scope.classLevel ?? null,
    filter_subject: scope.subject ?? null,
    filter_language: scope.language ?? null,
    min_similarity: opts.minSimilarity ?? 0.75,
  };
  let { data, error } = await client.rpc('match_textbook_pages', args);
  // A subject guessed from the profile can be wrong; widen once before giving up.
  if (!error && Array.isArray(data) && data.length === 0 && args.filter_subject) {
    ({ data, error } = await client.rpc('match_textbook_pages', { ...args, filter_subject: null }));
  }
  if (error || !Array.isArray(data)) {
    console.error('[textbook-pages] rpc failed', error?.message || error);
    return [];
  }
  return data.map((row: any, i: number) => ({
    ref: i + 1,
    chunkId: row.chunk_id,
    bookTitle: row.book_title,
    board: row.board,
    classLevel: row.class_level,
    subject: row.subject,
    chapterNumber: row.chapter_number ?? null,
    chapterTitle: row.chapter_title ?? null,
    page: row.page_number,
    similarity: Number(row.similarity) || 0,
    excerpt: String(row.content || '').slice(0, 1200),
  }));
}

export function formatBoard(board: string): string {
  const b = String(board || '').toLowerCase();
  if (b === 'ncert' || b === 'cbse') return 'NCERT';
  if (b === 'samacheer') return 'Samacheer Kalvi (TN)';
  return board ? board.charAt(0).toUpperCase() + board.slice(1) : 'Textbook';
}

export function citationLabel(c: TextbookCitation): string {
  const ch = c.chapterNumber != null ? `Ch ${c.chapterNumber}${c.chapterTitle ? ` (${c.chapterTitle})` : ''}` : 'Chapter n/a';
  return `${formatBoard(c.board)} Class ${c.classLevel} ${c.bookTitle}, ${ch}, p. ${c.page}`;
}

/** System prompt that forces every claim to carry a [n] book/chapter/page citation. */
export function buildTextbookSystemPrompt(citations: TextbookCitation[]): string {
  if (!citations.length) {
    return [
      'TEXTBOOK MODE is ON but no passage from the student\'s textbooks matched this question.',
      'Start your reply with exactly: "I could not find this in your textbook." Then give a short, clearly labelled general explanation ("General explanation, not from your textbook:").',
      'Never invent a book, chapter, or page number.',
    ].join('\n');
  }
  const sources = citations
    .map((c) => `[${c.ref}] ${citationLabel(c)}\n${c.excerpt}`)
    .join('\n\n');
  return [
    'TEXTBOOK MODE is ON. Answer ONLY from the textbook passages below.',
    'Every factual sentence must end with a citation marker like [1] or [2][3] that points to the passage it came from.',
    'Do not cite a passage that does not support the sentence. Do not invent books, chapters, or pages.',
    'If the passages do not answer the question, say "Your textbook does not cover this directly." and stop, or give a clearly labelled general note without citations.',
    'End with one line: "Sources:" followed by the markers you used.',
    '',
    'PASSAGES:',
    sources,
  ].join('\n');
}

/** Keep only citations the model actually referenced (fall back to all if it used none). */
export function citationsUsed(answer: string, citations: TextbookCitation[]): TextbookCitation[] {
  const used = new Set<number>();
  for (const m of String(answer || '').matchAll(/\[(\d{1,2})\]/g)) used.add(Number(m[1]));
  const filtered = citations.filter((c) => used.has(c.ref));
  return filtered.length ? filtered : citations;
}

export function lastUserText(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === 'user') {
      if (typeof m.content === 'string') return m.content;
      if (Array.isArray(m.content)) return m.content.map((p: any) => p?.text || '').join(' ');
    }
  }
  return '';
}
