#!/usr/bin/env python3
"""
Free image generator for MindGains assets. Supports multiple providers so we can
use whichever free key is available:

  --provider together    Together AI  FLUX.1 [schnell] Free  (free key, NO card)   [recommended]
  --provider gemini      Google Gemini "Nano Banana"        (needs billing)
  --provider pollinations  Pollinations.ai FLUX             (no key, low quality)

Keys live in tools/.env (gitignored): TOGETHER_API_KEY=... or GEMINI_API_KEY=...

Usage:
  python tools/genimage.py --provider together --out assets/onboarding/miga/miga-wave.png --prompt "..."

Install once:  pip install google-genai requests
"""
import argparse, os, sys, base64, pathlib, urllib.parse

def env(name):
    v = os.environ.get(name)
    if v:
        return v
    envp = pathlib.Path(__file__).with_name(".env")
    if envp.exists():
        for line in envp.read_text().splitlines():
            if line.strip().startswith(name + "="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None

def save(out, data: bytes):
    p = pathlib.Path(out)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)
    print(f"OK  {out}  ({len(data)} bytes)")

def together(prompt, out, w, h):
    import requests
    key = env("TOGETHER_API_KEY") or sys.exit("No TOGETHER_API_KEY in tools/.env")
    r = requests.post(
        "https://api.together.xyz/v1/images/generations",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json={"model": "black-forest-labs/FLUX.1-schnell-Free", "prompt": prompt,
              "width": w, "height": h, "steps": 4, "n": 1},
        timeout=120,
    )
    if r.status_code != 200:
        sys.exit(f"Together {r.status_code}: {r.text[:400]}")
    d = r.json()["data"][0]
    if d.get("b64_json"):
        save(out, base64.b64decode(d["b64_json"]))
    elif d.get("url"):
        save(out, requests.get(d["url"], timeout=120).content)
    else:
        sys.exit(f"Together: no image in response {str(d)[:300]}")

def gemini(prompt, out, w, h):
    from google import genai
    key = env("GEMINI_API_KEY") or sys.exit("No GEMINI_API_KEY in tools/.env")
    client = genai.Client(api_key=key)
    resp = client.models.generate_content(model="gemini-2.5-flash-image", contents=[prompt])
    for part in resp.candidates[0].content.parts:
        dat = getattr(part, "inline_data", None)
        if dat and getattr(dat, "data", None):
            return save(out, dat.data)
    txt = "".join(getattr(p, "text", "") or "" for p in resp.candidates[0].content.parts)
    sys.exit(f"Gemini: no image. Said: {txt[:300]}")

def cloudflare(prompt, out, w, h):
    import requests
    acct = env("CF_ACCOUNT_ID") or sys.exit("No CF_ACCOUNT_ID in tools/.env")
    token = env("CF_API_TOKEN") or sys.exit("No CF_API_TOKEN in tools/.env")
    url = f"https://api.cloudflare.com/client/v4/accounts/{acct}/ai/run/@cf/black-forest-labs/flux-1-schnell"
    r = requests.post(url, headers={"Authorization": f"Bearer {token}"},
                      json={"prompt": prompt, "steps": 8}, timeout=120)
    if r.status_code != 200:
        sys.exit(f"Cloudflare {r.status_code}: {r.text[:400]}")
    j = r.json()
    img = (j.get("result") or {}).get("image")
    if not img:
        sys.exit(f"Cloudflare: no image {str(j)[:300]}")
    save(out, base64.b64decode(img))

def pollinations(prompt, out, w, h):
    import requests
    enc = urllib.parse.quote(prompt)
    url = f"https://image.pollinations.ai/prompt/{enc}?width={w}&height={h}&model=flux&nologo=true"
    save(out, requests.get(url, timeout=120).content)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--provider", default="cloudflare", choices=["cloudflare", "together", "gemini", "pollinations"])
    ap.add_argument("--w", type=int, default=768)
    ap.add_argument("--h", type=int, default=1152)
    a = ap.parse_args()
    {"cloudflare": cloudflare, "together": together, "gemini": gemini, "pollinations": pollinations}[a.provider](a.prompt, a.out, a.w, a.h)

if __name__ == "__main__":
    main()
