// Direct end-to-end test of MIGA's textbook-grounded answering.
// (1) shows WHICH NCERT/Samacheer chunk the retrieval layer grounds on, then
// (2) calls the REAL deployed miga_stream edge function exactly like the app.
//
//   node --use-system-ca scripts/ask-miga.mjs "How is the President of India elected?"
//   node --use-system-ca scripts/ask-miga.mjs --file questions.txt
//   node --use-system-ca scripts/ask-miga.mjs --file questions.txt --out report.md
//
// Run via PowerShell (TLS middlebox → Git Bash gets ECONNRESET).

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const ROOT = process.cwd();
function loadEnv() {
  const env = {};
  for (const f of ['.env', '.env.local']) {
    const p = path.join(ROOT, f); if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
      const i = t.indexOf('='); env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
    }
  }
  return env;
}
const env = loadEnv();
const URL = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const OR = env.OPENROUTER_API_KEY || (env.OPENROUTER_API_KEYS || '').split(',')[0].trim();
const sb = createClient(URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function embed(q) {
  const r = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OR}` },
    body: JSON.stringify({ model: 'openai/text-embedding-3-small', input: [q] }),
  });
  if (!r.ok) return null;
  return (await r.json()).data[0].embedding;
}

// Mirror the deployed miga_stream retrieval: 12 candidates, lexical re-rank, top 6,
// language-aware (Tamil query -> Tamil chunks).
const STOP = new Set(['about','above','after','again','against','along','among','around','because','been','before','being','below','between','both','could','describe','during','explain','following','from','further','have','having','highlight','into','its','itself','mentioned','more','most','only','other','over','provide','reference','same','section','should','some','specific','such','than','that','their','them','then','there','these','they','this','those','through','under','until','using','what','when','where','which','while','with','within','would','your','structure','current','primary','argument','compare','setup','exact','page']);
async function retrievalPreview(q) {
  const e = await embed(q); if (!e) { console.log('  (retrieval preview skipped — embed failed)'); return; }
  const isTamil = /[஀-௿]/.test(q);
  const { data, error } = await sb.rpc('match_textbook_chunks', { query_embedding: e, match_count: 12, filter_language: isTamil ? 'tamil' : 'english' });
  if (error) { console.log('  retrieval error:', error.message); return; }
  const terms = [...new Set((q.toLowerCase().match(/[a-z][a-z-]{3,}/g) || []))].filter((w) => !STOP.has(w));
  const scored = data.map((r) => {
    const text = String(r.content || '').toLowerCase();
    let hits = 0; for (const t of terms) if (text.includes(t)) hits++;
    return { r, score: (r.similarity ?? 0) + Math.min(hits, 4) * 0.02, hits };
  }).sort((a, b) => b.score - a.score).slice(0, 6);
  console.log('  GROUNDING (top textbook chunks the model sees, after re-rank):');
  for (const { r, score, hits } of scored) {
    const src = `${r.board} class ${r.class_level} ${r.subject || ''}`.trim();
    console.log(`   • [sim ${r.similarity.toFixed(3)} +kw${hits} → ${score.toFixed(3)}] ${src}`);
    console.log(`       "${r.content.replace(/\s+/g, ' ').slice(0, 140)}…"`);
  }
}

async function askMiga(q) {
  const res = await fetch(`${URL}/functions/v1/miga_stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON}`, apikey: ANON },
    body: JSON.stringify({
      user_id: 'rag-test-harness',
      messages: [{ role: 'user', content: q }],
      mode: 'chat', language_code: 'en-IN', language_label: 'English', attachments: [], provider: 'openrouter',
    }),
  });
  if (!res.ok) { console.log(`  miga_stream HTTP ${res.status}:`, (await res.text()).slice(0, 300)); return; }
  const text = await res.text();
  let out = '';
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('data:')) continue;
    const d = t.slice(5).trim();
    if (d === '[DONE]') continue;
    try {
      const j = JSON.parse(d);
      const tok = j.token ?? j.content ?? j.choices?.[0]?.delta?.content ?? j.delta ?? '';
      if (typeof tok === 'string') out += tok;
    } catch {}
  }
  console.log('  MIGA ANSWER:\n');
  console.log(out.split('\n').map((l) => '    ' + l).join('\n'));
  return out;
}

const REPORT = [];
async function main() {
  let questions = [];
  const args = process.argv.slice(2);
  const fi = args.indexOf('--file');
  const oi = args.indexOf('--out');
  const outFile = oi >= 0 ? args[oi + 1] : null;
  if (fi >= 0) questions = fs.readFileSync(args[fi + 1], 'utf8').split(/\r?\n/).filter((l) => l.trim());
  else questions = args.filter((a) => !a.startsWith('--') && a !== outFile);
  if (!questions.length) { console.log('Give a question: node scripts/ask-miga.mjs "..."'); return; }

  for (const q of questions) {
    console.log('\n' + '='.repeat(78));
    console.log('Q:', q);
    console.log('='.repeat(78));
    await retrievalPreview(q);
    console.log('');
    const answer = await askMiga(q);
    REPORT.push(`### Q: ${q}\n\n${(answer || '(no answer)').trim()}\n`);
  }
  if (outFile) { fs.writeFileSync(outFile, REPORT.join('\n---\n\n'), 'utf8'); console.log(`\nReport written: ${outFile}`); }
}
main().catch((e) => { console.error(e); process.exit(1); });
