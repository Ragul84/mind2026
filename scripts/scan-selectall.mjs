// Verify the select-all exercise can NEVER show a heading-like / truncated /
// odd-length option on ANY day of ANY exam. Mirrors the exact deriveExercise
// logic in app/daily-mission/reader.tsx and asserts every generated option is
// clean. Reports both what the OLD logic would have shown and what the NEW
// logic shows, so we can see the bug is gone everywhere.
//   node --use-system-ca scripts/scan-selectall.mjs
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
const env = {};
for (const l of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const t = l.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('='); env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
}
const sb = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY || env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
const EXAMS = ['upsc_ecosystem', 'tnpsc_ecosystem', 'ssc_ecosystem'];

// mirror cleanDisplayCell (strip markdown emphasis, collapse whitespace)
const clean = (s) => String(s ?? '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();

function pagesOf(payload) {
  return (payload.lesson_pages || []).filter((pg) => pg.type !== 'overview');
}
function mindmapOf(blocks) {
  return (blocks || []).find((b) => (b.type === 'mindmap' || b.type === 'branch') && Array.isArray(b.branches) && b.branches.length >= 3 && b.branches.length <= 5);
}

// OLD logic: slice(0,30), any other-page label allowed
function oldOptions(page, pages, mm) {
  const correct = mm.branches.map((x) => clean(x.label).slice(0, 30)).filter((s) => s.length > 1);
  const pool = [];
  pages.forEach((pg) => { if (pg === page) return; (pg.blocks || []).forEach((b) => (b.branches || b.items || []).forEach((x) => {
    const l = clean(x.label).slice(0, 30); if (l.length > 1 && correct.indexOf(l) < 0 && pool.indexOf(l) < 0) pool.push(l);
  })); });
  return { correct, pool };
}
// NEW logic: correct AND distractors must all be clean; else no select-all at all
const clumsy = (s) => !s || s.length <= 1 || s.length > 30 || /^(art|article)\b/i.test(s) || s.includes(':');
function newOptions(page, pages, mm) {
  const correct = mm.branches.map((x) => clean(x.label));
  if (!(correct.every((s) => !clumsy(s)) && correct.length >= 3)) return null; // select-all skipped -> MCQ
  const maxLen = Math.max(16, ...correct.map((s) => s.length));
  const pool = [];
  pages.forEach((pg) => { if (pg === page) return; (pg.blocks || []).forEach((b) => (b.branches || b.items || []).forEach((x) => {
    const l = clean(x.label); if (!clumsy(l) && l.length <= maxLen + 4 && correct.indexOf(l) < 0 && pool.indexOf(l) < 0) pool.push(l);
  })); });
  if (pool.length < 1) return null;
  return { correct, pool };
}
// what a rendered option should never look like
const isBadOption = (s) => /^(art|article)\b/i.test(s) || s.includes(':') || s.length > 34 || /\bdis$|\bof$|\bthe$|\band$/i.test(s);

let scanned = 0, selectallPages = 0, oldBad = 0, newBad = 0;
const oldBadSamples = [], newBadSamples = [];

for (const exam of EXAMS) {
  const { data } = await sb.from('master_content_vault').select('day_number, content_json').eq('track_id', exam).order('day_number');
  for (const row of data || []) {
    scanned++;
    const payload = typeof row.content_json === 'string' ? JSON.parse(row.content_json) : row.content_json;
    const pages = pagesOf(payload);
    for (const pg of pages) {
      const mm = mindmapOf(pg.blocks);
      if (!mm) continue;
      selectallPages++;
      const oldR = oldOptions(pg, pages, mm);
      if (oldR.correct.length >= 3 && oldR.pool.length >= 1) {
        const opts = [...oldR.correct, ...oldR.pool.slice(0, 2)];
        const bad = opts.filter(isBadOption);
        if (bad.length) { oldBad++; if (oldBadSamples.length < 12) oldBadSamples.push(`${exam.replace('_ecosystem','')} D${row.day_number} "${clean(mm.center)}": [${bad.join(' | ')}]`); }
      }
      const newR = newOptions(pg, pages, mm);
      if (newR) {
        // NEW picks 2 random distractors from pool; test the WHOLE pool + correct (worst case any could show)
        const opts = [...newR.correct, ...newR.pool];
        const bad = opts.filter(isBadOption);
        if (bad.length) { newBad++; if (newBadSamples.length < 12) newBadSamples.push(`${exam.replace('_ecosystem','')} D${row.day_number} "${clean(mm.center)}": [${bad.join(' | ')}]`); }
      }
    }
  }
}

console.log(`\nScanned ${scanned} days across ${EXAMS.length} exams.`);
console.log(`Select-all-capable pages: ${selectallPages}`);
console.log(`\nOLD logic would have shown a bad option on ${oldBad} page(s):`);
oldBadSamples.forEach((s) => console.log('  - ' + s));
console.log(`\nNEW logic bad-option pages: ${newBad}`);
if (newBad === 0) console.log('  ✓ CLEAN — no heading-like / truncated / odd option can appear on any day.');
else newBadSamples.forEach((s) => console.log('  ✗ ' + s));
