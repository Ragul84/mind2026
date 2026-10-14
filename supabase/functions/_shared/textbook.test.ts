// deno test supabase/functions/_shared/textbook.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { chunkPage, cleanPageText, CHUNK_CHARS } from "./textbookChunking.ts";
import { buildTextbookSystemPrompt, citationLabel, citationsUsed, normaliseScope, type TextbookCitation } from "./textbookRetrieval.ts";

const cite = (ref: number, page: number): TextbookCitation => ({
  ref, chunkId: `c${ref}`, bookTitle: "Science", board: "ncert", classLevel: 10, subject: "science",
  chapterNumber: 6, chapterTitle: "Life Processes", page, similarity: 0.9, excerpt: "Photosynthesis ...",
});

Deno.test("cleanPageText de-hyphenates and collapses whitespace", () => {
  assertEquals(cleanPageText("photo-\nsynthesis   is\n\n\n\nkey"), "photosynthesis is\n\nkey");
});

Deno.test("chunkPage skips near-empty pages and splits long ones with overlap", () => {
  assertEquals(chunkPage("12"), []);
  const long = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} about plants.`).join(" ");
  const chunks = chunkPage(long);
  assert(chunks.length > 1);
  for (const c of chunks) assert(c.length <= CHUNK_CHARS);
});

Deno.test("citationLabel names book, chapter and page", () => {
  assertEquals(citationLabel(cite(1, 98)), "NCERT Class 10 Science, Ch 6 (Life Processes), p. 98");
});

Deno.test("system prompt forces citations or an explicit not-found", () => {
  assert(buildTextbookSystemPrompt([cite(1, 98)]).includes("[1] NCERT Class 10 Science"));
  assert(buildTextbookSystemPrompt([]).includes("I could not find this in your textbook."));
});

Deno.test("citationsUsed keeps only referenced sources", () => {
  const all = [cite(1, 98), cite(2, 99), cite(3, 101)];
  assertEquals(citationsUsed("Plants make food [1][3].", all).map((c) => c.ref), [1, 3]);
  assertEquals(citationsUsed("No markers.", all).length, 3);
});

Deno.test("normaliseScope validates class and lower-cases board", () => {
  assertEquals(normaliseScope({ board: "NCERT", classLevel: 10 }), { board: "ncert", classLevel: 10, subject: null, language: null });
  assertEquals(normaliseScope({ board: "x", class_level: 42 }).classLevel, null);
});
