// Page text cleaning + chunking for textbook ingestion (pure, unit-tested).

export const CHUNK_CHARS = 900;
export const CHUNK_OVERLAP = 150;
export const MIN_CHUNK_CHARS = 60;

export function cleanPageText(text: string): string {
  return String(text || "")
    .replace(/\u00ad/g, "")
    .replace(/-\n(\w)/g, "$1")         // de-hyphenate line breaks
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}


export function chunkPage(text: string): string[] {
  const clean = cleanPageText(text);
  if (clean.length < MIN_CHUNK_CHARS) return [];
  if (clean.length <= CHUNK_CHARS) return [clean];
  const out: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + CHUNK_CHARS, clean.length);
    if (end < clean.length) {
      // Prefer to break at a sentence or paragraph boundary.
      const window = clean.slice(start, end);
      const cut = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf(". "), window.lastIndexOf("? "));
      if (cut > CHUNK_CHARS * 0.5) end = start + cut + 1;
    }
    const piece = clean.slice(start, end).trim();
    if (piece.length >= MIN_CHUNK_CHARS) out.push(piece);
    if (end >= clean.length) break;
    start = Math.max(end - CHUNK_OVERLAP, start + 1);
  }
  return out;
}
