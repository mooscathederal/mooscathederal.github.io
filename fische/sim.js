// Fischi – Bewegungssimulation eines Koi (Verhalten + Kinematik), deterministisch bei festem dt und Seed.
// Einheiten: Längen in L (Körperlänge inkl. Schwanzflosse), Zeit in s, Winkel in rad.
import { midline } from "./warp.js";

export const PARAMS = {
  sizePct: { v: 15, min: 5, max: 40, step: 0.5, label: "Größe", help: "Fischlänge in % des Größenbezugs (Breite, Diagonale) oder in Pixel ÷ 10." },
  A:       { v: 0.05, min: 0, max: 0.2, step: 0.005, label: "Schlagamplitude", help: "Seitlicher Ausschlag der Schwanzspitze, einseitig, in Körperlängen." },
  lambda:  { v: 0.9, min: 0.5, max: 1.6, step: 0.05, label: "Wellenlänge", help: "Länge einer Körperwelle in Körperlängen; kleiner = mehr Schlängeln." },
  St:      { v: 0.25, min: 0.1, max: 0.6, step: 0.01, label: "Tempokopplung (Strouhal)", help: "Schlagfrequenz = St · Tempo / (2 · Amplitude). Höher = schneller schlagen bei gleichem Tempo." },
  vCruise: { v: 0.6, min: 0.1, max: 2, step: 0.05, label: "Tempo Schwimmen", help: "Mittleres Tempo während des Schlagens, in Körperlängen pro Sekunde." },
  burstBeats: { v: 3, min: 1, max: 8, step: 1, label: "Schläge je Schub", help: "Mittlere Zahl der Schwanzschläge, bevor der Fisch gleitet (zufällig ±1)." },
  coastV:  { v: 0.18, min: 0.02, max: 1, step: 0.01, label: "Gleiten bis Tempo", help: "Unter diesem Tempo (L/s) beginnt der nächste Schub. Kleiner = längeres Gleiten." },
  drag:    { v: 0.7, min: 0.1, max: 4, step: 0.05, label: "Abbremsen", help: "Widerstand beim Gleiten; größer = schneller langsamer. Mit Schalter B auch Stärke des Pulsierens." },
  jitterA: { v: 0.25, min: 0, max: 0.8, step: 0.01, label: "Unregelmäßigkeit Amplitude", help: "Zufällige Streuung der Amplitude von Schlag zu Schlag (Anteil)." },
  jitterF: { v: 0.15, min: 0, max: 0.8, step: 0.01, label: "Unregelmäßigkeit Frequenz", help: "Zufällige Streuung der Frequenz von Schlag zu Schlag (Anteil)." },
  kappaMax:{ v: 0.9, min: 0, max: 2.5, step: 0.05, label: "Kurvenlage", help: "Maximaler Körperbogen in Kurven (Gesamtwinkel über die Länge, rad)." },
  turnEvery:{ v: 5, min: 1, max: 20, step: 0.5, label: "Richtungswechsel alle", help: "Mittlerer Abstand spontaner Richtungswechsel in Sekunden." },
  wander:  { v: 0.25, min: 0, max: 1.5, step: 0.05, label: "Schlingern", help: "Langsames zufälliges Abweichen der Richtung (rad/s Rauschen)." },
  sJoint:  { v: 0.78, min: 0.5, max: 0.98, step: 0.01, label: "Schwanzstiel-Gelenk", help: "Ort des Gelenks in Körperlängen ab Schnauze; dahinter bewegt sich die Schwanzflosse als eigenes Glied." },
  finAmp:  { v: 0.6, min: 0, max: 1.2, step: 0.01, label: "Flossenausschlag", help: "Zusätzlicher Winkel der Schwanzflosse am Gelenk (rad, einseitig)." },
  finLag:  { v: 1.2, min: 0, max: 3.14, step: 0.05, label: "Flossennachlauf", help: "Phasenverzug der Schwanzflosse gegen die Körperwelle (rad); 0 = gleichzeitig." },
  coastRatio: { v: 0.62, min: 0.2, max: 0.95, step: 0.01, label: "Gleitende (Anteil)", help: "Neuer Modus: nächster Schub, wenn das Tempo auf diesen Anteil des Gleitanfangs gefallen ist (Koi-Messung ≈ 0,64)." },
  pTurn:   { v: 0.4, min: 0, max: 1, step: 0.05, label: "Wendewahrscheinlichkeit", help: "Neuer Modus: Anteil der Schübe, die mit einem einseitig stärkeren Wendeschlag beginnen." },
  turnAmp: { v: 1.6, min: 1, max: 3, step: 0.05, label: "Wendeschlag-Stärke", help: "Neuer Modus: Amplitudenfaktor des ersten Schlags bei einer Wende." },
  goalHold: { v: 5, min: 1, max: 30, step: 0.5, label: "Absicht: Dauer", help: "Schalter I: mittlere Zeit in Sekunden, die eine Zielrichtung beibehalten wird (zufällig 0,5–1,5×)." },
  goalTurn: { v: 90, min: 10, max: 180, step: 5, label: "Absicht: Wendewinkel", help: "Schalter I: typischer Winkel eines Zielwechsels in Grad (Streuung ±50 %, selten größer); Seite bleibt zu 70 % wie beim letzten Wechsel." },
  hoverP:  { v: 0.35, min: 0, max: 1, step: 0.05, label: "Verweilen: Wahrscheinlichkeit", help: "Schalter H: Anteil der Gleitphasen, die in aktives Bremsen und Verweilen übergehen." },
  hoverDur: { v: 2.5, min: 0.3, max: 10, step: 0.1, label: "Verweilen: Dauer", help: "Schalter H: mittlere Verweildauer in Sekunden (zufällig 0,4–1,6×)." },
  brake:   { v: 4, min: 1, max: 10, step: 0.5, label: "Bremsen: Stärke", help: "Schalter H: Vielfaches des Widerstands beim aktiven Bremsen (Brustflossen abgespreizt)." },
  bendDrag: { v: 2.5, min: 0, max: 6, step: 0.1, label: "Widerstand bei Biegung", help: "Schalter K: Widerstand wächst mit dem Körperbogen: drag·(1 + Wert·|Bogen|). Gestreckt gleitet, gebogen bremst." },
  speedVar: { v: 0.35, min: 0, max: 0.8, step: 0.01, label: "Tempo-Streuung je Schub", help: "Zufällige Streuung des Zieltempos von Schub zu Schub (Anteil, lognormal)." },
  targetVisible: { v: 6, min: 1, max: 20, step: 1, label: "Zielzahl sichtbarer Fische", help: "Schwarm: so viele Fische sollen im Mittel im Bild sein; Gesamtzahl und Wartezeiten draußen folgen daraus." },
  sizeSpread: { v: 0.22, min: 0, max: 0.6, step: 0.01, label: "Größenstreuung", help: "Schwarm: Streuung der Fischgrößen um die Grundgröße (lognormal)." },
  sepDist: { v: 1.1, min: 0, max: 3, step: 0.05, label: "Abstand halten", help: "Schwarm: unter diesem Abstand (in Körperlängen) weichen Fische einander aus." },
  followP: { v: 0.3, min: 0, max: 1, step: 0.05, label: "Folgen", help: "Schwarm: Wahrscheinlichkeit, bei einem Zielwechsel die Richtung eines Nachbarn (bis 3 L) zu übernehmen." },
  stageBias: { v: 0.5, min: 0, max: 1, step: 0.05, label: "Bühnenneigung", help: "Anteil der Zielwechsel, die auf einen Punkt im Bild zielen statt auf einen relativen Winkel; keine Wand." },
  headAmp: { v: 0.20, min: 0, max: 0.5, step: 0.01, label: "Kopfanteil", help: "Amplitude am Kopf als Anteil der Schwanzamplitude. Wirkt nur mit Schalter A sichtbar als Kopfschwingen." },
  headYaw: { v: 0, min: -30, max: 30, step: 0.5, label: "Kopfversatz (C)", help: "Winkel zwischen gemalter Blickrichtung und Bahn in Grad; Fisch wird um diesen Winkel gegen die Laufrichtung gedreht." },
  awayMin: { v: 2, min: 0, max: 15, step: 0.5, label: "Draußen mindestens", help: "Sekunden, die der Fisch nach dem Austritt mindestens außerhalb bleibt." },
  awayMax: { v: 5, min: 0, max: 30, step: 0.5, label: "Draußen höchstens", help: "Sekunden, die er höchstens draußen bleibt; Wiedereintritt an einem zufälligen Rand." },
  shHeight: { v: 0.7, min: 0, max: 0.8, step: 0.01, label: "Schatten: Höhe", help: "Versatz des Schattens gegen den Fisch in Körperlängen; mehr = höher über dem Wald." },
  shSoft:  { v: 0.05, min: 0, max: 0.5, step: 0.01, label: "Schatten: Weichheit", help: "Unschärfe des Schattens (Anteil der Körperlänge); höher = weicher." },
  shDark:  { v: 0.59, min: 0, max: 1, step: 0.01, label: "Schatten: Stärke", help: "Dunkelheit des Schattens." },
  shMod:   { v: 0.6, min: 0, max: 1, step: 0.01, label: "Schatten auf Relief", help: "Schatten folgt der Helligkeit des Waldes: auf hellen Kronen deutlich, in dunklen Senken kaum. 0 = gleichmäßig." },
  vol:     { v: 0.2, min: 0, max: 0.6, step: 0.01, label: "Volumen Fisch", help: "Leichte Abdunklung zu den Körperrändern hin (Schalter V). Gemalte Oberfläche bleibt, nur Helligkeit." },
  bgContrast: { v: 1.0, min: 0.6, max: 1.8, step: 0.02, label: "Hintergrund Kontrast", help: "Tonwertkurve des Waldes, nur zur Anzeige, nie ins Original eingebrannt." },
  bgBright: { v: 0, min: -0.3, max: 0.3, step: 0.01, label: "Hintergrund Helligkeit", help: "Aufhellen/Abdunkeln des Waldes zur Anzeige." },
  shAngle: { v: 35, min: -180, max: 180, step: 1, label: "Schatten: Richtung", help: "Richtung des Schattenversatzes in Grad (0 = rechts, 90 = unten)." },
};
export const SWITCHES = {
  M: { v: true, label: "M Neuer Bewegungsmodus (Physik)", help: "An: massengewichteter Rückstoß (Kopf ruhig, Schwanz arbeitet), Schub aus der gemessenen Schwanzgeschwindigkeit, Gleitende relativ zum Gleitanfang, Wenden nur aus Schlägen, kein Richtungsrauschen. Aus: alter Modus mit den Schaltern A und B." },
  I: { v: true, label: "I Absicht mit Gedächtnis", help: "An: eine Zielrichtung wird über Sekunden verfolgt, Kurven verteilen sich über mehrere Schläge, Wenden bleiben oft auf derselben Seite. Aus: Wende je Schub unabhängig gewürfelt (Lauf 3)." },
  H: { v: true, label: "H Bremsen und Verweilen", help: "An: nach manchen Gleitphasen bremst der Fisch aktiv, steht fast still und hält sich mit kleinen Bewegungen, bevor er weiterschwimmt. Aus: nur Schlagen und Gleiten." },
  K: { v: true, label: "K Widerstand nach Lage", help: "An: gebogener Körper bremst stärker als gestreckter. Aus: Widerstand unabhängig von der Biegung." },
  A: { v: true, label: "A Schwerpunkt statt Kopf", help: "An: mittlere Körperrichtung wird abgezogen, Schwerpunkt bleibt am Ort, Kopf schwingt mit. Aus: Schnauze festgenagelt, Schwanz peitscht." },
  B: { v: true, label: "B Vortrieb aus dem Schlag", help: "An: Tempo pulsiert zweimal je Schlagzyklus aus dem Schlag heraus. Aus: Tempo nähert sich glatt einem Zielwert." },
  C: { v: false, label: "C Kopfversatz anwenden", help: "An: Regler Kopfversatz dreht den Fisch gegen die Bahn. Aus: Bild exakt entlang der Bahn." },
  D: { v: true, label: "D Schatten und Höhe", help: "An: weicher versetzter Schatten auf dem Wald. Aus: kein Schatten." },
  V: { v: true, label: "V Volumen am Fisch", help: "An: Ränder des Fischkörpers leicht abgedunkelt (Regler Volumen). Aus: Bild unverändert." },
  R: { v: true, label: "Rand ohne Wand", help: "An: Fisch schwimmt hinaus und kommt später an einem Rand wieder herein. Aus: alte Randvermeidung (Wand)." },
};

export function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export function wrap(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }

export class Koi {
  constructor(seed, fish) { this.rnd = mulberry32(seed); this.fish = fish; this.reset(); }
  reset() {
    this.x = 0; this.y = 0; this.heading = 0; this.v = 0.3; this.phi = 0; this.gain = 1;
    this.kappa = 0; this.state = "burst"; this.beatsLeft = 3;
    this.ampMul = 1; this.freqMul = 1; this.f = 1; this.t = 0; this.targetHeading = 0; this.nextTurn = 3;
    this.wanderRate = 0; this.trail = []; this.away = false; this.awayUntil = 0; this.exits = 0;
    this.tailY = null; this.vLat = 0; this.vGlideStart = 0.5; this.turnBeat = false; this.thrust = 0;
    this.goalUntil = 0; this.lastSide = 1; this.hover = false; this.hoverUntil = 0; this.speedMul = 1; this.micro = 0;
  }
  // P: Parameter; S: Schalter; bounds: {w,h} Fenster in L; mode: 'frei'|'ort'|'starr'
  step(dt, P, S, bounds, mode) {
    const r = this.rnd;
    this.t += dt;
    // --- draußen: warten, dann an einem Rand neu eintreten (nur außerhalb des Bildes, nie drinnen) ---
    if (this.away) {
      if (this.t >= this.awayUntil) { this.reenter(P, bounds); } else return;
    }
    // --- Verhalten: Schub / Gleiten ---
    const A = Math.max(0.01, P.A * this.ampMul);
    if (this.state === "burst") this.gain += (1 - this.gain) * Math.min(1, dt / 0.15);
    else if (this.state === "hover") {
      // H: aktiv gebremst, fast still; kleine Mikrobewegung (Schwanz zittert leicht)
      this.gain += (0.12 - this.gain) * Math.min(1, dt / 0.4);
      if (this.t >= this.hoverUntil) { this.state = "burst"; this.beatsLeft = Math.max(1, Math.round(P.burstBeats + (r() - 0.5) * 2)); this.newBeat(P); this.startBurst(P, S); }
    } else { this.gain += (0 - this.gain) * Math.min(1, dt / 0.35);
      const thr = S.M ? Math.max(P.coastV, P.coastRatio * this.vGlideStart) * (0.9 + 0.2 * r()) : P.coastV * (0.8 + 0.4 * r());
      if (this.v < thr) {
        if (S.M && S.H && r() < P.hoverP) { this.state = "hover"; this.hoverUntil = this.t + P.hoverDur * (0.4 + 1.2 * r()); }
        else { this.state = "burst"; this.beatsLeft = Math.max(1, Math.round(P.burstBeats + (r() - 0.5) * 2)); this.newBeat(P); this.startBurst(P, S); } } }
    // --- Frequenz aus Strouhal, Streuung je Schlag ---
    const fRaw = P.St * Math.max(this.v, 0.15) / (2 * A);
    this.f = Math.max(0.3, fRaw) * this.freqMul;
    const fEff = this.state === "burst" ? this.f : (this.state === "hover" ? 0.6 : this.f * 0.35);
    const phiOld = this.phi; this.phi += 2 * Math.PI * fEff * dt;
    if (Math.floor(this.phi / (2 * Math.PI)) > Math.floor(phiOld / (2 * Math.PI))) {
      if (this.state === "burst") { this.beatsLeft--; this.turnBeat = false;
        if (this.beatsLeft <= 0) { this.state = "coast"; this.vGlideStart = this.v; if (S.M && !S.I) this.targetHeading = this.heading; } else this.newBeat(P); }
    }
    // --- Tempo ---
    if (S.M && this.fish) {
      // Schub aus der tatsächlichen seitlichen Geschwindigkeit der Schwanzspitze (Lighthill-artig, ∝ v_lat²)
      const ml = midline(this.fish, this.pose(P, S, mode), 24, 0, 1);
      const ty = ml.y[24] / this.fish.L;
      this.vLat = this.tailY === null ? 0 : (ty - this.tailY) / dt; this.tailY = ty;
      const vT = P.vCruise * this.ampMul * this.speedMul, w = 2 * Math.PI * this.f, Aeff = P.A * this.ampMul * (this.turnBeat ? P.turnAmp : 1);
      const kT = 0.5 * 2 * P.drag * vT * vT / Math.pow(Math.max(0.01, Aeff) * w, 2);   // 0,5: Schwanzspitze inkl. Flossenglied schwingt schneller als A·ω
      this.thrust = this.state === "hover" ? 0 : kT * this.vLat * this.vLat;
      let dragEff = P.drag * (S.K ? 1 + P.bendDrag * Math.abs(this.kappa) : 1) * (this.state === "hover" ? P.brake : 1);
      this.v += (this.thrust - dragEff * this.v * this.v) * dt;
      if (this.state === "hover") this.v = Math.max(this.v, 0.02);
    } else if (S.B) {
      // B: Schub aus dem Schlag, zwei Pulse je Zyklus (sin²), Widerstand quadratisch; kT so, dass das mittlere Tempo im Schub = vCruise·ampMul
      const vT = P.vCruise * this.ampMul, w = 2 * Math.PI * this.f;
      const kT = 2 * P.drag * vT * vT / (w * A);
      const s = Math.sin(this.phi);
      const thrust = kT * this.gain * w * A * s * s;
      this.v += (thrust - P.drag * this.v * this.v) * dt;
    } else {
      if (this.state === "burst") this.v += (P.vCruise * this.ampMul - this.v) * Math.min(1, dt / 0.45);
      else this.v = this.v / (1 + P.drag * this.v * dt);
    }
    // --- Richtung: spontane Wechsel, Schlingern ---
    if (!S.M) {
      if (this.t > this.nextTurn) { this.targetHeading += (r() - 0.5) * 2 * (0.3 + 0.8 * r()); this.nextTurn = this.t + P.turnEvery * (0.5 + r()); }
      this.wanderRate += (-this.wanderRate * dt / 1.5) + P.wander * Math.sqrt(dt) * (r() - 0.5) * 2;
      this.targetHeading += this.wanderRate * dt;
    }
    if (bounds && !S.R) {
      // alte Randvermeidung (Wand) – nur zum Vergleich
      const m = Math.min(1.2, 0.22 * Math.min(bounds.w, bounds.h)), dx = this.x - bounds.w / 2, dy = this.y - bounds.h / 2;
      const over = Math.max(m - this.x, this.x - (bounds.w - m), m - this.y, this.y - (bounds.h - m), 0);
      if (over > 0) { const toCenter = Math.atan2(-dy, -dx); this.targetHeading += wrap(toCenter - this.targetHeading) * Math.min(1, dt * (2 + 6 * over)); this.nextTurn = Math.max(this.nextTurn, this.t + 2); }
      this.x = Math.min(Math.max(this.x, 0.6), bounds.w - 0.6); this.y = Math.min(Math.max(this.y, 0.6), bounds.h - 0.6);
    }
    if (S.M && S.I && this.t >= this.goalUntil) {
      // I: neues Ziel, Seite meist wie zuletzt, Winkel gestreut, selten groß; gilt für Sekunden
      const side = r() < 0.7 ? this.lastSide : -this.lastSide; this.lastSide = side;
      let ang = P.goalTurn * Math.PI / 180 * (0.5 + r()); if (r() < 0.12) ang *= 2.2;
      this.targetHeading = this.heading + side * ang;
      if (bounds && P.stageBias > 0 && r() < P.stageBias) { const tx = bounds.w * (0.15 + 0.7 * r()), ty = bounds.h * (0.15 + 0.7 * r()); this.targetHeading = Math.atan2(ty - this.y, tx - this.x); }
      this.goalUntil = this.t + P.goalHold * (0.5 + r());
    }
    const err = wrap(this.targetHeading - this.heading);
    const kTarget = Math.max(-P.kappaMax, Math.min(P.kappaMax, err * 2.0)) * (S.M ? (S.I ? Math.max(0.35, Math.min(1, this.gain / 0.3)) : Math.min(1, this.gain / 0.3)) : 1);
    this.kappa += (kTarget - this.kappa) * Math.min(1, dt / 0.5);
    if (mode !== "ort") {
      this.heading += this.v * this.kappa * dt * 0.9;
      this.x += this.v * Math.cos(this.heading) * dt; this.y += this.v * Math.sin(this.heading) * dt;
    }
    // --- Austritt: erst wenn vollständig draußen (inkl. Schwanz und Schatten: 1,2 L hinter dem Rand) ---
    if (bounds && S.R && mode !== "ort") {
      const m = 0.65 + (S.D ? P.shHeight : 0);   // vollständig draußen: halbe Länge + Schattenversatz
      if (this.x < -m || this.x > bounds.w + m || this.y < -m || this.y > bounds.h + m) {
        this.away = true; this.exits++; this.awayUntil = this.t + P.awayMin + (P.awayMax - P.awayMin) * r(); this.trail = []; return;
      }
    }
    if (this.trail.length === 0 || this.t - this.trail[this.trail.length - 1].t > 0.1) { this.trail.push({ t: this.t, x: this.x, y: this.y }); if (this.trail.length > 200) this.trail.shift(); }
  }
  reenter(P, bounds) {
    const r = this.rnd, m = 0.65 + P.shHeight, side = Math.floor(r() * 4);
    // Zielpunkt im inneren Bereich (20–80 % des Fensters), Startpunkt außerhalb auf einer zufälligen Seite
    const tx = bounds.w * (0.2 + 0.6 * r()), ty = bounds.h * (0.2 + 0.6 * r());
    if (side === 0) { this.x = -m; this.y = bounds.h * r(); } else if (side === 1) { this.x = bounds.w + m; this.y = bounds.h * r(); }
    else if (side === 2) { this.x = bounds.w * r(); this.y = -m; } else { this.x = bounds.w * r(); this.y = bounds.h + m; }
    this.heading = Math.atan2(ty - this.y, tx - this.x); this.targetHeading = this.heading; this.kappa = 0;
    this.away = false; this.state = "burst"; this.beatsLeft = 3; this.v = Math.max(this.v, 0.4); this.newBeat(P); this.nextTurn = this.t + 2 + 3 * r(); this.turnBeat = false; this.tailY = null; this.goalUntil = this.t + P.goalHold * (0.8 + 0.6 * r());
  }
  startBurst(P, S) {
    if (!S.M) return; const r = this.rnd;
    this.speedMul = Math.exp((r() + r() + r() - 1.5) * P.speedVar * 1.6);   // lognormal-artig
    if (S.I) { const e = wrap(this.targetHeading - this.heading); this.turnBeat = Math.abs(e) > 0.5; return; }
    if (r() < P.pTurn) { const ang = (0.25 + 0.8 * r()) * (r() < 0.5 ? -1 : 1); this.targetHeading = this.heading + ang; this.turnBeat = true; }
    else { this.targetHeading = this.heading; this.turnBeat = false; }
  }
  newBeat(P) { const r = this.rnd; this.ampMul = 1 + (r() - 0.5) * 2 * P.jitterA; this.freqMul = 1 + (r() - 0.5) * 2 * P.jitterF; }
  pose(P, S, mode) {
    const starr = mode === "starr";
    return { A: starr ? 0 : P.A * this.ampMul * (this.turnBeat ? P.turnAmp : 1), lambda: P.lambda, phi: this.phi, gain: starr ? 0 : this.gain,
      kappa: starr ? 0 : this.kappa, sJoint: P.sJoint, finAmp: starr ? 0 : P.finAmp, finLag: P.finLag,
      env: { a0: P.headAmp, a1: 0.10, a2: 1 - P.headAmp - 0.10 }, anchor: S.M ? "mass" : (S.A ? "centroid" : "head") };
  }
}
