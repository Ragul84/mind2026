// Targeted subject-label fix: Samacheer SOCIAL SCIENCE books (class 8/9/10) whose
// mangled source_id dropped "social" were tagged subject='science'. Only rows whose
// source_id literally contains "social" but subject != social-science are relabelled.
// (A broad re-derivation corrupts correct labels — do NOT do it.)
//
//   node --use-system-ca scripts/textbook-fix-subject-labels.mjs           # dry run
//   node --use-system-ca scripts/textbook-fix-subject-labels.mjs --apply

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const ROOT = process.cwd();
const APPLY = process.argv.includes('--apply');
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
const sb = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function updateIds(ids, attempt = 0) {
  const { error } = await sb.from('textbook_chunks').update({ subject: 'social-science' }).in('id', ids);
  if (error) {
    if (attempt < 4 && /timeout|canceling statement|fetch failed|ECONNRESET|network/i.test(String(error.message))) {
      await sleep(Math.min(1500 * 2 ** attempt, 12000)); return updateIds(ids, attempt + 1);
    }
    throw error;
  }
}

async function main() {
  let from = 0;
  const subjById = new Map();
  while (true) {
    const { data, error } = await sb.from('textbook_chunks').select('source_id,subject').order('id', { ascending: true }).range(from, from + 999);
    if (error) { console.error(error.message); process.exit(1); }
    for (const r of data) if (!subjById.has(r.source_id)) subjById.set(r.source_id, r.subject);
    if (data.length < 1000) break; from += 1000;
  }
  const targets = [];
  for (const [sid, subj] of subjById) {
    const isSocial = /social/.test(sid.toLowerCase());
    const already = String(subj || '').toLowerCase().replace(/\s+/g, '-') === 'social-science';
    if (isSocial && !already) targets.push(sid);
  }
  console.log(`source_ids to relabel -> social-science: ${targets.length}`);
  targets.forEach((s) => console.log(`  ${s}`));
  if (!APPLY) { console.log('\nDRY RUN — re-run with --apply.'); return; }
  let updated = 0;
  for (const sid of targets) {
    const ids = []; let f = 0;
    while (true) {
      const { data, error } = await sb.from('textbook_chunks').select('id').eq('source_id', sid).range(f, f + 999);
      if (error) { console.error(`  ${sid} select: ${error.message}`); break; }
      data.forEach((r) => ids.push(r.id));
      if (data.length < 1000) break; f += 1000;
    }
    let n = 0;
    for (let i = 0; i < ids.length; i += 50) {
      try { await updateIds(ids.slice(i, i + 50)); n += Math.min(50, ids.length - i); } catch (e) { console.error(`  ${sid} @${i}: ${e.message}`); }
    }
    updated += n; console.log(`  updated ${sid} (${n}/${ids.length} rows)`);
  }
  console.log(`\nDONE. relabelled ${updated} rows across ${targets.length} sources.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
