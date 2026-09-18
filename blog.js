// Bilderstapel und Leiste der Blogseiten. Ohne dieses Skript bleibt die Leiste
// als einfache Liste erreichbar (der Griff ist dann nur ein Knopf ohne Wirkung).
const koerper = document.body;
const griff = document.getElementById("griff");
const leiste = document.getElementById("leiste");
const stapel = leiste?.querySelector(".stapel");
const kacheln = stapel ? [...stapel.querySelectorAll(".kachel")] : [];
if (kacheln.length) {
  let aktiv = Math.max(0, kacheln.findIndex((k) => k.classList.contains("aktiv")));
  stapel.classList.add("bereit");
  const name = leiste.querySelector(".stapel-name");
  let offen = false, schliessUhr = 0, zeigerDrin = false;
  const ruhig = matchMedia("(prefers-reduced-motion: reduce)");

  function lege() {
    const hoehe = kacheln[0].getBoundingClientRect().height || 140;
    const schritt = hoehe * 0.62;                       // Überlappung: Stapel statt Liste
    kacheln.forEach((k, i) => {
      const d = i - aktiv, a = Math.abs(d);
      k.style.setProperty("--dy", (d * schritt).toFixed(1) + "px");
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

  function oeffne() { offen = true; koerper.classList.add("leiste-offen"); griff.setAttribute("aria-expanded", "true"); lege(); }
  function schliesse() { offen = false; koerper.classList.remove("leiste-offen"); griff.setAttribute("aria-expanded", "false"); }
  function planeSchliessen(ms = 2600) {
    clearTimeout(schliessUhr);
    schliessUhr = setTimeout(() => { if (offen && !zeigerDrin) schliesse(); }, ms);
  }

  griff.addEventListener("click", () => { offen ? schliesse() : (oeffne(), planeSchliessen(4000)); });

  // Zeiger an der linken Kante öffnet
  addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    if (!offen && e.clientX <= 24) { oeffne(); planeSchliessen(3000); }
  }, { passive: true });

  leiste.addEventListener("pointerenter", () => { zeigerDrin = true; clearTimeout(schliessUhr); });
  leiste.addEventListener("pointerleave", () => { zeigerDrin = false; planeSchliessen(); });

  // Mausrad: in der Leiste dreht es den Stapel, sonst scrollt die Seite
  let radSperre = 0;
  leiste.addEventListener("wheel", (e) => {
    if (!offen) return;
    e.preventDefault();
    const jetzt = performance.now();
    if (jetzt - radSperre < (ruhig.matches ? 60 : 130)) return;
    radSperre = jetzt;
    const richtung = Math.sign(e.deltaY);
    aktiv = Math.min(kacheln.length - 1, Math.max(0, aktiv + richtung));
    lege();
  }, { passive: false });

  // Wischen auf dem Handy
  let startY = null;
  leiste.addEventListener("touchstart", (e) => { startY = e.touches[0].clientY; }, { passive: true });
  leiste.addEventListener("touchmove", (e) => {
    if (startY === null) return;
    const d = startY - e.touches[0].clientY;
    if (Math.abs(d) > 40) {
      aktiv = Math.min(kacheln.length - 1, Math.max(0, aktiv + Math.sign(d)));
      startY = e.touches[0].clientY; lege();
    }
  }, { passive: true });
  leiste.addEventListener("touchend", () => { startY = null; }, { passive: true });

  // Tastatur
  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && offen) { schliesse(); griff.focus(); return; }
    if (!offen) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      aktiv = Math.min(kacheln.length - 1, Math.max(0, aktiv + (e.key === "ArrowDown" ? 1 : -1)));
      lege(); kacheln[aktiv].querySelector("a").focus();
    }
  });

  addEventListener("resize", lege);
  lege();
  window.__blog = { anzahl: kacheln.length, aktiv: () => aktiv, offen: () => offen, oeffne, schliesse };
}
