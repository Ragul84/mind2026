#!/usr/bin/env python3
"""
Build and push dedicated Class 6 Samacheer quiz lists.

The app expects each Redis item to look like:
  {
    "question_text": "...",
    "options": ["...", "...", "...", "..."],
    "correct_answer": 1,
    "explanation": "...",
    "difficulty": "easy"
  }

We also include traceability metadata that the app ignores safely:
  class, subject, chapter_number, chapter_title, question_type,
  source_file, source_pdf, textbook_page_range, pdf_page_range
"""

from __future__ import annotations

import json
import os
import random
import re
import sys
import urllib.request
import hashlib
import argparse
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple


ROOT = Path("/home/ragul/edu4bharat/data/samacheer_structured_v1")
MINDWHITE_ROOT = Path("/mnt/c/mindwhite")
ENV_FILE = MINDWHITE_ROOT / ".env"
REPORT_FILE = MINDWHITE_ROOT / "data" / "samacheer_class6_push_report.json"

VISUAL_DEPENDENT_PHRASES = [
    "following figure",
    "given figure",
    "figure below",
    "diagram shown",
    "from the graph",
    "refer to the image",
    "missing figures",
    "omitted due to",
]

SAMACHEER_SCHEMA: Dict[str, Dict[str, Any]] = {
    "class6:english": {
        "redis_key": "samacheer:class6:english",
        "subject": "english",
        "difficulty": "easy",
        "sources": [
            "class-6-english-english-term-2.json",
            "class-6-english-english-term-3.json",
            "class-6-tamil-tamil-term-2.json",
            "class-6-tamil-tamil-term-3.json",
        ],
    },
    "class6:mathematics": {
        "redis_key": "samacheer:class6:mathematics",
        "subject": "mathematics",
        "difficulty": "easy",
        "sources": [
            "class-6-mathematics-english-term-1.json",
            "class-6-mathematics-english-term-2.json",
            "class-6-mathematics-english-term-3.json",
        ],
    },
    "class6:science": {
        "redis_key": "samacheer:class6:science",
        "subject": "science",
        "difficulty": "easy",
        "sources": [
            "class-6-science-english-term-2.json",
            "class-6-science-english-term-3.json",
        ],
    },
    "class6:tamil": {
        "redis_key": "samacheer:class6:tamil",
        "subject": "tamil",
        "difficulty": "easy",
        "sources": [
            "class-6-english-english-term-3.json",
        ],
    },
    "class7:mathematics": {
        "redis_key": "samacheer:class7:mathematics",
        "subject": "mathematics",
        "difficulty": "easy",
        "sources": [
            "class-7-mathematics-english-term-1.json",
            "class-7-mathematics-english-term-2.json",
            "class-7-mathematics-english-term-3.json",
        ],
    },
    "class7:science": {
        "redis_key": "samacheer:class7:science",
        "subject": "science",
        "difficulty": "easy",
        "sources": [
            "class-7-science-english-term-1.json",
            "class-7-science-english-term-2.json",
            "class-7-science-english-term-3.json",
        ],
    },
    "class8:english": {
        "redis_key": "samacheer:class8:english",
        "subject": "english",
        "difficulty": "easy",
        "sources": ["class-8-english-english-book.json"],
    },
    "class8:tamil": {
        "redis_key": "samacheer:class8:tamil",
        "subject": "tamil",
        "difficulty": "easy",
        "sources": ["class-8-tamil-tamil-book.json"],
    },
    "class8:mathematics": {
        "redis_key": "samacheer:class8:mathematics",
        "subject": "mathematics",
        "difficulty": "easy",
        "sources": ["class-8-mathematics-english-book.json"],
    },
    "class8:science": {
        "redis_key": "samacheer:class8:science",
        "subject": "science",
        "difficulty": "easy",
        "sources": ["class-8-science-english-book.json"],
    },
    "class8:social-science": {
        "redis_key": "samacheer:class8:social-science",
        "subject": "social-science",
        "difficulty": "easy",
        "sources": ["class-8-social-science-english-book.json"],
    },
    "class9:english": {
        "redis_key": "samacheer:class9:english",
        "subject": "english",
        "difficulty": "medium",
        "sources": ["class-9-english-english-book.json"],
    },
    "class9:tamil": {
        "redis_key": "samacheer:class9:tamil",
        "subject": "tamil",
        "difficulty": "medium",
        "sources": ["class-9-tamil-tamil-book.json"],
    },
    "class9:mathematics": {
        "redis_key": "samacheer:class9:mathematics",
        "subject": "mathematics",
        "difficulty": "medium",
        "sources": ["class-9-mathematics-english-book.json"],
    },
    "class9:science": {
        "redis_key": "samacheer:class9:science",
        "subject": "science",
        "difficulty": "medium",
        "sources": ["class-9-science-english-book.json"],
    },
    "class9:social-science": {
        "redis_key": "samacheer:class9:social-science",
        "subject": "social-science",
        "difficulty": "medium",
        "sources": ["class-9-social-science-english-book.json"],
    },
    "class10:english": {
        "redis_key": "samacheer:class10:english",
        "subject": "english",
        "difficulty": "medium",
        "sources": ["class-10-english-english-book.json"],
    },
    "class10:tamil": {
        "redis_key": "samacheer:class10:tamil",
        "subject": "tamil",
        "difficulty": "medium",
        "sources": ["class-10-tamil-tamil-book.json"],
    },
    "class10:mathematics": {
        "redis_key": "samacheer:class10:mathematics",
        "subject": "mathematics",
        "difficulty": "medium",
        "sources": ["class-10-mathematics-english-book.json"],
    },
    "class10:science": {
        "redis_key": "samacheer:class10:science",
        "subject": "science",
        "difficulty": "medium",
        "sources": ["class-10-science-english-book.json"],
    },
    "class10:social-science": {
        "redis_key": "samacheer:class10:social-science",
        "subject": "social-science",
        "difficulty": "medium",
        "sources": ["class-10-social-science-english-book.json"],
    },
    "class11:english": {
        "redis_key": "samacheer:class11:english",
        "subject": "english",
        "difficulty": "hard",
        "sources": ["class-11-english-english-book.json"],
    },
    "class11:mathematics": {
        "redis_key": "samacheer:class11:mathematics",
        "subject": "mathematics",
        "difficulty": "hard",
        "sources": ["class-11-mathematics-english-book.json"],
    },
    "class11:physics": {
        "redis_key": "samacheer:class11:physics",
        "subject": "physics",
        "difficulty": "hard",
        "sources": ["class-11-physics-english-book.json"],
    },
    "class11:chemistry": {
        "redis_key": "samacheer:class11:chemistry",
        "subject": "chemistry",
        "difficulty": "hard",
        "sources": ["class-11-chemistry-english-book.json"],
    },
    "class11:history": {
        "redis_key": "samacheer:class11:history",
        "subject": "history",
        "difficulty": "hard",
        "sources": ["class-11-history-english-book.json"],
    },
    "class11:geography": {
        "redis_key": "samacheer:class11:geography",
        "subject": "geography",
        "difficulty": "hard",
        "sources": ["class-11-geography-english-book.json"],
    },
    "class11:political-science": {
        "redis_key": "samacheer:class11:political-science",
        "subject": "political-science",
        "difficulty": "hard",
        "sources": ["class-11-political-science-english-book.json"],
    },
    "class11:commerce": {
        "redis_key": "samacheer:class11:commerce",
        "subject": "commerce",
        "difficulty": "hard",
        "sources": ["class-11-commerce-english-book.json"],
    },
    "class11:economics": {
        "redis_key": "samacheer:class11:economics",
        "subject": "economics",
        "difficulty": "hard",
        "sources": ["class-11-economics-english-book.json"],
    },
    "class11:accountancy": {
        "redis_key": "samacheer:class11:accountancy",
        "subject": "accountancy",
        "difficulty": "hard",
        "sources": ["class-11-accountancy-english-book.json"],
    },
    "class11:botany": {
        "redis_key": "samacheer:class11:botany",
        "subject": "botany",
        "difficulty": "hard",
        "sources": ["class-11-botany-english-book.json"],
    },
    "class12:physics": {
        "redis_key": "samacheer:class12:physics",
        "subject": "physics",
        "difficulty": "hard",
        "sources": ["class-12-physics-english-book.json"],
    },
    "class12:chemistry": {
        "redis_key": "samacheer:class12:chemistry",
        "subject": "chemistry",
        "difficulty": "hard",
        "sources": ["class-12-chemistry-english-book.json"],
    },
    "class12:history": {
        "redis_key": "samacheer:class12:history",
        "subject": "history",
        "difficulty": "hard",
        "sources": ["class-12-history-english-book.json"],
    },
    "class12:geography": {
        "redis_key": "samacheer:class12:geography",
        "subject": "geography",
        "difficulty": "hard",
        "sources": ["class-12-geography-english-book.json"],
    },
    "class12:economics": {
        "redis_key": "samacheer:class12:economics",
        "subject": "economics",
        "difficulty": "hard",
        "sources": ["class-12-economics-english-book.json"],
    },
    "class12:accountancy": {
        "redis_key": "samacheer:class12:accountancy",
        "subject": "accountancy",
        "difficulty": "hard",
        "sources": ["class-12-accountancy-english-book.json"],
    },
    "class12:business-mathematics": {
        "redis_key": "samacheer:class12:business-mathematics",
        "subject": "business-mathematics",
        "difficulty": "hard",
        "sources": ["class-12-business-mathematics-english-book.json"],
    },
    "class12:commerce-accountancy": {
        "redis_key": "samacheer:class12:commerce-accountancy",
        "subject": "accountancy",
        "difficulty": "hard",
        "sources": ["class-12-accountancy-english-book.json"],
    },
}


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
RANDOM = random.Random(6)


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


def clean_text(text: str) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    text = text.replace(" .", ".").replace(" ,", ",")
    return text


def is_visual_dependent(*parts: str) -> bool:
    merged = " ".join(clean_text(part).lower() for part in parts if part)
    return any(phrase in merged for phrase in VISUAL_DEPENDENT_PHRASES)


def tamil_char_count(text: str) -> int:
    return sum(0x0B80 <= ord(ch) <= 0x0BFF for ch in text)


def ascii_letter_count(text: str) -> int:
    return sum(ch.isascii() and ch.isalpha() for ch in text)


def is_english_candidate(question: str, answer: str) -> bool:
    text = f"{question} {answer}"
    return ascii_letter_count(text) >= max(20, tamil_char_count(text) * 3)


def is_tamil_candidate(question: str, answer: str) -> bool:
    text = f"{question} {answer}"
    return tamil_char_count(text) >= 20 and tamil_char_count(text) > ascii_letter_count(text)


def normalize_key(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def split_mcq_from_text(question: str) -> Optional[Tuple[str, List[str]]]:
    marker = re.search(r"\([aA]\)", question)
    if not marker:
        return None
    stem = clean_text(question[: marker.start()])
    tail = question[marker.start() :]
    chunks = re.split(r"\([a-dA-D]\)", tail)
    labels = re.findall(r"\(([a-dA-D])\)", tail)
    if len(labels) != 4 or len(chunks) < 5:
        return None
    options = [clean_text(chunks[i + 1]) for i in range(4)]
    if any(not opt for opt in options):
        return None
    return stem.rstrip(": .?") + "?", options


def infer_answer_index(answer: str, options: Sequence[str]) -> Optional[int]:
    answer = clean_text(answer)
    if not answer:
        return None
    label_match = re.fullmatch(r"\(?([a-dA-D])\)?", answer)
    if label_match:
        return ord(label_match.group(1).lower()) - ord("a")
    lower_answer = normalize_key(answer)
    for idx, option in enumerate(options):
        if normalize_key(option) == lower_answer:
            return idx
    for idx, option in enumerate(options):
        if lower_answer and lower_answer in normalize_key(option):
            return idx
    return None


def looks_like_bad_answer(answer: str) -> bool:
    answer = clean_text(answer)
    return not answer or answer in {"T", "F"} or len(answer) < 1


def build_explanation(level: int, subject: str, chapter: str, answer: str, qtype: str) -> str:
    answer = clean_text(answer)
    chapter = clean_text(chapter) or "the chapter"
    if subject == "english" and ascii_letter_count(chapter) < 5:
        chapter = "the chapter"
    if qtype == "true_false":
        verdict = "true" if answer.lower() in {"true", "t"} else "false"
        return f"From the {chapter} exercise in Samacheer Kalvi Class {level} {subject} textbook, this statement is {verdict}."
    return f"From the {chapter} exercise in Samacheer Kalvi Class {level} {subject} textbook, the correct answer is {answer}."


def numeric_distractors(answer: str) -> List[str]:
    match = re.fullmatch(r"([`₹$€£-]?\s*\d+(?:,\d{3})*(?:\.\d+)?)\s*([A-Za-z%²³./-]*)", answer.strip())
    if not match:
        return []
    number_text, unit = match.groups()
    try:
        value = int(number_text.replace(",", "").replace("`", "").replace("₹", "").replace("$", "").replace("€", "").replace("£", "").strip())
    except ValueError:
        return []
    variants = [value + 1, max(0, value - 1), value + 10, max(0, value - 10)]
    out = []
    prefix = ""
    stripped_number = number_text.strip()
    if stripped_number[:1] in {"`", "₹", "$", "€", "£"}:
        prefix = stripped_number[:1]
    seen = set()
    for variant in variants:
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
    base = answer.lower()
    variants = ["x", "y", "z", "n", "m", "a", "b", "c"]
    out = []
    for variant in variants:
        if variant != base:
            out.append(variant if answer.islower() else variant.upper())
        if len(out) == 4:
            break
    return out


def build_distractors(answer: str, pool: Sequence[str], question: str) -> List[str]:
    answer = clean_text(answer)
    candidates: List[str] = []
    seen = {normalize_key(answer)}

    for item in numeric_distractors(answer):
        key = normalize_key(item)
        if key and key not in seen:
            seen.add(key)
            candidates.append(item)

    for item in alpha_distractors(answer):
        key = normalize_key(item)
        if key and key not in seen:
            seen.add(key)
            candidates.append(item)

    if len(candidates) >= 3:
        return candidates[:3]

    if len(candidates) >= 3:
        return candidates[:3]

    keyword_hints = re.findall(r"\(([A-Za-z][A-Za-z -]{1,30})\)", question)
    for hint in keyword_hints:
        key = normalize_key(hint)
        if key and key not in seen:
            seen.add(key)
            candidates.append(clean_text(hint))

    for item in pool:
        item = clean_text(item)
        key = normalize_key(item)
        if not item or key in seen or len(item) > 80:
            continue
        seen.add(key)
        candidates.append(item)
        if len(candidates) >= 6:
            break

    if len(candidates) < 3 and re.search(r"\b(or|and|because|but|so)\b", answer, re.I):
        for fallback in ["and", "but", "or", "so"]:
            key = normalize_key(fallback)
            if key not in seen:
                seen.add(key)
                candidates.append(fallback)
            if len(candidates) >= 3:
                break

    return candidates[:3]


def answer_is_option_safe(answer: str) -> bool:
    answer = clean_text(answer)
    if not answer or len(answer) > 60:
        return False
    if is_visual_dependent(answer):
        return False
    banned_markers = ["{", "}", "[", "]", "omitted", "missing figure", "missing values"]
    lowered = answer.lower()
    if any(marker in lowered for marker in banned_markers):
        return False
    if re.search(r"\([ivx]+\)", lowered):
        return False
    if answer.count(",") > 1 or ";" in answer:
        return False
    return True


def is_numericish_answer(answer: str) -> bool:
    answer = clean_text(answer)
    if not answer:
        return False
    stripped = re.sub(r"[\s,₹`$€£%cmkmgm²m³./°⁻¹⁻²⁻³()+=:-]+", "", answer.lower())
    stripped = stripped.replace("sq", "").replace("mm", "").replace("cm", "").replace("km", "")
    return bool(stripped) and stripped.isdigit()


def is_simple_phrase_answer(answer: str) -> bool:
    answer = clean_text(answer)
    if not answer:
        return False
    if any(sep in answer for sep in [";", "{", "}", "[", "]"]):
        return False
    if answer.count(",") > 0:
        return False
    if len(answer.split()) > 5:
        return False
    return True


def local_distractor_pool(records: Sequence[Dict[str, Any]], subject: str, base_record: Dict[str, Any]) -> List[str]:
    chapter = base_record.get("chapter_title")
    source_file = base_record.get("source_file")
    qtype = base_record.get("type")
    pool: List[str] = []
    seen = set()

    def eligible(record: Dict[str, Any]) -> bool:
        question = clean_text(record.get("question", ""))
        answer = clean_text(str(record.get("answer", "")))
        if record is base_record:
            return False
        if is_visual_dependent(question, answer):
            return False
        if subject == "english" and not is_english_candidate(question, answer):
            return False
        if subject == "tamil" and not is_tamil_candidate(question, answer):
            return False
        if not answer_is_option_safe(answer):
            return False
        same_chapter = chapter and record.get("chapter_title") == chapter
        same_file = source_file and record.get("source_file") == source_file
        same_type = qtype and record.get("type") == qtype
        return bool(same_chapter or same_file or same_type)

    for record in records:
        if not eligible(record):
            continue
        answer = clean_text(str(record.get("answer", "")))
        key = normalize_key(answer)
        if key and key not in seen:
            seen.add(key)
            pool.append(answer)
    return pool


def shuffled_options(correct: str, distractors: Sequence[str]) -> Tuple[List[str], int]:
    options = [clean_text(correct), *[clean_text(d) for d in distractors[:3]]]
    if len({normalize_key(x) for x in options}) != 4:
        return [], -1
    RANDOM.shuffle(options)
    answer_index = options.index(clean_text(correct))
    return options, answer_index


def strip_true_false_prefix(question: str) -> str:
    question = clean_text(question)
    question = re.sub(
        r"^Write '?T'? if the statement is True and '?F'? if the statement is False\.?\s*",
        "",
        question,
        flags=re.I,
    )
    question = re.sub(r"^\d+\.\s*", "", question)
    return question


def parse_tamil_mcq(question: str, answer: str) -> Optional[Tuple[str, List[str], int]]:
    parsed = split_mcq_from_text(question)
    if not parsed:
        return None
    stem, options = parsed
    answer_index = infer_answer_index(answer, options)
    if answer_index is None:
        return None
    return stem, options, answer_index


def build_question(record: Dict[str, Any], subject: str, answer_pool: Sequence[str], level: int, difficulty: str) -> Optional[Dict[str, Any]]:
    raw_question = clean_text(record.get("question", ""))
    raw_answer = clean_text(str(record.get("answer", "")))
    qtype = record.get("type", "")
    chapter_title = clean_text(record.get("chapter_title", ""))

    if not raw_question or is_visual_dependent(raw_question, raw_answer):
        return None

    if subject == "english" and not is_english_candidate(raw_question, raw_answer):
        return None
    if subject == "tamil" and not is_tamil_candidate(raw_question, raw_answer):
        return None

    if subject == "tamil":
        parsed = parse_tamil_mcq(raw_question, raw_answer)
        if not parsed:
            return None
        question_text, options, answer_index = parsed
        answer_value = options[answer_index]
    elif qtype == "mcq":
        parsed = split_mcq_from_text(raw_question)
        if parsed:
            question_text, options = parsed
            answer_index = infer_answer_index(raw_answer, options)
            if answer_index is None:
                return None
            answer_value = options[answer_index]
        else:
            # MCQ must carry its own 4 options from the question block itself.
            return None
    elif qtype == "fill_blank":
        if looks_like_bad_answer(raw_answer) or not answer_is_option_safe(raw_answer):
            return None
        distractors = build_distractors(raw_answer, answer_pool, raw_question)
        if len(distractors) < 3:
            return None
        options, answer_index = shuffled_options(raw_answer, distractors)
        if answer_index < 0:
            return None
        question_text = raw_question
        answer_value = raw_answer
    elif qtype == "true_false":
        if raw_answer.lower() not in {"true", "false", "t", "f"}:
            if raw_answer.lower().startswith("false"):
                raw_answer = "False"
            elif raw_answer.lower().startswith("true"):
                raw_answer = "True"
            else:
                return None
        question_text = strip_true_false_prefix(raw_question)
        options = ["True", "False", "Cannot be determined", "Both are correct"]
        answer_value = "True" if raw_answer.lower().startswith("t") else "False"
        answer_index = options.index(answer_value)
    elif qtype == "short_answer":
        if looks_like_bad_answer(raw_answer) or not answer_is_option_safe(raw_answer):
            return None
        if subject in {"mathematics", "business-mathematics"} and not is_numericish_answer(raw_answer):
            return None
        if subject not in {"mathematics", "business-mathematics"} and not (
            is_numericish_answer(raw_answer) or is_simple_phrase_answer(raw_answer)
        ):
            return None
        distractors = build_distractors(raw_answer, answer_pool, raw_question)
        if len(distractors) < 3:
            return None
        options, answer_index = shuffled_options(raw_answer, distractors)
        if answer_index < 0:
            return None
        question_text = raw_question if raw_question.endswith("?") else raw_question + "?"
        answer_value = raw_answer
    elif qtype == "match_following":
        if looks_like_bad_answer(raw_answer) or not answer_is_option_safe(raw_answer):
            return None
        if not is_simple_phrase_answer(raw_answer):
            return None
        distractors = build_distractors(raw_answer, answer_pool, raw_question)
        if len(distractors) < 3:
            return None
        options, answer_index = shuffled_options(raw_answer, distractors)
        if answer_index < 0:
            return None
        question_text = f"Choose the correct match: {raw_question}"
        answer_value = raw_answer
    else:
        return None

    item = {
        "question_text": clean_text(question_text),
        "options": [clean_text(opt) for opt in options],
        "correct_answer": answer_index,
        "explanation": build_explanation(level, subject, chapter_title, answer_value, qtype),
        "difficulty": difficulty,
        "class": level,
        "subject": subject,
        "chapter_number": record.get("chapter_number"),
        "chapter_title": chapter_title,
        "question_type": qtype,
        "source_file": record.get("source_file"),
        "source_pdf": record.get("source_pdf"),
        "textbook_page_range": record.get("textbook_page_range"),
        "pdf_page_range": record.get("pdf_page_range"),
        "source_question_number": record.get("question_number"),
    }
    return item


def load_records(subject: str, config: Dict[str, Any]) -> List[Dict[str, Any]]:
    records: List[Dict[str, Any]] = []
    for source_name in config["sources"]:
        path = ROOT / source_name
        if not path.exists():
            continue
        with path.open(encoding="utf-8") as handle:
            payload = json.load(handle)
        for record in payload.get("questions", []):
            rec = dict(record)
            rec["source_file"] = source_name
            rec["source_pdf"] = payload.get("book", {}).get("path")
            records.append(rec)
    return records


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


def item_sha256(item: Dict[str, Any]) -> str:
    payload = {
        "question_text": clean_text(item["question_text"]),
        "options": [clean_text(opt) for opt in item["options"]],
        "correct_answer": item["correct_answer"],
    }
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def subject_pool(records: Sequence[Dict[str, Any]], subject: str) -> List[str]:
    pool: List[str] = []
    seen = set()
    for record in records:
        question = clean_text(record.get("question", ""))
        answer = clean_text(str(record.get("answer", "")))
        if subject == "english" and not is_english_candidate(question, answer):
            continue
        if subject == "tamil" and not is_tamil_candidate(question, answer):
            continue
        if not answer or len(answer) > 80:
            continue
        key = normalize_key(answer)
        if key and key not in seen:
            seen.add(key)
            pool.append(answer)
    return pool


def build_subject_items(subject: str, config: Dict[str, Any]) -> List[Dict[str, Any]]:
    records = load_records(subject, config)
    items: List[Dict[str, Any]] = []
    level = int(config["class"])
    difficulty = str(config["difficulty"])
    for record in records:
        pool = local_distractor_pool(records, subject, record)
        item = build_question(record, subject, pool, level, difficulty)
        if item:
            items.append(item)
    return dedupe_questions(items)


def push_subject(key: str, items: Sequence[Dict[str, Any]]) -> None:
    items = dedupe_questions(items)
    redis_post(["DEL", f"quiz:subject:{key}"])
    batch_size = 100
    for start in range(0, len(items), batch_size):
        batch = [json.dumps(item, ensure_ascii=False) for item in items[start : start + batch_size]]
        redis_post(["RPUSH", f"quiz:subject:{key}", *batch])


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("scopes", nargs="*")
    parser.add_argument("--report-file", default=str(REPORT_FILE))
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    report: Dict[str, Any] = {"scope": "samacheer_safe_push", "subjects": {}}
    scope_keys = list(SAMACHEER_SCHEMA.keys())
    if args.scopes:
        scope_keys = [scope for scope in args.scopes if scope in SAMACHEER_SCHEMA]

    for scope_key in scope_keys:
        config = dict(SAMACHEER_SCHEMA[scope_key])
        subject = str(config["subject"])
        config["class"] = int(scope_key.split(":", 1)[0].replace("class", ""))
        items = build_subject_items(subject, config)
        push_subject(config["redis_key"], items)
        report["subjects"][scope_key] = {
            "redis_key": config["redis_key"],
            "class": config["class"],
            "subject": subject,
            "count": len(items),
            "sample_questions": [item["question_text"] for item in items[:5]],
        }
        print(f"{scope_key}: pushed {len(items)} items to quiz:subject:{config['redis_key']}")

    report_path = Path(args.report_file)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"report: {report_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
