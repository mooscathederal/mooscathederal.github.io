import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js";

const GX = 40, GY = 12;              // Grid-Aufloesung des prozeduralen Meshs
const A_MAX = (14 * Math.PI) / 180;  // Laufwellen-Amplitude (Basiswert, skaliert mit uEnv)
const N_WAVES = 0.55;
const BEND_MAX = (11 * Math.PI) / 180; // max. stationaere Zusatzkruemmung bei voller Drehrate

// ---------------------------------------------------------------------------
// Bewegungs-Zustandsmodell. Kein sin(t)/cos(t) der absoluten Zeit irgendwo in
// der Bahnberechnung -- Zeit fliesst nur ueber dt in Integration und Poisson-
// Dwells ein. Orientierung ist die fuehrende Groesse (theta), nie aus einer
// Geschwindigkeit rekonstruiert.
// ---------------------------------------------------------------------------
const STATES = {
  CRUISE: { vFrac: [0.32, 0.52], meanDwell: 10.0, omegaMax: 1.15, kTurn: 2.6, wander: 0.85,
            next: { CRUISE: 0.00, BURST: 0.28, COAST: 0.34, TURN: 0.38 } },
  BURST:  { vFrac: [0.75, 1.00], meanDwell: 2.0,  omegaMax: 1.55, kTurn: 3.2, wander: 1.05,
            next: { CRUISE: 0.55, BURST: 0.00, COAST: 0.15, TURN: 0.30 } },
  COAST:  { vFrac: [0.10, 0.22], meanDwell: 5.5,  omegaMax: 0.55, kTurn: 2.0, wander: 0.45,
            next: { CRUISE: 0.60, BURST: 0.10, COAST: 0.00, TURN: 0.30 } },
  TURN:   { vFrac: [0.38, 0.60], meanDwell: 1.4,  omegaMax: 2.15, kTurn: 3.6, wander: 1.60,
            next: { CRUISE: 0.45, BURST: 0.20, COAST: 0.10, TURN: 0.00 } },
};
const V_MIN_FRAC = 0.12;      // Bodengeschwindigkeit, Vielfaches von L/s -- haelt v>0 strukturell
const ACCEL_FRAC = 0.55;      // max. Beschleunigung relativ zu vMax, pro Sekunde
const OMEGA_SLEW = 7.0;       // rad/s^2, Slew-Limit fuer omega (Traegheits-Glaettung)
const BOUNDARY_START = 0.70;  // Anteil des Frustums, ab dem Randzone beginnt
const BOUNDARY_MAX_W = 4.2;
const BOUNDARY_OMEGA = 2.6;   // Notfall-Drehrate in der Randzone, uebersteuert Zustands-omegaMax
const AVOID_RADIUS_MUL = 2.4; // * mittlere Koerperlaenge des Paares
const AVOID_DEPTH_SIM = 0.24; // nur Fische aehnlicher Tiefe vermeiden einander
const AVOID_STRENGTH = 1.6;
const AVOID_MAG_CAP = 2.5;    // deckelt die Summe vieler naher Nachbarn
const OVERLAP_FRAC = 0.55;    // Ueberlappungs-Schwelle relativ zu (Li+Lj)/2

function depthScaleMul(depth) { return 1.32 - 0.62 * depth; }  // 1.32 nah -> 0.70 fern
function depthSpeedMul(depth) { return 1.22 - 0.42 * depth; }  // 1.22 nah -> 0.80 fern

function wrapAngle(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

const canvas = document.createElement("canvas");
document.getElementById("stage").prepend(canvas);
const statsEl = document.getElementById("stats");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
camera.position.set(0, 0, 5);

scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const sun = new THREE.DirectionalLight(0xfff2d8, 1.05);
sun.position.set(0.3, 0.5, 1.6);
scene.add(sun);

let manifest, pondAspect, crownTex;
let fishTypes = {};   // id -> { geomCurved, geomStraight, tex, w, h }
let actors = [];
let overlapPairs = new Map();
let useCurved = true, occlusionEnabled = true;
let clock = new THREE.Clock();
let frames = 0, lastFpsT = 0, fps = 0;
let fHalfW = 0.5, fHalfH = 0.3;   // sichtbares Frustum, halbe Breite/Hoehe -- die Bewegungsdomaene
let REF_MIN_DIM = 0.5629;         // Referenz-Domaenengroesse fuer Fisch-/Geschwindigkeitsskala,
                                   // exakt gesetzt in main() sobald pondAspect bekannt ist (= 1/pondAspect)

let stats = mkStats();
function mkStats() {
  return {
    framesSeen: 0, sinceT: 0,
    maxDThetaDeg: 0, maxJumpL: 0,
    stallFrames: 0, fishFrames: 0,
    overlapEpisodes: 0, hardResets: 0,
    fpsHistory: [], minFps: Infinity,
  };
}
function resetStats() {
  stats = mkStats();
  stats.sinceT = clock.getElapsedTime();
  overlapPairs.clear();
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(w, h, true);
  const viewAspect = w / h;
  let vw, vh;
  if (viewAspect > pondAspect) { vw = 1; vh = 1 / viewAspect; }
  else { vh = 1 / pondAspect; vw = vh * viewAspect; }
  camera.left = -vw / 2; camera.right = vw / 2;
  camera.top = vh / 2; camera.bottom = -vh / 2;
  camera.updateProjectionMatrix();
  fHalfW = vw / 2; fHalfH = vh / 2;
}
window.addEventListener("resize", () => {
  resize();
  // Fischgroesse/-tempo sind domaenenrelativ kalibriert (siehe spawnActor) --
  // nach einer Fenstergroessenaenderung (Rotation, Resize, DevTools) muss
  // neu gespawnt werden, sonst laufen Akteure mit der ALTEN Domaenenskala in
  // der NEUEN Randgeometrie weiter, was die Rand-/Fluchtphysik aus dem Tritt
  // bringt (beobachtet: grosse maxJump-Werte und Hard-Resets direkt nach
  // einem Resize-Event).
  if (Object.keys(fishTypes).length && actors.length) setCount(actors.length);
});

function nearestSpine(lx, ly, sx, sy) {
  let bi = 0, bd = Infinity;
  for (let i = 0; i < sx.length; i++) {
    const dx = lx - sx[i], dy = ly - sy[i];
    const d = dx*dx + dy*dy;
    if (d < bd) { bd = d; bi = i; }
  }
  return bi;
}

function buildGeometry(fish, spineMode) {
  const aspect = fish.h / fish.w;
  const su = fish.spineX, sv = fish.spineY, sU = fish.spineU;
  const slx = su.map(v => v - 0.5);
  const sly = sv.map(v => -(v - 0.5) * aspect);
  let lx, ly;
  if (spineMode === "straight") {
    const x0 = slx[0], y0 = sly[0], x1 = slx[slx.length-1], y1 = sly[sly.length-1];
    lx = sU.map(u => x0 + (x1-x0)*u);
    ly = sU.map(u => y0 + (y1-y0)*u);
  } else {
    lx = slx; ly = sly;
  }

  const nV = GX * GY;
  const pos = new Float32Array(nV*3), uv = new Float32Array(nV*2);
  const aU = new Float32Array(nV), aSpine = new Float32Array(nV*2);
  let vi = 0;
  for (let j = 0; j < GY; j++) {
    for (let i = 0; i < GX; i++) {
      const ug = i/(GX-1), vg = j/(GY-1);
      const px = ug - 0.5, py = -(vg - 0.5) * aspect;
      pos[vi*3] = px; pos[vi*3+1] = py; pos[vi*3+2] = 0;
      uv[vi*2] = ug; uv[vi*2+1] = vg;
      const ni = nearestSpine(px, py, lx, ly);
      aU[vi] = sU[ni];
      aSpine[vi*2] = lx[ni]; aSpine[vi*2+1] = ly[ni];
      vi++;
    }
  }
  const idx = [];
  for (let j = 0; j < GY-1; j++) {
    for (let i = 0; i < GX-1; i++) {
      const a = j*GX+i, b = a+1, c = a+GX, d = c+1;
      idx.push(a,c,b, b,c,d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setAttribute("aU", new THREE.BufferAttribute(aU, 1));
  g.setAttribute("aSpine", new THREE.BufferAttribute(aSpine, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Ein Shaderprogramm fuer alle Fische (identischer Quelltext, nur Uniform-
// Werte unterscheiden sich pro Material) -- customProgramCacheKey konstant,
// spart 30-40 redundante Compiles beim Start.
function installFishShader(shader) {
  shader.uniforms.uPhase = { value: 0 };
  shader.uniforms.uEnv = { value: 0 };
  shader.uniforms.uBend = { value: 0 };
  shader.uniforms.uOcc = { value: 0 };
  shader.uniforms.uCrownMap = { value: crownTex };
  shader.uniforms.uPondAspect = { value: pondAspect };

  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>
attribute float aU;
attribute vec2 aSpine;
uniform float uPhase;
uniform float uEnv;
uniform float uBend;
varying vec2 vWorldXY;`)
    .replace("#include <begin_vertex>", `#include <begin_vertex>
{
  float amp = uEnv * ${A_MAX.toFixed(5)} * aU * aU;
  float ang = amp * sin(uPhase - ${(2*Math.PI*N_WAVES).toFixed(5)} * aU) + uBend * ${BEND_MAX.toFixed(5)} * aU * aU;
  float c = cos(ang), s = sin(ang);
  vec2 d = transformed.xy - aSpine;
  transformed.xy = aSpine + vec2(c*d.x - s*d.y, s*d.x + c*d.y);
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
  diffuseColor.a *= 1.0 - crown * uOcc;
}`);
}

async function loadFishType(fid, meta, tex) {
  const geomCurved = buildGeometry(meta, "curved");
  const geomStraight = buildGeometry(meta, "straight");
  fishTypes[fid] = { geomCurved, geomStraight, tex, w: meta.w, h: meta.h };
}

function mulberry32(a) {
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function sampleDwell(stateName, rnd) {
  const rate = 1 / STATES[stateName].meanDwell;
  return -Math.log(Math.max(1e-6, rnd())) / rate;   // memoryless (Poisson-Prozess)
}
function pickNextState(rnd, cur) {
  const table = STATES[cur].next;
  let r = rnd();
  for (const k of ["CRUISE","BURST","COAST","TURN"]) {
    const p = table[k]; if (p <= 0) continue;
    if (r < p) return k;
    r -= p;
  }
  return "CRUISE";
}

function spawnActor(fid, seed) {
  const t = fishTypes[fid];
  const mat = new THREE.MeshPhongMaterial({ map: t.tex, transparent: true, alphaTest: 0.12, side: THREE.DoubleSide, shininess: 16 });
  mat.customProgramCacheKey = () => "koi-wave-v2";
  const mesh = new THREE.Mesh(useCurved ? t.geomCurved : t.geomStraight, mat);

  const rnd = mulberry32(seed);
  const rndWander = mulberry32(((seed * 2654435761) >>> 0) ^ 0x9e3779b9);
  const rndState  = mulberry32(((seed * 40503) >>> 0) ^ 0x85ebca6b);

  // Fischgroesse UND -geschwindigkeit sind relativ zur Domaenengroesse
  // kalibriert (nicht in absoluten Welteinheiten): auf einem schmalen
  // Mobile-Frustum sind Fische sonst relativ zur sichtbaren Breite riesig,
  // UND das Verhaeltnis Randlauf-Distanz/Geschwindigkeit kippt, wodurch
  // Fische die weiche Randzone durchstossen koennen (per diag_motion_v2 bei
  // schmalen Seitenverhaeltnissen gefunden). REF_MIN_DIM ist die kleinere
  // Domaenenseite bei "normaler" Desktop-Form (aus pondAspect abgeleitet,
  // keine Fensterkonstante); domainScale=1 dort, <1 auf schmalen Viewports.
  const domainMinDim = 2*Math.min(fHalfW, fHalfH);
  const domainScale = domainMinDim / REF_MIN_DIM;
  const depth = rnd();
  const Lbase = 0.075 + rnd()*0.06;
  const L = Lbase * depthScaleMul(depth) * domainScale;
  const vMaxBase = 0.11 + rnd()*0.055;
  const vMax = vMaxBase * depthSpeedMul(depth) * domainScale;

  mesh.scale.set(L, L, 1);
  mesh.position.z = 0.02 - 0.04*depth;   // naeher (depth~0) -> vor ferneren Fischen
  mat.color.setRGB(1,1,1).lerp(new THREE.Color(0x93a67e), 0.22*depth); // leichte Luftperspektive

  const theta0 = rnd()*Math.PI*2;
  const rec = {
    fid, mesh, uniforms: null,
    depth, L, vMax, vMin: V_MIN_FRAC*L,
    x: (rnd()-0.5)*2*fHalfW*0.85, y: (rnd()-0.5)*2*fHalfH*0.85,
    theta: theta0, thetaD: theta0, thetaPrevTarget: theta0, omega: 0,
    v: vMax*0.3, vTargetFrac: 0.4,
    state: "CRUISE", tState: sampleDwell("CRUISE", rndState),
    phase: rnd()*Math.PI*2, bend: 0, envTarget: 0.6,
    avoidX: 0, avoidY: 0,
    rndWander, rndState,
  };
  mat.onBeforeCompile = (sh) => { installFishShader(sh); rec.uniforms = sh.uniforms; };
  scene.add(mesh);
  actors.push(rec);
}

// Weiche paarweise Abstossung, nur zwischen Fischen aehnlicher Tiefe (sie
// schwimmen sonst auf verschiedenen "Hoehen" und duerfen sich ueberlagern).
// O(n^2), bei n<=40 voellig unkritisch (~780 Paare/Frame).
function computeAvoidance() {
  for (const a of actors) { a.avoidX = 0; a.avoidY = 0; }
  for (let i = 0; i < actors.length; i++) {
    const A = actors[i];
    for (let j = i+1; j < actors.length; j++) {
      const B = actors[j];
      if (Math.abs(A.depth - B.depth) > AVOID_DEPTH_SIM) continue;
      const dx = A.x-B.x, dy = A.y-B.y;
      const d = Math.hypot(dx,dy) || 1e-6;
      const rel = (A.L+B.L)*0.5;
      const radius = rel*AVOID_RADIUS_MUL;
      if (d < radius) {
        const w = 1 - d/radius;
        const ux = dx/d, uy = dy/d;
        A.avoidX += ux*w; A.avoidY += uy*w;
        B.avoidX -= ux*w; B.avoidY -= uy*w;
      }
      const key = i + "_" + j;
      const nowOverlap = d < rel*OVERLAP_FRAC;
      const was = overlapPairs.get(key) || false;
      if (nowOverlap && !was) stats.overlapEpisodes++;
      overlapPairs.set(key, nowOverlap);
    }
  }
}

function stepActor(a, dt) {
  const st = STATES[a.state];

  a.tState -= dt;
  if (a.tState <= 0) {
    a.state = pickNextState(a.rndState, a.state);
    const ns = STATES[a.state];
    a.tState = sampleDwell(a.state, a.rndState);
    a.vTargetFrac = ns.vFrac[0] + a.rndState()*(ns.vFrac[1]-ns.vFrac[0]);
    if (a.state === "TURN") a.thetaD += (a.rndState()-0.5) * Math.PI * 1.1;
  }

  // kontinuierlicher Random Walk auf der Wunschrichtung -- nie periodisch
  a.thetaD += (a.rndWander()-0.5) * 2 * st.wander * Math.sqrt(dt);

  let sx = Math.cos(a.thetaD), sy = Math.sin(a.thetaD);
  let avMag = Math.hypot(a.avoidX, a.avoidY);
  let avX = a.avoidX, avY = a.avoidY;
  if (avMag > AVOID_MAG_CAP) { avX = avX/avMag*AVOID_MAG_CAP; avY = avY/avMag*AVOID_MAG_CAP; }
  sx += avX * AVOID_STRENGTH;
  sy += avY * AVOID_STRENGTH;

  // Randzone: die Randrichtung MISCHT die Steuerung nicht nur bei, sie
  // VERDRAENGT sie zunehmend -- sonst kann ein schneller Fisch die weiche
  // Wand durchstossen, weil seine Drehrate nicht genug Zeit hat umzuorien-
  // tieren, bevor er den harten Rand erreicht (empirisch mit diag_motion_v2
  // gefunden: additive Kraft allein liess ~1 Durchbruch/24s bei 30 Fischen).
  const fx = Math.abs(a.x)/fHalfW, fy = Math.abs(a.y)/fHalfH;
  const wx = fx > BOUNDARY_START ? clamp((fx-BOUNDARY_START)/(1-BOUNDARY_START), 0, 1)**2 : 0;
  const wy = fy > BOUNDARY_START ? clamp((fy-BOUNDARY_START)/(1-BOUNDARY_START), 0, 1)**2 : 0;
  if (wx > 0) sx = sx*(1-wx) + (-Math.sign(a.x))*BOUNDARY_MAX_W*wx;
  if (wy > 0) sy = sy*(1-wy) + (-Math.sign(a.y))*BOUNDARY_MAX_W*wy;
  const urgency = Math.max(wx, wy);

  const mag = Math.hypot(sx,sy);
  if (mag > 1e-5) a.thetaPrevTarget = Math.atan2(sy,sx);
  const thetaTarget = a.thetaPrevTarget;

  // in der Randzone eine hoehere Drehrate erlauben als der Zustand sonst
  // zulaesst (v.a. COAST mit 0.55 rad/s waere sonst eine Falle in schmalen
  // Domaenen/Ecken -- gefunden per diag_motion_v2 bei mobile-artigem Seiten-
  // verhaeltnis).
  const omegaMaxEff = Math.max(st.omegaMax, BOUNDARY_OMEGA*urgency);
  const dTheta = wrapAngle(thetaTarget - a.theta);
  const omegaDesired = clamp(st.kTurn*dTheta, -omegaMaxEff, omegaMaxEff);
  a.omega += clamp(omegaDesired-a.omega, -OMEGA_SLEW*dt, OMEGA_SLEW*dt);
  a.theta += a.omega*dt;

  // in der Randzone zusaetzlich bremsen -- kauft Drehradius/Zeit
  const vTarget = a.vTargetFrac * a.vMax * (1 - 0.85*urgency);
  const aMax = ACCEL_FRAC * a.vMax;
  a.v += clamp(vTarget-a.v, -aMax*dt, aMax*dt);
  if (a.v < a.vMin) a.v = a.vMin;

  a.x += a.v*Math.cos(a.theta)*dt;
  a.y += a.v*Math.sin(a.theta)*dt;

  // Sicherheitsnetz, sollte praktisch nie greifen: nur wenn ein Fisch die
  // Randkraft ueberwindet, wird er WEIT ausserhalb des Frustums neu gesetzt,
  // nie im sichtbaren Bild.
  const hardW = fHalfW*1.35, hardH = fHalfH*1.35;
  if (a.x > hardW) { a.x = -hardW; stats.hardResets++; }
  else if (a.x < -hardW) { a.x = hardW; stats.hardResets++; }
  if (a.y > hardH) { a.y = -hardH; stats.hardResets++; }
  else if (a.y < -hardH) { a.y = hardH; stats.hardResets++; }

  const vFrac = clamp(a.v/a.vMax, 0, 1);
  const tailHz = 0.35 + 1.65*vFrac;
  a.phase += 2*Math.PI*tailHz*dt;
  a.envTarget = 0.5 + 0.5*vFrac;
  a.bend = clamp(a.omega/st.omegaMax, -1, 1);
}

function clearActors() {
  for (const a of actors) { scene.remove(a.mesh); a.mesh.material.dispose(); }
  actors = [];
}

function setCount(n) {
  clearActors();
  overlapPairs.clear();
  const ids = Object.keys(fishTypes);
  for (let i = 0; i < n; i++) {
    spawnActor(ids[i % ids.length], i*97 + 13);
  }
  resetStats();
  document.querySelectorAll("#hud button[data-n]").forEach(b => b.classList.toggle("on", +b.dataset.n === n));
}

function setCurved(v) {
  useCurved = v;
  for (const a of actors) a.mesh.geometry = useCurved ? fishTypes[a.fid].geomCurved : fishTypes[a.fid].geomStraight;
  document.querySelector('[data-k="curved"]').classList.toggle("on", v);
}

function setOcclusion(v) {
  occlusionEnabled = v;
  document.querySelector('[data-k="occl"]').classList.toggle("on", v);
}

function tick() {
  const rawDt = clock.getDelta();
  const dt = Math.min(0.05, rawDt);
  const t = clock.getElapsedTime();
  frames++;
  if (t - lastFpsT > 0.5) { fps = Math.round(frames/(t-lastFpsT)); frames = 0; lastFpsT = t; }

  const instFps = rawDt > 0 ? 1/rawDt : fps;
  stats.fpsHistory.push(instFps);
  if (stats.fpsHistory.length > 900) stats.fpsHistory.shift();
  if (instFps < stats.minFps) stats.minFps = instFps;

  computeAvoidance();

  for (const a of actors) {
    const prevTheta = a.theta, prevX = a.x, prevY = a.y;
    stepActor(a, dt);

    const dTdeg = Math.abs(wrapAngle(a.theta - prevTheta)) * 180/Math.PI;
    if (dTdeg > stats.maxDThetaDeg) stats.maxDThetaDeg = dTdeg;
    const jumpL = Math.hypot(a.x-prevX, a.y-prevY) / a.L;
    if (jumpL > stats.maxJumpL) stats.maxJumpL = jumpL;
    stats.fishFrames++;
    if (a.v < 0.05*a.L) stats.stallFrames++;

    a.mesh.position.x = a.x; a.mesh.position.y = a.y;
    a.mesh.rotation.z = a.theta;
    if (a.uniforms) {
      a.uniforms.uPhase.value = a.phase;
      a.uniforms.uEnv.value += (a.envTarget - a.uniforms.uEnv.value) * Math.min(1, dt*6);
      a.uniforms.uBend.value = a.bend;
      a.uniforms.uOcc.value = occlusionEnabled ? a.depth : 0;
    }
  }
  stats.framesSeen++;

  renderer.render(scene, camera);
  const info = renderer.info.render;
  const stallPct = stats.fishFrames ? 100*stats.stallFrames/stats.fishFrames : 0;
  statsEl.textContent =
    `${fps} fps (min ${isFinite(stats.minFps)?Math.round(stats.minFps):"-"})  ${actors.length} fish  ${info.calls} draws  ${info.triangles} tris\n` +
    `maxTurn ${stats.maxDThetaDeg.toFixed(1)}°/f  maxJump ${stats.maxJumpL.toFixed(3)}L  stall ${stallPct.toFixed(2)}%  overlaps ${stats.overlapEpisodes}  resets ${stats.hardResets}`;
  requestAnimationFrame(tick);
}

async function main() {
  manifest = await (await fetch("./assets/manifest.json")).json();
  pondAspect = manifest.pond.w / manifest.pond.h;
  REF_MIN_DIM = 1 / pondAspect;

  const pondTex = await new Promise((res) => new THREE.TextureLoader().load("./assets/pond.jpg", t => { t.colorSpace = THREE.SRGBColorSpace; res(t); }));
  const pond = new THREE.Mesh(new THREE.PlaneGeometry(1, 1/pondAspect), new THREE.MeshBasicMaterial({ map: pondTex }));
  pond.position.z = -0.02;
  scene.add(pond);

  crownTex = await new Promise((res) => new THREE.TextureLoader().load("./assets/crown_mask.jpg", t => { t.colorSpace = THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; res(t); }));

  for (const [fid, meta] of Object.entries(manifest.fish)) {
    const tex = await new Promise((res) => new THREE.TextureLoader().load("./assets/"+meta.file, t => { t.colorSpace = THREE.SRGBColorSpace; res(t); }));
    await loadFishType(fid, meta, tex);
  }

  resize();
  setCount(30);
  tick();

  document.querySelectorAll("#hud button[data-n]").forEach(b => b.onclick = () => setCount(+b.dataset.n));
  document.querySelector('[data-k="occl"]').onclick = () => setOcclusion(!occlusionEnabled);
  document.querySelector('[data-k="curved"]').onclick = () => setCurved(!useCurved);
  document.querySelector('[data-k="reset"]').onclick = () => resetStats();
  document.querySelector('[data-k="text"]').onclick = (e) => {
    const on = e.target.classList.toggle("on");
    document.getElementById("ttl").style.display = on ? "" : "none";
    document.getElementById("sub").style.display = on ? "" : "none";
  };

  window.__koiStats = () => ({
    fps, minFps: isFinite(stats.minFps) ? Math.round(stats.minFps) : null,
    actors: actors.length,
    maxDThetaDeg: +stats.maxDThetaDeg.toFixed(2),
    maxJumpL: +stats.maxJumpL.toFixed(4),
    stallPct: +(stats.fishFrames ? 100*stats.stallFrames/stats.fishFrames : 0).toFixed(3),
    overlapEpisodes: stats.overlapEpisodes,
    hardResets: stats.hardResets,
    framesSeen: stats.framesSeen,
    elapsedSinceReset: +(clock.getElapsedTime()-stats.sinceT).toFixed(1),
    draws: renderer.info.render.calls,
    tris: renderer.info.render.triangles,
  });
  window.__koiActors = () => actors.map(a => ({
    x: +a.x.toFixed(3), y: +a.y.toFixed(3), theta: +(a.theta*180/Math.PI).toFixed(1),
    v: +a.v.toFixed(4), state: a.state, depth: +a.depth.toFixed(2),
  }));
  window.__koiResetStats = resetStats;
}

main().catch(e => { statsEl.textContent = String(e); console.error(e); });
