// READ-ONLY DIAGNOSTIC FUNCTION. Not part of the production MIGA chat path.
// It exists solely to trace the scoped Samacheer retrieval/ranking pipeline for
// investigation, using the EXACT retrieval/scoring code currently live in
// supabase/functions/miga_stream/index.ts (copied verbatim, unmodified weights,
// unmodified thresholds, unmodified window size). It never calls the LLM and
// never generates an answer. Safe to delete after the investigation.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ---- verbatim copy from miga_stream/index.ts -------------------------------

const TEXTBOOK_TEXT_SIM_THRESHOLD = 0.60;

let _tbEmbedSession: any = null;
const getTbEmbedSession = () => (_tbEmbedSession ??= new (globalThis as any).Supabase.ai.Session('gte-small'));
async function embedQueryForTextbook(text: string): Promise<number[] | null> {
  const input = String(text || "").trim().slice(0, 2000);
  if (!input) return null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const emb = await getTbEmbedSession().run(input, { mean_pool: true, normalize: true });
      const arr = Array.isArray(emb) ? emb : Array.from(emb ?? []);
      if (arr.length) return arr as number[];
    } catch (_e) {
      _tbEmbedSession = null;
    }
  }
  return null;
}

const TEXTBOOK_RANK_STOP = new Set(["about","above","after","again","against","along","among","around","because","been","before","being","below","between","both","could","describe","during","explain","following","from","further","have","having","highlight","into","its","itself","mentioned","more","most","only","other","over","provide","reference","same","section","should","some","specific","such","than","that","their","them","then","there","these","they","this","those","through","under","until","using","what","when","where","which","while","with","within","would","your","structure","current","primary","argument","compare","setup","exact","page","are","you","and","the","for","can","will","does","did","was","were","has","had","who","whom","whose","here","also","them","just","give","get","tell","show","need","want",
  "study","studying","studies","tips","tip","help","please","motivate","motivated","motivation","make","made","best","good","great","today","tomorrow","yesterday","plan","planning","time","feel","feeling","eat","food","meal","breakfast","lunch","dinner","sleep","stay","keep","start","begin","hello","thanks","thank","doing","like","really","very","much","many","know","think","things","stuff","idea","ideas","ready","focus","hard","easy","fast","quick","learn","learning","understand","remember",
  "lag","lagg","lagging","laggy","glitch","glitchy","glitches","bug","bugs","buggy","crash","crashing","crashed","expo","app","apps","application","freeze","freezing","frozen","stuck","hang","hanging","dots","emoji","wifi","keyboard","scroll","scrolling","tap","click","button","animation","laggs","lags","reply","replies","reload","loading","slow","slower","slowly","laggier","choppy","jerky","smooth","phone","mobile","internet","internets","testing","lmao","lol","haha","wtf","bro",
  "take","takes","taken","took","taking","long","longer","longest","reason","reasons","here","does","maybe","perhaps","kinda","gonna","wanna","actually","seem","seems","seemed","look","looks","looking","come","comes","came","coming","want","wants","wanted","way","ways","back","again","still","pretty","kind","sort","thing","things","lot","lots","bit","stuff","gotta","cant","cannot","wont","dont","doesnt","isnt","arent"]);
const TEXTBOOK_SHORT_QUERY_ALLOW = new Set(["dpsp", "fr", "dna", "gdp"]);
const TEXTBOOK_QUERY_LEADIN_RE = /^(?:please\s+|kindly\s+)?(?:explain|describe|discuss|define|state|tell me about|tell me|write about|give me|what is|what are|how to|why is|why are|short note on|brief note on|notes on|note on|according to|from)\b[\s:,-]*/i;
const TEXTBOOK_QUERY_ARTICLE_RE = /\b(?:article|art\.?)\s*(\d{1,3})\b/i;
const TEXTBOOK_QUERY_YEAR_RE = /\b(1[5-9]\d{2}|20\d{2})\b/g;
const TEXTBOOK_QUERY_NUMBERED_RE = /\b(?:chapter|unit|lesson|theme|part|book|class|standard|section|article|amendment|act|rule)\s*(\d{1,3}|[ivxlcdm]{1,6})\b/ig;

type RetrievalQueryBundle = {
  retrievalQuery: string;
  exactPhrase: string;
  terms: string[];
  aliasTokens: string[];
  numericTokens: string[];
  eligible: boolean;
};

const normalizeTextbookQuery = (prompt: string) => String(prompt || "")
  .normalize("NFKC")
  .replace(/[“”‘’]/g, '"')
  .replace(/[_•·]/g, " ")
  .replace(/[^\p{L}\p{N}\s-]/gu, " ")
  .replace(/\s+/g, " ")
  .trim();

const stripTextbookLeadins = (value: string) => {
  let out = normalizeTextbookQuery(value);
  for (let i = 0; i < 3; i++) {
    const next = out.replace(TEXTBOOK_QUERY_LEADIN_RE, "").replace(/^(?:the|a|an)\s+/i, "").trim();
    if (next === out) break;
    out = next;
  }
  return out;
};

const expandTextbookAlias = (token: string) => {
  const key = String(token || "").toLowerCase();
  if (key === "dpsp") return ["directive principles of state policy"];
  if (key === "fr") return ["fundamental rights"];
  if (key === "dna") return ["dna", "deoxyribonucleic acid"];
  if (key === "gdp") return ["gdp", "gross domestic product"];
  return [];
};

function normalizeEvidenceText(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function classifyEvidenceAspect(prompt: string) {
  const text = normalizeEvidenceText(prompt);
  if (/\b(compare|comparison|difference|distinguish|versus|vs\.?|differentiate|contrast)\b/i.test(text)) return 'comparison';
  if (/\b(why|cause|causes|because|reason|reasons|lead to|led to)\b/i.test(text)) return 'causal';
  if (/\b(how|mechanism|process|work|occurs|occur)\b/i.test(text)) return 'mechanism';
  if (/\b(type|types|classification|kinds?|categories?)\b/i.test(text)) return 'classification';
  if (/\b(define|definition|what is|what are|meaning of)\b/i.test(text)) return 'definition';
  return 'explanation';
}

const CAUSAL_QUERY_GLUE_WORDS = new Set([
  "why","does","do","did","occur","occurs","occurred","happen","happens","happened","happening",
  "cause","causes","caused","reason","reasons",
]);

function groundingTermsForPrompt(prompt: string, bundle: RetrievalQueryBundle) {
  const aspect = classifyEvidenceAspect(prompt);
  const terms = aspect === "causal"
    ? bundle.terms.filter((term) => !CAUSAL_QUERY_GLUE_WORDS.has(normalizeEvidenceText(term)))
    : bundle.terms;
  return { aspect, terms };
}

const buildTextbookRetrievalBundle = (prompt: string): RetrievalQueryBundle => {
  const raw = normalizeTextbookQuery(prompt);
  const stripped = stripTextbookLeadins(raw);
  const lower = stripped.toLowerCase();
  const aspect = classifyEvidenceAspect(prompt);
  const words = lower.match(/[a-z][a-z-]{1,}|[a-z]{2,}\d{1,3}|\d{2,}|[a-z]{2,}/g) || [];
  const numeric = Array.from(new Set([
    ...(lower.match(TEXTBOOK_QUERY_YEAR_RE) || []),
    ...((lower.match(TEXTBOOK_QUERY_ARTICLE_RE)?.[1] ? [lower.match(TEXTBOOK_QUERY_ARTICLE_RE)![1]] : [])),
    ...(Array.from(lower.matchAll(TEXTBOOK_QUERY_NUMBERED_RE)).map((m) => m[1].toLowerCase()).filter(Boolean)),
  ]));
  const aliasTokens = Array.from(new Set(words.flatMap((w) => expandTextbookAlias(w))));
  const baseTokens = words.filter((w) => !TEXTBOOK_RANK_STOP.has(w));
  const substantiveBaseTokens = aspect === "causal"
    ? baseTokens.filter((w) => !CAUSAL_QUERY_GLUE_WORDS.has(w))
    : baseTokens;
  const combined = Array.from(new Set([...substantiveBaseTokens, ...numeric, ...aliasTokens.flatMap((x) => x.split(/\s+/g))].filter(Boolean)));
  const retrievalCore = aliasTokens[0] || (aspect === "causal" && substantiveBaseTokens.length ? substantiveBaseTokens.join(" ") : stripped);
  const retrievalQuery = aliasTokens.length ? `${retrievalCore}\n${aliasTokens.join("\n")}\n${stripped}` : retrievalCore;
  const eligible = combined.length > 0 || TEXTBOOK_SHORT_QUERY_ALLOW.has(lower) || /\d{2,}/.test(stripped);
  return {
    retrievalQuery,
    exactPhrase: retrievalCore.toLowerCase(),
    terms: combined,
    aliasTokens,
    numericTokens: numeric,
    eligible,
  };
};

const escapeIlike = (value: string) => String(value || "").replace(/[\\%_]/g, "\\$&");

async function fetchLexicalTextbookCandidates(
  supabaseClient: any,
  board: string,
  language: string,
  needles: string[],
  limitPerNeedle = 200,
) {
  const cleanNeedles = Array.from(new Set((needles || []).map((n) => String(n || "").trim().toLowerCase()).filter((n) => n.length >= 3)));
  if (!board || !cleanNeedles.length) return { rows: [], needlesUsed: cleanNeedles, perNeedleCounts: {} as Record<string, number> };
  const seen = new Map<string, any>();
  const perNeedleCounts: Record<string, number> = {};
  const queries = cleanNeedles.slice(0, 8).map(async (needle) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const { data, error } = await supabaseClient
        .from('textbook_chunks')
        .select('id,source_id,board,class_level,subject,chapter,language,chunk_type,content')
        .eq('board', board)
        .eq('language', language)
        .ilike('content', `%${escapeIlike(needle)}%`)
        .order('id', { ascending: true })
        .limit(limitPerNeedle);
      if (!error) {
        perNeedleCounts[needle] = Array.isArray(data) ? data.length : 0;
        return Array.isArray(data) ? data : [];
      }
      console.error(`[diag] needle "${needle}" failed (attempt ${attempt + 1}/2): ${error.message || error}`);
    }
    perNeedleCounts[needle] = 0;
    return [];
  });
  for (const rows of await Promise.all(queries)) {
    for (const row of rows || []) {
      if (row?.id && !seen.has(row.id)) seen.set(row.id, row);
    }
  }
  return { rows: [...seen.values()], needlesUsed: cleanNeedles.slice(0, 8), perNeedleCounts };
}

function canonicalPhraseText(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[’‘']/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findWordBoundaryPhrase(canonicalText: string, canonicalPhrase: string): number {
  if (!canonicalPhrase) return -1;
  const escaped = canonicalPhrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|[^a-z0-9])(${escaped})(?:[^a-z0-9]|$)`, "i").exec(canonicalText);
  return match ? match.index + match[0].indexOf(match[1]) : -1;
}

function scoreTextbookCandidate(
  prompt: string,
  row: any,
  bundle: RetrievalQueryBundle,
  reqClass: number | null,
  reqBoard: string,
  reqSubject: string,
  isSamacheerPrimary: boolean,
  legacyPhraseMatch = false,
  legacySemanticWeight = false,
) {
  const text = String(row?.content || "").toLowerCase();
  const leadWindow = text.slice(0, 360);
  const { terms } = groundingTermsForPrompt(prompt, bundle);
  const exactPhrase = bundle.exactPhrase;
  const numericTokens = bundle.numericTokens;
  let termHits = 0;
  for (const t of terms) if (t && text.includes(t)) termHits++;
  const coverage = terms.length ? termHits / terms.length : 0;
  let phraseHit: number, phraseIndex: number;
  if (legacyPhraseMatch) {
    phraseHit = exactPhrase && exactPhrase.length >= 4 && text.includes(exactPhrase) ? 1 : 0;
    phraseIndex = phraseHit ? text.indexOf(exactPhrase) : -1;
  } else {
    const canonicalExactPhrase = canonicalPhraseText(exactPhrase);
    const canonicalContent = canonicalPhraseText(row?.content);
    phraseIndex = canonicalExactPhrase.length >= 2 ? findWordBoundaryPhrase(canonicalContent, canonicalExactPhrase) : -1;
    phraseHit = phraseIndex >= 0 ? 1 : 0;
  }
  const phraseBonusQualified = legacyPhraseMatch ? true : coverage >= 0.30;
  const phraseLeadHit = phraseHit && phraseIndex >= 0 && phraseIndex <= 220 ? 1 : 0;
  let leadTermHits = 0;
  for (const t of terms) if (t && leadWindow.includes(t)) leadTermHits++;
  const leadCoverage = terms.length ? leadTermHits / terms.length : 0;
  const numericHit = numericTokens.some((n) => n && text.includes(String(n).toLowerCase())) ? 1 : 0;
  const semantic = Number(row?.similarity ?? 0);
  const classBoost = reqClass && Number(row.class_level) === reqClass ? 0.18 : 0;
  const boardBoost = reqBoard && String(row.board || "").toLowerCase() === reqBoard ? 0.12 : 0;
  const subjectBoost = reqSubject && String(row.subject || "").toLowerCase().includes(reqSubject) ? 0.10 : 0;
  const chunkType = String(row?.chunk_type || "").toLowerCase();
  const subjectKey = String(row.subject || "").toLowerCase();
  const normalizedLead = leadWindow.replace(/\s+/g, " ").trim();
  const structureSignals = {
    toc: /\bcontents\b|\btable of contents\b|\bchapter outline\b/.test(normalizedLead),
    exercise: /\banswer the following\b|\bchoose the correct answer\b|\bevaluate yourself\b|\bfill in the blanks\b|\bmatch the following\b|\bexercise\b|\bmcq\b/.test(normalizedLead),
    objectives: /\blearning objectives?\b|\bthe learner will be able to\b/.test(normalizedLead),
    conceptMap: /\bconcept map\b/.test(normalizedLead),
    glossaryIndex: /\bglossary\b|\bindex\b/.test(normalizedLead),
    summary: /^\s*summary\b|\bsummary\b/.test(normalizedLead),
    lessonBody: /\b(explain|describes?|states?|means|refers to|results in|causes|produces|shows|occurs|relates to)\b/.test(normalizedLead),
  };
  const hasProposition =
    /\b(is|are|was|were|means|refers to|defined as|denotes|consists of|comprises|includes|forms|occurs|happens|results in|leads to|causes|explains|shows|describes|relates to|is called|implies)\b/.test(normalizedLead) &&
    /[.!?]/.test(normalizedLead) &&
    normalizedLead.split(" ").length >= 10;
  const chunkTypeBias = ({
    lesson_content: 0.14,
    chapter_content: 0.12,
    text: 0.10,
    summary: -0.03,
    activity: -0.04,
    bookback_exercise: -0.14,
    exercise: -0.12,
  } as Record<string, number>)[chunkType] || 0;
  const structureBias =
    (structureSignals.toc ? -0.22 : 0) +
    (structureSignals.exercise ? -0.18 : 0) +
    (structureSignals.objectives ? -0.16 : 0) +
    (structureSignals.conceptMap ? -0.14 : 0) +
    (structureSignals.glossaryIndex ? -0.14 : 0) +
    (structureSignals.summary ? -0.06 : 0) +
    (structureSignals.lessonBody ? 0.05 : 0);
  const historyLessonProseBoost =
    /(history|social[- ]science|political[- ]science)/.test(subjectKey) &&
    (chunkType === "lesson_content" || chunkType === "chapter_content" || chunkType === "text") &&
    hasProposition &&
    (phraseHit || coverage >= 0.34 || leadCoverage >= 0.28)
      ? 0.08
      : 0;
  const chunkTypeBoost = chunkTypeBias + structureBias;
  const lexicalScore = Math.min(0.60, (coverage * 0.20) + (leadCoverage * 0.14) + ((phraseBonusQualified ? phraseHit : 0) * 0.12) + ((phraseBonusQualified ? phraseLeadHit : 0) * 0.12) + (numericHit * 0.08) + (Math.min(termHits, 4) * 0.02));
  const dampedSemanticWeight = semantic * ((phraseBonusQualified && phraseHit) ? (0.22 + (coverage * 0.18) + (leadCoverage * 0.12) + (phraseLeadHit * 0.08) + (numericHit * 0.05)) : (0.05 + (coverage * 0.08) + (leadCoverage * 0.05)));
  const semanticWeight = legacySemanticWeight
    ? (isSamacheerPrimary ? dampedSemanticWeight : semantic)
    : dampedSemanticWeight;
  return {
    r: row,
    sourcePath: String(row?.sourcePath || ""),
    score: semanticWeight + lexicalScore + classBoost + boardBoost + subjectBoost + chunkTypeBoost + historyLessonProseBoost,
    termHits, coverage, phraseHit, phraseLeadHit, phraseBonusQualified, leadCoverage, numericHit, semantic,
    lexicalScore, semanticWeight, chunkTypeBoost, historyLessonProseBoost, hasProposition,
    structureSignals,
  };
}

// ---- diagnostic-only wiring -------------------------------------------------

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { prompt, board = "samacheer", knownChunkIds = [], legacyPhraseMatch = false, lexicalAugmentAllBoards = true, legacySemanticWeight = false } = await req.json();
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const bundle = buildTextbookRetrievalBundle(prompt);
    const isTamilQuery = /[஀-௿]/.test(prompt);

    if (!bundle.eligible && !isTamilQuery) {
      return new Response(JSON.stringify({ prompt, bundle, stoppedAt: "eligibility_precheck" }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const embedding = await embedQueryForTextbook(bundle.retrievalQuery);
    if (!embedding) {
      return new Response(JSON.stringify({ prompt, bundle, stoppedAt: "embedding_failed" }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const reqClass: number | null = (() => {
      const m = String(prompt).match(/\bclass\s*(\d{1,2})\b/i) || String(prompt).match(/\b(\d{1,2})\s*th\b/i);
      if (m) return Number(m[1]);
      return null;
    })();
    const reqBoard = /\bsamacheer\b/i.test(prompt) ? "samacheer" : /\bncert\b/i.test(prompt) ? "ncert" : "";
    const reqSubject = (() => {
      const t = String(prompt).toLowerCase();
      for (const s of ["physics", "chemistry", "biology", "mathematics", "history", "geography", "economics", "science", "tamil", "english"]) {
        if (new RegExp(`\\b${s}\\b`).test(t)) return s;
      }
      return "";
    })();

    const { data, error } = await supabaseClient.rpc('match_textbook_chunks_gte', {
      query_embedding: embedding,
      match_count: 24,
      filter_language: isTamilQuery ? 'tamil' : 'english',
      filter_board: board || null,
    });
    if (error || !Array.isArray(data)) {
      return new Response(JSON.stringify({ prompt, bundle, stoppedAt: "rpc_error", error }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const semanticRaw = data.map((r: any) => ({ id: r.id, source_id: r.source_id, chunk_type: r.chunk_type, similarity: r.similarity, passesThreshold: (r?.similarity ?? 0) >= TEXTBOOK_TEXT_SIM_THRESHOLD }));
    const semanticCandidates = data.filter((r: any) => (r?.similarity ?? 0) >= TEXTBOOK_TEXT_SIM_THRESHOLD);

    const boardHint = String(board || '').toLowerCase();
    const lexicalGateOpen = lexicalAugmentAllBoards ? Boolean(boardHint) : boardHint === 'samacheer';
    const lexicalResult = lexicalGateOpen
      ? await fetchLexicalTextbookCandidates(
          supabaseClient, boardHint, isTamilQuery ? 'tamil' : 'english',
          [bundle.exactPhrase, ...bundle.aliasTokens, ...bundle.numericTokens, ...bundle.terms],
          200,
        )
      : { rows: [], needlesUsed: [], perNeedleCounts: {} };
    const lexicalCandidates = lexicalResult.rows;

    const mergedById = new Map<string, any>();
    for (const row of semanticCandidates) if (row?.id) mergedById.set(String(row.id), { ...row, sourcePath: 'semantic' });
    for (const row of lexicalCandidates) {
      if (!row?.id) continue;
      const id = String(row.id);
      const existing = mergedById.get(id);
      mergedById.set(id, existing ? { ...existing, ...row, sourcePath: 'semantic+lexical' } : { ...row, sourcePath: 'lexical' });
    }
    const candidates = [...mergedById.values()];

    const isSamacheerPrimary = boardHint === 'samacheer';
    const groundingTerms = groundingTermsForPrompt(prompt, bundle).terms;
    const scored = candidates
      .map((r: any) => ({ ...scoreTextbookCandidate(prompt, r, bundle, reqClass, reqBoard, reqSubject, isSamacheerPrimary, legacyPhraseMatch, legacySemanticWeight) }))
      .sort((a: any, b: any) => b.score - a.score);

    const strongSamacheerMatch = (s: any) => {
      if (s.phraseHit) return s.semantic >= 0.10 || s.coverage >= 0.45 || s.leadCoverage >= 0.35 || s.numericHit;
      if (groundingTerms.length <= 2 && s.leadCoverage >= 0.5 && (s.semantic >= 0.10 || s.coverage >= 0.5 || s.chunkTypeBoost > 0)) return true;
      if (s.numericHit && s.coverage >= 0.35 && s.semantic >= 0.14) return true;
      if (s.termHits >= 3 && s.coverage >= 0.55 && s.semantic >= 0.18) return true;
      return false;
    };
    const lexicalMatched = scored.filter((s: any) => strongSamacheerMatch(s));

    let maxTermsInOnePassage = 0, hitPassageCount = 0;
    for (const s of scored.slice(0, 6)) {
      const text = String(s.r.content || '').toLowerCase();
      let inThis = 0;
      for (const t of groundingTerms) if (text.includes(t)) inThis++;
      if (inThis > 0) hitPassageCount++;
      if (inThis > maxTermsInOnePassage) maxTermsInOnePassage = inThis;
    }
    const oldGroundOk = isSamacheerPrimary ? lexicalMatched.length > 0 : (groundingTerms.length >= 2 ? maxTermsInOnePassage >= 2 : (groundingTerms.length === 1 && hitPassageCount >= 2));
    const genericGroundOk = groundingTerms.length >= 2 ? maxTermsInOnePassage >= 2 : (groundingTerms.length === 1 && hitPassageCount >= 2);

    const knownIdSet = new Set((knownChunkIds || []).map(String));
    const rankOf = (id: string) => {
      const idx = scored.findIndex((s: any) => String(s.r.id) === id);
      return idx === -1 ? null : idx + 1;
    };

    const summarize = (s: any, rank: number) => ({
      rank,
      id: s.r.id,
      source_id: s.r.source_id,
      chunk_type: s.r.chunk_type,
      class_level: s.r.class_level,
      subject: s.r.subject,
      sourcePath: s.r.sourcePath,
      score: Number(s.score.toFixed(4)),
      semantic: Number(s.semantic.toFixed(4)),
      semanticWeight: Number(s.semanticWeight.toFixed(4)),
      lexicalScore: Number(s.lexicalScore.toFixed(4)),
      termHits: s.termHits,
      coverage: Number(s.coverage.toFixed(3)),
      leadCoverage: Number(s.leadCoverage.toFixed(3)),
      phraseHit: s.phraseHit,
      phraseLeadHit: s.phraseLeadHit,
      phraseBonusQualified: s.phraseBonusQualified,
      numericHit: s.numericHit,
      chunkTypeBoost: Number(s.chunkTypeBoost.toFixed(3)),
      hasProposition: s.hasProposition,
      structureSignals: s.structureSignals,
      strongSamacheerMatch: strongSamacheerMatch(s),
      excerpt: String(s.r.content || '').replace(/\s+/g, ' ').trim().slice(0, 220),
    });

    return new Response(JSON.stringify({
      prompt,
      board,
      legacyPhraseMatch,
      lexicalAugmentAllBoards,
      legacySemanticWeight,
      bundle,
      groundingTerms,
      semantic: {
        rpcCandidateCount: data.length,
        passingThresholdCount: semanticCandidates.length,
        threshold: TEXTBOOK_TEXT_SIM_THRESHOLD,
        top10ByRawSimilarity: semanticRaw.sort((a: any, b: any) => (b.similarity ?? 0) - (a.similarity ?? 0)).slice(0, 10),
      },
      lexical: {
        needlesUsed: lexicalResult.needlesUsed,
        perNeedleCounts: lexicalResult.perNeedleCounts,
        candidateCount: lexicalCandidates.length,
      },
      merged: {
        totalCandidateCount: candidates.length,
        semanticOnlyCount: candidates.filter((c: any) => c.sourcePath === 'semantic').length,
        lexicalOnlyCount: candidates.filter((c: any) => c.sourcePath === 'lexical').length,
        bothCount: candidates.filter((c: any) => c.sourcePath === 'semantic+lexical').length,
      },
      ranked: {
        top15: scored.slice(0, 15).map((s: any, i: number) => summarize(s, i + 1)),
      },
      grounding: {
        candidateWindow: 6,
        strongMatchCount: lexicalMatched.length,
        oldSamacheerSpecificGroundOk: oldGroundOk,
        genericGroundOk,
        maxTermsInOnePassage,
        hitPassageCount,
      },
      knownChunkLookup: [...knownIdSet].map((id) => {
        const rank = rankOf(id);
        const inCandidates = candidates.some((c: any) => String(c.id) === id);
        const inSemantic = semanticCandidates.some((c: any) => String(c.id) === id);
        const inLexical = lexicalCandidates.some((c: any) => String(c.id) === id);
        const rawSemantic = semanticRaw.find((s: any) => String(s.id) === id) || null;
        const scoredIdx = scored.findIndex((s: any) => String(s.r.id) === id);
        const fullBreakdown = scoredIdx >= 0 ? summarize(scored[scoredIdx], scoredIdx + 1) : null;
        return { id, rank, inMergedCandidates: inCandidates, inSemanticCandidates: inSemantic, inLexicalCandidates: inLexical, rawSemanticSimilarity: rawSemantic?.similarity ?? null, passedThreshold: rawSemantic?.passesThreshold ?? null, fullBreakdown };
      }),
    }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }, null, 2), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
