"""
Referenz-Renderer: reproduziert Vertex-Deformation + Bewegungslogik aus main.js
in Python/numpy, um den (auth-blockierten) Live-Browser zu ersetzen.
Bend-Modell: pro Spalte x eine starre Rotation um den zugehoerigen Spine-Pivot
(aequivalent zur Shader-Logik: aU/aSpine sind pro Spalte na hezu konstant),
per iterativem inversen Mapping vektorisiert gerendert (kein PIL-MESH-Missbrauch).
"""
import os, json, math
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.expanduser("~/mnt/Fischi_Hub/website/koi-test")
OUT = os.path.join(ROOT, "preview")
os.makedirs(OUT, exist_ok=True)

A_MAX = math.radians(14)
N_WAVES = 0.55
REF_PX_PER_UNIT = 340

manifest = json.load(open(os.path.join(ROOT, "assets/manifest.json")))
fish_meta = manifest["fish"]
pondW, pondH = manifest["pond"]["w"], manifest["pond"]["h"]
pondAspect = pondW / pondH

pond_img = Image.open(os.path.join(ROOT, "assets/pond.jpg")).convert("RGB")
fg_img = Image.open(os.path.join(ROOT, "assets/foreground.png")).convert("RGBA")

def mulberry32_js(seed):
    state = seed & 0xffffffff
    def rnd():
        nonlocal state
        state = (state + 0x6D2B79F5) & 0xffffffff
        t = state
        t = (t ^ (t >> 15)) & 0xffffffff
        t = (t * ((t | 1) & 0xffffffff)) & 0xffffffff
        u = t
        v = (u ^ (u >> 7)) & 0xffffffff
        v = (v * ((v | 61) & 0xffffffff)) & 0xffffffff
        t = (v ^ t) & 0xffffffff
        t = (t ^ (t >> 14)) & 0xffffffff
        return t / 4294967296.0
    return rnd

def bilinear_sample(rgba, tx, ty):
    """rgba: HxWx4 uint8 array. tx,ty: float arrays (pixel coords, x along W, y along H).
    Rueckgabe: gleiche Form + (4,) Kanal, 0 ausserhalb."""
    H, W = rgba.shape[:2]
    x0 = np.floor(tx).astype(np.int64); y0 = np.floor(ty).astype(np.int64)
    x1 = x0 + 1; y1 = y0 + 1
    fx = (tx - x0)[..., None]; fy = (ty - y0)[..., None]
    valid = (x0 >= 0) & (x1 < W) & (y0 >= 0) & (y1 < H)
    xc0 = np.clip(x0, 0, W-1); xc1 = np.clip(x1, 0, W-1)
    yc0 = np.clip(y0, 0, H-1); yc1 = np.clip(y1, 0, H-1)
    c00 = rgba[yc0, xc0].astype(np.float32); c10 = rgba[yc0, xc1].astype(np.float32)
    c01 = rgba[yc1, xc0].astype(np.float32); c11 = rgba[yc1, xc1].astype(np.float32)
    top = c00*(1-fx) + c10*fx
    bot = c01*(1-fx) + c11*fx
    out = top*(1-fy) + bot*fy
    out[~valid] = 0
    return out

class FishType:
    def __init__(self, fid, meta):
        self.fid = fid
        self.w, self.h = meta["w"], meta["h"]
        self.aspect = self.h / self.w
        self.tex = np.asarray(Image.open(os.path.join(ROOT, "assets", meta["file"])).convert("RGBA"))
        su = np.array(meta["spineX"]); sv = np.array(meta["spineY"]); sU = np.array(meta["spineU"])
        self.sU = sU
        self.slx = {"curved": su - 0.5, "straight": None}
        self.sly = {"curved": -(sv - 0.5) * self.aspect, "straight": None}
        x0,y0,x1,y1 = self.slx["curved"][0], self.sly["curved"][0], self.slx["curved"][-1], self.sly["curved"][-1]
        self.slx["straight"] = x0 + (x1-x0)*sU
        self.sly["straight"] = y0 + (y1-y0)*sU
        # pro-Spalte Lookup (aU, pivotX, pivotY) fuer beide Modi
        cols = (np.arange(self.w)+0.5)/self.w - 0.5   # lokale x-Koordinate je Spalte
        self.col_localx = cols
        self.lut = {}
        for mode in ("curved", "straight"):
            slx, sly = self.slx[mode], self.sly[mode]
            order = np.argsort(slx)
            slx_s, sly_s, sU_s = slx[order], sly[order], sU[order]
            nearest = np.argmin(np.abs(cols[:, None] - slx[None, :]), axis=1)
            self.lut[mode] = dict(
                aU=sU[nearest], pivx=slx[nearest], pivy=sly[nearest],
                slx_sorted=slx_s, sly_sorted=sly_s, sU_sorted=sU_s,
            )

    def _nearest_2d(self, mode, qx, qy):
        """Echtes 2D-Nearest-Neighbor zur Spine (wie im Shader: naechster
        Spine-Punkt zur lokalen Vertexposition), nicht nur ueber x. Robust
        auch bei stark gekruemmten Fischen (x nicht monoton entlang der Spine)."""
        slx, sly = self.slx[mode], self.sly[mode]
        sU = self.sU
        shp = qx.shape
        qxf = qx.ravel(); qyf = qy.ravel()
        d2 = (qxf[:, None]-slx[None, :])**2 + (qyf[:, None]-sly[None, :])**2
        idx = np.argmin(d2, axis=1)
        return sU[idx].reshape(shp), slx[idx].reshape(shp), sly[idx].reshape(shp)

    def sprite(self, phase, env, mode, pad_frac=0.10):
        """Bend-deformiertes Sprite (nur Biegung, KEIN heading/scale) in lokalen
        Einheiten. Rueckgabe: PIL-RGBA-Bild + Bounding-Box (bx0,by0,bx1,by1)."""
        aspect = self.aspect
        # 1) grobe Vorwaerts-Bbox schaetzen: max. Auslenkung an y-Extremen der Kontur
        max_amp = env*A_MAX
        pad = pad_frac*max(1.0, aspect) + max_amp*0.6
        bx0, bx1 = -0.5-pad, 0.5+pad
        by0, by1 = -0.5*aspect-pad, 0.5*aspect+pad
        outW = min(900, max(8, int((bx1-bx0)*REF_PX_PER_UNIT)))
        outH = min(900, max(8, int((by1-by0)*REF_PX_PER_UNIT)))
        OX, OY = np.meshgrid(np.arange(outW), np.arange(outH))
        ox = bx0 + (OX+0.5)/outW*(bx1-bx0)
        oy = by1 - (OY+0.5)/outH*(by1-by0)
        # 2) inverse Iteration: finde Quellspalte x, sodass bend(x,y)=(ox,oy)
        sxg, syg = ox.copy(), oy.copy()
        for _ in range(3):
            aU, pivx, pivy = self._nearest_2d(mode, sxg, syg)
            ang = env*A_MAX*aU*aU*np.sin(phase - 2*math.pi*N_WAVES*aU)
            c, s = np.cos(-ang), np.sin(-ang)
            dx, dy = ox-pivx, oy-pivy
            sxg = pivx + c*dx - s*dy
            syg = pivy + s*dx + c*dy
        tx = (sxg+0.5)*self.w
        ty = (0.5 - syg/aspect)*self.h
        rgba = bilinear_sample(self.tex, tx, ty)
        img = Image.fromarray(np.clip(rgba,0,255).astype(np.uint8), "RGBA")
        return img, bx0, by0, bx1, by1

types = {fid: FishType(fid, meta) for fid, meta in fish_meta.items()}
print(f"{len(types)} Fischtypen geladen (spaltenbasiertes Bend-Modell)")

def make_actors(n):
    ids = list(types.keys())
    actors = []
    for i in range(n):
        rnd = mulberry32_js(i*97+13)
        fid = ids[i % len(ids)]
        L = 0.075 + rnd()*0.06
        cx = (rnd()-0.5)*0.95
        cy = (rnd()-0.5)*0.95/pondAspect
        ax = 0.10+rnd()*0.22; ay = 0.08+rnd()*0.18
        fx = 0.05+rnd()*0.08; fy = 0.04+rnd()*0.07
        ph = rnd()*2*math.pi; ph2 = rnd()*2*math.pi
        driftX = (rnd()-0.5)*0.035; driftY=(rnd()-0.5)*0.02
        freqHz = 0.5+rnd()*0.45; phase0 = rnd()*2*math.pi
        actors.append(dict(fid=fid, L=L, cx=cx, cy=cy, ax=ax, ay=ay, fx=fx, fy=fy,
                            ph=ph, ph2=ph2, driftX=driftX, driftY=driftY, freqHz=freqHz, phase=phase0))
    return actors

def wrap(v, half):
    span = half*2
    x = (v+half) % span
    if x < 0: x += span
    return x-half

def actor_state(a, t, dt_phase):
    dcx = a["cx"] + a["driftX"]*t; dcy = a["cy"] + a["driftY"]*t
    x = wrap(dcx, 0.6) + math.sin(t*a["fx"]*2*math.pi + a["ph"]) * a["ax"]
    y = wrap(dcy, 0.6/pondAspect) + math.sin(t*a["fy"]*2*math.pi + a["ph2"]) * a["ay"]
    dx = math.cos(t*a["fx"]*2*math.pi + a["ph"]) * a["ax"] * a["fx"]*2*math.pi + a["driftX"]
    dy = math.cos(t*a["fy"]*2*math.pi + a["ph2"]) * a["ay"] * a["fy"]*2*math.pi + a["driftY"]
    heading = math.atan2(dy, dx)
    speed = min(1.0, math.hypot(dx,dy)/0.25)
    a["phase"] += 2*math.pi*a["freqHz"]*dt_phase*(0.4+0.8*speed)
    env = 0.45+0.55*speed
    return x, y, heading, env

def cover_fit(viewport_aspect):
    if viewport_aspect > pondAspect:
        vw, vh = 1.0, 1.0/viewport_aspect
    else:
        vh, vw = 1.0/pondAspect, (1.0/pondAspect)*viewport_aspect
    return vw, vh

_font_cache = {}
def get_font(size, bold=False):
    key=(size,bold)
    if key not in _font_cache:
        from PIL import ImageFont
        path = "/usr/share/fonts/truetype/lato/Lato-%s.ttf" % ("Bold" if bold else "Regular")
        _font_cache[key] = ImageFont.truetype(path, size)
    return _font_cache[key]

def render_frame(actors_states, canvasW, canvasH, mode="curved", occlusion=True, text=False):
    ar = canvasW/canvasH
    vw, vh = cover_fit(ar)
    scale = canvasW/vw
    pond_crop_w = int(round(vw*pondW)); pond_crop_h = int(round(vh*pondH))
    cx0 = (pondW-pond_crop_w)//2; cy0=(pondH-pond_crop_h)//2
    base = pond_img.crop((cx0,cy0,cx0+pond_crop_w,cy0+pond_crop_h)).resize((canvasW,canvasH), Image.LANCZOS).convert("RGBA")
    for a, (x,y,heading,env) in actors_states:
        t = types[a["fid"]]
        sprite, bx0,by0,bx1,by1 = t.sprite(a["phase"], env, mode)
        L = a["L"]
        target_w = max(2, int(round((bx1-bx0)*L*scale)))
        target_h = max(2, int(round((by1-by0)*L*scale)))
        sr = sprite.resize((target_w, target_h), Image.BILINEAR)
        deg = -math.degrees(heading) - 90  # Bildkonvention: Kopf entlang +u (rechts) -> Rotation anpassen
        rot = sr.rotate(deg, expand=True, resample=Image.BILINEAR)
        # Zentrum des unrotierten Sprites im lokalen Fischursprung (0,0) vor Rotation:
        cxw = (0 - bx0)/(bx1-bx0) * target_w
        cyh = (1-(0-by0)/(by1-by0)) * target_h
        # nach PIL-Rotation um Bildmitte: neuer Ankerpunkt bestimmen
        ang = math.radians(deg)
        ccx, ccy = target_w/2, target_h/2
        ox, oy = cxw-ccx, cyh-ccy
        rcx = ox*math.cos(-ang) - oy*math.sin(-ang) + rot.width/2
        rcy = ox*math.sin(-ang) + oy*math.cos(-ang) + rot.height/2
        px = (x + vw/2)/vw*canvasW - rcx
        py = (1-(y+vh/2)/vh)*canvasH - rcy
        base.alpha_composite(rot, (int(round(px)), int(round(py))))
    if occlusion:
        fg_crop = fg_img.crop((cx0,cy0,cx0+pond_crop_w,cy0+pond_crop_h)).resize((canvasW,canvasH), Image.LANCZOS)
        base.alpha_composite(fg_crop)
    if text:
        d = ImageDraw.Draw(base, "RGBA")
        f1 = get_font(int(canvasH*0.075), bold=True)
        f2 = get_font(int(canvasH*0.028))
        d.text((canvasW*0.07, canvasH*0.17), "Nils Czarnetzki", font=f1, fill=(255,255,255,255))
        d.text((canvasW*0.072, canvasH*0.17+canvasH*0.10), "Persönliche Wissenschaft — Philosophie, Logik, MINT", font=f2, fill=(238,244,236,235))
    return base.convert("RGB")

N_FISH = 30
DUR_S = 3.0
FPS = 12
n_frames = int(DUR_S*FPS)

def run_clip(name, canvasW, canvasH, mode="curved", occlusion=True, text=False, n_fish=N_FISH):
    actors = make_actors(n_fish)
    seq_dir = os.path.join(OUT, f"seq_{name}")
    os.makedirs(seq_dir, exist_ok=True)
    dt = 1.0/FPS
    for fi in range(n_frames):
        t = fi*dt
        states = [(a, actor_state(a, t, dt)) for a in actors]
        frame = render_frame(states, canvasW, canvasH, mode=mode, occlusion=occlusion, text=text)
        frame.save(os.path.join(seq_dir, f"f_{fi:03d}.png"))
    print(f"{name}: {n_frames} Frames -> {seq_dir}")
    return seq_dir

if __name__ == "__main__":
    import sys
    which = sys.argv[1] if len(sys.argv)>1 else "all"
    if which in ("all","desktop"):
        run_clip("desktop_v2", 1280, 720, mode="curved", occlusion=True, text=True)
    if which in ("all","mobile"):
        run_clip("mobile_v2", 720, 1280, mode="curved", occlusion=True, text=True)
    if which in ("all","straight"):
        run_clip("straight", 1280, 720, mode="straight", occlusion=True, text=False, n_fish=14)
    if which in ("all","noccl"):
        run_clip("noccl", 1280, 720, mode="curved", occlusion=False, text=False, n_fish=N_FISH)
