import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js";
import { PARAMS, makeFish, solve } from "./kin.js";

// ---------------------------------------------------------------------------
//  Szene. Die Bewegungslehre steckt vollstaendig in kin.js; hier steht nur,
//  wie ein Fisch auf dem Bildschirm landet: Gitter an die Achse binden,
//  Achse pro Bild neu rechnen, hochladen, zeichnen.
// ---------------------------------------------------------------------------

const GX = 52, GY = 14;            // Gitteraufloesung pro Fisch
const NS = 44;                     // Stuetzstellen der Achse
const FISH_FRAC = 0.115;           // Rumpflaenge als Anteil der Bildbreite (nah)
const DEPTH_SCALE = [1.0, 0.55];   // Groesse nah -> fern
const OCC_MAX = 0.82;

let renderer, scene, camera, pondMesh, crownTex, params, types = {}, actors = [];
let halfW = 0.5, halfH = 0.3, pondAspect = 1.78;
let occlusionOn = true, showSpine = false;
const clock = new THREE.Clock();
const statsEl = document.getElementById("stats");
let fps = 0, frames = 0, lastT = 0;

// ---------------------------------------------------------------------- Shader
function patch(shader, uni) {
  Object.assign(shader.uniforms, uni);
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>
attribute float aIdx;    // Stuetzstelle auf der Ruheachse, als Gleitkommazahl
attribute vec2  aOff;    // Lage des Vertex im Ruhe-Begleitsystem: (tangential, normal)
uniform vec4 uSpine[${NS}];   // je Stuetzstelle: (Px,Py,Tx,Ty) der verformten Achse
varying vec2 vWorldXY;`)
    .replace("#include <begin_vertex>", `#include <begin_vertex>
{
  float fi = clamp(aIdx, 0.0, ${(NS - 1).toFixed(1)});
  int i0 = int(floor(fi));
  int i1 = min(i0 + 1, ${NS - 1});
  float wgt = fi - float(i0);
  vec4 A = uSpine[i0], B = uSpine[i1];
  vec2 P = mix(A.xy, B.xy, wgt);
  vec2 T = normalize(mix(A.zw, B.zw, wgt));
  vec2 N = vec2(-T.y, T.x);
  transformed.xy = P + T * aOff.x + N * aOff.y;
  vWorldXY = (modelMatrix * vec4(transformed, 1.0)).xy;
}`);
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>
uniform sampler2D uCrownMap;
uniform float uOcc;
uniform float uPondAspect;
varying vec2 vWorldXY;`)
    .replace("#include <map_fragment>", `#include <map_fragment>
{
  vec2 puv = vec2(vWorldXY.x + 0.5, vWorldXY.y * uPondAspect + 0.5);
  float crown = texture2D(uCrownMap, clamp(puv, 0.0, 1.0)).r;
  diffuseColor.a *= 1.0 - crown * uOcc * ${OCC_MAX.toFixed(2)};
}`);
}

// -------------------------------------------------------------------- Geometrie
// Jeder Vertex wird auf die gemalte Ruheachse projiziert und in deren
// Begleitsystem abgelegt: (tangentialer Abstand, normaler Abstand). Der Shader
// setzt ihn spaeter im GLEICHEN Begleitsystem der verformten Achse wieder ab.
// Dadurch folgt die Textur der Achse, statt geschert zu werden.
function buildGeometry(p) {
  const asp = p.h / p.w;
  const X = p.restX, Y = p.restY, n = X.length;
  const tx = new Float64Array(n), ty = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
    let dx = X[i1] - X[i0], dy = Y[i1] - Y[i0];
    const l = Math.hypot(dx, dy) || 1e-6;
    tx[i] = dx / l; ty[i] = dy / l;
  }
  const nV = GX * GY;
  const pos = new Float32Array(nV * 3), uv = new Float32Array(nV * 2);
  const aIdx = new Float32Array(nV), aOff = new Float32Array(nV * 2);
  const fiRaw = new Float32Array(nV);
  const gx = new Float32Array(nV), gy = new Float32Array(nV);
  let v = 0;
  for (let j = 0; j < GY; j++) {
    for (let i = 0; i < GX; i++) {
      const ug = i / (GX - 1), vg = j / (GY - 1);
      const X0 = ug - 0.5, Y0 = -(vg - 0.5) * asp;
      pos[v * 3] = X0; pos[v * 3 + 1] = Y0; pos[v * 3 + 2] = 0;
      uv[v * 2] = ug; uv[v * 2 + 1] = vg;
      gx[v] = X0; gy[v] = Y0;
      // naechsten Punkt auf dem Polygonzug suchen (segmentweise Projektion)
      let best = Infinity, bi = 0, bt = 0;
      for (let k = 0; k < n - 1; k++) {
        const ax = X[k], ay = Y[k], bx = X[k + 1], by = Y[k + 1];
        const ex = bx - ax, ey = by - ay;
        const ll = ex * ex + ey * ey || 1e-12;
        let tt = ((X0 - ax) * ex + (Y0 - ay) * ey) / ll;
        tt = Math.max(0, Math.min(1, tt));
        const qx = ax + ex * tt, qy = ay + ey * tt;
        const d2 = (X0 - qx) ** 2 + (Y0 - qy) ** 2;
        if (d2 < best) { best = d2; bi = k; bt = tt; }
      }
      fiRaw[v] = bi + bt;
      v++;
    }
  }
  // Das Zuordnungsfeld glaetten. Bei stark gebogenen Fischen springt die reine
  // Projektion zwischen weit auseinanderliegenden Achsenpunkten -- benachbarte
  // Vertices landen dann in voellig verschiedenen Begleitsystemen und das Netz
  // reisst in Bloecke. Ein paar Mittelungsdurchgaenge machen die Zuordnung
  // stetig; die kleine Ungenauigkeit sieht man nicht, den Riss schon.
  let fi = Float32Array.from(fiRaw), tmp = new Float32Array(nV);
  for (let it = 0; it < 22; it++) {
    for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++) {
      const c = j * GX + i;
      let sum = 0, cnt = 0;
      if (i > 0) { sum += fi[c - 1]; cnt++; }
      if (i < GX - 1) { sum += fi[c + 1]; cnt++; }
      if (j > 0) { sum += fi[c - GX]; cnt++; }
      if (j < GY - 1) { sum += fi[c + GX]; cnt++; }
      tmp[c] = 0.45 * fi[c] + 0.55 * (sum / cnt);
    }
    fi.set(tmp);
  }
  // Begleitsystem an der geglaetteten Stelle auswerten und Vertex dort ablegen
  for (let c = 0; c < nV; c++) {
    const f = Math.max(0, Math.min(n - 1 - 1e-4, fi[c]));
    const i0 = Math.floor(f), i1 = Math.min(n - 1, i0 + 1), w = f - i0;
    const Px = X[i0] + (X[i1] - X[i0]) * w, Py = Y[i0] + (Y[i1] - Y[i0]) * w;
    let Tx = tx[i0] + (tx[i1] - tx[i0]) * w, Ty = ty[i0] + (ty[i1] - ty[i0]) * w;
    const tl = Math.hypot(Tx, Ty) || 1e-6; Tx /= tl; Ty /= tl;
    const dx = gx[c] - Px, dy = gy[c] - Py;
    aIdx[c] = f;
    aOff[c * 2] = dx * Tx + dy * Ty;          // tangential
    aOff[c * 2 + 1] = dx * (-Ty) + dy * Tx;   // normal
  }
  const idx = [];
  for (let j = 0; j < GY - 1; j++) for (let i = 0; i < GX - 1; i++) {
    const a = j * GX + i, b = a + 1, c = a + GX, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setAttribute("aIdx", new THREE.BufferAttribute(aIdx, 1));
  g.setAttribute("aOff", new THREE.BufferAttribute(aOff, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------- Steuerung
function rnd32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const wrapAngle = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

function spawn(fid, seed) {
  const T = types[fid];
  const uni = {
    uSpine: { value: new Float32Array(NS * 4) },
    uCrownMap: { value: crownTex },
    uOcc: { value: 0 },
    uPondAspect: { value: pondAspect }
  };
  const mat = new THREE.MeshBasicMaterial({ map: T.tex, transparent: true, alphaTest: 0.12, side: THREE.DoubleSide });
  mat.customProgramCacheKey = () => "koi-kin-v1";
  mat.onBeforeCompile = sh => patch(sh, uni);
  const mesh = new THREE.Mesh(T.geom, mat);
  const r = rnd32(seed);
  const depth = r();
  const scl = DEPTH_SCALE[0] + (DEPTH_SCALE[1] - DEPTH_SCALE[0]) * depth;
  const LworldBody = FISH_FRAC * (2 * halfW) * scl;
  const k = LworldBody / T.p.LBody;         // Meshmass -> Weltmass
  mesh.scale.setScalar(k);
  mesh.position.z = 0.02 - 0.04 * depth;
  mesh.renderOrder = Math.round((1 - depth) * 100);
  scene.add(mesh);
  const a = {
    fid, mesh, uni, depth, F: makeFish(T.p, PARAMS),
    kScale: k, Lworld: LworldBody,
    x: (r() - 1 / 2) * 2 * halfW * 0.9, y: (r() - 1 / 2) * 2 * halfH * 0.9,
    theta: r() * Math.PI * 2, psi: r() * Math.PI * 2,
    v: 0, omega: 0, wander: r() * Math.PI * 2, rw: rnd32(seed ^ 0x9e37),
    vCruise: (0.55 + 0.5 * r()) * LworldBody * (1.25 - 0.45 * depth),
    burst: 0, burstT: 1 + 3 * r()
  };
  a.v = a.vCruise;
  actors.push(a);
  return a;
}

function step(a, dt, t) {
  // Wander: begrenzte Zufallsdrehung, nie periodisch
  a.wander += (a.rw() - 0.5) * 2.2 * dt * 3;
  let thetaD = a.theta + Math.sin(a.wander) * 0.9;
  // Rand: weich nach innen drehen
  const mx = halfW * 0.82, my = halfH * 0.82;
  let bx = 0, by = 0;
  if (a.x > mx) bx = -(a.x - mx) / (halfW * 0.25);
  if (a.x < -mx) bx = (-mx - a.x) / (halfW * 0.25);
  if (a.y > my) by = -(a.y - my) / (halfH * 0.25);
  if (a.y < -my) by = (-my - a.y) / (halfH * 0.25);
  const bs = Math.hypot(bx, by);
  if (bs > 1e-4) {
    const want = Math.atan2(by, bx);
    thetaD = a.theta + wrapAngle(want - a.theta) * clamp(bs, 0, 1);
  }
  const d = wrapAngle(thetaD - a.theta);
  const omegaMax = 1.9;
  const target = clamp(d * 2.4, -omegaMax, omegaMax);
  a.omega += clamp(target - a.omega, -7 * dt, 7 * dt);
  a.theta += a.omega * dt;

  a.burstT -= dt;
  if (a.burstT <= 0) { a.burst = a.rw() < 0.3 ? 1 : 0; a.burstT = 1.5 + 4 * a.rw(); }
  const vT = a.vCruise * (a.burst ? 2.1 : 1) * (1 - 0.35 * Math.abs(a.omega) / omegaMax);
  a.v += clamp(vT - a.v, -2.2 * a.Lworld * dt, 2.2 * a.Lworld * dt);
  a.v = Math.max(a.v, 0.12 * a.Lworld);

  a.x += a.v * Math.cos(a.theta) * dt;
  a.y += a.v * Math.sin(a.theta) * dt;

  // Kinematik: Geschwindigkeit in Rumpflaengen pro Sekunde
  const UperL = a.v / a.Lworld;
  const omegaN = clamp(a.omega / omegaMax, -1, 1);
  const f = solve(a.F, UperL, omegaN, t, a.psi, PARAMS, a.uni.uSpine.value);
  a.f = f; a.UperL = UperL;
  a.uni.uSpine.needsUpdate = true;
  a.mesh.position.x = a.x; a.mesh.position.y = a.y;
  a.mesh.rotation.z = a.theta;
}

// ---------------------------------------------------------------------- Aufbau
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  const va = w / h;
  if (va > pondAspect) { halfW = 0.5; halfH = 0.5 / va; }
  else { halfH = 0.5 / pondAspect; halfW = halfH * va; }
  camera.left = -halfW; camera.right = halfW;
  camera.top = halfH; camera.bottom = -halfH;
  camera.updateProjectionMatrix();
}

async function boot() {
  const stage = document.getElementById("stage");
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setClearColor(0x0a0e0b, 1);
  stage.appendChild(renderer.domElement);
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-.5, .5, .3, -.3, -1, 1);
  camera.position.z = 0.5;

  params = await (await fetch("./params.json")).json();
  pondAspect = params.pond.w / params.pond.h;
  resize();
  addEventListener("resize", () => { resize(); placePond(); });

  const tl = new THREE.TextureLoader();
  const load = u => new Promise(res => tl.load(u, t => { t.colorSpace = THREE.SRGBColorSpace; res(t); }));
  const pondTex = await load("./assets/pond.jpg");
  crownTex = await load("./assets/crown_mask.jpg");
  crownTex.colorSpace = THREE.NoColorSpace;

  pondMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: pondTex }));
  pondMesh.position.z = -0.5; pondMesh.renderOrder = -1;
  scene.add(pondMesh);
  placePond();

  for (const [fid, p] of Object.entries(params.fish)) {
    // Flossenanteil begrenzen: bei ein paar Fischen liegt der gemessene
    // Schwanzstiel sehr frueh, dann waere fast die halbe Achse "Flosse" und
    // das Glied verzieht sich sichtbar. Untergrenze 0.66 der Gesamtlaenge.
    const sN = p.s[p.s.length - 1];
    if (p.s[p.iPed] / sN < 0.66) {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < p.s.length; i++) {
        const d = Math.abs(p.s[i] / sN - 0.72);
        if (d < bd) { bd = d; bi = i; }
      }
      p.iPed = bi; p.LBody = p.s[bi];
    }
    // Gemalter Tangentenverlauf, mittelwertfrei. Das ist die Ruhehaltung des
    // Bildes als Winkel -- beschraenkt und ohne Knicke.
    {
      const nn = p.restX.length, th = new Float64Array(nn);
      let prev = 0;
      for (let i = 0; i < nn; i++) {
        const i0 = Math.max(0, i - 1), i1 = Math.min(nn - 1, i + 1);
        let a = Math.atan2(p.restY[i1] - p.restY[i0], p.restX[i1] - p.restX[i0]);
        while (a - prev > Math.PI) a -= 2 * Math.PI;
        while (a - prev < -Math.PI) a += 2 * Math.PI;
        th[i] = a; prev = a;
      }
      let bar = 0, ws = 0;
      for (let i = 0; i < nn; i++) {
        const ds = (p.s[Math.min(nn - 1, i + 1)] - p.s[Math.max(0, i - 1)]) * 0.5;
        bar += th[i] * ds; ws += ds;
      }
      bar /= (ws || 1);
      p.thetaRest = Array.from(th, v => v - bar);
    }
    const tex = await load("./assets/" + p.file);
    types[fid] = { p, tex, geom: buildGeometry(p) };
  }
  setCount(30);
  requestAnimationFrame(tick);
}

function placePond() {
  pondMesh.scale.set(1, 1 / pondAspect, 1);
}

function clearActors() {
  for (const a of actors) { scene.remove(a.mesh); a.mesh.material.dispose(); }
  actors = [];
}
function setCount(n) {
  clearActors();
  const ids = Object.keys(types);
  for (let i = 0; i < n; i++) spawn(ids[i % ids.length], i * 97 + 13);
  document.querySelectorAll("[data-n]").forEach(b => b.classList.toggle("on", +b.dataset.n === n));
}
window.setCount = setCount;

function tick() {
  const dt = Math.min(0.05, clock.getDelta());
  const t = clock.getElapsedTime();
  frames++;
  if (t - lastT > 0.5) { fps = Math.round(frames / (t - lastT)); frames = 0; lastT = t; }
  for (const a of actors) {
    step(a, dt, t);
    a.uni.uOcc.value = occlusionOn ? a.depth : 0;
  }
  renderer.render(scene, camera);
  const a0 = actors[0];
  if (statsEl && a0) {
    statsEl.textContent =
      `${fps} fps   ${actors.length} Fische\n` +
      `Fisch 1:  ${a0.UperL.toFixed(2)} Laengen/s   Schlag ${a0.f.toFixed(2)} Hz`;
  }
  requestAnimationFrame(tick);
}

// ----------------------------------------------------------------------- Regler
export function bindUI() {
  document.querySelectorAll("input[type=range]").forEach(inp => {
    const key = inp.dataset.k;
    inp.value = PARAMS[key];
    const out = document.getElementById("v_" + key);
    const show = () => { if (out) out.textContent = (+inp.value).toFixed(inp.step.includes(".") ? 2 : 0); };
    show();
    inp.addEventListener("input", () => { PARAMS[key] = +inp.value; show(); });
  });
  document.querySelectorAll("[data-n]").forEach(b =>
    b.addEventListener("click", () => setCount(+b.dataset.n)));
  const oc = document.getElementById("occl");
  if (oc) oc.addEventListener("click", () => {
    occlusionOn = !occlusionOn; oc.classList.toggle("on", occlusionOn);
  });
  const rs = document.getElementById("reset");
  if (rs) rs.addEventListener("click", () => {
    Object.assign(PARAMS, DEFAULTS);
    document.querySelectorAll("input[type=range]").forEach(i => {
      i.value = PARAMS[i.dataset.k]; i.dispatchEvent(new Event("input"));
    });
  });
}
const DEFAULTS = { ...PARAMS };

bindUI();
boot();
