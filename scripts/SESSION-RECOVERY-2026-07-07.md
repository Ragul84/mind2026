# Session Recovery — 2026-07-07 (pendrive D: disconnected)

The D: pendrive (working copy of the project) physically disconnected mid-session.
**Nothing irreplaceable was lost.** This file records the full state so you can
rebuild / re-verify everything from `C:\mindwhite`.

## ✅ Safe in the cloud (independent of the pendrive)
- **Supabase `textbook_chunks`: ~64,246 rows** = 59,010 English + 5,236 Tamil + 184 (last Tamil book) ≈ **5,420 Tamil**, all embedded (openai/text-embedding-3-small, 1536-dim). MIGA answers from these NOW.
- **All `miga_stream` edits are DEPLOYED** to Supabase project `yuntwerxahgmaoduxvqc`. The running function is the corrected one. Only the *source file* with the edits was on the pendrive (C:\mindwhite has an OLDER index.ts — re-apply the edits below when you recover D: or before the next deploy).
- Migration `supabase/migrations/20260706000000_textbook_chunks.sql` (table + `match_textbook_chunks` RPC, `filter_language` default 'english') is applied in the cloud.

## Scripts recreated into C:\mindwhite\scripts (this file's siblings)
- `ask-miga.mjs` — direct test harness (grounding preview + real miga_stream call). Language-aware preview, --file, --out (UTF-8).
- `textbook-embed.mjs` — embed English (`--apply --all-subjects`) or Tamil (`--apply --tamil-ocr`). Tamil uses batch=12 / 2500-char cap (token limits) + retry-on-no-data.
- `textbook-clean-inspect.mjs` — `cleanChunkText()` (reconstructed; only needed to re-embed English from raw).
- `textbook-dedupe.mjs` — exact-content dedupe keyed on (class_level + md5), preserves cross-class.
- `textbook-fix-subject-labels.mjs` — relabel 3 Samacheer social-science books mis-tagged 'science'.
- `tamil-ocr.py` — Gemini 2.5 Flash OCR (WORKERS=4). Raw PDFs were at D:/edu4bharat/raw/samacheer.
- Test files: `benchmark-full.txt`, `test-tamil.txt`, `test-negative.txt`, `test-routing.txt`.

Run all via **PowerShell** `node --use-system-ca scripts/<x>.mjs` (Git Bash gets ECONNRESET from the TLS middlebox).

## miga_stream edits made this session (deployed; re-apply to source when D: is back)
All in `supabase/functions/miga_stream/index.ts`. Deploy with `npx supabase functions deploy miga_stream --use-api` (no Docker needed).

1. **Retrieval re-rank + language filter** — in `buildServerTextbookTextContext`, the RPC call:
   - `match_count: 12` (was 6); then a lexical re-rank blending cosine + query-keyword overlap (`+0.02 * min(hits,4)`), take top 6.
   - **`filter_language: /[஀-௿]/.test(prompt) ? 'tamil' : 'english'`** — CRITICAL: the RPC defaults to english-only, so without this Tamil chunks are unreachable.
   - Add a `CITATION RULE` line to the VERIFIED_TEXTBOOK_TEXT block: attach a Ref only to facts a passage actually states; never invent a page/section/annexure.
2. **Citation hardening (chat system prompt)** — the "(Ref: source)" bullet: attach a Ref ONLY when the claim is in a supplied PASSAGE; copy that passage's Ref verbatim; never construct/guess/reuse; if from own knowledge, no Ref.
3. **Authority guardrail** (after the legal-history bullet): don't name a specific body/commission unless certain; **delimitation = Delimitation Commission + ECI, NOT State Election Commissions**. Plus: be conservative on implementation specifics for post-textbook facts.
4. **Date anchor** (chat prompt, after USER_NAME): `TODAY'S DATE: ${getIndiaDateKey()} (IST). Treat this as current; anything on/before today has happened.`
5. **Answer-first web fallback**:
   - New regex `DOC_HINT_RE` (budget/economic survey/scheme/policy/latest/current/pib/...).
   - Removed the hard `"couldn't load current affairs packet"` refusal (fall through to web).
   - `wantsWebFallback = mode==='chat' && !attachments && !brand && !quiz && (wantsCurrentAffairs || DOC_HINT_RE.test(lastUserText) || (wantsExactCitation && !exactCitationEvidence))`.
   - Rewrote `exactCitationNote`: if web fallback, "search web + cite the real source"; else give substance + at most one "couldn't verify" line, never fabricate a number.
   - Payload: `...(wantsWebFallback ? { plugins: [{ id: "web", max_results: 3 }] } : {})`.
6. **PYQ false-trigger fix** — `STRONG_PYQ_RE = /\b(pyqs?|previous\s+year|past\s+year|year\s+question)\b/i`; `wantsPyq = !brand && PYQ_HINT_RE.test(text) && (STRONG_PYQ_RE.test(text) || !CONCEPT_QUESTION_RE.test(text))` — stops "explain … asked in prelims" being hijacked to a PYQ dump.
7. **PYQ topic-match fix** — in `buildServerPyqContext`, only broaden to recent PYQs when `!hasTopicSignal` (no subjectHint, no alias, no promptWords); a named-but-unmatched topic returns honest-fewer / NO_VERIFIED_PYQ_MATCH instead of off-topic recent PYQs.

## Proof-test result (scaled, 2026-07-07)
English audit 11/12 (one one-off empty answer, not a bug), Negative 8/8 (no fabricated refs), Routing 4/4, Tamil 10/10 (after the language-filter fix). See `benchmark-full.txt` / `test-tamil.txt` to re-run.

## Open backlog (non-blocking)
- NCERT Class 11 Fine Arts ("An Introduction to Indian Art", kefa101–kefa108.pdf at ncert.nic.in) — download + embed. Was mid-download when D: dropped.
- PYQ oracle fine-topic precision (topic-entity extraction + strict keyword filter on the ilike path).
- Classes 6–7 Samacheer Tamil intentionally skipped (not exam-relevant).

## FIRST THING when D: is recovered
Copy D:\mindwhite to C: (or push to a NEW GitHub remote) so there is a real backup. Do not run off a single pendrive again.
