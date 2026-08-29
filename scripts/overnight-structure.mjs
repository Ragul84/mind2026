// Overnight structuring + quiz pass for ALL exams, ALL days.
// Uses aiand (kimi-k2.6) to RESHAPE each day's fact-checked notes into rich
// visual blocks + author 5 exam-style quiz questions. Facts are preserved
// (reshape only). Backs up every row, logs progress, resumable, skips
// already-rich days. Spot-check in the morning.
//
//   node --use-system-ca scripts/overnight-structure.mjs --test          # 1 day, prints output
//   node --use-system-ca scripts/overnight-structure.mjs                 # full run (all exams)
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = {};
for (const l of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const t = l.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('='); env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
}
const sb = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY || env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
const AIAND = 'sk-e585e4f8adfbe292283f4e0722db1835c3ea92ce6f1502bf43b22daed00c8bd8';
const MODEL = 'deepseek-ai/deepseek-v4-pro';
const TEST = process.argv.includes('--test');
const EXAMS = ['upsc_ecosystem', 'tnpsc_ecosystem', 'ssc_ecosystem'];
const RICH = ['table', 'timeline', 'mindmap', 'stat', 'flow', 'dodont', 'fact_grid'];

const SYSTEM = `You restructure Indian competitive-exam study notes into rich visual blocks for a mobile lesson app. CRITICAL RULES: preserve every fact exactly; only reorganize presentation; NEVER invent facts, dates, numbers or names not present in the input. Output STRICT valid JSON only, no prose, no markdown fences.`;

function userPrompt(topic, pages) {
  return `Topic: ${topic}

Concept pages (title :: notes):
${pages.map((p, i) => `${i + 1}. ${p.title} :: ${p.text}`).join('\n\n')}

Return JSON: {"pages":[{"title":<EXACT title>,"intro":<lead sentence, <=140 chars>,"blocks":[...]}],"quiz":[...]}

Choose the BEST block per page and VARY the type across pages (do not use one type everywhere):
- {"type":"table","headers":["","A","B"],"rows":[["r","a","b"]]}  (comparisons / A vs B; <=3 columns)
- {"type":"timeline","items":[{"label":"77th Amendment · 1995","value":"..."}]}  (dates / amendments / sequence)
- {"type":"fact_grid","items":[{"label":"term","value":"meaning"}]}  (term -> definition lists)
- {"type":"mindmap","center":"State","branches":[{"label":"X","value":"y"}]}  (types / categories)
- {"type":"stat","items":[{"value":"22","label":"official languages"}]}  (key numbers, <=3)
- {"type":"trap","text":"common mistake or exception"}
- {"type":"text","text":"remaining prose, kept short"}
Keep labels/values short. One or two blocks per page.

quiz: exactly one question PER concept page, in page order, UPSC-standard (statement-based / which-is-correct / which-is-NOT):
{"question":"...","options":["a","b","c","d"],"answer":<0-3 correct index>,"explanation":"one line"}`;
}

async function callOnce(topic, pages) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 150000); // never hang the whole run
  try {
    const res = await fetch('https://api.aiand.com/v1/chat/completions', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AIAND}` },
      body: JSON.stringify({
        model: MODEL, temperature: 0.3, max_tokens: 4000,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: userPrompt(topic, pages) }],
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
    const data = await res.json();
    let txt = data.choices?.[0]?.message?.content || '';
    txt = txt.replace(/^```json\s*|\s*```$/g, '').trim();
    const j = JSON.parse(txt);
    if (!Array.isArray(j.pages) || !Array.isArray(j.quiz)) throw new Error('bad shape');
    return j;
  } finally { clearTimeout(to); }
}
async function callLLM(topic, pages) {
  try { return await callOnce(topic, pages); }
  catch (e) { await new Promise((r) => setTimeout(r, 1500)); return await callOnce(topic, pages); }
}

function conceptPages(payload) {
  return (payload.lesson_pages || []).filter((pg) => pg.type !== 'overview').map((pg) => ({
    title: pg.title,
    text: (pg.intro || (pg.blocks || []).filter((b) => b.type === 'text').map((b) => b.text).join(' ') || '').slice(0, 1600),
  })).filter((p) => p.text.length > 40);
}

const log = (m) => { console.log(m); fs.appendFileSync('recovery/overnight-log.txt', m + '\n'); };

async function processRow(row) {
  const payload = typeof row.content_json === 'string' ? JSON.parse(row.content_json) : row.content_json;
  const already = (payload.lesson_pages || []).filter((pg) => pg.type !== 'overview').some((pg) => (pg.blocks || []).some((b) => RICH.includes(b.type)));
  if (already && !TEST) return 'skip';
  const cps = conceptPages(payload);
  if (cps.length < 2) return 'skip';

  const out = await callLLM(row.topic_title, cps);

  fs.mkdirSync('recovery/overnight-backup', { recursive: true });
  fs.writeFileSync(`recovery/overnight-backup/${row.track_id}-${row.day_number}.json`, JSON.stringify(payload));

  const byTitle = {}; out.pages.forEach((p) => (byTitle[String(p.title).trim()] = p));
  let changed = 0;
  (payload.lesson_pages || []).forEach((pg) => {
    const p = byTitle[String(pg.title).trim()];
    if (p && Array.isArray(p.blocks) && p.blocks.length) { pg.intro = p.intro || pg.intro; pg.blocks = p.blocks; changed++; }
  });
  if (Array.isArray(out.quiz) && out.quiz.length >= 2) {
    const q = out.quiz.map((x) => ({ ...x, correct_index: x.answer, correct_answer: (x.options || [])[x.answer] }));
    if (payload.quiz && Array.isArray(payload.quiz.questions)) payload.quiz.questions = q;
    else payload.quiz = { questions: q };
  }
  if (!changed) return 'nochange';
  const nj = typeof row.content_json === 'string' ? JSON.stringify(payload) : payload;
  const { error } = await sb.from('master_content_vault').update({ content_json: nj }).eq('id', row.id);
  if (error) throw new Error('db: ' + error.message);
  return 'ok';
}

async function main() {
  fs.mkdirSync('recovery', { recursive: true });
  if (TEST) {
    const { data } = await sb.from('master_content_vault').select('id, track_id, day_number, topic_title, content_json')
      .eq('track_id', 'upsc_ecosystem').eq('day_number', 5).maybeSingle();
    log('TEST day: ' + data.topic_title);
    await processRow(data); return;
  }
  const stats = { ok: 0, skip: 0, fail: 0 };
  for (const exam of EXAMS) {
    const { data } = await sb.from('master_content_vault').select('id, track_id, day_number, topic_title, content_json')
      .eq('track_id', exam).order('day_number');
    const ex = exam.replace('_ecosystem', '');
    for (const row of data || []) {
      process.stdout.write(`\n[${ex} D${row.day_number}] `);
      try {
        const r = await processRow(row);
        if (r === 'ok') { stats.ok++; process.stdout.write('OK'); log(`OK ${ex} D${row.day_number}`); }
        else { stats.skip++; process.stdout.write(String(r)); }
      } catch (e) {
        stats.fail++; process.stdout.write('FAIL'); log(`FAIL ${ex} D${row.day_number}: ${e.message}`);
      }
      await new Promise((r) => setTimeout(r, 500)); // gentle rate limit
    }
  }
  log(`\nDONE. ok=${stats.ok} skip=${stats.skip} fail=${stats.fail}`);
}
main();
