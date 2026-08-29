/**
 * Apply subject+topic tags to PYQ rows from a classification JSON.
 *
 * SAFETY BY CONSTRUCTION:
 *   - Only ever PATCHes `subject` and `topic`. Never touches question_text,
 *     options, answer_text, answer_source — the verified answers are untouchable.
 *   - `subject` must be one of the fixed taxonomy; `topic` must be one of the
 *     official-syllabus topics that BELONGS to that subject. Any row failing
 *     validation is reported and skipped, never written.
 *   - DRY RUN by default. Backs up the intended changes to recovery/ before --apply.
 *
 * Input JSON: either {"<id>": {"subject":"...","topic":"..."}, ...}
 *          or [{"id":"...","subject":"...","topic":"..."}, ...]
 *
 *   node scripts/pyq-tag-apply.cjs --in tags.json           # dry: validate + report
 *   node scripts/pyq-tag-apply.cjs --in tags.json --apply
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const BASE = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' };
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const APPLY = process.argv.includes('--apply');
const IN = arg('in');
// Taxonomy: 'upsc' (default) or 'tnpsc'. Constrains subject + topic.
const TAX = arg('taxonomy', 'upsc').toLowerCase();
const { SUBJECTS, TOPICS_BY_SUBJECT } = require(`./${TAX === 'tnpsc' ? 'tnpsc' : 'upsc'}-syllabus-topics.js`);
if (!IN || !fs.existsSync(IN)) { console.error('need --in <tags.json>'); process.exit(1); }

const subjOf = (s) => SUBJECTS.find((x) => x.toLowerCase() === String(s || '').toLowerCase().trim());
const topicOf = (subj, t) => (TOPICS_BY_SUBJECT[subj] || []).find((x) => x.toLowerCase() === String(t || '').toLowerCase().trim());

(async () => {
  const raw = JSON.parse(fs.readFileSync(IN, 'utf8'));
  const entries = Array.isArray(raw)
    ? raw.map((r) => [r.id, { subject: r.subject, topic: r.topic }])
    : Object.entries(raw);

  const good = []; const bad = [];
  for (const [id, v] of entries) {
    const subj = subjOf(v.subject);
    if (!subj) { bad.push(`${id}: bad subject ${JSON.stringify(v.subject)}`); continue; }
    const topic = topicOf(subj, v.topic);
    if (!topic) { bad.push(`${id}: topic ${JSON.stringify(v.topic)} not valid for subject ${subj}`); continue; }
    good.push({ id, subject: subj, topic });
  }

  console.log(`Valid: ${good.length} | invalid: ${bad.length} | total: ${entries.length}`);
  if (bad.length) { console.log('\nINVALID (skipped):'); bad.slice(0, 40).forEach((b) => console.log('  ' + b)); if (bad.length > 40) console.log(`  ...+${bad.length - 40} more`); }
  const dist = {};
  for (const g of good) dist[g.subject] = (dist[g.subject] || 0) + 1;
  console.log('\nSubject distribution:'); for (const [s, n] of Object.entries(dist).sort((a, b) => b[1] - a[1])) console.log(`  ${s.padEnd(22)} ${n}`);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.mkdirSync(path.resolve(__dirname, '../recovery'), { recursive: true });
  fs.writeFileSync(path.resolve(__dirname, `../recovery/pyq-tag-${stamp}.json`), JSON.stringify(good, null, 2));

  if (!APPLY) { console.log('\nDRY RUN. Re-run with --apply to write subject+topic (only those two fields).'); return; }

  let ok = 0, fail = 0;
  for (const g of good) {
    const r = await fetch(`${BASE}/rest/v1/pyq_questions?id=eq.${encodeURIComponent(g.id)}`, {
      method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' },
      body: JSON.stringify({ subject: g.subject, topic: g.topic }),
    });
    if (r.ok) ok++; else { fail++; if (fail <= 5) console.warn(`  PATCH ${g.id} failed ${r.status}`); }
  }
  console.log(`\nDone. Tagged ${ok} rows (subject+topic); ${fail} failed.`);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
