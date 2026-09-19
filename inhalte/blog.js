// Mühlrad der Blogseiten. Zwei Fälle:
//   quer   – Auswahlseite: waagerechtes Rad in der Bildmitte, ohne Leiste
//   laengs – Beitragsseite: senkrechtes Rad in der Leiste am linken Rand
// Ohne dieses Skript bleiben die Kacheln eine schlichte, scrollbare Liste.
const koerper = document.body;
const stapel = document.querySelector(".stapel");
const kacheln = stapel ? [...stapel.querySelectorAll(".kachel")] : [];
const griff = document.getElementById("griff");
const leiste = document.getElementById("leiste");
const name = document.querySelector(".stapel-name");
const fenster = stapel?.closest(".stapel-fenster");

if (kacheln.length) {
  const quer = stapel.dataset.richtung === "quer";
  const ruhig = matchMedia("(prefers-reduced-motion: reduce)");
  let aktiv = Math.max(0, kacheln.findIndex((k) => k.classList.contains("aktiv")));
  let offen = quer;                       // auf der Auswahlseite ist immer „offen"
  let schliessUhr = 0, zeigerDrin = false;

  stapel.classList.add("bereit");

  function lege() {
    const mass = kacheln[0].getBoundingClientRect();
    const schritt = (quer ? mass.width : mass.height) * 0.62;
    const n = kacheln.length;
    kacheln.forEach((k, i) => {
      // Mühlrad: kürzester Weg im Kreis, damit immer nach beiden Seiten Kacheln liegen
      let d = i - aktiv;
      if (n > 5) { if (d > n / 2) d -= n; else if (d < -n / 2) d += n; }
      const a = Math.abs(d);
      k.style.setProperty("--dx", quer ? (d * schritt).toFixed(1) + "px" : "0px");
      k.style.setProperty("--dy", quer ? "0px" : (d * schritt).toFixed(1) + "px");
      k.style.setProperty("--s", (a === 0 ? 1 : Math.max(0.78, 1 - 0.055 * a - 0.02)).toFixed(3));
      k.style.setProperty("--b", (a === 0 ? 1 : Math.max(0.62, 1 - 0.13 * a)).toFixed(2));
      k.style.setProperty("--o", a > 4 ? "0" : "1");
      k.style.setProperty("--z", String(100 - a));
      k.classList.toggle("aktiv", a === 0);
      k.querySelector("a").tabIndex = a === 0 ? 0 : -1;
    });
    if (name) {
      name.querySelector(".n-titel").textContent = kacheln[aktiv].querySelector(".kachel-titel")?.textContent || "";
      name.querySelector(".n-datum").textContent = kacheln[aktiv].querySelector(".kachel-datum")?.textContent || "";
    }
  }
  const setze = (i) => {                       // im Kreis, ohne Anschlag
    const n = kacheln.length;
    aktiv = n > 5 ? ((i % n) + n) % n : Math.min(n - 1, Math.max(0, i));
    lege();
  };

  // ---------- Leiste (nur Beitragsseiten) ----------
  if (!quer && griff && leiste) {
    const oeffne = () => { offen = true; koerper.classList.add("leiste-offen"); griff.setAttribute("aria-expanded", "true"); lege(); };
    const schliesse = () => { offen = false; koerper.classList.remove("leiste-offen"); griff.setAttribute("aria-expanded", "false"); };
    const planeSchliessen = (ms = 2600) => {
      clearTimeout(schliessUhr);
      schliessUhr = setTimeout(() => { if (offen && !zeigerDrin) schliesse(); }, ms);
    };
    griff.addEventListener("click", () => { offen ? schliesse() : (oeffne(), planeSchliessen(4000)); });
    addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse") return;
      if (!offen && e.clientX <= 24) { oeffne(); planeSchliessen(3000); }
    }, { passive: true });
    leiste.addEventListener("pointerenter", () => { zeigerDrin = true; clearTimeout(schliessUhr); });
    leiste.addEventListener("pointerleave", () => { zeigerDrin = false; planeSchliessen(); });
    addEventListener("keydown", (e) => { if (e.key === "Escape" && offen) { schliesse(); griff.focus(); } });
    window.__blog = Object.assign(window.__blog || {}, { oeffne, schliesse });
  }

  // ---------- Rad ----------
  const radZiel = quer ? window : leiste;
  let radSperre = 0;
  radZiel?.addEventListener("wheel", (e) => {
    if (!quer && !offen) return;
    if (!quer && !leiste.contains(e.target)) return;
    e.preventDefault();
    const jetzt = performance.now();
    if (jetzt - radSperre < (ruhig.matches ? 60 : 130)) return;
    radSperre = jetzt;
    setze(aktiv + Math.sign(e.deltaY || e.deltaX));
  }, { passive: false });

  // ---------- Wischen ----------
  const wischZiel = quer ? fenster : leiste;
  let start = null;
  wischZiel?.addEventListener("touchstart", (e) => {
    start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: true });
  wischZiel?.addEventListener("touchmove", (e) => {
    if (!start) return;
    const dx = start.x - e.touches[0].clientX, dy = start.y - e.touches[0].clientY;
    const d = quer ? dx : dy;
    if (Math.abs(d) > 40) { setze(aktiv + Math.sign(d)); start = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }
  }, { passive: true });
  wischZiel?.addEventListener("touchend", () => { start = null; }, { passive: true });

  // ---------- Tastatur ----------
  addEventListener("keydown", (e) => {
    if (!quer && !offen) return;
    const vor = quer ? "ArrowRight" : "ArrowDown", zurueck = quer ? "ArrowLeft" : "ArrowUp";
    if (e.key === vor || e.key === zurueck) {
      e.preventDefault();
      setze(aktiv + (e.key === vor ? 1 : -1));
      kacheln[aktiv].querySelector("a").focus();
    }
  });

  addEventListener("resize", lege);
  lege();
  window.__blog = Object.assign(window.__blog || {}, {
    anzahl: kacheln.length, quer, aktiv: () => aktiv, offen: () => offen, setze,
  });
}
