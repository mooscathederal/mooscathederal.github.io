// Fischi – Verformungskern v2 (Stufe 0). Reine Funktionen.
// Fischrahmen wie v1: Ursprung Schwerpunkt, e1 Richtung Kopf, s = Bogenlänge ab Schnauze in L (0..1).
// Pose statt Zeit: Die Verformung wird aus einer Pose beschrieben, die die Simulation liefert:
//   pose = { A, lambda, phi, gain, kappa, sJoint, finAmp, finLag, env }
//   A      Schwanzamplitude einseitig in L (Rumpfwelle)
//   lambda Wellenlänge in L
//   phi    Wellenphase (rad), von der Simulation fortgeschrieben (Schlagfrequenz kann variieren)
//   gain   0..1, skaliert die Welle (Gleiten -> 0)
//   kappa  Körperbogen: Gesamtwinkeländerung über die Länge (rad), für Kurven
//   sJoint Ort des Schwanzstiel-Gelenks in L; ab hier ist die Flosse ein eigenes Glied
//   finAmp Ausschlag der Schwanzflosse am Gelenk (rad), einseitig
//   finLag Phasennachlauf der Flosse gegen die Rumpfwelle (rad)
//   env    {a0,a1,a2} Amplitudenhüllkurve relativ (=1 bei s=1)

export const DEFAULT_ENV = { a0: 0.04, a1: 0.10, a2: 0.86 };

export function envelope(s, env) { return env.a0 + env.a1 * s + env.a2 * s * s; }

// Tangentenwinkel-Funktion der Pose bei Bogenlänge s (dimensionslos, L-Einheiten)
export function thetaOf(pose, L, s) {
  const env = pose.env || DEFAULT_ENV;
  const A = pose.A * pose.gain;
  const k = 2 * Math.PI / pose.lambda;
  const sB = Math.min(s, pose.sJoint);
  // Rumpfwelle: h(s) = A env(s) sin(k s + phi)  -> h'(s) = A [env'(s) sin + env(s) k cos]
  const envp = env.a1 + 2 * env.a2 * sB;
  const arg = k * sB + pose.phi;
  const slope = A * (envp * Math.sin(arg) + envelope(sB, env) * k * Math.cos(arg));
  let th = Math.atan(slope) + pose.kappa * sB;
  if (s > pose.sJoint) {
    // Flossenglied: starr, mit eigenem Ausschlag und Nachlauf; Übergang linear über 6 % L geglättet
    const w = Math.min(1, (s - pose.sJoint) / 0.06);
    const finArg = k * pose.sJoint + pose.phi - pose.finLag;
    th += w * pose.finAmp * pose.gain * Math.sin(finArg) + pose.kappa * (s - pose.sJoint) * 0.5;
  }
  return th;
}

export function midline(fish, pose, ns, s0, s1) {
  const L = fish.L, N = ns + 1, ds = (s1 - s0) / ns;
  const x = new Float64Array(N), y = new Float64Array(N), nx = new Float64Array(N), ny = new Float64Array(N);
  const rest = (pose.A * pose.gain === 0) && pose.kappa === 0 && (pose.finAmp * pose.gain === 0);
  if (rest) {
    for (let i = 0; i < N; i++) { x[i] = fish.uHead - (s0 + i * ds) * L; y[i] = 0; nx[i] = 0; ny[i] = 1; }
    return { x, y, nx, ny };
  }
  const th = new Float64Array(N);
  for (let i = 0; i < N; i++) th[i] = thetaOf(pose, L, s0 + i * ds);
  const iA = Math.round((0 - s0) / ds), iB = Math.round((1 - s0) / ds);   // Indizes von s=0 und s=1
  // Gewichte je Stützstelle: gleich (centroid) oder Masse ∝ Breite² (mass), Flosse hinter dem Gelenk fast masselos
  let wgt = null;
  if (pose.anchor === "centroid" || pose.anchor === "mass") {
    wgt = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const s = s0 + i * ds; if (s < 0 || s > 1) { wgt[i] = 0; continue; }
      if (pose.anchor === "mass" && fish.widthProfile) {
        const wp = fish.widthProfile, k = Math.min(wp.length - 1, Math.floor(s * wp.length));
        const w = Math.min(wp[k], 0.2);                       // Brustflossen nicht als Masse zählen
        wgt[i] = w * w * (s > pose.sJoint ? 0.05 : 1);
      } else wgt[i] = 1;
    }
    let m = 0, W = 0; for (let i = 0; i < N; i++) { m += th[i] * wgt[i]; W += wgt[i]; } m /= W;
    for (let i = 0; i < N; i++) th[i] -= m;                    // Drehimpuls: massengewichtete mittlere Richtung = 0
  }
  x[0] = 0; y[0] = 0;
  for (let i = 1; i < N; i++) { const tm = 0.5 * (th[i - 1] + th[i]); x[i] = x[i - 1] - Math.cos(tm) * ds * L; y[i] = y[i - 1] + Math.sin(tm) * ds * L; }
  let ox, oy;
  if (wgt) {
    // Impuls: massengewichteter Schwerpunkt bleibt auf dem Ruhe-Massenschwerpunkt
    let mx = 0, my = 0, W = 0, mu = 0;
    for (let i = 0; i < N; i++) { mx += x[i] * wgt[i]; my += y[i] * wgt[i]; W += wgt[i]; mu += (fish.uHead - (s0 + i * ds) * L) * wgt[i]; }
    ox = mu / W - mx / W; oy = -my / W;
  } else { ox = fish.uHead - x[iA]; oy = -y[iA]; }
  for (let i = 0; i < N; i++) { x[i] += ox; y[i] += oy; nx[i] = Math.sin(th[i]); ny[i] = Math.cos(th[i]); }
  return { x, y, nx, ny };
}

export function buildGrid(fish, pose, ns, nv, s0, s1, v0, v1) {
  const ml = midline(fish, pose, ns, s0, s1);
  const nVerts = (ns + 1) * (nv + 1);
  const pos = new Float32Array(nVerts * 2), tex = new Float32Array(nVerts * 2);
  const { cx, cy, e1x, e1y, e2x, e2y, L } = fish;
  let k = 0;
  for (let i = 0; i <= ns; i++) {
    const s = s0 + (s1 - s0) * i / ns, uRest = fish.uHead - s * L;
    for (let j = 0; j <= nv; j++) {
      const v = v0 + (v1 - v0) * j / nv;
      tex[k] = cx + uRest * e1x + v * e2x; tex[k + 1] = cy + uRest * e1y + v * e2y;
      const fu = ml.x[i] + v * ml.nx[i], fv = ml.y[i] + v * ml.ny[i];
      pos[k] = cx + fu * e1x + fv * e2x; pos[k + 1] = cy + fu * e1y + fv * e2y; k += 2;
    }
  }
  const idx = new Uint32Array(ns * nv * 6); let m = 0;
  for (let i = 0; i < ns; i++) for (let j = 0; j < nv; j++) { const a = i * (nv + 1) + j, b = a + nv + 1; idx[m++] = a; idx[m++] = b; idx[m++] = a + 1; idx[m++] = a + 1; idx[m++] = b; idx[m++] = b + 1; }
  return { pos, tex, idx, ns, nv };
}
