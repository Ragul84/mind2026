#!/usr/bin/env node
// Ingest one textbook PDF through the textbook-ingest edge function, in page ranges.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... TEXTBOOK_INGEST_TOKEN=... \
//   node scripts/ingest-textbook.mjs scripts/textbooks/ncert-10-science-en.json
//
// The manifest JSON = the function body minus page_from/page_to, plus optional
// "pages_per_call" (default 25) and "total_pages" (if known; otherwise the first
// call reports it). Secrets are read from env and never printed.

import { readFileSync } from 'node:fs';

const [, , manifestPath] = process.argv;
if (!manifestPath) { console.error('Usage: node scripts/ingest-textbook.mjs <manifest.json>'); process.exit(1); }
const { SUPABASE_URL, SUPABASE_ANON_KEY, TEXTBOOK_INGEST_TOKEN } = process.env;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !TEXTBOOK_INGEST_TOKEN) {
  console.error('Set SUPABASE_URL, SUPABASE_ANON_KEY and TEXTBOOK_INGEST_TOKEN in the environment.');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const step = Number(manifest.pages_per_call) || 25;
const offset = Number(manifest.page_offset) || 0;
let total = Number(manifest.total_pages) || 0;

async function call(from, to, markReady) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/textbook-ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      apikey: SUPABASE_ANON_KEY,
      'x-ingest-token': TEXTBOOK_INGEST_TOKEN,
    },
    body: JSON.stringify({ ...manifest, page_from: from, page_to: to, mark_ready: markReady }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(`pages ${from}-${to}: ${data.error || res.status}`);
  return data;
}

let from = 1;
while (true) {
  const to = from + step - 1;
  const last = total > 0 && to >= total - offset;
  const r = await call(from, to, last);
  total = total || Number(r.total_pages) || 0;
  console.log(`${manifest.book.slug}: pages ${from}-${to} -> ${r.chunks_upserted} chunks${r.ready ? ' (ready)' : ''}`);
  if (r.ready || to >= total - offset) {
    if (!r.ready) await call(total + 1, total + 1, true); // empty range: just marks the book ready
    break;
  }
  from += step;
}
console.log('Done.');
