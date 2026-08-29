#!/usr/bin/env python3
"""Master art job: generate every onboarding Miga pose (free, Cloudflare FLUX) with
a LOCKED identity block for max consistency, then auto-remove the background to a
transparent PNG. Output -> assets/mascot/onboarding/<name>.png

Run:  python tools/genpack.py            (all)
      python tools/genpack.py welcome_hero streak_celebrate   (subset)
"""
import sys, pathlib
from rembg import remove
from PIL import Image
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import genimage

CHAR = ("Miga the brand mascot, ALWAYS identical: an adorable soft 3D rendered chibi cat-fox, "
        "cyan sky-blue fluffy fur, fluffy cream-white cheeks belly and muzzle, spiky purple-indigo "
        "mohawk tuft on the head, large round dark sparkly friendly eyes, a small purple superhero "
        "cape, purple gloves and purple boots, a single bright yellow lightning-bolt emblem on the "
        "chest, purple-tipped fluffy tail, rounded chunky cute proportions, soft Pixar / DreamWorks "
        "premium mobile-game 3D rendering, soft even studio lighting. Full body, centered, on a plain "
        "solid pure white background, no text, no drop shadow, no props unless stated.")

POSES = {
    "welcome_hero":     "Pose: flying like Superman through the air, cape flowing behind, one arm stretched forward, big joyful open smile, dynamic mid-air hero pose.",
    "streak_celebrate": "Pose: jumping happily with both arms raised celebrating, winking one eye, cheerful open smile, excited.",
    "studylab_peek":    "Pose: peeking upward playfully with both paws raised near the face, curious excited wide smile, looking up.",
    "meetmiga_wink":    "Pose: standing friendly, winking one eye, one paw giving a small wave hello, warm smile.",
    "quiz_thumbsup":    "Pose: giving a big thumbs-up with one paw, confident happy grin, standing.",
    "signup_welcome":   "Pose: standing happily with both arms open in a warm welcoming gesture, big friendly smile.",
}

raw = pathlib.Path("tools/art_raw"); out = pathlib.Path("assets/mascot/onboarding")
raw.mkdir(parents=True, exist_ok=True); out.mkdir(parents=True, exist_ok=True)

names = [a for a in sys.argv[1:]] or list(POSES)
for name in names:
    action = POSES[name]
    rawp = raw / f"{name}.png"
    print(f"--- {name} ---")
    genimage.cloudflare(f"{CHAR} {action}", str(rawp), 1024, 1024)
    cut = remove(Image.open(rawp).convert("RGBA"))
    cut.save(out / f"{name}.png")
    print(f"CUTOUT {out / f'{name}.png'}")
