import math
import numpy as np
from PIL import Image
import sim_preview as S

# Direkter A/B-Vergleich: gleiche Fische, gleiche Phase/Env, nur Spine-Modus unterschiedlich
ids = ["koi-03", "koi-32", "koi-16", "koi-11"]
env = 0.95
phase = 1.2

def panel(mode):
    canvas = Image.new("RGB", (1200, 340), (18, 26, 20))
    x0 = 20
    for fid in ids:
        t = S.types[fid]
        sprite, bx0, by0, bx1, by1 = t.sprite(phase, env, mode)
        target_h = 300
        scale = target_h / ((by1-by0))
        w = int((bx1-bx0)*scale)
        sr = sprite.resize((w, target_h), Image.LANCZOS)
        canvas.paste(sr, (x0, 20), sr)
        x0 += w + 30
    return canvas

curved = panel("curved")
straight = panel("straight")
out = Image.new("RGB", (1200, 700), (10, 14, 11))
out.paste(curved, (0, 0))
out.paste(straight, (0, 360))
out.save("preview/compare_spine.png")
print("ok")
