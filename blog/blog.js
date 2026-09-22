// Senkrechtes Mühlrad in der Leiste der Beitragsseiten.
// Ohne dieses Skript bleiben die Kacheln eine schlichte, scrollbare Liste.
const koerper = document.body;
const wurzel = document.documentElement;
const stapel = document.querySelector(".stapel");
const kacheln = stapel ? [...stapel.querySelectorAll(".kachel")] : [];
const griff = document.getElementById("griff");
const leiste = document.getElementById("leiste");
const deckel = document.getElementById("leiste-deckel");
const name = document.querySelector(".stapel-name");

if (kacheln.length && griff && leiste) {
  const ruhig = matchMedia("(prefers-reduced-motion: reduce)");
  const n = kacheln.length;
  let pos = Math.max(0, kacheln.findIndex((k) => k.classList.contains("aktiv")));
  let offen = false;
  let schliessUhr = 0, zeigerDrin = false;

  stapel.classList.add("bereit");

  const schrittPx = () => kacheln[0].getBoundingClientRect().height * 0.62;
  const naechsterIndex = () => ((Math.round(pos) % n) + n) % n;

  function lege() {
    const schritt = schrittPx();
    const naechste = naechsterIndex();
    kacheln.forEach((k, i) => {
      // Mühlrad: kürzester Weg im Kreis, damit immer nach beiden Seiten Kacheln liegen
      let d = i - pos;
      if (n > 5) { if (d > n / 2) d -= n; else if (d < -n / 2) d += n; }
      const a = Math.abs(d);
      k.style.setProperty("--dx", "0px");
      k.style.setProperty("--dy", (d * schritt).toFixed(1) + "px");
      k.style.setProperty("--s", (a < 0.02 ? 1 : Math.max(0.78, 1 - 0.055 * a - 0.02)).toFixed(3));
      k.style.setProperty("--b", (a < 0.02 ? 1 : Math.max(0.62, 1 - 0.13 * a)).toFixed(2));
      k.style.setProperty("--o", a > 4 ? "0" : "1");
      k.style.setProperty("--z", String(100 - Math.round(a)));
      k.classList.toggle("aktiv", i === naechste);
      k.querySelector("a").tabIndex = i === naechste ? 0 : -1;
    });
    if (name) {
      name.querySelector(".n-titel").textContent = kacheln[naechste].querySelector(".kachel-titel")?.textContent || "";
      name.querySelector(".n-datum").textContent = kacheln[naechste].querySelector(".kachel-datum")?.textContent || "";
    }
  }

  let rastUhr = 0;
  function einrasten() {
    pos = Math.round(pos);
    if (!ruhig.matches) {
      stapel.classList.add("rastet");
      clearTimeout(rastUhr);
      rastUhr = setTimeout(() => stapel.classList.remove("rastet"), 220);
    }
    lege();
  }

  function auslaufen(v) {
    if (ruhig.matches || Math.abs(v) < 0.0006) { einrasten(); return; }
    pos += v * 16;
    v *= 0.95;
    lege();
    requestAnimationFrame(() => auslaufen(v));
  }

  // ---------- Leiste öffnen/schließen ----------
  const oeffne = () => {
    offen = true;
    koerper.classList.add("leiste-offen");
    wurzel.classList.add("leiste-offen");
    griff.setAttribute("aria-expanded", "true");
    lege();
  };
  const schliesse = () => {
    offen = false;
    koerper.classList.remove("leiste-offen");
    wurzel.classList.remove("leiste-offen");
    griff.setAttribute("aria-expanded", "false");
  };
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

  // ---------- Rad: Mausrad, deltaY aufsummieren statt fester Sperre ----------
  let radUhr = 0;
  leiste.addEventListener("wheel", (e) => {
    if (!offen) return;
    e.preventDefault();
    stapel.classList.add("zieht");
    pos += (e.deltaY || e.deltaX) / schrittPx();
    lege();
    clearTimeout(radUhr);
    radUhr = setTimeout(() => { stapel.classList.remove("zieht"); einrasten(); }, 120);
  }, { passive: false });

  // ---------- Rad: Ziehen mit dem Finger/der Maus, klebt am Zeiger ----------
  let ziehend = false, dirty = false, raf = 0;
  let startX = 0, startY = 0, startPos = 0, proben = [];

  function zeichne() {
    raf = 0;
    if (dirty) { lege(); dirty = false; }
  }

  function nieder(e) {
    if (!offen) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    ziehend = true;
    startX = e.clientX; startY = e.clientY; startPos = pos;
    proben = [{ t: performance.now(), y: e.clientY }];
    clearTimeout(schliessUhr);
    stapel.classList.add("zieht");
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function bewegt(e) {
    if (!ziehend) return;
    pos = startPos - (e.clientY - startY) / schrittPx();
    const jetzt = performance.now();
    proben.push({ t: jetzt, y: e.clientY });
    while (proben.length > 2 && proben[0].t < jetzt - 80) proben.shift();
    dirty = true;
    if (!raf) raf = requestAnimationFrame(zeichne);
  }
  function los(e) {
    if (!ziehend) return;
    ziehend = false;
    stapel.classList.remove("zieht");
    const weg = Math.hypot(e.clientX - startX, e.clientY - startY);
    if (weg < 8) {
      // Tipp ohne Bewegung: innerhalb der Leiste öffnet der Link selbst,
      // außerhalb schließt der Tipp die Leiste.
      if (!leiste.contains(e.target)) schliesse();
      lege();
      return;
    }
    let v = 0;
    if (proben.length >= 2) {
      const a = proben[0], b = proben[proben.length - 1], dt = b.t - a.t;
      if (dt > 0) v = -((b.y - a.y) / dt) / schrittPx();
    }
    auslaufen(v);
  }
  for (const ziel of [leiste, deckel]) {
    if (!ziel) continue;
    ziel.addEventListener("pointerdown", nieder);
    ziel.addEventListener("pointermove", bewegt);
    ziel.addEventListener("pointerup", los);
    ziel.addEventListener("pointercancel", los);
  }

  // ---------- Tastatur ----------
  addEventListener("keydown", (e) => {
    if (!offen) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      pos = Math.round(pos) + (e.key === "ArrowDown" ? 1 : -1);
      lege();
      kacheln[naechsterIndex()].querySelector("a").focus();
    }
  });

  addEventListener("resize", lege);
  lege();
  window.__blog = { anzahl: n, offen: () => offen, aktiv: naechsterIndex, oeffne, schliesse };
}
