// Textbook ingestion: PDF -> pages -> chunks -> gte-small embeddings -> textbook_page_chunks.
//
// Admin-only. Requires header `x-ingest-token` equal to the TEXTBOOK_INGEST_TOKEN secret.
// Edge functions have a wall-clock limit, so large books are ingested in page
// ranges (page_from / page_to). scripts/ingest-textbook.mjs loops the ranges.
//
// POST body:
// {
//   "book": { "slug": "ncert-10-science-en", "board": "ncert", "board_type": "ncert",
//             "state_code": null, "class_level": 10, "subject": "science",
//             "language": "english", "title": "Science", "source_url": "https://ncert.nic.in/..." },
//   "pdf_url": "https://.../book.pdf",          // or "pdf_base64", or "pages": [{ "page": 1, "text": "..." }]
//   "chapters": [{ "number": 1, "title": "Chemical Reactions and Equations", "page_start": 1, "page_end": 18 }],
//   "page_offset": 0,       // printed page = PDF page index - page_offset
//   "page_from": 1, "page_to": 40,
//   "replace": false        // true = delete this book's chunks in the range first
// }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { embedText } from "../_shared/textbookRetrieval.ts";
import { chunkPage } from "../_shared/textbookChunking.ts";

type Chapter = { number: number; title: string; page_start?: number; page_end?: number };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ingest-token",
};

async function extractPdfPages(bytes: Uint8Array): Promise<string[]> {
  const { extractText, getDocumentProxy } = await import("https://esm.sh/unpdf@0.12.1");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: false });
  return Array.isArray(text) ? text : [String(text)];
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const expected = Deno.env.get("TEXTBOOK_INGEST_TOKEN");
    if (!expected || req.headers.get("x-ingest-token") !== expected) {
      return json({ success: false, error: "Unauthorized." }, 401);
    }
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const body = await req.json().catch(() => ({}));
    const book = body.book || {};
    for (const k of ["slug", "board", "class_level", "subject", "title"]) {
      if (book[k] == null || book[k] === "") return json({ success: false, error: `book.${k} is required.` }, 400);
    }
    const scope = {
      board: String(book.board).toLowerCase(),
      class_level: Number(book.class_level),
      subject: String(book.subject).toLowerCase(),
      language: String(book.language || "english").toLowerCase(),
    };

    // 1. Upsert the book.
    const { data: bookRow, error: bookErr } = await supabase
      .from("textbooks")
      .upsert({
        slug: book.slug,
        board: scope.board,
        board_type: book.board_type === "state" ? "state" : "ncert",
        state_code: book.state_code ?? null,
        class_level: scope.class_level,
        subject: scope.subject,
        language: scope.language,
        title: book.title,
        edition: book.edition ?? null,
        publisher: book.publisher ?? (scope.board === "ncert" ? "NCERT" : null),
        source_url: book.source_url ?? null,
        status: "ingesting",
        updated_at: new Date().toISOString(),
      }, { onConflict: "slug" })
      .select("id")
      .single();
    if (bookErr || !bookRow) throw new Error(`book upsert failed: ${bookErr?.message}`);
    const textbookId = bookRow.id as string;

    // 2. Chapters.
    const chapters: Chapter[] = Array.isArray(body.chapters) ? body.chapters : [];
    const chapterIdByNumber = new Map<number, string>();
    if (chapters.length) {
      const { data: chRows, error: chErr } = await supabase
        .from("textbook_chapters")
        .upsert(chapters.map((c) => ({
          textbook_id: textbookId,
          chapter_number: Number(c.number),
          title: String(c.title),
          page_start: c.page_start ?? null,
          page_end: c.page_end ?? null,
        })), { onConflict: "textbook_id,chapter_number" })
        .select("id, chapter_number");
      if (chErr) throw new Error(`chapter upsert failed: ${chErr.message}`);
      for (const r of chRows || []) chapterIdByNumber.set(r.chapter_number, r.id);
    }
    const chapterForPage = (page: number): string | null => {
      for (const c of chapters) {
        if (c.page_start != null && c.page_end != null && page >= c.page_start && page <= c.page_end) {
          return chapterIdByNumber.get(Number(c.number)) ?? null;
        }
      }
      return null;
    };

    // 3. Pages.
    let pages: { page: number; text: string }[] = [];
    let totalPages = 0;
    if (Array.isArray(body.pages)) {
      pages = body.pages.map((p: any, i: number) => ({ page: Number(p.page ?? i + 1), text: String(p.text || "") }));
      totalPages = pages.length;
    } else {
      let bytes: Uint8Array;
      if (body.pdf_base64) {
        bytes = Uint8Array.from(atob(String(body.pdf_base64)), (ch) => ch.charCodeAt(0));
      } else if (body.pdf_url) {
        const res = await fetch(String(body.pdf_url));
        if (!res.ok) throw new Error(`PDF download failed (${res.status})`);
        bytes = new Uint8Array(await res.arrayBuffer());
      } else {
        return json({ success: false, error: "Provide pdf_url, pdf_base64, or pages[]." }, 400);
      }
      const texts = await extractPdfPages(bytes);
      totalPages = texts.length;
      const offset = Number(body.page_offset) || 0;
      pages = texts.map((text, i) => ({ page: i + 1 - offset, text }));
    }
    const from = Number(body.page_from) || -Infinity;
    const to = Number(body.page_to) || Infinity;
    pages = pages.filter((p) => p.page >= from && p.page <= to && p.page >= 1);

    if (body.replace && pages.length) {
      await supabase.from("textbook_page_chunks").delete()
        .eq("textbook_id", textbookId)
        .gte("page_number", pages[0].page)
        .lte("page_number", pages[pages.length - 1].page);
    }

    // 4. Chunk + embed + upsert in small batches.
    let inserted = 0;
    let batch: any[] = [];
    const flush = async () => {
      if (!batch.length) return;
      const { error } = await supabase.from("textbook_page_chunks")
        .upsert(batch, { onConflict: "textbook_id,page_number,chunk_index" });
      if (error) throw new Error(`chunk upsert failed: ${error.message}`);
      inserted += batch.length;
      batch = [];
    };
    for (const p of pages) {
      const pieces = chunkPage(p.text);
      for (let i = 0; i < pieces.length; i++) {
        const embedding = await embedText(pieces[i]);
        batch.push({
          textbook_id: textbookId,
          chapter_id: chapterForPage(p.page),
          page_number: p.page,
          chunk_index: i,
          content: pieces[i],
          token_estimate: Math.ceil(pieces[i].length / 4),
          embedding,
          ...scope,
        });
        if (batch.length >= 25) await flush();
      }
    }
    await flush();

    const lastPage = pages.length ? pages[pages.length - 1].page : 0;
    const finished = !Number.isFinite(to) || lastPage >= totalPages - (Number(body.page_offset) || 0);
    await supabase.from("textbooks").update({
      status: finished || body.mark_ready ? "ready" : "ingesting",
      page_count: totalPages || null,
      last_error: null,
      updated_at: new Date().toISOString(),
    }).eq("id", textbookId);

    return json({ success: true, textbook_id: textbookId, pages_processed: pages.length, chunks_upserted: inserted, total_pages: totalPages, ready: finished || !!body.mark_ready });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[textbook-ingest]", message);
    return json({ success: false, error: message }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
