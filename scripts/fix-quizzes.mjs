// Quiz-only repair pass: for days whose quiz is the broken generic template
// ("key fact about X" / undefined answer), regenerate 5 real exam MCQs from the
// day's own content (blocks kept untouched). deepseek-v4-pro. Backups + log + resumable.
//   node --use-system-ca scripts/fix-quizzes.mjs --test
//   node --use-system-ca scripts/fix-quizzes.mjs
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
const log = (m) => { console.log(m); fs.appendFileSync('recovery/quizfix-log.txt', m + '\n'); };

function quizBroken(qs) {
  if (!Array.isArray(qs) || qs.length < 2) return true;
  return qs.some((q) => /key (fact|point) about|which is the key/i.test(String(q.question || '')) || typeof q.answer !== 'number' || !Array.isArray(q.options || q.choices));
}
function conceptText(payload) {
  return (payload.lesson_pages || []).filter((pg) => pg.type !== 'overview').map((pg) => {
    const parts = [String(pg.title)];
    for (const b of (pg.blocks || [])) {
      if (b.type === 'text' && b.text) parts.push(b.text);
      else if (b.items) parts.push(b.items.map((x) => (x.label || '') + ': ' + (x.value || x.detail || '')).join('; '));
      else if (b.rows) parts.push((b.headers || []).join(' | ') + ' :: ' + b.rows.map((r) => r.join(' | ')).join(' ;; '));
      else if (b.branches) parts.push(b.branches.map((x) => (x.label || '') + ': ' + (x.value || '')).join('; '));
      else if (b.text) parts.push(b.text);
    }
    if (pg.intro && !(pg.blocks || []).length) parts.push(pg.intro);
    return parts.join(' — ').slice(0, 700);
  });
}

async function genQuiz(topic, pages) {
  const sys = 'You write exam-standard multiple-choice questions for Indian competitive exams. Base every question ONLY on the provided content; never invent facts. Match the language of the content (English or Tamil). Output STRICT JSON only.';
  const usr = `Topic: ${topic}\n\nConcept pages:\n${pages.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n\nWrite exactly ${pages.length} questions, ONE per page in the same order, exam-standard (statement-based / which-is-correct / which-is-NOT). Return JSON: {"quiz":[{"question":"...","options":["a","b","c","d"],"answer":<0-3 correct index>,"explanation":"one line"}]}`;
  const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 120000);
  try {
    const res = await fetch('https://api.aiand.com/v1/chat/completions', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AIAND}` },
      body: JSON.stringify({ model: MODEL, temperature: 0.3, max_tokens: 3000, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: sys }, { role: 'user', content: usr }] }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    let txt = (data.choices?.[0]?.message?.content || '').replace(/^```json\s*|\s*```$/g, '').trim();
    const j = JSON.parse(txt);
    if (!Array.isArray(j.quiz) || j.quiz.length < 2) throw new Error('bad quiz');
    return j.quiz;
  } finally { clearTimeout(to); }
}

async function run() {
  fs.mkdirSync('recovery/quizfix-backup', { recursive: true });
  const stats = { ok: 0, skip: 0, fail: 0 };
  const targets = TEST ? [['upsc_ecosystem', 6]] : null;
  for (const exam of EXAMS) {
    if (targets && !targets.some((t) => t[0] === exam)) continue;
    const q = sb.from('master_content_vault').select('id, day_number, topic_title, content_json').eq('track_id', exam).order('day_number');
    const { data } = await q;
    for (const row of data || []) {
      if (targets && !targets.some((t) => t[1] === row.day_number)) continue;
      const payload = typeof row.content_json === 'string' ? JSON.parse(row.content_json) : row.content_json;
      const qs = payload.quiz?.questions || payload.quiz || [];
      if (!quizBroken(qs)) { stats.skip++; continue; }
      const pages = conceptText(payload);
      if (pages.length < 2) { stats.skip++; continue; }
      try {
        const quiz = await genQuiz(row.topic_title, pages);
        const norm = quiz.map((x) => ({ question: x.question, options: x.options, answer: x.answer, correct_index: x.answer, correct_answer: (x.options || [])[x.answer], explanation: x.explanation || '' }));
        if (TEST) { console.log(JSON.stringify(norm, null, 2).slice(0, 1500)); return; }
        fs.writeFileSync(`recovery/quizfix-backup/${exam}-${row.day_number}.json`, JSON.stringify(payload.quiz || []));
        if (payload.quiz && Array.isArray(payload.quiz.questions)) payload.quiz.questions = norm;
        else payload.quiz = { questions: norm };
        const nj = typeof row.content_json === 'string' ? JSON.stringify(payload) : payload;
        await sb.from('master_content_vault').update({ content_json: nj }).eq('id', row.id);
        stats.ok++; process.stdout.write(`\n[${exam.replace('_ecosystem', '')} D${row.day_number}] OK`); log(`OK ${exam.replace('_ecosystem', '')} D${row.day_number}`);
      } catch (e) { stats.fail++; process.stdout.write(`\n[${exam.replace('_ecosystem', '')} D${row.day_number}] FAIL ${e.message}`); log(`FAIL ${exam.replace('_ecosystem', '')} D${row.day_number}: ${e.message}`); }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  log(`\nDONE quizfix. ok=${stats.ok} skip=${stats.skip} fail=${stats.fail}`);
}
run();
