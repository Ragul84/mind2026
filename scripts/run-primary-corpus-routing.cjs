require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const url = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anon || !service) throw new Error('Supabase credentials required');

const admin = createClient(url, service, { auth: { persistSession: false } });
const authHeaders = {
  Authorization: `Bearer ${anon}`,
  apikey: anon,
  'Content-Type': 'application/json',
};

const promptSets = {
  baseline: 'Explain DPSP',
  baselineFull: 'Explain Directive Principles of State Policy',
  nuclearFission: 'What is nuclear fission?',
  revolt: 'The revolt of 1857',
  revoltCauses: 'Explain the causes of the Revolt of 1857',
  monsoon: 'Explain the Indian monsoon',
  overrideNcert: 'Explain DPSP according to NCERT',
  overrideSamacheer: 'Explain DPSP from Samacheer',
  both: 'Compare how NCERT and Samacheer explain Directive Principles of State Policy',
};

const fixtures = [
  { key: 'tnpsc', context: { primary_exam: 'tnpsc', primary_curriculum: 'samacheer', class_level: 10, context_source: 'onboarding' } },
  { key: 'samacheer_school', context: { primary_exam: null, primary_curriculum: 'samacheer', class_level: 10, context_source: 'onboarding' } },
  { key: 'upsc', context: { primary_exam: 'upsc', primary_curriculum: 'ncert', class_level: null, context_source: 'onboarding' } },
  { key: 'ncert_school', context: { primary_exam: null, primary_curriculum: 'ncert', class_level: 11, context_source: 'onboarding' } },
  { key: 'ssc', context: { primary_exam: 'ssc', primary_curriculum: 'ncert', class_level: null, context_source: 'onboarding' } },
  { key: 'rrb', context: { primary_exam: 'rrb', primary_curriculum: 'ncert', class_level: null, context_source: 'onboarding' } },
  { key: 'generic', context: null },
];

function randomEmail(label) {
  return `${label}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}@example.com`;
}

async function createFixture(name, context) {
  const email = randomEmail(name);
  const password = `Temp-${crypto.randomBytes(8).toString('hex')}!`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: `${name} fixture` },
  });
  if (error) throw error;
  const userId = data.user.id;
  if (context) {
    const payload = {
      user_id: userId,
      primary_exam: context.primary_exam,
      primary_curriculum: context.primary_curriculum,
      class_level: context.class_level,
      context_source: context.context_source || 'onboarding',
    };
    const { error: upsertError } = await admin.from('user_study_context').upsert(payload, { onConflict: 'user_id' });
    if (upsertError) throw upsertError;
  }
  return { key: name, userId, email, password, context };
}

async function cleanupFixture(fixture) {
  if (!fixture?.userId) return;
  await admin.from('user_study_context').delete().eq('user_id', fixture.userId);
  await admin.auth.admin.deleteUser(fixture.userId).catch(() => {});
}

async function streamChat(userId, prompt) {
  const response = await fetch(`${url}/functions/v1/miga_stream`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      user_id: userId,
      messages: [{ role: 'user', content: prompt }],
      mode: 'chat',
      language_code: 'en-IN',
      language_label: 'English',
      attachments: [],
      provider: 'openrouter',
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    return { ok: false, status: response.status, error: raw };
  }

  let event = '';
  let answer = '';
  let evidence = [];
  const events = [];
  for (const line of raw.split(/\r?\n/)) {
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
    } catch {}
  }

  return { ok: true, status: response.status, events, answer, evidence };
}

async function hydrateEvidence(evidence) {
  const out = [];
  for (const item of evidence || []) {
    const [{ data: chunk }, { data: doc }, { data: chapter }] = await Promise.all([
      admin.from('textbook_chunks').select('id,source_id,board,class_level,subject,chapter,language,chunk_type,content').eq('id', item.excerptChunkId).maybeSingle(),
      admin.from('textbook_source_documents').select('source_id,board,class_level,subject,language,book_title,volume_or_part,document_scope,official_source_url,verification_status,field_provenance').eq('source_id', item.sourceId).maybeSingle(),
      item.chapterId
        ? admin.from('textbook_source_chapters').select('chapter_id,source_id,chapter_number,chapter_title,canonical_unit_type,canonical_unit_number,canonical_unit_title,verification_status,field_provenance').eq('chapter_id', item.chapterId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    out.push({
      evidence: item,
      chunk,
      document: doc,
      chapter,
    });
  }
  return out;
}

function classifySource(item, expectedBoard, prompt) {
  const board = String(item?.document?.board || item?.chunk?.board || '').toLowerCase();
  const subject = String(item?.document?.subject || item?.chunk?.subject || '').toLowerCase();
  const query = String(prompt || '').toLowerCase();
  const boardMatches = expectedBoard ? board === expectedBoard : true;
  const queryHits = [subject, String(item?.document?.book_title || '').toLowerCase(), String(item?.chapter?.chapter_title || '').toLowerCase()]
    .filter(Boolean)
    .filter((value) => query.includes(value) || value.includes(query))
    .length;
  if (boardMatches && queryHits > 0) return 'PRIMARY';
  if (boardMatches) return 'SUPPORTING';
  return 'WEAK';
}

async function main() {
  const created = [];
  try {
    for (const fixture of fixtures) {
      created.push(await createFixture(fixture.key, fixture.context));
    }

    const byKey = Object.fromEntries(created.map((fixture) => [fixture.key, fixture]));
    const tests = [
      { name: 'tnpsc_baseline', userKey: 'tnpsc', prompt: promptSets.baseline, expectedBoard: 'samacheer' },
      { name: 'upsc_baseline', userKey: 'upsc', prompt: promptSets.baseline, expectedBoard: 'ncert' },
      { name: 'tnpsc_full_dpsp', userKey: 'tnpsc', prompt: promptSets.baselineFull, expectedBoard: 'samacheer' },
      { name: 'upsc_full_dpsp', userKey: 'upsc', prompt: promptSets.baselineFull, expectedBoard: 'ncert' },
      { name: 'tnpsc_nuclear_fission', userKey: 'tnpsc', prompt: promptSets.nuclearFission, expectedBoard: 'samacheer' },
      { name: 'upsc_nuclear_fission', userKey: 'upsc', prompt: promptSets.nuclearFission, expectedBoard: 'ncert' },
      { name: 'samacheer_school', userKey: 'samacheer_school', prompt: 'Explain photosynthesis', expectedBoard: 'samacheer' },
      { name: 'ncert_school', userKey: 'ncert_school', prompt: 'Explain photosynthesis', expectedBoard: 'ncert' },
      { name: 'ssc_baseline', userKey: 'ssc', prompt: promptSets.baseline, expectedBoard: 'ncert' },
      { name: 'rrb_monsoon', userKey: 'rrb', prompt: promptSets.monsoon, expectedBoard: 'ncert' },
      { name: 'generic_baseline', userKey: 'generic', prompt: promptSets.baseline, expectedBoard: '' },
      { name: 'generic_full_dpsp', userKey: 'generic', prompt: promptSets.baselineFull, expectedBoard: '' },
      { name: 'tnpsc_override_ncert', userKey: 'tnpsc', prompt: promptSets.overrideNcert, expectedBoard: 'ncert' },
      { name: 'upsc_override_samacheer', userKey: 'upsc', prompt: promptSets.overrideSamacheer, expectedBoard: 'samacheer' },
      { name: 'both_requested', userKey: 'upsc', prompt: promptSets.both, expectedBoard: '' },
      { name: 'revolt_simple', userKey: 'upsc', prompt: promptSets.revolt, expectedBoard: 'ncert' },
      { name: 'revolt_causes', userKey: 'upsc', prompt: promptSets.revoltCauses, expectedBoard: 'ncert' },
    ];

    const results = [];
    for (const test of tests) {
      const fixture = byKey[test.userKey];
      const live = await streamChat(fixture.userId, test.prompt);
      const hydrated = live.ok ? await hydrateEvidence(live.evidence) : [];
      results.push({
        ...test,
        userId: fixture.userId,
        resolvedStudyContext: fixture.context || { primary_exam: null, primary_curriculum: null, class_level: null, context_source: 'generic' },
        stream: live,
        evidence: hydrated,
        sourceRelevance: hydrated.map((item) => ({
          sourceId: item.evidence.sourceId,
          board: item.document?.board || item.chunk?.board || null,
          classification: classifySource(item, test.expectedBoard, test.prompt),
          supportingChunkCount: item.evidence.supportingChunkCount,
          excerpt: item.evidence.excerpt,
          canonical: {
            board: item.document?.board || null,
            class_level: item.document?.class_level ?? item.chunk?.class_level ?? null,
            subject: item.document?.subject || item.chunk?.subject || null,
            book_title: item.document?.book_title || null,
            volume_or_part: item.document?.volume_or_part || null,
            chapter_number: item.chapter?.chapter_number || null,
            chapter_title: item.chapter?.chapter_title || null,
            unit_type: item.chapter?.canonical_unit_type || null,
            unit_number: item.chapter?.canonical_unit_number || null,
            unit_title: item.chapter?.canonical_unit_title || null,
          },
        })),
      });
    }

    const report = {
      generated_at: new Date().toISOString(),
      fixtures: created.map((fixture) => ({
        key: fixture.key,
        userId: fixture.userId,
        context: fixture.context,
      })),
      results,
    };

    const out = path.join('reports', 'primary-corpus-routing.json');
    fs.writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({
      output: out,
      tests: results.map((r) => ({
        name: r.name,
        events: r.stream.events,
        evidence_sources: r.stream.evidence.length,
        answer_chars: r.stream.answer.length,
      })),
    }, null, 2));
  } finally {
    for (const fixture of created.reverse()) {
      await cleanupFixture(fixture);
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
