# -*- coding: utf-8 -*-
import json, re
from collections import Counter
rows=[json.loads(l) for l in open("data/pyq-corpus/questions.jsonl",encoding="utf-8") if l.strip()]
n=len(rows)
print("TOTAL rows:", n)

def opts(r): 
    o=r.get("options"); return o if isinstance(o,list) else []
def qt(r): return (r.get("question_text") or "")

# option-count buckets
oc=Counter(len(opts(r)) for r in rows)
print("\noption-count distribution:")
for k in sorted(oc): print(f"  {k} opts: {oc[k]}")

# junk heuristics
short=sum(1 for r in rows if len(qt(r).replace(' ',''))<15)
one_opt=sum(1 for r in rows if len(opts(r))<2)
repl=sum(1 for r in rows if qt(r).count('�')>2)
# instruction-like
instr_pat=re.compile(r'answer all|carry equal marks|do not tick|english version|failure to comply|turn over|winmeen|booklet', re.I)
instr=sum(1 for r in rows if instr_pat.search(qt(r)))
# garbled latin-font (TSCII/scan) — lots of non-word capital/digit clusters, few real words
def garbled(r):
    t=qt(r)
    if not t: return True
    # ratio of tamil-unicode
    tamil=len(re.findall(r'[஀-௿]',t))
    latin=len(re.findall(r'[A-Za-z]',t))
    # meaningless if many isolated caps/digits mixed (scan OCR)
    weird=len(re.findall(r'[A-Z]{2,}[0-9]|[0-9][A-Za-z]{2,}',t))
    return weird>=3 and tamil<3

garb=sum(1 for r in rows if garbled(r))

# duplicate question_text (normalized)
norm=lambda s: re.sub(r'\s+',' ',s.strip().lower())[:120]
dups=Counter(norm(qt(r)) for r in rows if len(qt(r))>15)
dup_extra=sum(c-1 for c in dups.values() if c>1)

print("\n-- junk signals (overlapping) --")
print("very short stem (<15 chars):", short)
print("fewer than 2 options:", one_opt)
print("replacement-char garbled:", repl)
print("instruction/footer lines:", instr)
print("scan-OCR garbled stems:", garb)
print("duplicate-text extra copies:", dup_extra)

# by exam
print("\nby exam:")
for k,v in Counter(r.get("exam") for r in rows).most_common(): print(f"  {k}: {v}")

# rough "clean MCQ" = >=2 options, stem>=15, not instruction, not replacement-garbled
def clean(r):
    return len(opts(r))>=2 and len(qt(r).replace(' ',''))>=15 and not instr_pat.search(qt(r)) and qt(r).count('�')<=2
cl=sum(1 for r in rows if clean(r))
print("\nrough CLEAN MCQ (>=2 opts, real stem):", cl)
