#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import random
import re
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup, Tag


ROOT_URL = "https://www.shaalaa.com"
INDEX_URL = f"{ROOT_URL}/textbook-solutions/a/samacheer-kalvi-solutions_406"
MINDWHITE_ROOT = Path("/mnt/c/mindwhite")
ENV_FILE = MINDWHITE_ROOT / ".env"
CACHE_DIR = MINDWHITE_ROOT / "data" / "samacheer_shaalaa_cache"
CATALOG_FILE = MINDWHITE_ROOT / "data" / "samacheer_shaalaa_catalog.json"
REPORT_FILE = MINDWHITE_ROOT / "data" / "samacheer_shaalaa_push_report.json"
CHECKPOINT_FILE = MINDWHITE_ROOT / "data" / "samacheer_shaalaa_checkpoint.json"
CATALOG_REDIS_KEY = "catalog:samacheer:shaalaa:v1"
RANDOM = random.Random(6)

VISUAL_DEPENDENT_PHRASES = [
    "following figure",
    "given figure",
    "figure below",
    "diagram shown",
    "from the graph",
    "refer to the image",
    "missing figures",
    "omitted due to",
    "the chart below",
    "from the table",
]

NUMBER_WORDS = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
]

SCALE_WORDS = ["ten", "hundred", "thousand", "lakh", "crore", "million", "billion"]

SYMBOL_DISTRACTORS = {
    ">": ["<", "=", ">="],
    "<": [">", "=", "<="],
    "=": [">", "<", "!="],
}


@dataclass
class Book:
    class_num: int
    book_name: str
    title: str
    url: str
    redis_key: str
    topic_id: str


@dataclass
class Chapter:
    url: str
    chapter_number: Optional[int]
    chapter_title: str


def load_env(path: Path) -> Dict[str, str]:
    env: Dict[str, str] = {}
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip().strip('"').strip("'")
    return env


ENV = load_env(ENV_FILE)
REDIS_URL = ENV["EXPO_PUBLIC_UPSTASH_REDIS_REST_URL"].rstrip("/")
REDIS_TOKEN = ENV["EXPO_PUBLIC_UPSTASH_REDIS_REST_TOKEN"]


def redis_post(command: Sequence[Any]) -> Any:
    req = urllib.request.Request(
        REDIS_URL,
        data=json.dumps(list(command)).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {REDIS_TOKEN}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return payload.get("result")


def slugify(text: str) -> str:
    text = text.lower()
    text = re.sub(r"\[[^\]]+\]", "", text)
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def clean_text(text: str) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    return text.replace(" .", ".").replace(" ,", ",")


def normalize_key(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", clean_text(text).lower()).strip()


def infer_subject(book_name: str) -> str:
    subject = re.sub(r"\[[^\]]+\]", "", book_name)
    subject = re.sub(r"\s*-\s*Term\s*\d+", "", subject, flags=re.IGNORECASE)
    subject = re.sub(r"\s*-\s*Volume\s*\d+\s*and\s*\d+", "", subject, flags=re.IGNORECASE)
    return clean_text(subject)


def item_sha256(item: Dict[str, Any]) -> str:
    payload = {
        "question_text": clean_text(item["question_text"]),
        "options": [clean_text(opt) for opt in item["options"]],
        "correct_answer": item["correct_answer"],
    }
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def dedupe_questions(items: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    unique: List[Dict[str, Any]] = []
    seen = set()
    for item in items:
        key = item_sha256(item)
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return unique


def cache_path_for_url(url: str) -> Path:
    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()
    return CACHE_DIR / f"{digest}.html"


def fetch_html(session: requests.Session, url: str) -> str:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_path = cache_path_for_url(url)
    if cache_path.exists():
        return cache_path.read_text(encoding="utf-8", errors="ignore")
    response = session.get(url, timeout=45)
    response.raise_for_status()
    html = response.text
    cache_path.write_text(html, encoding="utf-8")
    return html


def atomic_write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temp_path.replace(path)


def load_json_file(path: Path, default: Dict[str, Any]) -> Dict[str, Any]:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def build_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({"User-Agent": "Mozilla/5.0"})
    return session


def build_topic_entry(book: Book, count: int) -> Dict[str, Any]:
    return {
        "id": book.topic_id,
        "name": book.book_name,
        "redisKey": book.redis_key,
        "questionCount": count,
        "source": "shaalaa",
    }


def build_report_entry(book: Book, items: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        "class": book.class_num,
        "book_name": book.book_name,
        "subject": infer_subject(book.book_name),
        "count": len(items),
        "book_url": book.url,
        "sample_questions": [item["question_text"] for item in items[:5]],
    }


def build_catalog_payload(topics_by_class: Dict[str, List[Dict[str, Any]]]) -> Dict[str, Any]:
    return {
        "version": "samacheer_shaalaa_v1",
        "generated_at_utc": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "topicsByClass": {
            class_id: sorted(items, key=lambda x: x["name"])
            for class_id, items in sorted(topics_by_class.items())
        },
    }


def load_checkpoint_state() -> Tuple[Dict[str, Any], Dict[str, List[Dict[str, Any]]], Dict[str, Any]]:
    checkpoint = load_json_file(
        CHECKPOINT_FILE,
        {"scope": "samacheer_shaalaa_v1", "completed": {}, "topicsByClass": {}, "report": {"scope": "samacheer_shaalaa_v1", "books": {}}},
    )
    topics_by_class = checkpoint.get("topicsByClass") or {}
    report = checkpoint.get("report") or {"scope": "samacheer_shaalaa_v1", "books": {}}
    return checkpoint, topics_by_class, report


def persist_state(checkpoint: Dict[str, Any], topics_by_class: Dict[str, List[Dict[str, Any]]], report: Dict[str, Any]) -> None:
    checkpoint["topicsByClass"] = topics_by_class
    checkpoint["report"] = report
    checkpoint["updated_at_utc"] = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    catalog_payload = build_catalog_payload(topics_by_class)
    atomic_write_json(CHECKPOINT_FILE, checkpoint)
    atomic_write_json(CATALOG_FILE, catalog_payload)
    atomic_write_json(REPORT_FILE, report)
    redis_post(["SET", CATALOG_REDIS_KEY, json.dumps(catalog_payload, ensure_ascii=False)])


def is_visual_dependent(*parts: str) -> bool:
    merged = " ".join(clean_text(part).lower() for part in parts if part)
    return any(phrase in merged for phrase in VISUAL_DEPENDENT_PHRASES)


def parse_index_books(session: requests.Session) -> List[Book]:
    html = fetch_html(session, INDEX_URL)
    soup = BeautifulSoup(html, "html.parser")
    books: List[Book] = []
    seen = set()
    for a in soup.find_all("a", href=True):
        title = clean_text(a.get_text(" ", strip=True))
        href = a["href"]
        if not title.startswith("Samacheer Kalvi Solutions for "):
            continue
        if href.startswith("#"):
            continue
        if href == "/textbook-solutions/a/samacheer-kalvi-solutions_406":
            continue
        match = re.search(r"Class\s+(\d+)", title)
        if not match:
            continue
        class_num = int(match.group(1))
        if class_num < 6 or class_num > 12:
            continue
        if href in seen:
            continue
        seen.add(href)
        book_name = re.sub(r"^Samacheer Kalvi Solutions for\s+", "", title)
        book_name = re.sub(r"\s+Class\s+\d+.*$", "", book_name).strip()
        topic_id = slugify(book_name)
        redis_key = f"samacheer:v2:class{class_num}:{topic_id}"
        books.append(
            Book(
                class_num=class_num,
                book_name=book_name,
                title=title,
                url=urljoin(ROOT_URL, href),
                redis_key=redis_key,
                topic_id=topic_id,
            )
        )
    return sorted(books, key=lambda b: (b.class_num, b.book_name))


def parse_book_chapters(session: requests.Session, book: Book) -> List[Chapter]:
    html = fetch_html(session, book.url)
    soup = BeautifulSoup(html, "html.parser")
    chapters: List[Chapter] = []
    seen = set()
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if "/textbook-solutions/c/" not in href:
            continue
        txt = clean_text(a.get_text(" ", strip=True))
        if not txt:
            continue
        full_url = urljoin(ROOT_URL, href.split("#", 1)[0])
        if full_url in seen:
            continue
        seen.add(full_url)
        num_match = re.match(r"(\d+)\s*[:\-]\s*(.+)", txt)
        chapter_number = int(num_match.group(1)) if num_match else None
        chapter_title = clean_text(num_match.group(2) if num_match else txt)
        chapters.append(Chapter(url=full_url, chapter_number=chapter_number, chapter_title=chapter_title))
    return chapters


def parse_meta_label(meta_div: Tag) -> Tuple[str, str]:
    page_tag = meta_div.find("span", class_="pg_no")
    page_label = clean_text(page_tag.get_text(" ", strip=True)) if page_tag else ""
    meta_text = clean_text(meta_div.get_text(" ", strip=True))
    question_label = clean_text(meta_text.replace(page_label, "").strip())
    return question_label, page_label


def parse_chapter_blocks(session: requests.Session, book: Book, chapter: Chapter) -> List[Dict[str, Any]]:
    html = fetch_html(session, chapter.url)
    soup = BeautifulSoup(html, "html.parser")
    out: List[Dict[str, Any]] = []
    for block in soup.find_all("div", class_="block noselect"):
        header = block.find("div", class_="header_wrap")
        header_text = clean_text(header.get_text(" ", strip=True)) if header else ""
        if not header_text:
            continue
        if not block.find("div", class_="qp_result_data"):
            continue
        exercise_label = header_text
        current_section = ""
        for child in block.find_all(recursive=False):
            if child.name == "h4":
                current_section = clean_text(child.get_text(" ", strip=True))
                continue
            classes = child.get("class") or []
            if "qp_result_data" not in classes:
                continue
            meta_div = child.find("div", class_="qp_result_data_data_meta")
            html_text = child.find("div", class_="html_text")
            link = child.find("a", class_="view_solution", href=True)
            if not meta_div or not html_text or not link:
                continue
            question_label, page_label = parse_meta_label(meta_div)
            paragraphs = [clean_text(p.get_text(" ", strip=True)) for p in html_text.find_all("p")]
            question_preview = "\n".join([p for p in paragraphs if p])
            preview_options = [clean_text(li.get_text(" ", strip=True)) for li in child.select("ul.qbq_items li")]
            out.append(
                {
                    "class_num": book.class_num,
                    "book_name": book.book_name,
                    "book_url": book.url,
                    "redis_key": book.redis_key,
                    "topic_id": book.topic_id,
                    "chapter_number": chapter.chapter_number,
                    "chapter_title": chapter.chapter_title,
                    "chapter_url": chapter.url,
                    "exercise_label": exercise_label,
                    "section_label": current_section,
                    "question_label": question_label,
                    "page_label": page_label,
                    "question_preview": question_preview,
                    "preview_options": preview_options,
                    "solution_url": urljoin(ROOT_URL, link["href"].split("#", 1)[0]),
                    "shaalaa_question_id": child.get("data-id"),
                    "shaalaa_instance_id": child.get("data-piqbq_id"),
                }
            )
    return out


def parse_question_page(session: requests.Session, stub: Dict[str, Any]) -> Dict[str, Any]:
    html = fetch_html(session, stub["solution_url"])
    soup = BeautifulSoup(html, "html.parser")
    qblock = soup.find("div", class_="qbq_text_question")
    sblock = soup.find("div", class_="qbq_text_solution")
    if not qblock or not sblock:
        return {}
    q_html_texts = qblock.find_all("div", class_="html_text")
    question_parts: List[str] = []
    options: List[str] = []
    answer_index: Optional[int] = None
    if q_html_texts:
        question_parts = [clean_text(p.get_text(" ", strip=True)) for p in q_html_texts[0].find_all("p")]
    option_lis = qblock.select("ul.qbq_items li")
    if option_lis:
        for idx, li in enumerate(option_lis):
            opt = clean_text(li.get_text(" ", strip=True))
            if opt:
                options.append(opt)
            if "question_item_answer" in (li.get("class") or []):
                answer_index = idx
    q_types = [clean_text(node.get_text(" ", strip=True)) for node in qblock.select(".qbq_q_type")]
    solution_text_parts = [clean_text(p.get_text(" ", strip=True)) for p in sblock.find_all("p")]
    return {
        "question_text": "\n".join([part for part in question_parts if part]) or stub["question_preview"],
        "options": options,
        "answer_index": answer_index,
        "question_types": q_types,
        "solution_text": "\n".join([part for part in solution_text_parts if part]),
    }


def derive_answer_from_blank(question: str, solution: str) -> Optional[str]:
    question = clean_text(question)
    solution = clean_text(solution)
    if "___" not in question:
        return None
    parts = [re.escape(clean_text(part)) for part in re.split(r"_+", question)]
    if len(parts) < 2:
        return None
    pattern = r"^\s*" + r"\s*(.+?)\s*".join(parts) + r"\s*$"
    match = re.match(pattern, solution, flags=re.IGNORECASE)
    if not match:
        return None
    captures = [clean_text(g) for g in match.groups() if clean_text(g)]
    if len(captures) == 1:
        return captures[0]
    return " | ".join(captures) if captures else None


def derive_answer_text(question_text: str, solution_text: str) -> str:
    question_text = clean_text(question_text)
    solution_text = clean_text(solution_text)
    if not solution_text:
        return ""
    blank_answer = derive_answer_from_blank(question_text, solution_text)
    if blank_answer:
        return blank_answer
    if solution_text.startswith(question_text):
        remainder = clean_text(solution_text[len(question_text):]).lstrip("-:= ")
        if remainder:
            return remainder
    if " - " in solution_text:
        maybe = clean_text(solution_text.rsplit(" - ", 1)[-1])
        if maybe:
            return maybe
    if ": " in solution_text:
        maybe = clean_text(solution_text.split(": ", 1)[-1])
        if maybe:
            return maybe
    return solution_text


def numeric_distractors(answer: str) -> List[str]:
    match = re.fullmatch(r"([₹`$€£-]?\s*\d+(?:,\d{3})*(?:\.\d+)?)\s*([A-Za-z%²³./-]*)", answer.strip())
    if not match:
        return []
    number_text, unit = match.groups()
    try:
        value = int(number_text.replace(",", "").replace("₹", "").replace("`", "").replace("$", "").replace("€", "").replace("£", "").strip())
    except ValueError:
        return []
    prefix = ""
    if number_text.strip()[:1] in {"₹", "`", "$", "€", "£"}:
        prefix = number_text.strip()[:1]
    out = []
    seen = set()
    for variant in [value + 1, max(0, value - 1), value + 10, max(0, value - 10)]:
        candidate = f"{prefix}{variant}{unit}".strip()
        key = normalize_key(candidate)
        if key and key not in seen:
            seen.add(key)
            out.append(candidate)
    return out


def alpha_distractors(answer: str) -> List[str]:
    answer = clean_text(answer)
    if not re.fullmatch(r"[A-Za-z]", answer):
        return []
    variants = ["x", "y", "z", "n", "m", "a", "b", "c"]
    out = []
    for variant in variants:
        if variant.lower() != answer.lower():
            out.append(variant if answer.islower() else variant.upper())
        if len(out) >= 4:
            break
    return out


def number_word_distractors(answer: str) -> List[str]:
    answer = clean_text(answer)
    words = answer.lower().split()
    if not words or len(words) > 4:
        return []
    if not all(word in NUMBER_WORDS or word in SCALE_WORDS or word == "and" for word in words):
        return []

    candidates: List[str] = []
    seen = {normalize_key(answer)}
    for index, word in enumerate(words):
        variants: List[str] = []
        if word in NUMBER_WORDS:
            pos = NUMBER_WORDS.index(word)
            variants.extend(
                candidate
                for candidate in [NUMBER_WORDS[max(0, pos - 1)], NUMBER_WORDS[min(len(NUMBER_WORDS) - 1, pos + 1)]]
                if candidate != word
            )
        if word in SCALE_WORDS:
            pos = SCALE_WORDS.index(word)
            variants.extend(
                candidate
                for candidate in [SCALE_WORDS[max(0, pos - 1)], SCALE_WORDS[min(len(SCALE_WORDS) - 1, pos + 1)]]
                if candidate != word
            )
        for variant in variants:
            updated = words[:]
            updated[index] = variant
            candidate = " ".join(updated).title()
            key = normalize_key(candidate)
            if key and key not in seen:
                seen.add(key)
                candidates.append(candidate)
    return candidates


def expression_distractors(answer: str) -> List[str]:
    answer = clean_text(answer)
    if not re.search(r"\d", answer):
        return []
    if not re.search(r"[+\-×÷=/]", answer):
        return []
    matches = list(re.finditer(r"\d+(?:,\d{3})*", answer))
    candidates: List[str] = []
    seen = {normalize_key(answer)}
    for match in matches[:2]:
        original = match.group(0)
        base = int(original.replace(",", ""))
        for delta in (-1, 1):
            replacement = f"{base + delta:,}".replace(",", "")
            candidate = clean_text(answer[: match.start()] + replacement + answer[match.end() :])
            key = normalize_key(candidate)
            if key and key not in seen:
                seen.add(key)
                candidates.append(candidate)
    return candidates


def answer_kind(answer: str) -> str:
    answer = clean_text(answer)
    if answer.lower() in {"true", "false"}:
        return "boolean"
    if answer in SYMBOL_DISTRACTORS:
        return "symbol"
    if number_word_distractors(answer):
        return "number_words"
    if numeric_distractors(answer):
        return "numeric"
    if re.search(r"\d", answer) and re.search(r"[+\-×÷=/]", answer):
        return "expression"
    if re.fullmatch(r"[A-Za-z ]{1,40}", answer):
        return "text"
    return "mixed"


def build_generated_options(answer_text: str, pool: Sequence[str]) -> Tuple[List[str], int]:
    answer_text = clean_text(answer_text)
    lower_answer = answer_text.lower()
    if lower_answer in {"true", "false"}:
        options = ["True", "False"]
        return options, 0 if lower_answer == "true" else 1
    if answer_text in SYMBOL_DISTRACTORS:
        options = [answer_text, *SYMBOL_DISTRACTORS[answer_text]]
        RANDOM.shuffle(options)
        return options, options.index(answer_text)
    candidates: List[str] = []
    seen = {normalize_key(answer_text)}
    generated = (
        numeric_distractors(answer_text)
        + alpha_distractors(answer_text)
        + number_word_distractors(answer_text)
        + expression_distractors(answer_text)
    )
    for item in generated:
        key = normalize_key(item)
        if key and key not in seen:
            seen.add(key)
            candidates.append(item)
    preferred_kind = answer_kind(answer_text)
    same_kind_pool = [item for item in pool if answer_kind(item) == preferred_kind]
    for item in same_kind_pool:
        item = clean_text(item)
        key = normalize_key(item)
        if not item or key in seen or len(item) > 60:
            continue
        seen.add(key)
        candidates.append(item)
        if len(candidates) >= 3:
            break
    if not candidates and preferred_kind == "text":
        return [], -1
    options = [answer_text, *candidates[:3]]
    options = list(dict.fromkeys([clean_text(opt) for opt in options if clean_text(opt)]))
    if len(options) < 2:
        return [], -1
    RANDOM.shuffle(options)
    return options, options.index(answer_text)


def difficulty_for_class(class_num: int) -> str:
    if class_num <= 8:
        return "easy"
    if class_num <= 10:
        return "medium"
    return "hard"


def build_explanation(solution_text: str, chapter_title: str, exercise_label: str, class_num: int, book_name: str, answer_text: str) -> str:
    solution_text = clean_text(solution_text)
    if solution_text:
        return solution_text
    chapter_title = clean_text(chapter_title) or "the chapter"
    exercise_label = clean_text(exercise_label) or "the exercise"
    return f"From the {chapter_title} {exercise_label} in Samacheer Kalvi Class {class_num} {book_name} textbook, the correct answer is {answer_text}."


def scrape_book(session: requests.Session, book: Book) -> Tuple[Book, List[Dict[str, Any]]]:
    chapters = parse_book_chapters(session, book)
    stubs: List[Dict[str, Any]] = []
    for chapter in chapters:
        stubs.extend(parse_chapter_blocks(session, book, chapter))

    details: Dict[str, Dict[str, Any]] = {}
    with ThreadPoolExecutor(max_workers=10) as executor:
        future_map = {executor.submit(parse_question_page, session, stub): stub["solution_url"] for stub in stubs}
        for future in as_completed(future_map):
            url = future_map[future]
            try:
                details[url] = future.result()
            except Exception:
                details[url] = {}

    raw_rows: List[Dict[str, Any]] = []
    for stub in stubs:
        detail = details.get(stub["solution_url"], {})
        question_text = clean_text(detail.get("question_text") or stub["question_preview"])
        solution_text = clean_text(detail.get("solution_text", ""))
        options = [clean_text(opt) for opt in (detail.get("options") or stub["preview_options"] or []) if clean_text(opt)]
        answer_index = detail.get("answer_index")
        if is_visual_dependent(question_text, solution_text):
            continue
        question_types = detail.get("question_types") or ([stub["section_label"]] if stub["section_label"] else [])
        answer_text = options[answer_index] if options and isinstance(answer_index, int) and 0 <= answer_index < len(options) else derive_answer_text(question_text, solution_text)
        if not answer_text:
            continue
        raw_rows.append(
            {
                **stub,
                "question_text": question_text,
                "options": options,
                "answer_index": answer_index,
                "answer_text": clean_text(answer_text),
                "question_types": question_types,
                "solution_text": solution_text,
            }
        )

    answer_pool = [row["answer_text"] for row in raw_rows if len(row["answer_text"].split()) <= 6 and len(row["answer_text"]) <= 60]
    final_items: List[Dict[str, Any]] = []
    for row in raw_rows:
        options = row["options"]
        answer_index = row["answer_index"]
        if not options or answer_index is None:
            pool = [
                r["answer_text"]
                for r in raw_rows
                if r["exercise_label"] == row["exercise_label"]
                and r["section_label"] == row["section_label"]
                and r["solution_url"] != row["solution_url"]
            ] or answer_pool
            options, answer_index = build_generated_options(row["answer_text"], pool)
        if answer_index is None or answer_index < 0 or len(options) < 2:
            continue
        item = {
            "id": item_sha256(
                {
                    "question_text": row["question_text"],
                    "options": options,
                    "correct_answer": answer_index,
                }
            ),
            "question_text": row["question_text"],
            "options": options,
            "correct_answer": answer_index,
            "explanation": build_explanation(
                row["solution_text"],
                row["chapter_title"],
                row["exercise_label"],
                row["class_num"],
                row["book_name"],
                row["answer_text"],
            ),
            "difficulty": difficulty_for_class(row["class_num"]),
            "schema_version": "samacheer_shaalaa_v1",
            "source": "shaalaa",
            "class": row["class_num"],
            "subject": infer_subject(row["book_name"]),
            "book_name": row["book_name"],
            "chapter_number": row["chapter_number"],
            "chapter_title": row["chapter_title"],
            "exercise_label": row["exercise_label"],
            "section_label": row["section_label"],
            "question_label": row["question_label"],
            "page_label": row["page_label"],
            "question_type": ", ".join(row["question_types"]) if row["question_types"] else row["section_label"],
            "source_url": row["chapter_url"],
            "solution_url": row["solution_url"],
            "answer_text": row["answer_text"],
        }
        final_items.append(item)
    return book, dedupe_questions(final_items)


def process_book(book: Book) -> Tuple[Book, List[Dict[str, Any]]]:
    session = build_session()
    scraped_book, items = scrape_book(session, book)
    push_subject(scraped_book.redis_key, items)
    return scraped_book, items


def push_subject(key: str, items: Sequence[Dict[str, Any]]) -> None:
    items = dedupe_questions(items)
    redis_post(["DEL", f"quiz:subject:{key}"])
    batch_size = 100
    for start in range(0, len(items), batch_size):
        batch = [json.dumps(item, ensure_ascii=False) for item in items[start : start + batch_size]]
        redis_post(["RPUSH", f"quiz:subject:{key}", *batch])


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--class", dest="class_num", type=int)
    parser.add_argument("--match", dest="match", default="")
    parser.add_argument("--force-refresh", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    session = build_session()

    books = parse_index_books(session)
    if args.class_num:
        books = [book for book in books if book.class_num == args.class_num]
    if args.match:
        needle = args.match.lower()
        books = [book for book in books if needle in book.book_name.lower() or needle in book.redis_key.lower()]
    checkpoint, topics_by_class, report = load_checkpoint_state()
    completed = checkpoint.setdefault("completed", {})

    if args.force_refresh:
        checkpoint = {"scope": "samacheer_shaalaa_v1", "completed": {}}
        topics_by_class = {}
        report = {"scope": "samacheer_shaalaa_v1", "books": {}}
        completed = checkpoint["completed"]

    pending_books: List[Book] = []
    for book in books:
        if completed.get(book.redis_key):
            continue
        pending_books.append(book)

    if not pending_books:
        persist_state(checkpoint, topics_by_class, report)
        print("No pending books. Checkpoint already covers the requested scope.")
        print(f"catalog: {CATALOG_FILE}")
        print(f"report: {REPORT_FILE}")
        print(f"checkpoint: {CHECKPOINT_FILE}")
        return 0

    with ThreadPoolExecutor(max_workers=4) as executor:
        future_map = {executor.submit(process_book, book): book for book in pending_books}
        for future in as_completed(future_map):
            scraped_book, items = future.result()
            class_id = f"class{scraped_book.class_num}"
            topic_entry = build_topic_entry(scraped_book, len(items))
            existing_topics = [item for item in topics_by_class.get(class_id, []) if item.get("redisKey") != scraped_book.redis_key]
            existing_topics.append(topic_entry)
            topics_by_class[class_id] = existing_topics
            report["books"][scraped_book.redis_key] = build_report_entry(scraped_book, items)
            completed[scraped_book.redis_key] = {
                "class": scraped_book.class_num,
                "book_name": scraped_book.book_name,
                "count": len(items),
                "completed_at_utc": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            }
            persist_state(checkpoint, topics_by_class, report)
            print(f"{scraped_book.redis_key}: pushed {len(items)} items")

    persist_state(checkpoint, topics_by_class, report)
    print(f"catalog: {CATALOG_FILE}")
    print(f"report: {REPORT_FILE}")
    print(f"checkpoint: {CHECKPOINT_FILE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
