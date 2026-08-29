// Reusable chunk cleaner for the NCERT/Samacheer English corpus.
// Reconstructed 2026-07-07 (original was lost with the D: pendrive; the embedded
// corpus is unaffected — this is only needed to RE-embed English from raw chunks).
//
// cleanChunkText(raw): de-hyphenate line breaks, strip box/□ glyphs, remove
// replacement chars (U+FFFD) and control chars, drop obvious boilerplate lines,
// collapse whitespace.

import { pathToFileURL } from 'node:url';

const BOILERPLATE = /^(reprint|rationalised|©|not to be republished|isbn|first edition|printed at|published by|price\b|watermark)\b/i;
const CONTROL = new RegExp('[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]', 'g');
const BOXGLYPH = new RegExp('[\\u25A0-\\u25FF\\u2B1B\\u2B1C\\uFFFD]', 'g');

export function cleanChunkText(raw) {
  let s = String(raw || '');
  // Join words split by a hyphen at a line break: "differ-\nentiate" -> "differentiate"
  s = s.replace(/([A-Za-z])-\s*\n\s*([a-z])/g, '$1$2');
  // Drop box / geometric-shape placeholder glyphs and the Unicode replacement char.
  s = s.replace(BOXGLYPH, ' ');
  // Remove control chars (keep \t \n \r).
  s = s.replace(CONTROL, '');
  // Line-level cleanup: drop boilerplate lines.
  s = s.split(/\r?\n/).filter((line) => !BOILERPLATE.test(line.trim())).join('\n');
  // Collapse whitespace.
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function main() {
  const sample = process.argv.slice(2).join(' ') || 'sample text with U+FFFD glyph';
  console.log(JSON.stringify(cleanChunkText(sample)));
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
