import os, glob, json
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.expanduser("~/mnt/Fischi_Hub")
OUTW = os.path.join(ROOT, "website/koi-test/assets")
FISH_SRC = sorted(glob.glob(os.path.join(ROOT, "32 Koi Vorlage PNG/Fische/*.png")))
EXCLUDE = {"koi-06"}  # aspect zu stark gekruemmt, PCA-Achse unbrauchbar (siehe BEFUND.md)

os.makedirs(os.path.join(OUTW, "fish"), exist_ok=True)

# ---------- Hintergrund + Occlusion-Layer ----------
bg = Image.open(os.path.join(ROOT, "agent_work/Hintergrund.png")).convert("RGB")
bg.save(os.path.join(OUTW, "pond.jpg"), quality=90)
W, H = bg.size

lum = np.asarray(bg.convert("L"), dtype=np.float32)
sm = np.asarray(Image.fromarray(lum.astype(np.uint8)).filter(ImageFilter.GaussianBlur(9)), np.float32)
thr = np.percentile(sm, 72)
mask = np.clip((sm - thr) / (sm.max() - thr), 0, 1) ** 0.8
# Kontrast anheben: Kronenoberseiten sollen nahe 1 erreichen (echte Verdeckung),
# nicht nur 0.3-0.6 (Dunst). Wird jetzt pro Fisch im Fragmentshader gesampelt,
# nicht mehr als globale Vollbild-Ebene -- daher reicht eine kleine Graustufe.
mask = np.clip((mask - 0.30) / 0.55, 0, 1)
maskI = Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2))
crown_w = 640
crown_h = max(1, int(round(H * crown_w / W)))
crownSmall = maskI.resize((crown_w, crown_h), Image.LANCZOS).convert("L")
crownSmall.save(os.path.join(OUTW, "crown_mask.jpg"), quality=85)
old_fg = os.path.join(OUTW, "foreground.png")
if os.path.exists(old_fg):
    os.remove(old_fg)
print(f"pond {W}x{H}, crown_mask.jpg geschrieben ({crown_w}x{crown_h}, einkanalig)")

# ---------- pro Fisch: Crop, Resize, gekruemmte Centerline ----------
def crop_alpha(im, pad=2):
    a = im.split()[-1]
    bb = a.getbbox()
    bb = (max(0, bb[0]-pad), max(0, bb[1]-pad), min(im.width, bb[2]+pad), min(im.height, bb[3]+pad))
    return im.crop(bb)

def curved_spine(a, n_bins=44):
    ys, xs = np.nonzero(a > 0.35)
    w = a[ys, xs].astype(np.float64)
    cx, cy = (xs*w).sum()/w.sum(), (ys*w).sum()/w.sum()
    X = np.stack([xs-cx, ys-cy]).astype(np.float64)
    C = (X*w) @ X.T / w.sum()
    ev, evec = np.linalg.eigh(C)
    ax = evec[:, np.argmax(ev)]
    t = X.T @ ax
    nrm = X.T @ np.array([-ax[1], ax[0]])
    bins = np.linspace(t.min(), t.max(), n_bins+1)
    pts_t, pts_n = [], []
    for i in range(n_bins):
        sel = (t >= bins[i]) & (t < bins[i+1])
        if sel.sum() > 15:
            pts_t.append((bins[i]+bins[i+1])/2)
            pts_n.append(np.average(nrm[sel], weights=w[sel]))
    pts_t, pts_n = np.array(pts_t), np.array(pts_n)
    if len(pts_n) > 5:
        k = np.array([1,2,3,2,1], dtype=np.float64); k /= k.sum()
        pts_n = np.convolve(pts_n, k, mode="same")
    third = max(1, len(pts_t)//3)
    def band_width(idxs):
        widths=[]
        for i in idxs:
            sel = (t >= bins[i]) & (t < bins[i+1])
            if sel.sum() > 15:
                widths.append(np.percentile(np.abs(nrm[sel]), 85))
        return np.mean(widths) if widths else 0
    head_is_lo = band_width(range(0, third)) < band_width(range(len(pts_t)-third, len(pts_t)))
    px = cx + pts_t*ax[0] + pts_n*(-ax[1])
    py = cy + pts_t*ax[1] + pts_n*(ax[0])
    if not head_is_lo:
        px, py = px[::-1], py[::-1]
    return px, py, (cx, cy), ax

manifest = {}
for p in FISH_SRC:
    fid = os.path.splitext(os.path.basename(p))[0]
    if fid in EXCLUDE:
        continue
    im = Image.open(p).convert("RGBA")
    im = crop_alpha(im)
    a = np.asarray(im.split()[-1], dtype=np.float32) / 255.0
    px, py, center, ax = curved_spine(a)
    if len(px) < 6:
        print(f"  {fid}: SKIP (zu wenig Spine-Punkte)")
        continue
    W0, H0 = im.size
    s = 420.0 / max(W0, H0)
    im_small = im.resize((max(2,int(W0*s)), max(2,int(H0*s))), Image.LANCZOS)
    fname = f"fish/{fid}.png"
    im_small.save(os.path.join(OUTW, fname))
    su = px * s / im_small.width
    sv = py * s / im_small.height
    seg = np.hypot(np.diff(su*im_small.width), np.diff(sv*im_small.height))
    arclen = np.concatenate([[0], np.cumsum(seg)])
    u = arclen / arclen[-1]
    manifest[fid] = {
        "file": fname,
        "w": im_small.width, "h": im_small.height,
        "spineU": [round(float(x),4) for x in u],
        "spineX": [round(float(x),4) for x in su],
        "spineY": [round(float(x),4) for x in sv],
    }
    print(f"  {fid}: {W0}x{H0} -> {im_small.width}x{im_small.height}, {len(u)} spine pts")

with open(os.path.join(OUTW, "manifest.json"), "w") as f:
    json.dump({"fish": manifest, "pond": {"w": W, "h": H}}, f)
print(f"manifest.json: {len(manifest)} Fische")

tot = sum(os.path.getsize(os.path.join(OUTW, m["file"])) for m in manifest.values())
tot += os.path.getsize(os.path.join(OUTW,"pond.jpg")) + os.path.getsize(os.path.join(OUTW,"crown_mask.jpg"))
print(f"Gesamtgewicht Assets: {tot/1e6:.2f} MB")
