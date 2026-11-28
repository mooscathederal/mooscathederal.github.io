// Kamera & Bedienung für die frontale Wand: Pan, Zoom-to-Cursor, Pinch, Doppelklick, LOD.
const q = new URLSearchParams(location.search);
const kachelModus = q.has("kachel");

document.documentElement.classList.remove("ohne-js");
if (kachelModus) document.documentElement.classList.add("kachel-modus");
document.body.classList.add("wand-aktiv");

const buehne = document.getElementById("wand-buehne");
const welt = document.getElementById("wand-welt");

// Gestaltungsvariablen für Bewegungsgefühl & Startansicht aus gestaltung.css lesen
const cssVar = (name, fallback) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
};
const cssNum = (name, fallback) => {
  const n = parseFloat(cssVar(name, ""));
  return Number.isFinite(n) ? n : fallback;
};

const cfg = {
  startansicht: cssVar("--wand-startansicht", "perspektive").toLowerCase(),
  zoomMin: cssNum("--wand-zoom-min", 0.12),
  zoomMax: cssNum("--wand-zoom-max", 3.5),
  tempoRad: cssNum("--wand-zoom-tempo-rad", 0.0022),
  tempoPinch: cssNum("--wand-zoom-tempo-pinch", 0.01),
  zoomSchritt: cssNum("--wand-zoom-schritt", 1.3),
  animDauer: cssNum("--wand-anim-dauer-ms", 260),
};

const parseRect = (raw, fallback) => {
  if (!raw) return fallback;
  const p = raw.split(",").map(Number);
  return p.length === 4 && p.every(Number.isFinite) ? { x: p[0], y: p[1], w: p[2], h: p[3] } : fallback;
};

const bounds = parseRect(welt.dataset.bounds, { x: 0, y: 0, w: 1200, h: 900 });
const perspektive = parseRect(welt.dataset.perspektive, bounds);

// Kleine Bildstufen für LOD-Herunterschalten merken
for (const img of welt.querySelectorAll("img[data-src-gross]")) {
  if (!img.dataset.srcKlein) img.dataset.srcKlein = img.getAttribute("src") || "";
}

let tx = 0;
let ty = 0;
let scale = 1;
let animId = 0;
let lodTimer = 0;

function berechneGrenzen() {
  const vw = buehne.clientWidth || window.innerWidth;
  const vh = buehne.clientHeight || window.innerHeight;
  const fit = Math.min((vw * 0.92) / Math.max(bounds.w, 1), (vh * 0.92) / Math.max(bounds.h, 1));
  return {
    vw,
    vh,
    minScale: Math.min(cfg.zoomMin, fit * 0.7),
    maxScale: cfg.zoomMax,
  };
}

function clampKamera(nx, ny, ns) {
  const { vw, vh, minScale, maxScale } = berechneGrenzen();
  const s = Math.min(maxScale, Math.max(minScale, ns));
  if (kachelModus) return { tx: nx, ty: ny, scale: s };
  const randX = vw * 0.75;
  const randY = vh * 0.75;
  const minX = vw - (bounds.x + bounds.w) * s - randX;
  const maxX = -bounds.x * s + randX;
  const minY = vh - (bounds.y + bounds.h) * s - randY;
  const maxY = -bounds.y * s + randY;
  return {
    tx: Math.min(Math.max(nx, Math.min(minX, maxX)), Math.max(minX, maxX)),
    ty: Math.min(Math.max(ny, Math.min(minY, maxY)), Math.max(minY, maxY)),
    scale: s,
  };
}

function anwenden(nx, ny, ns) {
  const c = clampKamera(nx, ny, ns);
  tx = c.tx;
  ty = c.ty;
  scale = c.scale;
  welt.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`;
  // Putzkörnung wandert 1:1 mit der Wandfläche mit; Raumlicht (2. Schicht) bleibt ruhig im Fenster
  const korn = Math.max(96, 384 * scale);
  buehne.style.backgroundPosition = `${tx.toFixed(1)}px ${ty.toFixed(1)}px, 0 0`;
  buehne.style.backgroundSize = `${korn.toFixed(1)}px ${korn.toFixed(1)}px, 100% 100%`;
  if (!kachelModus) planeLod();
}

function zeigeRechteck(rect, fuellfaktor = 1, animiert = false) {
  const vw = buehne.clientWidth || window.innerWidth;
  const vh = buehne.clientHeight || window.innerHeight;
  const zielScale = Math.min((vw * fuellfaktor) / Math.max(rect.w, 1), (vh * fuellfaktor) / Math.max(rect.h, 1));
  const zielTx = vw / 2 - (rect.x + rect.w / 2) * zielScale;
  const zielTy = vh / 2 - (rect.y + rect.h / 2) * zielScale;
  if (!animiert) {
    stopAnim();
    anwenden(zielTx, zielTy, zielScale);
    return;
  }
  animiereZu(zielTx, zielTy, zielScale, cfg.animDauer);
}

function stopAnim() {
  if (animId) {
    cancelAnimationFrame(animId);
    animId = 0;
  }
}

function animiereZu(zielTx, zielTy, zielScale, dauerMs = cfg.animDauer) {
  stopAnim();
  const c = clampKamera(zielTx, zielTy, zielScale);
  const startTx = tx, startTy = ty, startS = scale;
  const t0 = performance.now();
  const schritt = (jetzt) => {
    const p = Math.min(1, (jetzt - t0) / Math.max(1, dauerMs));
    const e = 1 - Math.pow(1 - p, 3);
    anwenden(
      startTx + (c.tx - startTx) * e,
      startTy + (c.ty - startTy) * e,
      startS + (c.scale - startS) * e
    );
    if (p < 1) animId = requestAnimationFrame(schritt);
    else animId = 0;
  };
  animId = requestAnimationFrame(schritt);
}

function zoomAmPunkt(px, py, faktor) {
  stopAnim();
  const { minScale, maxScale } = berechneGrenzen();
  const neuS = Math.min(maxScale, Math.max(minScale, scale * faktor));
  const verhaeltnis = neuS / scale;
  const neuTx = px - (px - tx) * verhaeltnis;
  const neuTy = py - (py - ty) * verhaeltnis;
  anwenden(neuTx, neuTy, neuS);
}

// Level of Detail (LOD): hochschalten im Blickfeld, außerhalb der Sicht wieder herunterschalten
function aktualisiereLod() {
  const vw = buehne.clientWidth || window.innerWidth;
  const vh = buehne.clientHeight || window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  for (const img of welt.querySelectorAll("img[data-src-gross]")) {
    const gross = img.dataset.srcGross;
    const klein = img.dataset.srcKlein;
    if (!gross || !klein) continue;
    const karte = img.closest(".fundstueck");
    if (!karte) continue;
    const x = parseFloat(karte.style.left) || 0;
    const y = parseFloat(karte.style.top) || 0;
    const w = parseFloat(karte.style.width) || 300;
    const h = parseFloat(karte.style.height) || 200;
    const sx = x * scale + tx;
    const sy = y * scale + ty;
    const sw = w * scale;
    const sh = h * scale;
    const imBlick = sx + sw > -120 && sy + sh > -120 && sx < vw + 120 && sy < vh + 120;
    const weitWeg = sx + sw < -320 || sy + sh < -320 || sx > vw + 320 || sy > vh + 320;
    const pxGroesse = Math.max(sw, sh) * dpr;
    const aktuell = img.getAttribute("src");
    if (imBlick && pxGroesse > 240 && aktuell !== gross) {
      img.src = gross;
    } else if ((weitWeg || pxGroesse < 140) && aktuell !== klein) {
      img.src = klein;
    }
  }
}

function planeLod() {
  clearTimeout(lodTimer);
  lodTimer = setTimeout(aktualisiereLod, 120);
}

// Startansicht setzen (Kachel-Modus: exakt Perspektive ohne Rand)
if (kachelModus) {
  const vw = buehne.clientWidth || window.innerWidth;
  const vh = buehne.clientHeight || window.innerHeight;
  const s = Math.max(vw / Math.max(perspektive.w, 1), vh / Math.max(perspektive.h, 1));
  const x = vw / 2 - (perspektive.x + perspektive.w / 2) * s;
  const y = vh / 2 - (perspektive.y + perspektive.h / 2) * s;
  anwenden(x, y, s);
  aktualisiereLod();
  Promise.all([
    document.fonts ? document.fonts.ready : Promise.resolve(),
    ...Array.from(document.images).map((im) => im.decode().catch(() => {})),
  ]).then(() => {
    document.documentElement.dataset.kachelBereit = "1";
  });
} else {
  const startRect = cfg.startansicht === "alles" ? bounds : perspektive;
  const fuell = cfg.startansicht === "alles" ? 0.9 : 0.96;
  zeigeRechteck(startRect, fuell, false);
  aktualisiereLod();
}

// ---------- Lesekarten: Text, der nicht in seine Karte passt ----------
// Fokusmodell: Im Ruhezustand gehören Rad, Wischen und Ziehen über allen Karten der Wand.
// Ein Klick auf eine überlaufende Karte macht sie zur Lesekarte; nur dann scrollen Rad und Wischen ihren Text.
// Klick daneben oder Esc gibt die Wand zurück. Pinch zoomt immer die Wand.
const LESBAR_PX = 280;   // so breit muss eine Karte auf dem Schirm sein, damit Lesen ohne Heranzoomen geht
let lesekarte = null;

function markiereUeberlauf() {
  for (const k of welt.querySelectorAll(".fundstueck.typ-text, .fundstueck.typ-notiz")) {
    const ueber = k.scrollHeight > k.clientHeight + 2;
    k.classList.toggle("ueberlauf", ueber);
    if (ueber && !kachelModus) k.tabIndex = 0;
  }
}
markiereUeberlauf();
if (document.fonts) document.fonts.ready.then(markiereUeberlauf);
window.addEventListener("load", markiereUeberlauf);

function kartenRechteck(karte) {
  return {
    x: parseFloat(karte.style.left) || 0,
    y: parseFloat(karte.style.top) || 0,
    w: parseFloat(karte.style.width) || 300,
    h: parseFloat(karte.style.height) || 200,
  };
}

function oeffneLesekarte(karte) {
  if (lesekarte && lesekarte !== karte) schliesseLesekarte();
  lesekarte = karte;
  karte.classList.add("lesend");
  if (kartenRechteck(karte).w * scale < LESBAR_PX) zeigeRechteck(kartenRechteck(karte), 0.78, true);
  karte.focus({ preventScroll: true });
}

function schliesseLesekarte() {
  if (!lesekarte) return;
  lesekarte.classList.remove("lesend");
  if (document.activeElement === lesekarte) lesekarte.blur();
  lesekarte = null;
}

// ---------- Eingaben: Pointer (Pan & 2-Finger-Touch-Pinch) ----------
// setPointerCapture erst nach Überschreiten der 5-px-Ziehschwelle, damit Links klickbar bleiben!
const zeiger = new Map();
let zieht = false;
let verschoben = false;
let captureId = null;
let startX = 0, startY = 0, startTx = 0, startTy = 0;
let pinchDist = 0, pinchMidX = 0, pinchMidY = 0;

if (!kachelModus) {
  buehne.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (e.target.closest(".wand-hud")) return;
    // In der Lesekarte gehört der Zeiger der Karte: Finger scrollt, Maus markiert Text, Scrollbalken bleibt bedienbar
    if (lesekarte && lesekarte.contains(e.target)) return;
    stopAnim();
    zeiger.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (zeiger.size === 1) {
      zieht = true;
      verschoben = false;
      startX = e.clientX;
      startY = e.clientY;
      startTx = tx;
      startTy = ty;
    } else if (zeiger.size === 2) {
      zieht = false;
      for (const pid of zeiger.keys()) {
        try { buehne.setPointerCapture(pid); } catch {}
      }
      const [a, b] = Array.from(zeiger.values());
      pinchDist = Math.hypot(b.x - a.x, b.y - a.y);
      pinchMidX = (a.x + b.x) / 2;
      pinchMidY = (a.y + b.y) / 2;
    }
  });

  buehne.addEventListener("pointermove", (e) => {
    if (!zeiger.has(e.pointerId)) return;
    zeiger.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (zeiger.size === 1 && zieht) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!verschoben && Math.hypot(dx, dy) > 5) {
        verschoben = true;
        buehne.classList.add("zieht");
        captureId = e.pointerId;
        try { buehne.setPointerCapture(e.pointerId); } catch {}
      }
      if (verschoben) anwenden(startTx + dx, startTy + dy, scale);
    } else if (zeiger.size === 2) {
      const [a, b] = Array.from(zeiger.values());
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      if (pinchDist > 0) {
        const faktor = dist / pinchDist;
        anwenden(tx + (midX - pinchMidX), ty + (midY - pinchMidY), scale);
        zoomAmPunkt(midX, midY, faktor);
      }
      pinchDist = dist;
      pinchMidX = midX;
      pinchMidY = midY;
      verschoben = true;
    }
  });

  const beendeZeiger = (e) => {
    zeiger.delete(e.pointerId);
    if (captureId === e.pointerId) {
      try { if (buehne.hasPointerCapture(e.pointerId)) buehne.releasePointerCapture(e.pointerId); } catch {}
      captureId = null;
    }
    if (zeiger.size < 2) pinchDist = 0;
    if (zeiger.size === 0) {
      zieht = false;
      buehne.classList.remove("zieht");
    }
  };
  buehne.addEventListener("pointerup", beendeZeiger);
  buehne.addEventListener("pointercancel", beendeZeiger);

  // Klick nach echtem Drag unterdrücken, normalen Link-Klick aber durchlassen
  buehne.addEventListener("click", (e) => {
    if (verschoben) {
      e.preventDefault();
      e.stopPropagation();
      verschoben = false;
    }
  }, true);

  // Klick ohne Ziehen: überlaufende Karte wird Lesekarte, Klick daneben gibt die Wand zurück
  buehne.addEventListener("click", (e) => {
    if (e.target.closest("a, button, .wand-hud")) return;
    const karte = e.target.closest(".fundstueck.ueberlauf");
    if (karte) {
      if (karte !== lesekarte) oeffneLesekarte(karte);
    } else {
      schliesseLesekarte();
    }
  });

  // Doppelklick zoomt auf das Fundstück
  buehne.addEventListener("dblclick", (e) => {
    if (e.target.closest("a, button")) return;
    const karte = e.target.closest(".fundstueck");
    if (karte) {
      const r = {
        x: parseFloat(karte.style.left) || 0,
        y: parseFloat(karte.style.top) || 0,
        w: parseFloat(karte.style.width) || 300,
        h: parseFloat(karte.style.height) || 200,
      };
      zeigeRechteck(r, 0.78, true);
    } else {
      zoomAmPunkt(e.clientX, e.clientY, 1.5);
    }
  });

  // ---------- Mausrad & Trackpad (Wheel + Scroll-Durchlass für lange Textkarten + Safari Gesture) ----------
  buehne.addEventListener("wheel", (e) => {
    // Bei Pinch (ctrlKey/metaKey) immer die Wand zoomen
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const rect = buehne.getBoundingClientRect();
      const faktor = Math.exp(-e.deltaY * cfg.tempoPinch);
      zoomAmPunkt(e.clientX - rect.left, e.clientY - rect.top, faktor);
      return;
    }

    // Über der Lesekarte scrollt der Browser ihren Text; am Ende geht nichts an die Wand weiter (overscroll-behavior)
    if (lesekarte && lesekarte.contains(e.target)) return;

    e.preventDefault();
    const rect = buehne.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    const istTrackpadWischen =
      e.deltaMode === 0 &&
      (Math.abs(e.deltaX) > 0 || (Math.abs(e.deltaY) < 40 && !Number.isInteger(e.deltaY / 100)));

    if (istTrackpadWischen) {
      stopAnim();
      anwenden(tx - e.deltaX, ty - e.deltaY, scale);
    } else {
      const schritt = e.deltaMode === 1 ? e.deltaY * 24 : e.deltaY;
      const faktor = Math.exp(-Math.max(-180, Math.min(180, schritt)) * cfg.tempoRad);
      zoomAmPunkt(px, py, faktor);
    }
  }, { passive: false });

  // Safari macOS/iPadOS Trackpad-Pinch
  let gestureScale = 1;
  buehne.addEventListener("gesturestart", (e) => {
    e.preventDefault();
    gestureScale = 1;
  }, { passive: false });
  buehne.addEventListener("gesturechange", (e) => {
    e.preventDefault();
    const faktor = e.scale / (gestureScale || 1);
    gestureScale = e.scale;
    const rect = buehne.getBoundingClientRect();
    zoomAmPunkt(e.clientX - rect.left, e.clientY - rect.top, faktor);
  }, { passive: false });
  buehne.addEventListener("gestureend", (e) => { e.preventDefault(); }, { passive: false });

  // ---------- Bedienleiste & Tastatur ----------
  document.getElementById("btn-alles")?.addEventListener("click", () => zeigeRechteck(bounds, 0.9, true));
  document.getElementById("btn-plus")?.addEventListener("click", () => zoomAmPunkt(buehne.clientWidth / 2, buehne.clientHeight / 2, cfg.zoomSchritt));
  document.getElementById("btn-minus")?.addEventListener("click", () => zoomAmPunkt(buehne.clientWidth / 2, buehne.clientHeight / 2, 1 / cfg.zoomSchritt));

  window.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || /input|textarea/i.test(e.target.tagName)) return;
    if (lesekarte) {
      if (e.key === "Escape") { e.preventDefault(); schliesseLesekarte(); return; }
      const zeile = 40, seite = lesekarte.clientHeight * 0.9;
      const weg = { ArrowDown: zeile, ArrowUp: -zeile, PageDown: seite, PageUp: -seite, " ": e.shiftKey ? -seite : seite,
                    Home: -lesekarte.scrollHeight, End: lesekarte.scrollHeight }[e.key];
      if (weg !== undefined) { e.preventDefault(); lesekarte.scrollBy({ top: weg }); return; }
    }
    if ((e.key === "Enter" || e.key === " ") && e.target.classList?.contains("ueberlauf")) {
      e.preventDefault(); oeffneLesekarte(e.target); return;
    }
    if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      zoomAmPunkt(buehne.clientWidth / 2, buehne.clientHeight / 2, cfg.zoomSchritt);
    } else if (e.key === "-") {
      e.preventDefault();
      zoomAmPunkt(buehne.clientWidth / 2, buehne.clientHeight / 2, 1 / cfg.zoomSchritt);
    } else if (e.key === "0") {
      e.preventDefault();
      zeigeRechteck(bounds, 0.9, true);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault(); anwenden(tx + 90, ty, scale);
    } else if (e.key === "ArrowRight") {
      e.preventDefault(); anwenden(tx - 90, ty, scale);
    } else if (e.key === "ArrowUp") {
      e.preventDefault(); anwenden(tx, ty + 90, scale);
    } else if (e.key === "ArrowDown") {
      e.preventDefault(); anwenden(tx, ty - 90, scale);
    } else if (e.key === "Escape") {
      const zurueck = document.querySelector(".wand-knopf.marke");
      if (zurueck) location.href = zurueck.href;
    }
  });

  window.addEventListener("resize", () => anwenden(tx, ty, scale));
}

// ---------- Diagnose: ?fps (analog zu raum.js) ----------
if (q.has("fps") && !kachelModus) {
  const el = Object.assign(document.createElement("div"), {
    style: "position:fixed;right:10px;bottom:10px;z-index:30;font:12px/1.3 ui-monospace,monospace;color:#fff;background:rgba(0,0,0,.65);padding:4px 8px;border-radius:4px"
  });
  document.body.append(el);
  let n = 0, t = performance.now();
  (function loop(now) {
    n++;
    if (now - t > 1000) {
      el.textContent = `${(n * 1000 / (now - t)).toFixed(0)} B/s · Zoom ${(scale * 100).toFixed(0)} %`;
      n = 0; t = now;
    }
    requestAnimationFrame(loop);
  })(t);
}

// ---------- Papierstreifen (Weg B: eingefrorenes v5-Bütten + S3a-Buchdruck-Physik) ----------
(function initPapierstreifen() {
  const streifen = Array.from(document.querySelectorAll(".fundstueck.typ-papierstreifen"));
  if (!streifen.length) return;

  const ladeBild = (src) => new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = src;
  });

  const hashVal = (s) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  };
  const hashN = (h, sh) => (((h >>> sh) & 1023) / 1024) - 0.5;
  const smoothstep = (e0, e1, x) => {
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };

  const umbreche = (ctx, text, maxW) => {
    const zeilen = [];
    for (const roh of text.split(/\r?\n/)) {
      const worte = roh.trim().split(/\s+/).filter(Boolean);
      if (!worte.length) { zeilen.push(""); continue; }
      let cur = "";
      for (const w of worte) {
        const test = cur ? cur + " " + w : w;
        if (ctx.measureText(test).width > maxW && cur) {
          zeilen.push(cur);
          cur = w;
        } else {
          cur = test;
        }
      }
      if (cur) zeilen.push(cur);
    }
    return zeilen.length ? zeilen : [""];
  };

  Promise.all([
    document.fonts ? document.fonts.ready : Promise.resolve(),
    ladeBild("papier-flaeche.webp"),
    ladeBild("papier-kante-h.png"),
    ladeBild("papier-kante-v.png"),
  ]).then(([, flaeche, kanteH, kanteV]) => {
    // 3x gespiegeltes horizontales Kantenband vorbereiten (nahtlos für jede Breite)
    const hBand = document.createElement("canvas");
    hBand.width = kanteH.width * 3;
    hBand.height = kanteH.height;
    const hCtx = hBand.getContext("2d");
    for (let i = 0; i < 3; i++) {
      hCtx.save();
      if (i % 2 === 1) {
        hCtx.translate((i + 1) * kanteH.width, 0);
        hCtx.scale(-1, 1);
        hCtx.drawImage(kanteH, 0, 0);
      } else {
        hCtx.drawImage(kanteH, i * kanteH.width, 0);
      }
      hCtx.restore();
    }

    for (const el of streifen) {
      const text = (el.dataset.streifenText || el.querySelector(".streifen-text")?.textContent || "").trim();
      const can = el.querySelector("canvas.streifen-bild");
      const textEl = el.querySelector(".streifen-text");
      if (!can || !text) continue;

      const cssW = Math.max(140, Math.round(el.offsetWidth || parseFloat(el.style.width) || 320));
      const padX = 34;
      const padY = 20;
      const fontSize = 17.5;
      const lineH = 26; // 17.5 * 1.485

      const mCan = document.createElement("canvas");
      const mCtx = mCan.getContext("2d");
      mCtx.font = `400 ${fontSize}px "Newsreader", Georgia, serif`;
      const lines = umbreche(mCtx, text, Math.max(60, cssW - padX * 2));

      // Dynamische Höhe: so hoch wie die Zeilen es brauchen + organischer Randabstand
      const cssH = Math.max(66, Math.round(padY * 2 + lines.length * lineH));
      el.style.height = cssH + "px";
      if (textEl) {
        textEl.style.padding = `${padY}px ${padX}px`;
        textEl.style.textAlign = lines.length === 1 ? "center" : "left";
      }

      const W = cssW * 2, H = cssH * 2;
      can.width = W;
      can.height = H;
      const ctx = can.getContext("2d");
      const seedStr = el.dataset.id || text;
      const hSeed = hashVal(seedStr);

      // 1. Eingefrorene v5-Bütten-Oberfläche kacheln
      const pCan = document.createElement("canvas");
      pCan.width = W; pCan.height = H;
      const pCtx = pCan.getContext("2d");
      const sw = flaeche.width, sh = flaeche.height;
      const ox = (hSeed % sw);
      const oy = ((hSeed >>> 8) % sh);
      for (let yy = -oy; yy < H; yy += sh) {
        for (let xx = -ox; xx < W; xx += sw) {
          pCtx.drawImage(flaeche, xx, yy);
        }
      }

      // 2. Alle 4 realen Büttenkanten via destination-in anwenden (beide Enden aus kanteV -> K2 100% beidseitig!)
      const maske = document.createElement("canvas");
      maske.width = W; maske.height = H;
      const kCtx = maske.getContext("2d");
      const wendeMaskeAn = (zeichne) => {
        kCtx.globalCompositeOperation = "source-over";
        kCtx.fillStyle = "#fff";
        kCtx.fillRect(0, 0, W, H);
        zeichne(kCtx);
        pCtx.globalCompositeOperation = "destination-in";
        pCtx.drawImage(maske, 0, 0);
        pCtx.globalCompositeOperation = "source-over";
      };

      const bw = kanteH.width, bh = kanteH.height;
      const vw = kanteV.width, vh = kanteV.height;
      const hx1 = (hSeed % (bw * 2));
      const hx2 = (((hSeed >>> 5) + 180) % (bw * 2));
      const vy1 = ((hSeed >>> 3) % Math.max(1, vh - Math.min(H, vh)));
      const vy2 = (((hSeed >>> 11) + 137) % Math.max(1, vh - Math.min(H, vh)));

      // Oberkante
      wendeMaskeAn((c) => { c.clearRect(0, 0, W, bh); c.drawImage(hBand, hx1, 0, W, bh, 0, 0, W, bh); });
      // Unterkante (gespiegelt)
      wendeMaskeAn((c) => {
        c.clearRect(0, H - bh, W, bh);
        c.save(); c.translate(0, H); c.scale(1, -1);
        c.drawImage(hBand, hx2, 0, W, bh, 0, 0, W, bh);
        c.restore();
      });
      // Linkes raues Ende
      wendeMaskeAn((c) => {
        c.clearRect(0, 0, vw, H);
        const takeH = Math.min(H, vh);
        c.drawImage(kanteV, 0, vy1, vw, takeH, 0, 0, vw, H);
      });
      // Rechtes raues Ende (gespiegelte raue Kante -> K2 beidseitig!)
      wendeMaskeAn((c) => {
        c.clearRect(W - vw, 0, vw, H);
        const takeH = Math.min(H, vh);
        c.save(); c.translate(W, 0); c.scale(-1, 1);
        c.drawImage(kanteV, 0, vy2, vw, takeH, 0, 0, vw, H);
        c.restore();
      });

      const pImg = pCtx.getImageData(0, 0, W, H);
      const pData = pImg.data;

      // 3. S3a-Buchdruck-Satz (Newsreader 400, Kerning erhalten, sanfte Grundlinien- & Druck-Atmung)
      const iCan = document.createElement("canvas");
      iCan.width = W; iCan.height = H;
      const iCtx = iCan.getContext("2d");
      iCtx.font = `400 ${fontSize * 2}px "Newsreader", Georgia, serif`;
      iCtx.textBaseline = "alphabetic";

      const lineH2 = lineH * 2;
      const blockH = (lines.length - 1) * lineH2;
      const firstBaseY = H * 0.5 - blockH * 0.5 + 11;
      const maxLineW = Math.max(...lines.map((ln) => iCtx.measureText(ln).width));
      const blockLeft = Math.max(padX * 2, (W - maxLineW) * 0.5);

      lines.forEach((line, li) => {
        const hl = hashVal(seedStr + "|l|" + li + "|" + line);
        const lineDx = hashN(hl, 0) * 1.4;
        const lineRot = hashN(hl, 10) * 0.0045;
        const baseY = firstBaseY + li * lineH2;
        const startX = (lines.length === 1 ? (W - iCtx.measureText(line).width) * 0.5 : blockLeft) + lineDx;
        const chars = Array.from(line);
        let walkY = 0;

        iCtx.save();
        iCtx.translate(startX, baseY);
        iCtx.rotate(lineRot);
        for (let i = 0; i < chars.length; i++) {
          const ch = chars[i];
          if (ch === " ") continue;
          const prefixW = iCtx.measureText(chars.slice(0, i + 1).join("")).width;
          const chW = iCtx.measureText(ch).width;
          const exactX = prefixW - chW;

          const hc = hashVal(seedStr + "|" + li + "|" + i + "|" + ch);
          walkY = Math.max(-1.0, Math.min(1.0, walkY * 0.65 + hashN(hc, 0) * 0.85));
          const dy = walkY + hashN(hc, 16) * 0.45;
          const dx = hashN(hc, 8) * 0.25;
          const rot = hashN(hc, 22) * 0.009;
          const press = Math.max(0.84, Math.min(1.0, 0.96 + hashN(hc, 8) * 0.08));

          iCtx.save();
          iCtx.translate(exactX + dx + chW * 0.5, dy);
          iCtx.rotate(rot);
          iCtx.fillStyle = `rgba(0,0,0,${press.toFixed(3)})`;
          iCtx.fillText(ch, -chW * 0.5, 0);
          iCtx.restore();
        }
        iCtx.restore();
      });

      // 4. Exakte Worte-Tintenphysik (sink=0.50, pore=0.24, inkStrength=0.96) + leichtes Oberlicht
      const iData = iCtx.getImageData(0, 0, W, H).data;
      const out = ctx.createImageData(W, H);
      const o = out.data;

      const lumaAt = (x, y) => {
        const cx = Math.max(0, Math.min(W - 1, x));
        const cy = Math.max(0, Math.min(H - 1, y));
        const id = (cy * W + cx) * 4;
        return (0.299 * pData[id] + 0.587 * pData[id + 1] + 0.114 * pData[id + 2]) / 255.0;
      };
      const inkAt = (fx, fy) => {
        const x0 = Math.max(0, Math.min(W - 2, Math.floor(fx)));
        const y0 = Math.max(0, Math.min(H - 2, Math.floor(fy)));
        const tx = Math.max(0, Math.min(1, fx - x0));
        const ty = Math.max(0, Math.min(1, fy - y0));
        const a00 = iData[(y0 * W + x0) * 4 + 3] / 255.0;
        const a10 = iData[(y0 * W + x0 + 1) * 4 + 3] / 255.0;
        const a01 = iData[((y0 + 1) * W + x0) * 4 + 3] / 255.0;
        const a11 = iData[((y0 + 1) * W + x0 + 1) * 4 + 3] / 255.0;
        return (a00 * (1 - tx) + a10 * tx) * (1 - ty) + (a01 * (1 - tx) + a11 * tx) * ty;
      };

      for (let y = 0; y < H; y++) {
        const vShift = (1.0 - 2.0 * y / Math.max(1, H - 1)) * (1.5 / 255.0);
        for (let x = 0; x < W; x++) {
          const id = (y * W + x) * 4;
          const pA = pData[id + 3];
          if (pA === 0) { o[id + 3] = 0; continue; }

          // Feiner Oberlicht-Saum entlang der oberen Papierfaser-Kante (setzt Oberkante klar vom Putz ab)
          const obenA = y >= 2 ? pData[((y - 2) * W + x) * 4 + 3] : 0;
          const kanteOben = (pA > 40 && obenA < 25) ? 0.048 : 0;
          const pr = Math.max(0, Math.min(1, pData[id] / 255.0 + vShift + kanteOben));
          const pg = Math.max(0, Math.min(1, pData[id + 1] / 255.0 + vShift + kanteOben));
          const pb = Math.max(0, Math.min(1, pData[id + 2] / 255.0 + vShift + kanteOben * 0.92));
          const pLum = 0.299 * pr + 0.587 * pg + 0.114 * pb;

          const gX = lumaAt(x + 2, y) - pLum;
          const gY = lumaAt(x, y + 2) - pLum;
          const inkA = inkAt(x + gX * 7.0, y + gY * 7.0);

          if (inkA < 0.002) {
            o[id] = Math.round(pr * 255); o[id + 1] = Math.round(pg * 255); o[id + 2] = Math.round(pb * 255); o[id + 3] = pA;
            continue;
          }

          const poreBreak = smoothstep(0.87, 0.95, pLum) * 0.24;
          const cloud = Math.sin(x * 0.009 + y * 0.005) * 0.5 + Math.sin(x * 0.004 - y * 0.011 + 1.7) * 0.5;
          const finalA = Math.max(0, Math.min(1, inkA * (1.0 - poreBreak) * 0.96 * (1.0 + cloud * 0.035)));
          const lit = 0.86 + 0.28 * pLum;
          const ir = 0.095 * lit, ig = 0.088 * lit, ib = 0.080 * lit;

          o[id]     = Math.round((pr * (1 - finalA) + ir * finalA) * 255);
          o[id + 1] = Math.round((pg * (1 - finalA) + ig * finalA) * 255);
          o[id + 2] = Math.round((pb * (1 - finalA) + ib * finalA) * 255);
          o[id + 3] = pA;
        }
      }
      ctx.putImageData(out, 0, 0);
      el.classList.add("bemalt");
    }
  }).catch(() => {});
})();

window.__wand = {
  getState: () => ({ tx, ty, scale, bounds, perspektive, cfg }),
  panBy: (dx, dy) => anwenden(tx + dx, ty + dy, scale),
  zoomAt: (px, py, f) => zoomAmPunkt(px, py, f),
  fitAll: () => zeigeRechteck(bounds, 0.9, false),
  aktualisiereLod,
  lesekarte: () => lesekarte?.dataset.id || null,
};
