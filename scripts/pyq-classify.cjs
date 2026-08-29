/**
 * PYQ subject/topic classifier — the foundation for topic analytics.
 *
 * Assigns each untagged PYQ a `subject` (from a FIXED taxonomy, so counts are
 * consistent) and a concise `topic`. Enables "most-asked topic", "how many times
 * X was asked", "least-asked", etc.
 *
 * Careful by construction:
 *   - Only ever writes `subject` and `topic`. Never touches question_text,
 *     options, or answer_text — the verified answers are untouchable.
 *   - `subject` must be one of the fixed list or the row is left unset (never a
 *     free-form subject that would fragment the counts).
 *   - Rows are matched back by a per-batch index the model must echo; any
 *     mismatch is skipped, never mis-assigned.
 *   - DRY RUN by default: prints the subject distribution + a sample to eyeball.
 *     Every planned change is backed up to recovery/ before --apply.
 *
 *   node --use-system-ca scripts/pyq-classify.cjs --exam TNPSC            # dry
 *   node --use-system-ca scripts/pyq-classify.cjs --exam TNPSC --apply    # write
 *   node --use-system-ca scripts/pyq-classify.cjs --source-id-like tnpsc-group --apply
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');

const URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
// aiand.com (Anthropic-format proxy) — fast, credited, not rate-limited like the
// free OpenRouter endpoint. deepseek-v4-flash is plenty for classification.
const AIAND_KEY = process.env.AIAND_API_KEY;
const MODEL = (() => { const i = process.argv.indexOf('--model'); return i > -1 ? process.argv[i + 1] : (process.env.AIAND_MODEL || 'deepseek-ai/deepseek-v4-flash'); })();
if (!URL || !SR || !AIAND_KEY) { console.error('missing env (need AIAND_API_KEY)'); process.exit(1); }
const H = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' };

const APPLY = process.argv.includes('--apply');
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : null; };
const EXAM = arg('exam');
const SRC_LIKE = arg('source-id-like');
const LIMIT = parseInt(arg('limit') || '0', 10) || 0;

// FIXED subject taxonomy — the ONLY allowed subjects, so topic counts never
// fragment across synonyms. Aligned to the GS exam syllabus.
const SUBJECTS = [
  'Polity', 'History', 'Geography', 'Economy', 'Science & Technology',
  'Environment', 'Current Affairs', 'Art & Culture',
  // Language + reasoning sections — kept distinct so the app can filter GS-only.
  'General English', 'Aptitude', 'General Knowledge',
];
const SUBJECT_SET = new Set(SUBJECTS.map((s) => s.toLowerCase()));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Calls aiand.com (Anthropic /v1/messages format). `messages` comes in OpenAI
// shape [{role:'system'|'user', content}]; split the system out as Anthropic wants.
async function or(messages) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const msgs = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content }));
  for (let a = 0; a < 4; a++) {
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 90000);
    try {
      const r = await fetch('https://api.aiand.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': AIAND_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({ model: MODEL, max_tokens: 4000, temperature: 0, system, messages: msgs }),
      });
      if (r.status === 429 || r.status >= 500) throw new Error(`retryable ${r.status}`);
      if (!r.ok) throw new Error(`aiand ${r.status}: ${(await r.text()).slice(0, 120)}`);
      const c = String((await r.json())?.content?.[0]?.text || '').trim();
      if (!c) throw new Error('empty'); return c;
    } catch (e) { if (a === 3) throw e; await sleep(2000 * (a + 1)); } finally { clearTimeout(timer); }
  }
}
const parseJson = (s) => JSON.parse(s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim());

const RETAG = process.argv.includes('--retag'); // re-classify even already-tagged rows (normalise messy subjects)
async function fetchUntagged() {
  const cols = 'id,exam,year,question_text,answer_source';
  // Normally only untagged rows; with --retag, everything (to normalise into the
  // fixed taxonomy). Never touches demoted rows.
  let filter = RETAG ? '&answer_source=not.like.*-demoted' : '&subject=is.null';
  if (EXAM) filter += `&exam=eq.${encodeURIComponent(EXAM)}`;
  if (SRC_LIKE) filter += `&source_id=like.${encodeURIComponent(SRC_LIKE)}*`;
  const PAGE = 1000; const rows = [];
  for (let from = 0; ; from += PAGE) {
    const r = await fetch(`${URL}/rest/v1/pyq_questions?select=${cols}${filter}&order=id.asc`, { headers: { ...H, Range: `${from}-${from + PAGE - 1}` } });
    if (!r.ok) throw new Error(`fetch ${r.status}`);
    const b = await r.json(); rows.push(...b);
    if (b.length < PAGE || (LIMIT && rows.length >= LIMIT)) break;
  }
  return LIMIT ? rows.slice(0, LIMIT) : rows;
}

async function classifyBatch(batch) {
  // batch: [{i, question}] — model must echo i so we map back exactly.
  const payload = batch.map((b, i) => ({ i, q: String(b.question_text).slice(0, 400) }));
  const out = await or([
    {
      role: 'system',
      content:
        'For each exam question, first judge if it is a READABLE, real question in English. ' +
        'Many are OCR garbage (random letters/digits like "680T 6801 5T6", mangled non-words) or non-English — mark those "valid":false. ' +
        `For valid ones, "subject" MUST be exactly one of: ${SUBJECTS.join(', ')}. ` +
        '"topic" is a short canonical topic (2-4 words, e.g. "Fundamental Rights", "Chola Dynasty", "Monetary Policy"). ' +
        'Use "Aptitude" for maths/reasoning, "General Knowledge" only if valid but nothing else fits. ' +
        'Echo each item\'s "i". Output ONLY a JSON array [{"i":<int>,"valid":<true|false>,"subject":"<one of the list, or empty if invalid>","topic":"<short topic, or empty>"}].',
    },
    { role: 'user', content: JSON.stringify(payload) },
  ]);
  try {
    const arr = parseJson(out);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

(async () => {
  console.log(`PYQ classify — ${APPLY ? 'APPLY' : 'DRY RUN'}${EXAM ? ` exam=${EXAM}` : ''}${SRC_LIKE ? ` src~${SRC_LIKE}` : ''}\n`);
  const rows = await fetchUntagged();
  console.log(`Untagged rows to classify: ${rows.length}`);
  if (!rows.length) return;

  const BATCH = 15;
  const updates = []; // {id, subject, topic}  (valid, classified)
  const garbage = []; // {id, answer_source}   (invalid → demote)
  const dist = {};
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    let res = [];
    try { res = await classifyBatch(slice); } catch { /* skip batch */ }
    for (const r of res) {
      const row = slice[r.i];
      if (!row) continue; // index must map
      if (r.valid === false) { garbage.push(row); continue; }
      const subj = SUBJECTS.find((s) => s.toLowerCase() === String(r.subject || '').toLowerCase().trim());
      if (!subj) continue; // subject must be in the fixed list, else skip (careful)
      const topic = String(r.topic || '').trim().slice(0, 60) || null;
      updates.push({ id: row.id, subject: subj, topic });
      dist[subj] = (dist[subj] || 0) + 1;
    }
    if ((i / BATCH) % 10 === 0) process.stdout.write(`  ${Math.min(i + BATCH, rows.length)}/${rows.length}\r`);
  }
  console.log(`\n\nValid & classified: ${updates.length} | flagged garbage (to demote): ${garbage.length} | of ${rows.length}`);
  console.log('\nSubject distribution:');
  for (const [s, n] of Object.entries(dist).sort((a, b) => b[1] - a[1])) console.log(`  ${s.padEnd(22)} ${n}`);

  console.log('\nSample classifications (verify these are right):');
  const step = Math.max(1, Math.floor(updates.length / 12));
  for (let i = 0; i < updates.length; i += step) {
    const u = updates[i]; const row = rows.find((r) => r.id === u.id);
    console.log(`  [${u.subject} / ${u.topic}] ${String(row?.question_text).slice(0, 70)}`);
  }
  console.log('\nSample flagged-garbage (verify these are truly unreadable):');
  garbage.slice(0, 8).forEach((r) => console.log(`  ${JSON.stringify(String(r.question_text).slice(0, 70))}`));

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.mkdirSync(path.resolve(__dirname, '../recovery'), { recursive: true });
  fs.writeFileSync(path.resolve(__dirname, `../recovery/pyq-classify-${stamp}.json`), JSON.stringify({ updates, garbage: garbage.map((g) => g.id) }, null, 2));
  console.log(`\nBackup: recovery/pyq-classify-${stamp}.json`);

  if (!APPLY) { console.log('\nDRY RUN — verify both samples. Re-run with --apply to tag the valid ones AND demote the garbage.'); return; }

  console.log(`\nTagging ${updates.length} valid + demoting ${garbage.length} garbage...`);
  let ok = 0;
  for (const u of updates) {
    const r = await fetch(`${URL}/rest/v1/pyq_questions?id=eq.${encodeURIComponent(u.id)}`, {
      method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' },
      body: JSON.stringify({ subject: u.subject, topic: u.topic }),
    });
    if (r.ok) ok++;
  }
  let dem = 0;
  for (const g of garbage) {
    const r = await fetch(`${URL}/rest/v1/pyq_questions?id=eq.${encodeURIComponent(g.id)}`, {
      method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' },
      body: JSON.stringify({ answer_source: `${g.answer_source || 'unknown'}|garbage-demoted` }),
    });
    if (r.ok) dem++;
  }
  console.log(`\nDone. Tagged ${ok} rows (subject+topic), demoted ${dem} garbage rows.`);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
