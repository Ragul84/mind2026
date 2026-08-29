// Embed English + Tamil textbook chunks into public.textbook_chunks.
// English source: data/textbook-release-corpus/<src>/chunks.jsonl
// Tamil source (--tamil-ocr): data/textbook-tamil-ocr/<src>/chunks.jsonl
//
// SAFE by default: dry-run prints counts + cost, no writes. Add --apply.
// Resumable (skips ids already in DB).
//
//   node --use-system-ca scripts/textbook-embed.mjs                        # dry run (polity pilot)
//   node --use-system-ca scripts/textbook-embed.mjs --apply --all-subjects # all English
//   node --use-system-ca scripts/textbook-embed.mjs --apply --tamil-ocr    # all Tamil
//
// Run via PowerShell `node --use-system-ca` (TLS middlebox).

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { cleanChunkText } from './textbook-clean-inspect.mjs';

const ROOT = process.cwd();
const CORPUS = path.join(ROOT, 'data', 'textbook-release-corpus');
const TAMIL_DIR = path.join(ROOT, 'data', 'textbook-tamil-ocr');
const APPLY = process.argv.includes('--apply');
const ALL_SUBJECTS = process.argv.includes('--all-subjects');
const TAMIL_OCR = process.argv.includes('--tamil-ocr');
// Optional: only process source_ids containing this substring (e.g. --match=fine-arts).
const MATCH = (process.argv.find((a) => a.startsWith('--match=')) || '').split('=')[1] || null;
const EMBED_MODEL = 'openai/text-embedding-3-small'; // 1536 dims, via OpenRouter
const KEEP_TYPES = new Set(['lesson_content', 'bookback_exercise', 'activity', 'summary']);

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
const OR_KEY = env.OPENROUTER_API_KEY || (env.OPENROUTER_API_KEYS || '').split(',')[0].trim();
const EMBED_MODEL_ENV = env.OPENROUTER_EMBEDDING_MODEL || EMBED_MODEL;
const sb = createClient(
  env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const isEnglish = (name) => !/-tamil-|-hi-chapter-|-(hindi)-/.test(name) && !name.endsWith('-tamil-book-pdf');
const isPolityPilot = (name) =>
  /^samacheer-class-1[12]-political-science-english-book-pdf$/.test(name) ||
  /^ncert-class-11-political-science-india-constitution-at-work-en-chapter-\d+-pdf$/.test(name) ||
  /^ncert-class-12-political-science-politics-in-india-since-independence-en-chapter-\d+-pdf$/.test(name);

function listSources() {
  if (TAMIL_OCR) {
    if (!fs.existsSync(TAMIL_DIR)) return [];
    return fs.readdirSync(TAMIL_DIR).filter((n) => fs.existsSync(path.join(TAMIL_DIR, n, 'chunks.jsonl'))).sort();
  }
  return fs.readdirSync(CORPUS)
    .filter((n) => fs.existsSync(path.join(CORPUS, n, 'chunks.jsonl')))
    .filter(isEnglish)
    .filter((n) => MATCH ? n.includes(MATCH) : (ALL_SUBJECTS ? true : isPolityPilot(n)))
    .sort();
}

// Tamil OCR chunks are already clean (Gemini) — no cleanChunkText, tag language='tamil'.
function readTamilChunks(src) {
  const file = path.join(TAMIL_DIR, src, 'chunks.jsonl');
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    const content = String(r.text || '').replace(/\s+/g, ' ').trim();
    if (content.length < 40) continue;
    out.push({
      id: r.chunk_id || `${src}:${out.length}`,
      source_id: r.source_id || src, board: 'samacheer', class_level: r.class_level ?? null,
      subject: r.subject || null, chapter: r.chapter || null, language: 'tamil',
      chunk_type: r.chunk_type || 'lesson_content', content, token_count: Math.round(content.length / 4),
    });
  }
  return out;
}

function readChunks(src) {
  if (TAMIL_OCR) return readTamilChunks(src);
  const file = path.join(CORPUS, src, 'chunks.jsonl');
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (!KEEP_TYPES.has(r.chunk_type)) continue;
    const content = cleanChunkText(r.text || '');
    if (content.length < 40) continue;
    out.push({
      id: r.chunk_id || `${r.source_id || src}:${out.length}`,
      source_id: r.source_id || src,
      board: r.board || (src.startsWith('samacheer') ? 'samacheer' : 'ncert'),
      class_level: r.class_level ?? null, subject: r.subject || null, chapter: r.chapter || null,
      language: 'english', chunk_type: r.chunk_type, content, token_count: Math.round(content.length / 4),
    });
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function upsertRows(rows, attempt = 0) {
  const { error } = await sb.from('textbook_chunks').upsert(rows, { onConflict: 'id' });
  if (error) {
    if (attempt < 4 && /timeout|timed out|canceling statement|fetch failed|ECONNRESET|network/i.test(String(error.message))) {
      await sleep(Math.min(1500 * 2 ** attempt, 15000)); return upsertRows(rows, attempt + 1);
    }
    throw error;
  }
}

async function embedBatch(inputs, attempt = 0) {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OR_KEY}` },
      body: JSON.stringify({ model: EMBED_MODEL_ENV, input: inputs }),
    });
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 5) throw new Error(`OpenRouter ${res.status} after retries`);
      await sleep(Math.min(2000 * 2 ** attempt, 30000)); return embedBatch(inputs, attempt + 1);
    }
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = await res.json();
    // Some 200 responses come back without `data` (transient hiccup) — retry.
    if (!json?.data || !Array.isArray(json.data)) {
      if (attempt < 5) { await sleep(Math.min(2000 * 2 ** attempt, 30000)); return embedBatch(inputs, attempt + 1); }
      throw new Error(`OpenRouter no data after retries: ${JSON.stringify(json).slice(0, 200)}`);
    }
    return json.data.map((d) => d.embedding);
  } catch (e) {
    if (attempt < 5 && /ECONNRESET|fetch failed|network|timeout/i.test(String(e.message))) {
      await sleep(Math.min(2000 * 2 ** attempt, 30000)); return embedBatch(inputs, attempt + 1);
    }
    throw e;
  }
}

async function existingIds(sourceIds) {
  const set = new Set();
  for (const sid of sourceIds) {
    let from = 0;
    while (true) {
      const { data, error } = await sb.from('textbook_chunks').select('id').eq('source_id', sid).range(from, from + 999);
      if (error) { if (error.message.includes('does not exist')) { console.error('\n! Table missing — apply the migration first.\n'); process.exit(1); } throw error; }
      data.forEach((r) => set.add(r.id));
      if (data.length < 1000) break; from += 1000;
    }
  }
  return set;
}

async function main() {
  if (!OR_KEY) { console.error('Missing OPENROUTER_API_KEY'); process.exit(1); }
  const sources = listSources();
  let all = [];
  for (const src of sources) all = all.concat(readChunks(src));
  const totalTokens = all.reduce((s, c) => s + c.token_count, 0);
  const cost = (totalTokens / 1e6) * 0.02;
  console.log(`Scope: ${TAMIL_OCR ? 'TAMIL OCR' : (ALL_SUBJECTS ? 'ALL English subjects' : 'polity pilot')} | sources: ${sources.length}`);
  console.log(`Answerable chunks: ${all.length} | ~${totalTokens.toLocaleString()} tokens | est. embed cost ~$${cost.toFixed(3)}`);
  if (!APPLY) { const byBoard = {}; all.forEach((c) => { byBoard[c.board] = (byBoard[c.board] || 0) + 1; }); console.log('By board:', byBoard); console.log('\nDRY RUN — re-run with --apply.'); return; }

  const have = await existingIds([...new Set(all.map((c) => c.source_id))]);
  const pending = all.filter((c) => !have.has(c.id));
  console.log(`Already embedded: ${have.size} | pending: ${pending.length}`);

  let done = 0, failed = 0;
  // Tamil is ~3 tokens/char; use a small batch + tight char cap to stay under the
  // embedding API's 8192-per-input and 300k-per-request token limits.
  const BATCH = TAMIL_OCR ? 12 : 96;
  const MAXCHARS = TAMIL_OCR ? 2500 : 8000;
  const UPSERT = 20;
  for (let i = 0; i < pending.length; i += BATCH) {
    const slice = pending.slice(i, i + BATCH);
    let vectors;
    try { vectors = await embedBatch(slice.map((c) => c.content.slice(0, MAXCHARS))); }
    catch (e) { failed += slice.length; console.error(`  embed @${i} failed: ${e.message}`); continue; }
    const rows = slice.map((c, k) => ({ ...c, embedding: vectors[k] }));
    for (let j = 0; j < rows.length; j += UPSERT) {
      const sub = rows.slice(j, j + UPSERT);
      try { await upsertRows(sub); done += sub.length; } catch (e) { failed += sub.length; console.error(`  upsert @${i}+${j} failed: ${e.message}`); }
    }
    if ((i / BATCH) % 5 === 0) console.log(`  …embedded ${done}/${pending.length} (failed ${failed})`);
  }
  console.log(`\nDONE. Embedded: ${done} | failed: ${failed}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
