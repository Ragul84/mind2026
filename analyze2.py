# -*- coding: utf-8 -*-
import json, re
from collections import Counter
rows=[json.loads(l) for l in open("data/pyq-corpus/questions.jsonl",encoding="utf-8") if l.strip()]
def opts(r):
    o=r.get("options"); return o if isinstance(o,list) else []
def qt(r): return (r.get("question_text") or "")
norm=lambda s: re.sub(r'[^a-z0-9]+',' ',s.strip().lower()).strip()[:140]
instr=re.compile(r'answer all|carry equal marks|do not tick|english version|failure to comply|winmeen|this booklet', re.I)

def clean(r):
    return len(opts(r))>=2 and len(qt(r).replace(' ',''))>=20 and not instr.search(qt(r)) and qt(r).count('�')<=2

# unique-clean per exam (dedup by normalized stem within exam)
seen=set(); uniq_by_exam=Counter(); clean_by_exam=Counter(); total_by_exam=Counter()
for r in rows:
    e=r.get("exam"); total_by_exam[e]+=1
    if not clean(r): continue
    clean_by_exam[e]+=1
    key=(e,norm(qt(r)))
    if key in seen: continue
    seen.add(key); uniq_by_exam[e]+=1

print(f"{'exam':8} {'total':>7} {'clean':>7} {'uniqClean':>9}")
tot=cl=uq=0
for e in ['UPSC','SSC','NEET','TNPSC','Banking','JEE']:
    print(f"{e:8} {total_by_exam[e]:>7} {clean_by_exam[e]:>7} {uniq_by_exam[e]:>9}")
    tot+=total_by_exam[e]; cl+=clean_by_exam[e]; uq+=uniq_by_exam[e]
print(f"{'ALL':8} {tot:>7} {cl:>7} {uq:>9}")

# how bad is UPSC duplication? show a few most-repeated UPSC stems
upsc=[qt(r) for r in rows if r.get('exam')=='UPSC' and clean(r)]
c=Counter(norm(x) for x in upsc)
print("\nTop repeated UPSC stems (count):")
for s,n in c.most_common(5):
    print(f"  {n}x  {s[:70]}")
