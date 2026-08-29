// Remove exact-content duplicate chunks from public.textbook_chunks.
// Key = (class_level + md5(content)) — only merges WITHIN the same class, so the
// same topic taught in different classes is always preserved. Keeps lowest id.
//
//   node --use-system-ca scripts/textbook-dedupe.mjs --lang=english          # dry run
//   node --use-system-ca scripts/textbook-dedupe.mjs --lang=english --apply

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const ROOT = process.cwd();
const APPLY = process.argv.includes('--apply');
const LANG = (process.argv.find((a) => a.startsWith('--lang=')) || '').split('=')[1] || null;

function loadEnv() {
  const env = {};
  for (const f of ['.env.local', '.env']) {
    const p = path.join(ROOT, f); if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
      const i = t.indexOf('='); env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
    }
  }
  return env;
}
const env = loadEnv();
const sb = createClient(env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function deleteIds(ids, attempt = 0) {
  const { error } = await sb.from('textbook_chunks').delete().in('id', ids);
  if (error) {
    if (attempt < 4 && /timeout|canceling statement|fetch failed|ECONNRESET|network/i.test(String(error.message))) {
      await sleep(Math.min(1500 * 2 ** attempt, 15000)); return deleteIds(ids, attempt + 1);
    }
    throw error;
  }
}

async function main() {
  let from = 0;
  const groups = new Map();
  let total = 0;
  while (true) {
    let q = sb.from('textbook_chunks').select('id,class_level,source_id,content').order('id', { ascending: true }).range(from, from + 999);
    if (LANG) q = q.eq('language', LANG);
    const { data, error } = await q;
    if (error) throw error;
    for (const r of data) {
      total++;
      const h = crypto.createHash('md5').update((r.content || '').trim()).digest('hex');
      const key = `${r.class_level}|${h}`;
      if (!groups.has(key)) { groups.set(key, { keep: r.id, drop: [] }); }
      else { const g = groups.get(key); if (r.id < g.keep) { g.drop.push(g.keep); g.keep = r.id; } else g.drop.push(r.id); }
    }
    if (data.length < 1000) break; from += 1000;
  }
  const toDelete = [];
  let affected = 0;
  for (const g of groups.values()) if (g.drop.length) { affected++; toDelete.push(...g.drop); }
  console.log(`Rows scanned: ${total} | distinct (class+content): ${groups.size}`);
  console.log(`Duplicate groups: ${affected} | extra rows to delete: ${toDelete.length}`);
  if (!APPLY) { console.log('\nDRY RUN — re-run with --apply. Cross-class recurrence preserved by construction.'); return; }
  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += 100) {
    const batch = toDelete.slice(i, i + 100);
    try { await deleteIds(batch); deleted += batch.length; } catch (e) { console.error(`  delete @${i} failed: ${e.message}`); }
  }
  console.log(`\nDONE. Deleted ${deleted} duplicate rows.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
