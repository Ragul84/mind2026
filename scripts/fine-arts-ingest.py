"""Extract + chunk NCERT Class 11 Fine Arts ('An Introduction to Indian Art' Part I)
into the corpus format so textbook-embed.mjs can embed it.

Reads data/fine-arts-raw/kefa1{01..08}.pdf, writes
data/textbook-release-corpus/ncert-class-11-fine-arts-...-chapter-{n}-pdf/chunks.jsonl

  python scripts/fine-arts-ingest.py
"""
import fitz, os, re, json, glob

ROOT = os.getcwd()
RAW = os.path.join(ROOT, 'data', 'fine-arts-raw')
CORPUS = os.path.join(ROOT, 'data', 'textbook-release-corpus')
CHUNK_CHARS = 1400
BASE = 'ncert-class-11-fine-arts-an-introduction-to-indian-art-en'

# Chapter titles (from the NCERT Class 11 Fine Arts book contents).
TITLES = {
    1: 'Prehistoric Rock Paintings',
    2: 'Arts of the Indus Valley',
    3: 'Arts of the Mauryan Period',
    4: 'Post-Mauryan Trends in Indian Art and Architecture',
    5: 'Later Mural Traditions',
    6: 'Temple Architecture and Sculpture',
    7: 'Indian Bronze Sculpture',
    8: 'Some Aspects of Indo-Islamic Architecture',
}

def clean(t):
    t = re.sub(r'-\s*\n\s*', '', t)            # de-hyphenate line breaks
    t = re.sub(r'[ \t]+', ' ', t)
    t = re.sub(r'\n{2,}', '\n', t)
    return t.strip()

def chunk_pages(pages, source_id, cls, chapter):
    chunks, buf, start = [], '', 1
    def flush(endp):
        nonlocal buf
        s = re.sub(r'\s+', ' ', buf).strip()
        if len(s) >= 80:
            chunks.append({
                'chunk_id': f"{source_id}:{len(chunks):04d}", 'source_id': source_id,
                'board': 'ncert', 'class_level': cls, 'subject': 'fine-arts',
                'chapter': chapter, 'language': 'english', 'chunk_type': 'lesson_content',
                'page_start': start, 'page_end': endp, 'text': s,
            })
        buf = ''
    for i, (pno, txt) in enumerate(pages):
        if not buf:
            start = pno
        buf += '\n' + txt
        if len(buf) >= CHUNK_CHARS:
            flush(pno)
    flush(pages[-1][0] if pages else 1)
    return chunks

def main():
    total = 0
    for pdf in sorted(glob.glob(os.path.join(RAW, 'kefa1*.pdf'))):
        m = re.search(r'kefa1(\d\d)\.pdf$', pdf)
        if not m:
            continue
        n = int(m.group(1))
        source_id = f"{BASE}-chapter-{n:02d}-pdf"
        doc = fitz.open(pdf)
        pages = [(p + 1, clean(doc[p].get_text())) for p in range(doc.page_count)]
        pages = [(p, t) for p, t in pages if len(t) >= 40]  # drop image-only pages
        chunks = chunk_pages(pages, source_id, 11, TITLES.get(n, f'Chapter {n}'))
        outdir = os.path.join(CORPUS, source_id)
        os.makedirs(outdir, exist_ok=True)
        with open(os.path.join(outdir, 'chunks.jsonl'), 'w', encoding='utf-8') as fh:
            for c in chunks:
                fh.write(json.dumps(c, ensure_ascii=False) + '\n')
        chars = sum(len(c['text']) for c in chunks)
        print(f"ch{n:02d} '{TITLES.get(n)}': {doc.page_count} pages -> {len(chunks)} chunks ({chars:,} chars)")
        total += len(chunks)
    print(f"\nDONE. {total} Fine Arts chunks written.")

if __name__ == '__main__':
    main()
