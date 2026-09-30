// Leuchttisch: ein Blatt groß, blättern mit Pfeilen, Tasten oder Wischen. Daumenkino spielt die Serie in Folge ab.
(() => {
  const N = 40, lt = document.getElementById("lt"), bild = document.getElementById("lt-bild"), zahl = document.getElementById("lt-zahl");
  const kino = document.getElementById("lt-kino");
  const zwei = (i) => String(i).padStart(2, "0");
  let i = 1, uhr = 0, zuletzt = null;

  // Große Fassungen vorladen, sobald der Leuchttisch das erste Mal aufgeht, damit das Daumenkino nicht stockt.
  let geladen = false;
  const vorladen = () => { if (geladen) return; geladen = true; for (let k = 1; k <= N; k++) { const im = new Image(); im.src = `bild/${zwei(k)}.webp`; } };

  function zeige(n) {
    i = ((n - 1 + N) % N) + 1;
    bild.src = `bild/${zwei(i)}.webp`;
    bild.alt = `Blatt ${zwei(i)} von ${N}`;
    zahl.textContent = `${zwei(i)} / ${N}`;
  }
  function stoppe() { clearInterval(uhr); uhr = 0; kino.setAttribute("aria-pressed", "false"); }
  function oeffne(n, von) { zuletzt = von; vorladen(); zeige(n); lt.hidden = false; document.body.style.overflow = "hidden"; document.getElementById("lt-zu").focus(); }
  function schliesse() { stoppe(); lt.hidden = true; document.body.style.overflow = ""; zuletzt?.focus(); }

  for (const feld of [document.getElementById("raster"), document.getElementById("raster-folge")]) feld?.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-i]"); if (b) oeffne(+b.dataset.i, b);
  });
  document.getElementById("lt-zu").addEventListener("click", schliesse);
  document.getElementById("lt-vor").addEventListener("click", () => { stoppe(); zeige(i + 1); });
  document.getElementById("lt-zurueck").addEventListener("click", () => { stoppe(); zeige(i - 1); });
  kino.addEventListener("click", () => {
    if (uhr) return stoppe();
    kino.setAttribute("aria-pressed", "true");
    uhr = setInterval(() => zeige(i + 1), 160);
  });
  const orig = document.getElementById("lt-original");
  orig.addEventListener("click", () => { const an = !lt.classList.contains("original"); lt.classList.toggle("original", an); orig.setAttribute("aria-pressed", String(an)); });
  addEventListener("keydown", (e) => {
    if (lt.hidden) return;
    if (e.key === "Escape") schliesse();
    if (e.key === "ArrowRight") { stoppe(); zeige(i + 1); }
    if (e.key === "ArrowLeft") { stoppe(); zeige(i - 1); }
  });
  let x0 = null;
  lt.addEventListener("pointerdown", (e) => { if (e.target.tagName !== "BUTTON") x0 = e.clientX; });
  lt.addEventListener("pointerup", (e) => {
    if (x0 === null) return; const dx = e.clientX - x0; x0 = null;
    if (Math.abs(dx) > 50) { stoppe(); zeige(i + (dx < 0 ? 1 : -1)); }
  });
})();
