from __future__ import annotations

import concurrent.futures as cf
import dataclasses
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

import pdfplumber


ROOT = Path(r"D:\edu4bharat")
RAW_ROOT = ROOT / "raw"
MANIFEST_PATH = ROOT / "chapter_manifest.json"
SCRATCH_DIR = Path(r"D:\mindwhite") / "scratch"
SCRATCH_DIR.mkdir(parents=True, exist_ok=True)

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions"

OPENROUTER_MODELS = [
    "openrouter/free",
    "openrouter/free",
]
NVIDIA_MODEL = "nvidia/llama-3.1-nemotron-nano-8b-v1"

TARGET_BOARD = "samacheer"
TARGET_CLASS = 6
TARGET_SUBJECT = "science"
TARGET_CHAPTER = 1


def log_path(worker_id: int) -> Path:
    return SCRATCH_DIR / f"class6_worker_{worker_id}.log"


def log(worker_id: int, message: str) -> None:
    ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    line = f"{ts}\t{message}"
    print(line, flush=True)
    with log_path(worker_id).open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def slugify(value: str) -> str:
    value = value.lower().strip()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-")


def load_dotenv_file(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("'").strip('"')
        os.environ.setdefault(key, value)


def load_manifest() -> dict[str, Any]:
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def is_quiz_eligible(entry: dict[str, Any]) -> bool:
    if entry["board"] not in {"samacheer", "ncert"}:
        return False
    if entry["class"] not in {6, 7, 8, 9, 10, 11, 12}:
        return False
    if entry["source_type"] not in {"body", "bookback", "exemplar", "pyq", "answer_key", "sample_paper", "model_paper"}:
        return False
    return True


def pick_target_entry(manifest: dict[str, Any]) -> dict[str, Any]:
    candidates = [
        e
        for e in manifest["entries"]
        if e["board"] == TARGET_BOARD
        and e["class"] == TARGET_CLASS
        and e["subject"] == TARGET_SUBJECT
        and e["chapter_number"] == TARGET_CHAPTER
        and is_quiz_eligible(e)
    ]
    if not candidates:
        raise SystemExit("No target entry found for Samacheer Class 6 Science Chapter 1")
    candidates.sort(key=lambda e: (e["priority"], e["source_type"], e["file_path"]))
    # Prefer the English term PDF for the pilot.
    for entry in candidates:
        if entry.get("language") == "en":
            return entry
    return candidates[0]


def page_text(pdf: pdfplumber.PDF, page_no: int) -> str:
    return pdf.pages[page_no - 1].extract_text() or ""


def detect_chapter_span(pdf: pdfplumber.PDF, chapter_number: int, chapter_title: str | None) -> tuple[int, int]:
    title_rx = re.escape(chapter_title) if chapter_title else None
    start_page = None
    end_page = len(pdf.pages)

    for i, page in enumerate(pdf.pages, 1):
        txt = page.extract_text() or ""
        if re.search(rf"\bUnit\s*{chapter_number}\b", txt, re.I) or (
            title_rx and re.search(title_rx, txt, re.I)
        ):
            start_page = i
            break

    if start_page is None:
        raise SystemExit(f"Could not locate chapter {chapter_number} start")

    for i in range(start_page + 1, len(pdf.pages) + 1):
        txt = page_text(pdf, i)
        if re.search(rf"\bUnit\s*{chapter_number + 1}\b", txt, re.I):
            end_page = i - 1
            break

    return start_page, end_page


def extract_pages(pdf_path: Path, start_page: int, end_page: int) -> list[tuple[int, str]]:
    pages = []
    with pdfplumber.open(str(pdf_path)) as pdf:
        for page_no in range(start_page, end_page + 1):
            pages.append((page_no, page_text(pdf, page_no)))
    return pages


def collect_bookback_pages(chapter_pages: list[tuple[int, str]]) -> list[tuple[int, str]]:
    headings = (
        "TEXTBOOK EVALUATION",
        "Evaluation",
        "Book Back Questions",
        "Self Evaluation",
        "Exercise",
        "Questions",
    )
    hit_idx = None
    for idx, (_, txt) in enumerate(chapter_pages):
        if any(h.lower() in txt.lower() for h in headings):
            hit_idx = idx
            break
    if hit_idx is None:
        return []
    return chapter_pages[hit_idx:]


def compact_text(text: str) -> str:
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def normalize_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def extract_tier1_mcqs(bookback_pages: list[tuple[int, str]]) -> list[dict[str, Any]]:
    if not bookback_pages:
        return []

    merged = "\n".join(txt for _, txt in bookback_pages)
    merged = compact_text(merged)
    lines = merged.splitlines()
    start_idx = None
    end_idx = None
    for i, line in enumerate(lines):
        if start_idx is None and re.search(r"i\s*\.\s*choose the correct answer", line, re.I):
            start_idx = i
            continue
        if start_idx is not None and re.search(r"ii\s*\.\s*fill in the blanks", line, re.I):
            end_idx = i
            break
    if start_idx is None:
        return []

    raw_block_lines = lines[start_idx + 1 : end_idx] if end_idx is not None else lines[start_idx + 1 :]
    block_lines: list[str] = []
    for line in raw_block_lines:
        parts = re.split(r"(?<=[\.\?\!])\s+(?=\d+[)\.]\s+)", line)
        if len(parts) > 1:
            block_lines.extend(part for part in parts if part)
        else:
            block_lines.append(line)
    q_starts: list[tuple[int, str]] = []
    current_num: int | None = None
    current_buf: list[str] = []

    def flush() -> None:
        nonlocal current_num, current_buf
        if current_num is None:
            return
        text = " ".join(part for part in current_buf if part).strip()
        if text:
            q_starts.append((current_num, text))
        current_num = None
        current_buf = []

    for line in block_lines:
        m = re.match(r"^\s*(\d+)[\)\.]\s*(.*)$", line)
        if m:
            flush()
            current_num = int(m.group(1))
            current_buf = [m.group(2).strip()]
        else:
            if current_num is not None:
                current_buf.append(line.strip())
    flush()

    results: list[dict[str, Any]] = []
    for qnum, segment in q_starts:
        option_matches = list(re.finditer(r"(?<!\w)([a-d])\)\s*", segment))
        if len(option_matches) < 4:
            continue
        q_text = normalize_whitespace(segment[: option_matches[0].start()])
        options: list[str] = []
        for opt_idx, opt_match in enumerate(option_matches[:4]):
            opt_start = opt_match.end()
            opt_end = option_matches[opt_idx + 1].start() if opt_idx + 1 < len(option_matches) else len(segment)
            opt_text = normalize_whitespace(segment[opt_start:opt_end])
            options.append(opt_text)
        if len(options) != 4:
            continue
        # Tier-1 extraction keeps the textbook item even when the book itself
        # does not mark the key. The downstream fact-check pass can fill/verify
        # the answer against chapter text.
        results.append(
            {
                "id": qnum,
                "question": q_text,
                "options": options,
                "correct_option": None,
                "citation": "TEXTBOOK EVALUATION / Choose the correct answer",
                "explanation": "Extracted directly from the textbook evaluation block; answer key to be verified downstream.",
                "source_tier": "bookback",
            }
        )
    return results


def sha256_dedup_key(question: str, options: list[str]) -> str:
    normalized = normalize_whitespace(question).lower()
    normalized += "||" + "||".join(normalize_whitespace(o).lower() for o in options)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def chapter_seed_key(entry: dict[str, Any]) -> str:
    return entry.get("seed_key") or f"{entry['board']}_{entry['class']}_{entry['subject']}_ch{entry['chapter_number']}_v1"


def build_generation_prompt(entry: dict[str, Any], chapter_text: str, target_count: int) -> list[dict[str, str]]:
    system = (
        "You are a quiz question writer for Samacheer Kalvi Class 6 science.\n"
        "Generate only grounded MCQs from the supplied chapter text.\n"
        "Rules:\n"
        "- Use ONLY facts explicitly stated in the text.\n"
        "- No outside knowledge.\n"
        "- Return valid JSON only.\n"
        "- Every question must have 4 options, exactly 1 correct answer, a citation, and an explanation.\n"
        "- Keep distractors plausible.\n"
        "- Do not mention that you are an AI.\n"
    )
    user = (
        f"Chapter: {entry.get('chapter_title') or 'Chapter ' + str(entry['chapter_number'])}\n"
        f"Board: Samacheer Kalvi\n"
        f"Class: 6\n"
        f"Subject: {entry['subject']}\n"
        f"Seed: {chapter_seed_key(entry)}\n"
        f"Target questions: {target_count}\n\n"
        "Generate ONLY from the text below.\n"
        "Return JSON in this shape:\n"
        "{\n"
        '  "questions": [\n'
        "    {\n"
        '      "question": "…",\n'
        '      "options": ["…","…","…","…"],\n'
        '      "correct_option": 1,\n'
        '      "citation": "Section / paragraph / page",\n'
        '      "explanation": "…"\n'
        "    }\n"
        "  ]\n"
        "}\n\n"
        "Text:\n"
        f"{chapter_text}"
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def post_chat_completion(url: str, key: str, model: str, messages: list[dict[str, str]], temperature: float = 0.1, max_tokens: int = 5000) -> str:
    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    body = json.dumps(payload).encode("utf-8")
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    if url.startswith("https://openrouter.ai/"):
        headers["HTTP-Referer"] = "http://localhost"
        headers["X-Title"] = "edu4bharat-pdf-quiz-pilot"
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=180) as resp:
        raw = resp.read().decode("utf-8")
    data = json.loads(raw)
    return data["choices"][0]["message"]["content"]


def parse_json_from_model(raw_text: str) -> dict[str, Any]:
    text = raw_text.strip()
    if text.startswith("```"):
        text = text.split("```", 2)[1]
    text = text.replace("```json", "").replace("```", "").strip()
    return json.loads(text)


def generate_worker_questions(worker_id: int, provider: str, key: str, model: str, entry: dict[str, Any], chapter_text: str, target_count: int) -> dict[str, Any]:
    try:
        messages = build_generation_prompt(entry, chapter_text, target_count)
        url = OPENROUTER_URL if provider == "openrouter" else NVIDIA_URL
        if provider == "opengateway":
            url = "https://opengateway.gitlawb.com/v1/chat/completions"
        raw = post_chat_completion(
            url,
            key,
            model,
            messages,
        )
        parsed = parse_json_from_model(raw)
        questions = parsed.get("questions", [])
        if not isinstance(questions, list):
            raise ValueError("model_output_questions_not_list")

        cleaned = []
        for q in questions:
            if not isinstance(q, dict):
                continue
            question = normalize_whitespace(str(q.get("question", "")))
            options = q.get("options", [])
            if not question or not isinstance(options, list) or len(options) != 4:
                continue
            options = [normalize_whitespace(str(o)) for o in options]
            try:
                correct_option = int(q.get("correct_option"))
            except Exception:
                continue
            if correct_option not in {1, 2, 3, 4}:
                continue
            cleaned.append(
                {
                    "question": question,
                    "options": options,
                    "correct_option": correct_option,
                    "citation": normalize_whitespace(str(q.get("citation", ""))),
                    "explanation": normalize_whitespace(str(q.get("explanation", ""))),
                    "source_tier": "generated",
                }
            )

        return {
            "worker_id": worker_id,
            "provider": provider,
            "model": model,
            "status": "ok",
            "raw_count": len(questions),
            "clean_count": len(cleaned),
            "questions": cleaned,
        }
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="replace")
        except Exception:
            body = "<unavailable>"
        return {
            "worker_id": worker_id,
            "provider": provider,
            "model": model,
            "status": "http_error",
            "error_code": e.code,
            "error_body": body[:2000],
            "raw_count": 0,
            "clean_count": 0,
            "questions": [],
        }
    except Exception as e:
        return {
            "worker_id": worker_id,
            "provider": provider,
            "model": model,
            "status": "error",
            "error": str(e),
            "raw_count": 0,
            "clean_count": 0,
            "questions": [],
        }


def merge_questions(bookback_questions: list[dict[str, Any]], generated_sets: list[dict[str, Any]], desired_total: int = 30) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    seen: set[str] = set()

    def add(q: dict[str, Any], tier: str) -> None:
        key = sha256_dedup_key(q["question"], q["options"])
        if key in seen:
            return
        seen.add(key)
        q = dict(q)
        q["source_tier"] = tier
        merged.append(q)

    for q in bookback_questions:
        add(q, "bookback")

    for worker in generated_sets:
        for q in worker["questions"]:
            add(q, "generated")
            if len(merged) >= desired_total:
                return merged[:desired_total]

    return merged[:desired_total]


def compare_sets(worker_outputs: list[dict[str, Any]]) -> dict[str, Any]:
    norms: list[set[str]] = []
    for worker in worker_outputs:
        s = {
            sha256_dedup_key(q["question"], q["options"])
            for q in worker["questions"]
        }
        norms.append(s)
    if not norms:
        return {"exact_overlap": 0, "pairwise_jaccard": []}
    common = set.intersection(*norms) if len(norms) > 1 else norms[0]
    pairwise = []
    for i in range(len(norms)):
        for j in range(i + 1, len(norms)):
            union = norms[i] | norms[j]
            inter = norms[i] & norms[j]
            pairwise.append(
                {
                    "pair": [i + 1, j + 1],
                    "jaccard": round(len(inter) / len(union), 4) if union else 1.0,
                }
            )
    return {
        "exact_overlap_count": len(common),
        "pairwise_jaccard": pairwise,
    }


def chapter_text_for_entry(entry: dict[str, Any]) -> tuple[list[tuple[int, str]], list[tuple[int, str]], tuple[int, int], str]:
    pdf_path = RAW_ROOT / entry["file_path"]
    with pdfplumber.open(str(pdf_path)) as pdf:
        span = detect_chapter_span(pdf, entry["chapter_number"], entry.get("chapter_title"))
    chapter_pages = extract_pages(pdf_path, span[0], span[1])
    bookback_pages = collect_bookback_pages(chapter_pages)
    chapter_text = "\n\n".join(f"[PAGE {page_no}]\n{txt}" for page_no, txt in chapter_pages)
    return chapter_pages, bookback_pages, span, chapter_text


def worker_entry(worker_id: int, provider: str, model: str, key: str, entry: dict[str, Any], chapter_text: str, target_generated_count: int) -> dict[str, Any]:
    log(worker_id, f"START provider={provider} model={model}")
    result = generate_worker_questions(worker_id, provider, key, model, entry, chapter_text, target_generated_count)
    if result["status"] == "ok":
        log(worker_id, f"DONE raw_count={result['raw_count']} clean_count={result['clean_count']}")
    else:
        log(worker_id, f"FAIL status={result['status']} error={result.get('error') or result.get('error_code')}")
    return result


def main() -> int:
    load_dotenv_file(Path(r"D:\mindwhite\.env"))
    load_dotenv_file(Path(r"D:\mindwhite\.env.local"))

    manifest = load_manifest()
    entry = pick_target_entry(manifest)
    pdf_path = RAW_ROOT / entry["file_path"]

    chapter_pages, bookback_pages, span, chapter_text = chapter_text_for_entry(entry)
    bookback_questions = extract_tier1_mcqs(bookback_pages)
    target_total = 30
    target_generated = max(target_total - len(bookback_questions), 0)

    keys = {
        "openrouter_1": os.environ.get("OPENROUTER_KEY_1", ""),
        "openrouter_3": os.environ.get("OPENROUTER_KEY_3", ""),
        "nvidia_1": os.environ.get("NVIDIA_KEY_1", ""),
        "opengateway_1": os.environ.get("OPENGATEWAY_KEY_1", ""),
    }
    if not all(keys.values()):
        raise SystemExit("Missing one or more API keys. Set OPENROUTER_KEY_1, OPENROUTER_KEY_3, NVIDIA_KEY_1, OPENGATEWAY_KEY_1.")

    workers = [
        (1, "openrouter", OPENROUTER_MODELS[0], keys["openrouter_1"]),
        (2, "openrouter", OPENROUTER_MODELS[1], keys["openrouter_3"]),
        (3, "nvidia", NVIDIA_MODEL, keys["nvidia_1"]),
        (4, "opengateway", "minimax/minimax-m3", keys["opengateway_1"]),
    ]

    log(1, f"TARGET pdf={entry['file_path']} span={span[0]}-{span[1]} bookback_mcqs={len(bookback_questions)} target_generated={target_generated}")
    log(1, f"BOOKBACK_HEADINGS found={bool(bookback_pages)} pages={[p for p, _ in bookback_pages[:3]]}")

    with cf.ThreadPoolExecutor(max_workers=4) as ex:
        futures = [
            ex.submit(worker_entry, wid, provider, model, key, entry, chapter_text, target_generated)
            for wid, provider, model, key in workers
        ]
        worker_outputs = [f.result() for f in futures]

    comparison = compare_sets(worker_outputs)
    merged_by_worker = [
        {
            "worker_id": w["worker_id"],
            "provider": w["provider"],
            "model": w["model"],
            "question_count": len(merge_questions(bookback_questions, [w], target_total)),
        }
        for w in worker_outputs
    ]

    final_sets = [
        merge_questions(bookback_questions, [worker_output], target_total)
        for worker_output in worker_outputs
    ]

    report = {
        "source": {
            "board": entry["board"],
            "class": entry["class"],
            "subject": entry["subject"],
            "chapter": entry["chapter_number"],
            "chapter_title": entry.get("chapter_title"),
            "pdf_path": str(pdf_path),
            "seed_key": chapter_seed_key(entry),
        },
        "chapter_span": {
            "start_page": span[0],
            "end_page": span[1],
            "chapter_page_count": len(chapter_pages),
            "bookback_page_count": len(bookback_pages),
        },
        "tier1_bookback": {
            "count": len(bookback_questions),
            "questions": bookback_questions,
        },
        "worker_summaries": worker_outputs,
        "comparison": comparison,
        "final_counts": merged_by_worker,
        "pilot_check": {
            "target_total": target_total,
            "generated_per_worker": target_generated,
            "all_workers_reached_total": all(len(s) == target_total for s in final_sets),
        },
        "sample_final": final_sets[0][:5] if final_sets else [],
    }

    out_path = SCRATCH_DIR / "class6_science_ch1_pilot_report.json"
    out_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    print(f"\nWROTE {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
