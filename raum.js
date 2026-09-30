// Der Raum unter jeder Ebene: eine Welt aus Wald und Fischen (animation/welt.js), Stand 30.09.2026.
// Vorschau: ?stufe=0 (bisher: zwei Leinwände), a, b, c (Standard). Tasten 0 / a / b / c schalten um.
// Weitere Prüfhilfen: ?sinken=5 (erster Abstieg nach 5 s), ?stunde=7 (Tageslicht wie um 7 Uhr), ?fps (Anzeige).
const q = new URLSearchParams(location.search);
const stufe = (q.get("stufe") || "c").toLowerCase();
const leise = document.body.classList.contains("unterseite");
const wald = document.getElementById("wald-shader");
const koi = document.getElementById("koi");

addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || /input|textarea/i.test(e.target.tagName)) return;
  const k = e.key.toLowerCase(); if (!["0", "a", "b", "c"].includes(k) || k === stufe) return;
  q.set("stufe", k); location.search = q.toString();
});

if (q.has("fps")) {
  const el = Object.assign(document.createElement("div"), { style: "position:fixed;right:8px;top:8px;z-index:9;font:12px/1.3 ui-monospace,monospace;color:#fff;background:rgba(0,0,0,.55);padding:4px 7px;border-radius:3px;white-space:pre" });
  document.body.append(el);
  let n = 0, t = performance.now();
  (function f(now) { n++; if (now - t > 1000) { const w = window.__welt;
    el.textContent = `Stufe ${stufe}  ${(n * 1000 / (now - t)).toFixed(0)} B/s` + (w ? `  ${w.ms.toFixed(1)} ms/Bild\nBöe ${w.boe.toFixed(2)}${w.sinkt ? "  · ein Fisch sinkt" : ""}` : ""); n = 0; t = now; }
    requestAnimationFrame(f); })(t);
}

if (stufe === "0") {
  const { startKoi } = await import("./animation/koi.js");
  const { startWald } = await import("./animation/wald.js");
  if (wald) startWald(wald).then(() => wald.classList.add("laeuft")).catch(() => wald.remove());
  if (koi) startKoi(koi, { transparent: true, tint: [0.86, 0.9, 0.82] }).then(() => koi.classList.add("laeuft")).catch(() => koi.remove());
} else {
  koi?.remove();
  let c = wald;
  if (!c) {   // Unterseiten haben bisher nur den stehenden Wald: Leinwand dazulegen
    c = Object.assign(document.createElement("canvas"), { id: "wald-shader" }); c.setAttribute("aria-hidden", "true");
    document.querySelector(".wald")?.after(c);
  }
  const { startWelt } = await import("./animation/welt.js");
  startWelt(c, { stufe, leise, onLost: () => c.remove() })
    .then(() => c.classList.add("laeuft"))
    .catch((e) => { console.error(e); c.remove(); });   // Rückfall: stehendes Waldbild
}
