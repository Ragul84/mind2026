"""Re-OCR Samacheer Tamil textbooks with a vision LLM (Gemini 2.5 Flash via
OpenRouter) so the Tamil is clean — the PDFs' legacy-font text layer is corrupted.

Scope: TNPSC-core subjects, classes 6-12. Resumable per page (cached to disk),
concurrent, retry on rate limits. Writes chunks.jsonl per book.

NOTE: All 22 core Tamil books are ALREADY OCR'd + embedded (2026-07-07). This is
only needed to re-run. Raw PDFs were at D:/edu4bharat/raw/samacheer (pendrive).

  python scripts/tamil-ocr.py                 # all core books (resumable)
  python scripts/tamil-ocr.py --book class-12/tamil
  python scripts/tamil-ocr.py --list
Output: data/textbook-tamil-ocr/<source_id>/{pages/<n>.txt, chunks.jsonl}
"""
import fitz, base64, json, os, sys, glob, time, re
import urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

ROOT = os.getcwd()
RAW = os.path.join('D:', os.sep, 'edu4bharat', 'raw', 'samacheer')
OUTDIR = os.path.join(ROOT, 'data', 'textbook-tamil-ocr')
CORE = {'social-science', 'science', 'history', 'geography', 'political-science',
        'economics', 'tamil', 'physics', 'chemistry', 'biology', 'mathematics'}
MODEL = 'google/gemini-2.5-flash'
DPI = 170
WORKERS = 4
CHUNK_CHARS = 1500

def load_env():
    env = {}
    for f in ['.env.local', '.env']:
        p = os.path.join(ROOT, f)
        if not os.path.exists(p): continue
        for l in open(p, encoding='utf-8'):
            t = l.strip()
            if t and not t.startswith('#') and '=' in t:
                i = t.index('='); env[t[:i].strip()] = t[i+1:].strip().strip('\'"')
    return env
ENV = load_env()
OR_KEY = ENV.get('OPENROUTER_API_KEY') or (ENV.get('OPENROUTER_API_KEYS', '').split(',')[0].strip())

PROMPT = ("You are a precise OCR engine for Tamil school textbooks. Transcribe ALL text in "
          "this page image EXACTLY as printed, preserving reading order and paragraph breaks. "
          "Keep Tamil in Tamil and English/numbers as-is. Do NOT translate, summarize, correct, "
          "explain, or add anything. If the page is blank or only images, output an empty line. "
          "Output only the transcribed text.")

def core_books():
    books = []
    for p in glob.glob(os.path.join(RAW, 'class-*', '*', 'tamil', 'book.pdf')):
        parts = p.replace(os.sep, '/').split('/')
        cls = next((x for x in parts if x.startswith('class-')), None)
        subj = parts[-3]
        if not cls or subj not in CORE: continue
        n = cls.split('-')[1]
        source_id = f"samacheer-class-{n}-{subj}-tamil-book-pdf"
        books.append({'pdf': p, 'cls': int(n), 'subj': subj, 'source_id': source_id, 'label': f"{cls}/{subj}"})
    return sorted(books, key=lambda b: (b['cls'], b['subj']))

def ocr_image(b64, attempt=0):
    body = json.dumps({"model": MODEL, "temperature": 0, "messages": [{"role": "user", "content": [
        {"type": "text", "text": PROMPT},
        {"type": "image_url", "image_url": {"url": "data:image/png;base64," + b64}},
    ]}]}).encode()
    req = urllib.request.Request("https://openrouter.ai/api/v1/chat/completions", data=body,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {OR_KEY}"})
    try:
        resp = json.load(urllib.request.urlopen(req, timeout=180))
        return resp["choices"][0]["message"].get("content") or ""
    except urllib.error.HTTPError as e:
        if e.code in (429, 500, 502, 503) and attempt < 5:
            time.sleep(min(2 ** attempt * 2, 30)); return ocr_image(b64, attempt + 1)
        raise
    except Exception:
        if attempt < 5:
            time.sleep(min(2 ** attempt * 2, 30)); return ocr_image(b64, attempt + 1)
        raise

def process_book(b):
    outbase = os.path.join(OUTDIR, b['source_id'])
    pagedir = os.path.join(outbase, 'pages')
    os.makedirs(pagedir, exist_ok=True)
    doc = fitz.open(b['pdf'])
    npages = doc.page_count

    def do_page(pno):
        cache = os.path.join(pagedir, f"{pno:04d}.txt")
        if os.path.exists(cache):
            return pno, open(cache, encoding='utf-8').read()
        png = doc[pno].get_pixmap(dpi=DPI).tobytes("png")
        txt = ocr_image(base64.b64encode(png).decode()) or ""
        open(cache, 'w', encoding='utf-8').write(txt)
        return pno, txt

    todo = [p for p in range(npages) if not os.path.exists(os.path.join(pagedir, f"{p:04d}.txt"))]
    print(f"  {b['label']}: {npages} pages, {len(todo)} to OCR", flush=True)
    done = 0
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = {ex.submit(do_page, p): p for p in todo}
        for f in as_completed(futs):
            try:
                f.result(); done += 1
                if done % 25 == 0: print(f"    {b['label']} …{done}/{len(todo)}", flush=True)
            except Exception as e:
                print(f"    page {futs[f]} failed: {e}", flush=True)

    pages = []
    for p in range(npages):
        cache = os.path.join(pagedir, f"{p:04d}.txt")
        pages.append((p, open(cache, encoding='utf-8').read() if os.path.exists(cache) else ''))
    chunks = []
    buf, buf_start = '', 0
    def flush(endpage):
        nonlocal buf
        s = re.sub(r'[ \t]+', ' ', buf).strip()
        if len(s) >= 60:
            chunks.append({
                'chunk_id': f"{b['source_id']}:{len(chunks):04d}",
                'source_id': b['source_id'], 'board': 'samacheer', 'class_level': b['cls'],
                'subject': b['subj'], 'language': 'ta', 'chapter': b['subj'],
                'chunk_type': 'lesson_content', 'page_start': buf_start + 1, 'page_end': endpage + 1,
                'text': s,
            })
        buf = ''
    for p, t in pages:
        if not buf: buf_start = p
        buf += ('\n' + t)
        if len(buf) >= CHUNK_CHARS: flush(p)
    flush(npages - 1)
    with open(os.path.join(outbase, 'chunks.jsonl'), 'w', encoding='utf-8') as fh:
        for c in chunks: fh.write(json.dumps(c, ensure_ascii=False) + '\n')
    print(f"  {b['label']}: wrote {len(chunks)} chunks", flush=True)
    return len(chunks)

def main():
    args = sys.argv[1:]
    books = core_books()
    if '--list' in args:
        for b in books:
            doc = fitz.open(b['pdf']); print(f"  {b['label']:34} {doc.page_count} pages  -> {b['source_id']}")
        print(f"total core Tamil books: {len(books)}")
        return
    if '--book' in args:
        sel = args[args.index('--book') + 1]
        books = [b for b in books if b['label'] == sel or b['source_id'] == sel]
    if not OR_KEY: print('Missing OPENROUTER_API_KEY'); sys.exit(1)
    print(f"OCR model: {MODEL} | books: {len(books)}", flush=True)
    total = 0
    for b in books:
        total += process_book(b)
    print(f"\nDONE. total chunks: {total}", flush=True)

if __name__ == '__main__':
    main()
