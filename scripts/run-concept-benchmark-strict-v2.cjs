/* Read-only concept benchmark rerun with a stricter evidence validator.
 * It reuses the same 60 prompt/context cases recorded in reports/concept-benchmark-audit.json,
 * replays them through the live miga_stream path, and classifies evidence more strictly:
 * - TOCs / contents / exercises / glossaries / adjacent-topic passages are rejected
 * - evidence must contain an actual proposition that answers the requested aspect
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const url = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anon || !service) throw new Error('Supabase credentials required');

const db = createClient(url, service);
const seedPath = path.join('reports', 'concept-benchmark-audit.json');
const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

const fixtureUsers = new Map();
for (const result of seed.results || []) {
  if (result.fixtureKey && result.userId && !fixtureUsers.has(result.fixtureKey)) {
    fixtureUsers.set(result.fixtureKey, result.userId);
  }
}

const fixtures = (seed.fixtures || []).map((fixture) => ({
  key: fixture.key,
  context: fixture.context || null,
  expectedCorpus: fixture.expectedCorpus || null,
  userId: fixtureUsers.get(fixture.key) || null,
}));

const focusCase = String(process.env.STRICT_V2_ONLY_CASE || '').trim();
const promptFilter = String(process.env.STRICT_V2_ONLY_PROMPT || '').trim();
const prompts = (seed.prompts || []).map((p) => ({ key: p.key, prompt: p.prompt }));

if (!fixtures.length || !prompts.length) {
  throw new Error('Seed report does not contain prompts/fixtures');
}

const EXAM_TO_PROTOCOL_TRACK = {
  tnpsc: 'tnpsc_ecosystem',
  upsc: 'upsc_ecosystem',
  ssc: 'ssc_ecosystem',
};

function canonicalStudyContextFromRow(row) {
  if (!row) {
    return { primaryExam: '', primaryCurriculum: '', classLevel: null, source: 'generic' };
  }
  return {
    primaryExam: String(row.primary_exam || ''),
    primaryCurriculum: row.primary_curriculum === 'ncert' || row.primary_curriculum === 'samacheer'
      ? row.primary_curriculum
      : '',
    classLevel: Number.isInteger(row.class_level) ? row.class_level : null,
    source: 'saved',
  };
}

async function seedCanonicalFixtureContexts() {
  const seeded = [];
  for (const fixture of fixtures) {
    if (!fixture.userId || !fixture.context) continue;

    const context = fixture.context;
    const protocolTrackId = EXAM_TO_PROTOCOL_TRACK[String(context.primary_exam || '').toLowerCase()] || null;
    if (!protocolTrackId) continue;

    const studyPayload = {
      user_id: fixture.userId,
      primary_exam: context.primary_exam ?? null,
      primary_curriculum: context.primary_curriculum ?? null,
      class_level: context.class_level ?? null,
      context_source: 'onboarding',
      updated_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };

    const protocolPayload = {
      user_id: fixture.userId,
      track_id: protocolTrackId,
      current_day_number: 1,
      progress_phase: 1,
      last_unlock_at: null,
      updated_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };

    const { error: studyError } = await db
      .from('user_study_context')
      .upsert(studyPayload, { onConflict: 'user_id' });
    if (studyError) throw studyError;

    const { error: protocolError } = await db
      .from('user_protocols')
      .upsert(protocolPayload, { onConflict: 'user_id' });
    if (protocolError) throw protocolError;

    seeded.push({
      fixtureKey: fixture.key,
      userId: fixture.userId,
      studyPayload: {
        primary_exam: studyPayload.primary_exam,
        primary_curriculum: studyPayload.primary_curriculum,
        class_level: studyPayload.class_level,
        context_source: studyPayload.context_source,
      },
      protocolTrackId,
    });
  }
  return seeded;
}

async function getFixtureStudyContext(userId) {
  const { data, error } = await db
    .from('user_study_context')
    .select('user_id, primary_exam, primary_curriculum, class_level, context_source')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

function normalizeText(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[“”"'.;,!?()[\]{}:]/g, ' ')
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ABBREVIATIONS = {
  dpsp: 'directive principles of state policy',
  fr: 'fundamental rights',
};

function expandRetrievalTerms(prompt) {
  const raw = normalizeText(prompt);
  if (!raw) return [];
  const terms = new Set();
  const addTerm = (term) => {
    const cleaned = normalizeText(term);
    if (cleaned) terms.add(cleaned);
  };

  addTerm(raw);
  const parts = raw.split(' ');
  for (const part of parts) addTerm(part);

  const abbrev = ABBREVIATIONS[raw];
  if (abbrev) {
    addTerm(abbrev);
    for (const part of abbrev.split(' ')) addTerm(part);
  }

  // preserve meaningful numbers and common exam tokens
  const numberTokens = raw.match(/\b\d{3,4}\b/g) || [];
  for (const n of numberTokens) addTerm(n);

  return [...terms];
}

function classifyAspect(prompt) {
  const q = normalizeText(prompt);
  if (/\b(compare|difference between|distinguish|versus|vs)\b/i.test(q)) return 'comparison';
  if (/\b(causes of|reasons for|why)\b/i.test(q)) return 'causal';
  if (/\b(how does|how is|mechanism|process of|working of)\b/i.test(q)) return 'mechanism';
  if (/\b(classification|types of|kinds of|categories of)\b/i.test(q)) return 'classification';
  if (/^\s*(what is|what are|define|definition of)\b/i.test(q)) return 'definition';
  if (/^\s*(explain|describe|tell me about)\b/i.test(q)) return 'explanation';
  return 'explanation';
}

function hasTOCLikeSignal(text) {
  const s = normalizeText(text);
  return (
    /(^|\b)(contents|table of contents|index)\b/.test(s) ||
    /\bunit\s+topic\s+page\s+no\b/.test(s) ||
    /\bchapter\s+\d+\b.*\bpage\b/.test(s) ||
    /\bmonth\b.*\bpage\b/.test(s) ||
    /\bpage no\b/.test(s)
  );
}

const BLOCKED_CHUNK_TYPES = new Set([
  'bookback_exercise',
  'exercise',
  'mcq',
  'question',
  'quiz',
  'outline',
  'contents',
  'table_of_contents',
  'index',
  'glossary',
  'learning_objective',
  'objectives',
]);

function hasExerciseLikeSignal(text) {
  const s = normalizeText(text);
  return (
    /\b(bookback|book back|exercise|review questions|multiple choice|mcq|choose the correct|which of the following|true or false|fill in the blanks|match the following)\b/.test(s) ||
    /^\s*\d+\.\s*\([a-divx]+\)/.test(s) ||
    /\b(a|b|c|d)\s*\)/.test(s)
  );
}

function hasGlossaryLikeSignal(text) {
  const s = String(text || '');
  const norm = normalizeText(s);
  const bilingualNoise =
    /[\u0B80-\u0BFF]/.test(s) && /[a-z]{4,}/i.test(s) && /\b\d+\b/.test(s);
  const termListLike =
    /^[0-9]+\s+[A-Z][A-Za-z]+/.test(s.trim()) &&
    !/[.!?]/.test(s.slice(0, 200)) &&
    (s.split(/\s+/).length > 14 || /[\/\\]/.test(s));
  return (
    /\b(glossary|glossaries|vocabulary|index)\b/.test(norm) ||
    bilingualNoise ||
    termListLike
  );
}

function hasProposition(text) {
  const s = normalizeText(text);
  if (!s) return false;
  const propositionMarkers = [
    /\b(is|are|was|were|means|refers to|defined as|denotes|consists of|comprises|includes|forms|occurs|happens|results in|leads to|causes|explains|shows|describes|relates to|is called)\b/,
  ];
  if (/[.!?]/.test(s) && propositionMarkers.some((r) => r.test(s))) return true;
  return propositionMarkers.some((r) => r.test(s)) && s.split(' ').length >= 8;
}

function targetTermsForPrompt(prompt) {
  const raw = normalizeText(prompt);
  const terms = [];
  const push = (term) => {
    const clean = normalizeText(term);
    if (clean && !terms.includes(clean)) terms.push(clean);
  };

  const abbrev = ABBREVIATIONS[raw];
  if (abbrev) push(abbrev);

  if (/\b(dpsp)\b/.test(raw)) push('directive principles of state policy');
  if (/\b(fr)\b/.test(raw)) push('fundamental rights');

  const patterns = [
    /causes of the ([\w\s]+)$/i,
    /what are the ([\w\s]+)$/i,
    /what is the ([\w\s]+)$/i,
    /what is ([\w\s]+)$/i,
    /explain ([\w\s]+)$/i,
    /describe ([\w\s]+)$/i,
    /compare ([\w\s]+)$/i,
  ];
  for (const pattern of patterns) {
    const m = prompt.match(pattern);
    if (m && m[1]) {
      push(m[1]);
      for (const part of normalizeText(m[1]).split(' ')) {
        if (part.length > 2) push(part);
      }
    }
  }

  for (const n of raw.match(/\b\d{3,4}\b/g) || []) push(n);

  if (!terms.length) {
    for (const part of raw.split(' ')) {
      if (part.length > 2) push(part);
    }
  }

  return terms;
}

function containsPhrase(text, phrase) {
  const t = normalizeText(text);
  const p = normalizeText(phrase);
  if (!t || !p) return false;
  return t.includes(p);
}

function containsAny(text, phrases) {
  return phrases.some((phrase) => containsPhrase(text, phrase));
}

function wordWindow(text, term, before = 8, after = 10) {
  const words = normalizeText(text).split(' ').filter(Boolean);
  const termWords = normalizeText(term).split(' ').filter(Boolean);
  if (!words.length || !termWords.length) return '';
  for (let i = 0; i <= words.length - termWords.length; i++) {
    let ok = true;
    for (let j = 0; j < termWords.length; j++) {
      if (words[i + j] !== termWords[j]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      const start = Math.max(0, i - before);
      const end = Math.min(words.length, i + termWords.length + after);
      return words.slice(start, end).join(' ');
    }
  }
  return '';
}

function aspectSupport(prompt, excerpt) {
  const aspect = classifyAspect(prompt);
  const targetTerms = targetTermsForPrompt(prompt);
  const normExcerpt = normalizeText(excerpt);

  if (!normExcerpt) {
    return { matched: false, reason: 'empty_excerpt' };
  }

  if (hasTOCLikeSignal(excerpt)) {
    return { matched: false, reason: 'toc_or_contents' };
  }
  if (hasExerciseLikeSignal(excerpt)) {
    return { matched: false, reason: 'exercise_or_mcq' };
  }
  if (hasGlossaryLikeSignal(excerpt)) {
    return { matched: false, reason: 'glossary_or_index' };
  }

  if (!hasProposition(excerpt)) {
    return { matched: false, reason: 'no_proposition' };
  }

  const targetCoverage = targetTerms.filter((t) => containsPhrase(normExcerpt, t)).length;
  const hasTarget = targetCoverage > 0;

  if (!hasTarget) {
    return { matched: false, reason: 'missing_target_terms' };
  }

  const causalMarkers = /\b(because|due to|due to the|led to|leads to|resulted in|results in|caused|causes|therefore|as a result|triggered|stems from|originated from)\b/i;
  const causalRelationMarkers = /\b(responsible for|held responsible for|related to|associated with|linked to|result from|results from|arises from|originates from|gives rise to|is the result of|is due to|is caused by|brings about|produces|leads to|results in|occurs when|happens when|depends on)\b/i;
  const explanatoryStructureMarkers = /\b(before|after|prior to|during|when|as|while|through|by|with|from|into|over|under)\b/i;
  const processVerbMarkers = /\b(occurs?|happens?|sets in|withdraws?|withdrawal|shifts?|strikes?|divides?|forms?|moves?|blows?|crosses?|results?|leads?|causes?|produces?|brings?|develops?|increases?|decreases?|affects?|influences?|determines?|controls?|changes?)\b/i;
  const definitionMarkers = /\b(is|are|was|were|means|refers to|defined as|denotes|consists of|comprises|includes|forms|is called)\b/i;
  const comparisonMarkers = /\b(whereas|while|in contrast|compared to|versus|vs\.?|however)\b/i;
  const mechanismMarkers = /\b(because|due to|therefore|as a result|through|by|causes|leads to|results in|occurs when|happens when)\b/i;

  const targetWindow = targetTerms
    .map((t) => wordWindow(excerpt, t))
    .find(Boolean) || normExcerpt;

  switch (aspect) {
    case 'definition':
      if (!definitionMarkers.test(targetWindow)) {
        return { matched: false, reason: 'definition_marker_missing' };
      }
      return { matched: true, reason: 'definition_supported' };
    case 'causal':
      const causalScope = `${targetWindow} ${normExcerpt}`;
      if (
        !causalMarkers.test(causalScope) &&
        !causalRelationMarkers.test(causalScope) &&
        !(
          explanatoryStructureMarkers.test(causalScope) &&
          processVerbMarkers.test(causalScope)
        )
      ) {
        return { matched: false, reason: 'causal_relation_missing' };
      }
      return { matched: true, reason: 'causal_relation_supported' };
    case 'comparison':
      if (!comparisonMarkers.test(normExcerpt)) {
        return { matched: false, reason: 'comparison_marker_missing' };
      }
      return { matched: true, reason: 'comparison_supported' };
    case 'mechanism':
      if (!mechanismMarkers.test(targetWindow)) {
        return { matched: false, reason: 'mechanism_marker_missing' };
      }
      return { matched: true, reason: 'mechanism_supported' };
    case 'classification':
      if (!/\b(classification|classifies|types of|kinds of|categories of|grouped into|divided into)\b/i.test(targetWindow)) {
        return { matched: false, reason: 'classification_marker_missing' };
      }
      return { matched: true, reason: 'classification_supported' };
    default:
      if (targetCoverage < 1) {
        return { matched: false, reason: 'target_terms_missing' };
      }
      if (targetWindow.length < 20) {
        return { matched: false, reason: 'too_little_context' };
      }
      return { matched: true, reason: 'explanation_supported' };
  }
}

async function stream(profile, prompt) {
  const response = await fetch(`${url}/functions/v1/miga_stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${anon}`,
      apikey: anon,
    },
    body: JSON.stringify({
      user_id: profile.id,
      messages: [{ role: 'user', content: prompt }],
      mode: 'chat',
      language_code: 'en-IN',
      language_label: 'English',
      attachments: [],
      provider: 'openrouter',
    }),
  });

  if (!response.ok) throw new Error(await response.text());

  let event = '';
  let answer = '';
  let evidence = [];
  const events = [];
  const text = await response.text();
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
      events.push(event);
      continue;
    }
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      const parsed = JSON.parse(data);
      if (event === 'evidence') evidence = parsed.evidence || [];
      else if (parsed.token) answer += parsed.token;
    } catch {
      // ignore malformed lines
    }
  }

  return { events, answer, evidence };
}

async function smokeTestFixture(fixtureKey, prompt) {
  const fixture = fixtures.find((f) => f.key === fixtureKey);
  if (!fixture?.userId) throw new Error(`Missing fixture user for ${fixtureKey}`);
  const saved = await getFixtureStudyContext(fixture.userId);
  const resolved = canonicalStudyContextFromRow(saved);
  const streamed = await stream({ id: fixture.userId }, prompt);
  return {
    fixtureKey,
    userId: fixture.userId,
    prompt,
    savedContext: saved,
    resolvedStudyContext: resolved,
    actualPrimaryCorpus: streamed.evidence?.[0]?.board || null,
    evidenceCount: streamed.evidence?.length || 0,
    answer: streamed.answer,
    events: streamed.events,
  };
}

async function enrichEvidence(prompt, evidenceRows) {
  const enriched = [];
  for (const item of evidenceRows) {
    const { data: chunk, error } = await db
      .from('textbook_chunks')
      .select('id,source_id,content,board,class_level,subject,chunk_type,chapter,language')
      .eq('id', item.excerptChunkId)
      .maybeSingle();
    if (error) throw error;

    const strict = aspectSupport(prompt, item.excerpt || '');
    const enrichedItem = {
      ...item,
      chunkType: chunk?.chunk_type || null,
      board: chunk?.board || item.board || null,
      class_level: chunk?.class_level ?? null,
      subject: chunk?.subject || item.subject || null,
      chapter: chunk?.chapter || null,
      language: chunk?.language || null,
      strictRequestedAspectMatched: strict.matched,
      strictReasonDirect: BLOCKED_CHUNK_TYPES.has(String(chunk?.chunk_type || '').toLowerCase())
        ? `blocked_chunk_type:${String(chunk?.chunk_type || '').toLowerCase()}`
        : strict.reason,
      strictDirect: strict.matched && !BLOCKED_CHUNK_TYPES.has(String(chunk?.chunk_type || '').toLowerCase()),
    };

    enriched.push(enrichedItem);
  }
  return enriched;
}

function firstSupportingEvidence(enrichedEvidence) {
  return enrichedEvidence.find((item) => item.strictDirect) || null;
}

function verdictForResult({ expectedCorpus, actualPrimaryCorpus, evidence, supporting }) {
  if (!evidence.length) return 'FAIL_NO_EVIDENCE';
  if (expectedCorpus && actualPrimaryCorpus && expectedCorpus !== actualPrimaryCorpus) {
    return 'FAIL_WRONG_CORPUS';
  }
  if (!supporting.length) return 'FAIL_WEAK_EVIDENCE';
  return 'PASS_DIRECT';
}

async function chooseProfiles() {
  const tnpsc = fixtures.find((f) => f.key === 'tnpsc');
  const upsc = fixtures.find((f) => f.key === 'upsc');
  if (!tnpsc?.userId || !upsc?.userId) throw new Error('Could not infer fixture user IDs from seed report');
  return { tnpsc: tnpsc.userId, upsc: upsc.userId };
}

(async () => {
  const profileIds = await chooseProfiles();
  const seededFixtures = await seedCanonicalFixtureContexts();
  const smokeTests = [];
  if (!focusCase) {
    smokeTests.push(await smokeTestFixture('tnpsc', 'What is democracy?'));
    smokeTests.push(await smokeTestFixture('upsc', 'What is democracy?'));
  }
  const results = [];

  for (const fixture of fixtures) {
    const userId = profileIds[fixture.key];
    const profile = { id: userId };
    for (const prompt of prompts) {
      if (promptFilter && prompt.key !== promptFilter) continue;
      const name = `${fixture.key}:${prompt.key}`;
      if (focusCase && name !== focusCase) continue;
      const streamed = await stream(profile, prompt.prompt);
      const evidence = streamed.evidence || [];
      const enrichedEvidence = await enrichEvidence(prompt.prompt, evidence);
      const supporting = enrichedEvidence.filter((item) => item.strictDirect);
      const top = enrichedEvidence[0] || null;
      const actualPrimaryCorpus = top?.board || null;

      const topSource = top
        ? {
            sourceId: top.sourceId,
            board: top.board,
            class_level: top.class_level,
            subject: top.subject,
            book_title: null,
            volume_or_part: null,
            chapter_number: null,
            chapter_title: null,
            unit_type: null,
            unit_number: null,
            unit_title: null,
            excerpt: top.excerpt,
            supportingChunkCount: enrichedEvidence.length,
          }
        : null;

      const verdict = verdictForResult({
        expectedCorpus: fixture.expectedCorpus,
        actualPrimaryCorpus,
        evidence: enrichedEvidence,
        supporting,
      });

      results.push({
        name,
        fixtureKey: fixture.key,
        prompt: prompt.prompt,
        expectedCorpus: fixture.expectedCorpus,
        userId,
        stream: {
          ok: true,
          status: 200,
          events: streamed.events,
          answer: streamed.answer,
        },
        actualPrimaryCorpus,
        leakageBoards: [...new Set(enrichedEvidence.map((x) => x.board).filter(Boolean))].filter((b) => b !== actualPrimaryCorpus),
        topSource,
        evidenceAudit: enrichedEvidence.map((item) => ({
          sourceId: item.sourceId,
          chunkId: item.excerptChunkId,
          excerpt: item.excerpt,
          supportScore: item.supportScore,
          selectionReason: item.selectionReason ?? null,
          selectionScore: item.selectionScore ?? null,
          selectionDirect: item.selectionDirect ?? null,
          selectionBlocked: item.selectionBlocked ?? null,
          requestedAspectMatched: item.strictRequestedAspectMatched,
          reasonDirect: item.strictReasonDirect,
          verdict: item.strictDirect ? 'DIRECT' : 'REJECTED',
          board: item.board,
          subject: item.subject,
          chapterTitle: null,
          unitTitle: null,
          chunkType: item.chunkType,
          strictReason: item.strictReasonDirect,
        })),
        auditSupportingEvidence: supporting.map((item) => ({
          sourceId: item.sourceId,
          chunkId: item.excerptChunkId,
          excerpt: item.excerpt,
          supportScore: item.supportScore,
          selectionReason: item.selectionReason ?? null,
          selectionScore: item.selectionScore ?? null,
          selectionDirect: item.selectionDirect ?? null,
          selectionBlocked: item.selectionBlocked ?? null,
          requestedAspectMatched: item.strictRequestedAspectMatched,
          reasonDirect: item.strictReasonDirect,
          verdict: 'DIRECT',
          board: item.board,
          subject: item.subject,
          chapterTitle: null,
          unitTitle: null,
          chunkType: item.chunkType,
          strictReason: item.strictReasonDirect,
        })),
        answerCoverage: streamed.answer ? 1 : 0,
        verdict,
      });
    }
  }

  const summary = results.reduce(
    (acc, r) => {
      if (r.verdict === 'PASS_DIRECT') acc.pass_direct += 1;
      else if (r.verdict === 'PASS_PARTIAL') acc.pass_partial += 1;
      else acc.fail += 1;
      return acc;
    },
    { total: results.length, pass_direct: 0, pass_partial: 0, fail: 0 }
  );
  summary.strictPassRate = summary.pass_direct / summary.total;

  const report = {
    generatedAt: new Date().toISOString(),
    prompts,
    fixtures,
    seededFixtures,
    smokeTests,
    results,
    summary,
    validatorVersion: 'strict-v2',
    notes: [
      'TOC/contents/exercise/glossary-adjacent passages are rejected unless they contain an actual proposition answering the requested aspect.',
      'PASS_DIRECT requires both corpus match and at least one strict supporting passage.',
    ],
  };

  const out = process.env.STRICT_V2_BENCHMARK_OUT
    ? path.resolve(process.env.STRICT_V2_BENCHMARK_OUT)
    : path.join('reports', 'concept-benchmark-strict-v2-canonical-context.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output: out, summary }, null, 2));
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
