// Rebuild daily-mission quizzes as REAL multiple-choice questions derived from
// the (clean) flashcards already on each row — so lessons, cards and quizzes
// all stay consistent. Each question: natural stem, 4 options (correct + 3
// plausible distractors from sibling cards), answer_index, explanation.
// Deterministic (stable across re-runs). Backs up to scratch/ first.
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const supabase = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const DRY_RUN = process.argv.includes('--dry-run');

function clean(v) { return String(v || '').replace(/\s+/g, ' ').trim(); }
function parsePayload(raw) { if (!raw) return {}; if (typeof raw === 'string') { try { return JSON.parse(raw); } catch { return {}; } } return raw; }

// "The subject of Schedule 4" -> "What is the subject of Schedule 4?"
function toQuestion(front) {
  let s = clean(front).replace(/[?.]+$/, '');
  if (!s) return '';
  if (/^the\s/i.test(s)) return `What is ${s.charAt(0).toLowerCase()}${s.slice(1)}?`;
  if (/^which|^what|^who|^when|^where|^how/i.test(s)) return `${s}?`;
  return `${s}?`;
}

// Simple deterministic hash for stable distractor choice / option placement.
function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return Math.abs(h); }

function buildQuestions(cards) {
  const usable = cards
    .filter((c) => c && c.front && c.back)
    .map((c) => ({ front: clean(c.front), back: clean(c.back), source: c.source || '' }))
    .filter((c) => c.back.length <= 120 && c.front.length <= 110);

  // Distinct answers pool for distractors.
  const allBacks = [...new Set(usable.map((c) => c.back))];
  if (allBacks.length < 4) return [];

  const out = [];
  const seenStems = new Set();

  usable.forEach((card, idx) => {
    const stem = toQuestion(card.front);
    if (!stem || seenStems.has(stem)) return;

    // Distractors: prefer same-source backs, then any; deterministic pick.
    const sameSource = usable.filter((c) => c.source === card.source && c.back !== card.back).map((c) => c.back);
    const others = allBacks.filter((b) => b !== card.back);
    const pool = [...new Set([...sameSource, ...others])];
    if (pool.length < 3) return;

    const ranked = pool
      .map((b) => ({ b, k: hash(b + stem) }))
      .sort((a, z) => a.k - z.k)
      .map((x) => x.b);
    const distractors = ranked.slice(0, 3);

    const options = [card.back, ...distractors];
    // Deterministic placement of the correct answer.
    const answerPos = hash(stem) % 4;
    const tmp = options[0]; options[0] = options[answerPos]; options[answerPos] = tmp;

    seenStems.add(stem);
    out.push({
      question: stem,
      options,
      answer_index: answerPos,
      explanation: `${card.front.replace(/[?.]+$/, '')}: ${card.back}.`.replace(/\.\.$/, '.'),
      source: 'generated_from_study_cards',
    });
  });

  return out.slice(0, 10);
}

async function main() {
  const { data, error } = await supabase
    .from('master_content_vault')
    .select('track_id, day_number, content_json')
    .in('track_id', ['upsc_ecosystem', 'tnpsc_ecosystem', 'ssc_ecosystem'])
    .order('track_id').order('day_number');
  if (error) throw error;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(path.resolve(__dirname, `../scratch/daily-mission-before-quizzes-${stamp}.json`), JSON.stringify(data));

  let changed = 0, empty = 0;
  for (const row of data) {
    const payload = parsePayload(row.content_json);
    const questions = buildQuestions(payload.flashcards || []);
    if (questions.length < 4) { empty++; continue; }
    const nextPayload = { ...payload, quiz: { ...(payload.quiz || {}), questions } };
    changed++;
    if (!DRY_RUN) {
      const { error: e } = await supabase.from('master_content_vault')
        .update({ content_json: nextPayload, updated_at: new Date().toISOString() })
        .eq('track_id', row.track_id).eq('day_number', row.day_number);
      if (e) throw e;
    }
  }
  console.log(JSON.stringify({ dryRun: DRY_RUN, rows: data.length, changed, empty }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
