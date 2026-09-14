// ---------------------------------------------------------------------------
//  Schwimmkinematik eines Koi — der formale Kern.
//
//  Grundgroesse ist nicht die seitliche Auslenkung, sondern die KRUEMMUNG
//  kappa(s,t) entlang der Bogenlaenge s. Aus kappa wird die Achse integriert:
//
//      theta(s) = theta0 + INT kappa ds
//      P(s)     = P0     + INT (cos theta, sin theta) ds
//
//  Damit ist die Achse per Konstruktion unausdehnbar: der Fisch kann sich
//  biegen, aber nicht laenger oder kuerzer werden. Genau das geht verloren,
//  wenn man stattdessen Punkte seitlich verschiebt.
//
//  Der Koerper besteht aus zwei Gliedern:
//    s <  s_ped   Rumpf  -- traegt die laufende Kruemmungswelle
//    s >= s_ped   Schwanzflosse -- eigenes Glied, das der Welle nachlaeuft
//  s_ped ist der Schwanzstiel, pro Fisch aus dem Bild gemessen (Median 0.72).
//
//  KENNGROESSEN (alle Groessen in Koerperlaengen L = Rumpflaenge bis s_ped):
//
//   A_tail   Amplitude der Schwanzspitze, einseitig, in L.
//            Empirie: Spitze-Spitze ~0.18 L, weitgehend geschwindigkeits-
//            unabhaengig (Bainbridge 1958) -> einseitig ~0.09.
//   lambda   Wellenlaenge der Koerperwelle in L. Subcarangiform (Karpfen,
//            Koi) ~0.8-1.0.
//   St       Strouhal-Zahl St = f * A_pp / U. Effizientes Schwimmen liegt
//            bei 0.25-0.35 (Triantafyllou). Daraus folgt die Schlagfrequenz
//            aus der Geschwindigkeit -- sie ist kein freier Parameter:
//               f = St * U / (2 * A_tail * L)
//   env      Amplitudenhuellkurve a(x) = a0 + a1 x + a2 x^2 (Lighthill).
//            Klassische Werte 0.02 / -0.08 / 0.16 in L: Kopf schlaegt leicht
//            mit (Rueckstoss), Minimum bei x~0.25, Maximum am Schwanz.
//            Hier normiert auf a(1) = 1 und mit A_tail skaliert.
//   phi      Phasenverzug der Schwanzflosse gegen die Welle am Schwanzstiel.
//            Die Flosse laeuft nach; daraus entsteht ihr Anstellwinkel.
//   beta     Maximaler Zusatzwinkel der Flossenspitze gegen die Rumpfachse.
//   w_rest   Anteil der GEMALTEN Ruhekruemmung, der stehen bleibt. Das
//            gemalte Bild ist eine Haltung, kein Fehler -- aber wer sie voll
//            stehen laesst, hat einen Fisch, der ewig in der Kurve liegt.
//   c_turn   Stationaere Zusatzkruemmung beim Drehen: ein Fisch legt sich
//            in die Kurve, statt sich um seinen Mittelpunkt zu drehen.
//
//  Die Achse wird am Schluss so verschoben und gedreht, dass ihr Schwerpunkt
//  und ihre mittlere Richtung fest bleiben. Sonst waere der Kopf genagelt und
//  der Schwanz wuerde peitschen. So schwingen beide Enden um die Mitte --
//  und der Kopf bekommt seinen kleinen Gegenschlag.
// ---------------------------------------------------------------------------

export const PARAMS = {
  A_tail:  0.090,   // Schwanzamplitude, einseitig, in Rumpflaengen
  lambda:  0.90,    // Wellenlaenge in Rumpflaengen
  St:      0.30,    // Strouhal-Zahl
  f_min:   0.45,    // Hz, Grundschlag im Leerlauf
  f_max:   3.20,    // Hz, Obergrenze
  headAmp: 0.20,    // Kopfamplitude als Anteil der Schwanzamplitude
  dipAt:   0.25,    // Ort des Amplitudenminimums (Anteil der Rumpflaenge)
  phi:     95,      // Phasenverzug der Flosse in Grad
  beta:    26,      // max. Winkel der Flossenspitze gegen die Rumpfachse, Grad
  w_rest:  0.45,    // Anteil der gemalten Ruhekruemmung
  c_turn:  0.55     // Staerke der Kurvenlage
};

// Huellkurve a(x)/A_tail: quadratisch durch (0, headAmp), Minimum bei dipAt,
// (1, 1). Loest a0 + a1 x + a2 x^2 mit a(0)=h, a'(dip)=0, a(1)=1.
function envCoeffs(h, dip) {
  // a0 = h ; a1 = -2 a2 dip ; a0 + a1 + a2 = 1
  const a2 = (1 - h) / (1 - 2 * dip);
  return [h, -2 * a2 * dip, a2];
}

export function makeFish(meta, par) {
  // meta: { s[], kappaRest[], uPed, iPed, LBody, restCx, restCy }
  const n = meta.s.length;
  return {
    meta,
    n,
    theta: new Float64Array(n),
    px: new Float64Array(n),
    py: new Float64Array(n),
    kap: new Float64Array(n),
    h:   new Float64Array(n)
  };
}

/**
 * Berechnet die verformte Achse.
 * @param F      Objekt aus makeFish
 * @param U      Bahngeschwindigkeit in Weltmass pro Sekunde, umgerechnet in
 *               Rumpflaengen pro Sekunde durch den Aufrufer
 * @param omegaN Drehrate, normiert auf [-1,1]
 * @param t      Zeit in Sekunden
 * @param psi    Phasenversatz dieses Fisches
 * @param P      Kenngroessen (PARAMS)
 * @param out    Float32Array(n*4): je Stuetzstelle (Px,Py,Tx,Ty)
 * @returns      die verwendete Schlagfrequenz in Hz
 */
export function solve(F, UperL, omegaN, t, psi, P, out) {
  const m = F.meta, n = F.n, s = m.s, L = m.LBody, iPed = m.iPed;
  const sPed = s[iPed], sEnd = s[n - 1];

  // --- Frequenz aus der Strouhal-Zahl -------------------------------------
  const App = 2 * P.A_tail;                       // Spitze-Spitze in L
  let f = App > 1e-6 ? (P.St * UperL) / App : 0;  // UperL in L/s -> f in Hz
  if (f < P.f_min) f = P.f_min;
  if (f > P.f_max) f = P.f_max;

  // --- Tangentenwinkel des Rumpfes ----------------------------------------
  // Klassische Auslenkungsform h(x,t) mit Lighthill-Huellkurve. Der
  // Tangentenwinkel folgt EXAKT aus der Steigung: theta = atan(dh/ds).
  // (Der Umweg ueber die Kruemmung mit Kleinwinkelnaeherung ueberschaetzt die
  // Biegung bei diesen Amplituden erheblich -- der Fisch stand dann dauernd
  // im Haken. Ueber den Winkel gerechnet stimmt die Form und die Achse bleibt
  // trotzdem unausdehnbar, weil ueber die Bogenlaenge integriert wird.)
  const [c0, c1, c2] = envCoeffs(P.headAmp, P.dipAt);
  const k = 2 * Math.PI / (P.lambda * L);
  const w = 2 * Math.PI * f;
  const Aabs = P.A_tail * L;
  for (let i = 0; i <= iPed; i++) {
    const x = s[i] / L;
    const a = Aabs * (c0 + c1 * x + c2 * x * x);
    F.h[i] = a * Math.sin(k * s[i] - w * t + psi);
  }
  for (let i = 0; i <= iPed; i++) {
    const i0 = Math.max(0, i - 1), i1 = Math.min(iPed, i + 1);
    const ds = s[i1] - s[i0];
    const slope = ds > 1e-9 ? (F.h[i1] - F.h[i0]) / ds : 0;
    F.theta[i] = Math.atan(slope);
  }

  // --- Gemalte Ruhehaltung und Kurvenlage ---------------------------------
  // thetaRest ist der gemalte Tangentenverlauf, mittelwertfrei. Als Winkel
  // addiert ist er beschraenkt -- als Kruemmung addiert erzeugen einzelne
  // Messausreisser Knicke.
  const kTurn = P.c_turn * omegaN;
  for (let i = 0; i <= iPed; i++) {
    F.theta[i] += P.w_rest * m.thetaRest[i] + kTurn * (s[i] / L - 0.5);
  }

  // --- Schwanzflosse als eigenes Glied -------------------------------------
  // Sie folgt der Rumpfachse am Schwanzstiel und stellt sich um beta dagegen;
  // die Phase laeuft der Welle um phi nach. Daraus ihr Anstellwinkel.
  const finLen = Math.max(1e-6, sEnd - sPed);
  const betaT = (P.beta * Math.PI / 180) *
                Math.sin(k * sPed - w * t + psi - P.phi * Math.PI / 180);
  const thPed = F.theta[iPed];
  for (let i = iPed + 1; i < n; i++) {
    const r = (s[i] - sPed) / finLen;
    F.theta[i] = thPed + P.w_rest * (m.thetaRest[i] - m.thetaRest[iPed]) + betaT * r;
  }

  // mittlere Richtung abziehen (laengengewichtet) -> keine Netto-Drehung
  let thBar = 0, wsum = 0;
  for (let i = 0; i < n; i++) {
    const ds = (s[Math.min(n - 1, i + 1)] - s[Math.max(0, i - 1)]) * 0.5;
    thBar += F.theta[i] * ds; wsum += ds;
  }
  thBar /= (wsum || 1);
  for (let i = 0; i < n; i++) F.theta[i] -= thBar;

  // --- Integration: Winkel -> Punkte --------------------------------------
  F.px[0] = 0; F.py[0] = 0;
  for (let i = 1; i < n; i++) {
    const ds = s[i] - s[i - 1];
    const cx = 0.5 * (Math.cos(F.theta[i]) + Math.cos(F.theta[i - 1]));
    const cy = 0.5 * (Math.sin(F.theta[i]) + Math.sin(F.theta[i - 1]));
    F.px[i] = F.px[i - 1] + cx * ds;
    F.py[i] = F.py[i - 1] + cy * ds;
  }
  // Schwerpunkt auf den Ruheschwerpunkt legen -> Kopf und Schwanz schwingen
  // beide um die Mitte, statt dass ein Ende festgenagelt ist.
  let cx = 0, cy = 0, w2 = 0;
  for (let i = 0; i < n; i++) {
    const ds = (s[Math.min(n - 1, i + 1)] - s[Math.max(0, i - 1)]) * 0.5;
    cx += F.px[i] * ds; cy += F.py[i] * ds; w2 += ds;
  }
  cx /= (w2 || 1); cy /= (w2 || 1);
  const ox = m.restCx - cx, oy = m.restCy - cy;

  for (let i = 0; i < n; i++) {
    out[i * 4]     = F.px[i] + ox;
    out[i * 4 + 1] = F.py[i] + oy;
    out[i * 4 + 2] = Math.cos(F.theta[i]);
    out[i * 4 + 3] = Math.sin(F.theta[i]);
  }
  return f;
}
