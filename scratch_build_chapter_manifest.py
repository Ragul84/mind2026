from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(r"D:\edu4bharat")
RAW_ROOT = ROOT / "raw"
OUT_PATH = ROOT / "chapter_manifest.json"


def slugify(value: str) -> str:
    value = value.lower().strip()
    value = value.replace("&", " and ")
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-")


def norm_subject(value: str) -> str:
    raw = value.lower().strip().replace("_", "-")
    mapping = {
        "maths": "mathematics",
        "mathematics": "mathematics",
        "math": "mathematics",
        "science": "science",
        "social-science": "social-science",
        "social science": "social-science",
        "political-science": "political-science",
        "political science": "political-science",
        "computer-science": "computer-science",
        "computer science": "computer-science",
        "physics-volume-1": "physics",
        "physics-volume-2": "physics",
        "chemistry-volume-1": "chemistry",
        "chemistry-volume-2": "chemistry",
        "mathematics-volume-1": "mathematics",
        "mathematics-volume-2": "mathematics",
        "english": "english",
        "tamil": "tamil",
        "history": "history",
        "geography": "geography",
        "economics": "economics",
        "accountancy": "accountancy",
        "business-studies": "business-studies",
        "basic-electronics-engineering": "basic-electronics-engineering",
        "basic-mechanical-engineering": "basic-mechanical-engineering",
        "basic-automobile-engineering": "basic-automobile-engineering",
        "basic-civil-engineering": "basic-civil-engineering",
        "basic-electrical-engineering": "basic-electrical-engineering",
        "communicative-english": "english",
        "office-management-and-secretaryship-and-typography-and-computer-applications": "office-management-and-secretaryship-and-typography-and-computer-applications",
        "textiles-and-dress-designing": "textiles-and-dress-designing",
        "textiles-technology": "textiles-technology",
        "food-service-management": "food-service-management",
        "general-nursing": "general-nursing",
        "micro-biology": "micro-biology",
        "zoology": "zoology",
        "botany": "botany",
        "auditing": "auditing",
        "commerce": "commerce",
        "statistics": "statistics",
        "home-science": "home-science",
        "employability-skills": "employability-skills",
    }
    return mapping.get(raw, raw)


def parse_class(parts: list[str]) -> int | None:
    for part in parts:
        m = re.match(r"class-(\d+)$", part, re.I)
        if m:
            return int(m.group(1))
        roman = {
            "class-ix": 9,
            "class-x": 10,
            "class-xi": 11,
            "class-xii": 12,
        }.get(part.lower())
        if roman:
            return roman
    return None


def parse_year(path_parts: list[str]) -> int | None:
    for part in reversed(path_parts):
        m = re.fullmatch(r"(19|20)\d{2}", part)
        if m:
            return int(part)
    return None


def detect_board(path_parts: list[str]) -> str:
    if "ncert" in path_parts:
        return "ncert"
    if "samacheer" in path_parts:
        return "samacheer"
    if "cbse" in path_parts:
        return "cbse"
    if "tnpsc" in path_parts:
        return "tnpsc"
    if "upsc" in path_parts:
        return "upsc"
    if "ssc" in path_parts:
        return "ssc"
    if "banking" in path_parts:
        return "banking"
    if "neet" in path_parts:
        return "neet"
    if "jee" in path_parts:
        return "jee"
    return "general"


def detect_language(path_parts: list[str], file_path: Path) -> str | None:
    low = str(file_path).lower()
    for lang in ("english", "tamil", "hindi", "urdu", "malayalam", "kannada", "telugu"):
        if lang in path_parts or f"-{lang}-" in low or low.endswith(f"-{lang}.pdf"):
            return {
                "english": "en",
                "tamil": "ta",
                "hindi": "hi",
                "urdu": "ur",
                "malayalam": "ml",
                "kannada": "kn",
                "telugu": "te",
            }[lang]
    if any(x in low for x in ("_tm_", "tm_text", "tamil-medium")):
        return "ta"
    if any(x in low for x in ("_em_", "english-medium", "en_text")):
        return "en"
    return None


def detect_source_type(rel: str) -> str:
    low = rel.lower()
    if "/exemplar/" in low:
        return "exemplar"
    if "/pyq/" in low or "/question-papers/" in low or "/question-paper/" in low:
        return "pyq"
    if "/answer-keys/" in low:
        return "answer_key"
    if "/sample-paper/" in low:
        return "sample_paper"
    if "/syllabus/" in low:
        return "syllabus"
    if "model-question-paper" in low or "model-paper" in low:
        return "model_paper"
    if "bookback" in low or "exercise" in low:
        return "bookback"
    return "body"


def detect_scope(rel: str, source_type: str) -> str:
    low = rel.lower()
    if source_type in {"pyq", "answer_key", "sample_paper", "syllabus", "model_paper"}:
        return "paper"
    if source_type == "exemplar":
        return "chapter_bank_pdf"
    if source_type == "bookback":
        return "exercise_section"
    if "chapter-" in low:
        return "single_chapter_pdf"
    if low.endswith("book.pdf") or low.endswith("_text.pdf") or low.endswith(".pdf"):
        return "full_book_pdf"
    return "unknown"


def parse_chapter_number(file_name: str) -> int | None:
    stem = Path(file_name).stem.lower()
    patterns = [
        r"chapter[-_ ]?(\d{1,3})",
        r"ch[-_ ]?(\d{1,3})",
        r"(\d{1,3})$",
    ]
    for pat in patterns:
        m = re.search(pat, stem)
        if m:
            try:
                return int(m.group(1))
            except ValueError:
                pass
    return None


def title_hint_from_path(path: Path) -> str:
    parts = list(path.parts)
    if len(parts) >= 2:
        # Parent folders carry the most useful human clue in this corpus.
        parent = parts[-2]
        grandparent = parts[-3] if len(parts) >= 3 else ""
        if parent.lower() not in {"english", "tamil", "hi", "ur"}:
            return grandparent if grandparent else parent
        return grandparent or parent
    return path.stem


def build_entry(file_path: Path) -> dict:
    rel = file_path.relative_to(RAW_ROOT).as_posix()
    parts = [p.lower() for p in file_path.relative_to(RAW_ROOT).parts]
    board = detect_board(parts)
    source_type = detect_source_type(rel)
    scope = detect_scope(rel, source_type)
    class_num = parse_class(parts)
    year = parse_year(parts)
    lang = detect_language(parts, file_path)

    subject = None
    if "class-" in rel:
        # Use the first subject-like folder after the class segment.
        try:
            idx = next(i for i, p in enumerate(parts) if p.startswith("class-"))
            if idx + 1 < len(parts):
                subject = norm_subject(parts[idx + 1])
        except StopIteration:
            subject = None

    if subject is None:
        # fallback to a shallow path-derived guess
        for part in parts:
            if part in {"maths", "mathematics", "science", "english", "tamil", "history", "geography", "economics", "political-science", "computer-science", "accountancy", "business-studies", "physics", "chemistry", "biology", "social-science"}:
                subject = norm_subject(part)
                break
    if subject is None and len(parts) >= 3:
        subject = norm_subject(parts[-3])

    chapter_number = parse_chapter_number(file_path.name)
    chapter_title = None
    title_hint = title_hint_from_path(file_path)

    if source_type == "body" and chapter_number is not None:
        # For chapter PDFs we keep the real chapter number and a stable title hint.
        chapter_title = None
    elif source_type in {"exemplar", "pyq", "answer_key", "sample_paper", "model_paper"}:
        chapter_title = None

    priority = {
        "bookback": 1,
        "exemplar": 2,
        "pyq": 3,
        "answer_key": 3,
        "sample_paper": 3,
        "model_paper": 3,
        "body": 4,
        "syllabus": 5,
    }.get(source_type, 9)

    seed_key = None
    if board in {"ncert", "samacheer"} and class_num and subject and chapter_number:
        seed_key = f"{board}_{class_num}_{subject}_ch{chapter_number}_v1"
    elif board in {"ncert", "samacheer"} and class_num and subject:
        seed_key = f"{board}_{class_num}_{subject}_{source_type}_v1"
    elif board != "general":
        seed_key = f"{board}_{source_type}_{slugify(file_path.stem)}_v1"

    return {
        "id": slugify(rel),
        "board": board,
        "class": class_num,
        "subject": subject,
        "language": lang,
        "source_type": source_type,
        "source_scope": scope,
        "priority": priority,
        "chapter_number": chapter_number,
        "chapter_title": chapter_title,
        "title_hint": title_hint,
        "year": year,
        "term": next((p for p in parts if p in {"term-1", "term-2", "term-3"}), None),
        "file_name": file_path.name,
        "file_path": rel,
        "seed_key": seed_key,
    }


def main() -> int:
    if not RAW_ROOT.exists():
        raise SystemExit(f"Missing raw root: {RAW_ROOT}")

    entries = []
    for pdf in sorted(RAW_ROOT.rglob("*.pdf")):
        entries.append(build_entry(pdf))

    entries.sort(key=lambda e: (e["board"], e["class"] or 999, e["subject"] or "", e["source_type"], e["file_path"]))

    manifest = {
        "manifest_version": "v1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_root": str(RAW_ROOT),
        "entry_count": len(entries),
        "entries": entries,
        "indexes": {
            "by_board_class_subject": defaultdict(list),
            "by_source_type": defaultdict(list),
        },
    }

    for entry in entries:
        bcs_key = f"{entry['board']}|{entry['class'] or 'na'}|{entry['subject'] or 'na'}"
        manifest["indexes"]["by_board_class_subject"][bcs_key].append(entry["id"])
        manifest["indexes"]["by_source_type"][entry["source_type"]].append(entry["id"])

    # Convert defaultdicts to plain dicts for JSON.
    manifest["indexes"] = {
        "by_board_class_subject": dict(manifest["indexes"]["by_board_class_subject"]),
        "by_source_type": dict(manifest["indexes"]["by_source_type"]),
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    summary = Counter(e["board"] for e in entries)
    print(f"WROTE {OUT_PATH}")
    print(f"ENTRIES {len(entries)}")
    for board, count in sorted(summary.items()):
        print(f"{board}: {count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
