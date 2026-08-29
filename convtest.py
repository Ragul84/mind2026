# -*- coding: utf-8 -*-
from tamil import txt2unicode
samples = {
  "bamini_known": "jpUf;Fws;",
  "bamini_phrase": "kw;Wk;",
  "bamini_row": "i kw;Wk; ii rhp",
  "ocr_image": "ls6OTD GsT DI",
}
funcs = ["bamini2unicode","tscii2unicode","tab2unicode","auto2unicode"]
import tamil.txt2unicode as t
have = [f for f in funcs if hasattr(t,f)]
print("available:", have)
for name,s in samples.items():
    print("====", name, "::", s)
    for f in have:
        try:
            out = getattr(t,f)(s)
            print(f"  {f}: {out}")
        except Exception as e:
            print(f"  {f}: ERR {e}")
