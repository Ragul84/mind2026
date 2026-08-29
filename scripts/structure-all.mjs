// Conservative auto-structuring pass for master_content_vault.
// Adds rich blocks (timeline / mind-map / comparison) ONLY when confidently
// detected; otherwise leaves the intro (which renders as points + chips).
// Facts are never changed — only re-shaped. DRY-RUN by default.
//
//   node --use-system-ca scripts/structure-all.mjs                # dry-run samples
//   node --use-system-ca scripts/structure-all.mjs --exam=upsc_ecosystem --apply
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = {};
for (const l of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const t = l.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('='); env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
}
const sb = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY || env.EXPO_PUBLIC_SUPABASE_ANON_KEY);

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const EXAM = (args.find((a) => a.startsWith('--exam=')) || '').split('=')[1];

const splitSentences = (t) => (String(t).replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) || []).map((s) => s.trim()).filter((s) => s.replace(/[^\w]/g, '').length > 1);

// --- Detectors (return a rich block + the sentence indices they consumed) ---

// Amendment timeline: "77th Amendment (1995) ... 10% ..." x>=2
function detectTimeline(sents) {
  const items = [], used = [];
  sents.forEach((s, i) => {
    const m = s.match(/(\d+(?:st|nd|rd|th)\s+Amendment)[^.]*?\(?(\d{4})\)?/i);
    if (m) {
      const detail = s.replace(/^.*?\d+(?:st|nd|rd|th)\s+Amendment[^,:]*[,:]?\s*/i, '').replace(/\(\d{4}\)/, '').trim();
      items.push({ label: `${m[1]} · ${m[2]}`, value: detail.slice(0, 120) });
      used.push(i);
    }
  });
  return items.length >= 2 ? { block: { type: 'timeline', items }, used } : null;
}

// Classification mind-map: "<X> includes/consists of/comprises A, B, C[, D]"
function detectMindmap(sents) {
  for (let i = 0; i < sents.length; i++) {
    const s = sents[i];
    const m = s.match(/^(.{4,60}?)\b(?:includes?|consists?\s+of|comprises?|are|namely)\b\s*:?\s*(.+)$/i);
    if (!m) continue;
    const items = m[2].split(/,\s*|\s+and\s+/i).map((x) => x.replace(/^(?:the|all|other)\s+/i, '').replace(/[.;].*$/, '').trim())
      .filter((x) => x.length >= 2 && x.split(/\s+/).length <= 4 && !/\b(is|are|which|that|means)\b/i.test(x));
    if (items.length >= 3 && items.length <= 6) {
      const center = m[1].replace(/\b(the|a|an|of)\b/gi, '').trim() || 'Types';
      return { block: { type: 'mindmap', center: center.slice(0, 32), branches: items.map((x) => ({ label: x.slice(0, 28) })) }, used: [i] };
    }
  }
  return null;
}

function structurePage(pg) {
  if (!pg || pg.type === 'overview') return null;
  const intro = pg.intro || (pg.blocks || []).filter((b) => b.type === 'text').map((b) => b.text).join(' ');
  if (!intro || String(intro).length < 40) return null;
  // Skip pages we've already hand-authored into rich blocks.
  if ((pg.blocks || []).some((b) => ['table', 'timeline', 'mindmap', 'stat', 'flow', 'dodont', 'fact_grid'].includes(b.type))) return null;

  const sents = splitSentences(intro);
  const extra = [];
  const consumed = new Set();
  for (const det of [detectTimeline, detectMindmap]) {
    const r = det(sents);
    if (r) { extra.push(r.block); r.used.forEach((u) => consumed.add(u)); }
  }
  if (!extra.length) return null;
  const remaining = sents.filter((_, i) => !consumed.has(i)).join(' ');
  return { intro: remaining, extraBlocks: extra, formats: extra.map((b) => b.type) };
}

async function run() {
  let rows;
  if (APPLY && EXAM) {
    ({ data: rows } = await sb.from('master_content_vault').select('id, track_id, day_number, content_json').eq('track_id', EXAM).order('day_number'));
  } else {
    // dry-run sample: a few days from each track
    const samples = [];
    for (const trk of ['upsc_ecosystem', 'tnpsc_ecosystem', 'ssc_ecosystem']) {
      const { data } = await sb.from('master_content_vault').select('id, track_id, day_number, content_json').eq('track_id', trk).in('day_number', [5, 10, 20, 30]).order('day_number');
      (data || []).forEach((r) => samples.push(r));
    }
    rows = samples;
  }
  const counts = {}; let pagesTouched = 0, daysTouched = 0;
  for (const row of rows || []) {
    const payload = typeof row.content_json === 'string' ? JSON.parse(row.content_json) : row.content_json;
    let dayHit = false;
    (payload.lesson_pages || []).forEach((pg) => {
      const r = structurePage(pg);
      if (!r) return;
      dayHit = true; pagesTouched++;
      r.formats.forEach((f) => (counts[f] = (counts[f] || 0) + 1));
      if (!APPLY) console.log(`${row.track_id.replace('_ecosystem', '')} D${row.day_number} · ${String(pg.title).slice(0, 34)} -> ${r.formats.join(', ')}`);
      if (APPLY) { pg.intro = r.intro; pg.blocks = [...r.extraBlocks, ...(pg.blocks || [])]; }
    });
    if (dayHit) daysTouched++;
    if (APPLY && dayHit) {
      const nj = typeof row.content_json === 'string' ? JSON.stringify(payload) : payload;
      await sb.from('master_content_vault').update({ content_json: nj }).eq('id', row.id);
    }
  }
  console.log(`\n${APPLY ? 'APPLIED' : 'DRY-RUN'}: ${daysTouched} days, ${pagesTouched} pages got a rich block. Formats: ${JSON.stringify(counts)}`);
}
run();
