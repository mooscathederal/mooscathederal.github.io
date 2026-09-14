from PIL import Image
import sim_preview as S

fid = "koi-32"
phase = 1.2
for mode in ("straight","curved"):
    t = S.types[fid]
    sprite, bx0,by0,bx1,by1 = t.sprite(phase, 1.0, mode)
    sprite = sprite.resize((sprite.width*2, sprite.height*2), Image.LANCZOS)
    sprite.save(f"preview/zoom_{fid}_{mode}.png")
print("ok", sprite.size)
