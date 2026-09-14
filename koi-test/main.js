import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js";

const GX = 40, GY = 12;              // Grid-Aufloesung des prozeduralen Meshs
const A_MAX = (14 * Math.PI) / 180;  // max. Biegewinkel
const N_WAVES = 0.55;

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

let manifest, pondAspect;
let fishTypes = {};   // id -> { geomCurved, geomStraight, mat, w, h }
let actors = [];
let useCurved = true, useOcclusion = true;
let occlMesh = null;
let clock = new THREE.Clock();
let frames = 0, lastFpsT = 0, fps = 0;

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
}
window.addEventListener("resize", resize);

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
  // lokale Spine-Koordinaten (gleicher Raum wie Vertex-Positionen)
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

function waveChunk(shader) {
  shader.uniforms.uPhase = { value: 0 };
  shader.uniforms.uEnv = { value: 0 };
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>
attribute float aU;
attribute vec2 aSpine;
uniform float uPhase;
uniform float uEnv;`)
    .replace("#include <begin_vertex>", `#include <begin_vertex>
{
  float amp = uEnv * ${A_MAX.toFixed(5)} * aU * aU;
  float ang = amp * sin(uPhase - ${(2*Math.PI*N_WAVES).toFixed(5)} * aU);
  float c = cos(ang), s = sin(ang);
  vec2 d = transformed.xy - aSpine;
  transformed.xy = aSpine + vec2(c*d.x - s*d.y, s*d.x + c*d.y);
}`);
}

async function loadFishType(fid, meta, tex) {
  const geomCurved = buildGeometry(meta, "curved");
  const geomStraight = buildGeometry(meta, "straight");
  fishTypes[fid] = { geomCurved, geomStraight, tex, w: meta.w, h: meta.h };
}

function spawnActor(fid, seed) {
  const t = fishTypes[fid];
  const mat = new THREE.MeshPhongMaterial({ map: t.tex, transparent: true, alphaTest: 0.12, side: THREE.DoubleSide, shininess: 16 });
  const progKey = "koi-wave-" + fid + "-" + seed;
  mat.customProgramCacheKey = () => progKey;
  const mesh = new THREE.Mesh(useCurved ? t.geomCurved : t.geomStraight, mat);
  const rnd = mulberry32(seed);
  const L = 0.075 + rnd()*0.06;      // Laenge relativ zur Bildbreite (=1)
  mesh.scale.set(L, L, 1);
  const rec = {
    fid, mesh, uniforms: null, L,
    cx: (rnd()-0.5)*0.95, cy: (rnd()-0.5)*0.95*1/pondAspect,
    ax: 0.10+rnd()*0.22, ay: 0.08+rnd()*0.18,
    fx: 0.05+rnd()*0.08, fy: 0.04+rnd()*0.07,
    ph: rnd()*Math.PI*2, ph2: rnd()*Math.PI*2,
    driftX: (rnd()-0.5)*0.035, driftY: (rnd()-0.5)*0.02,
    freqHz: 0.5+rnd()*0.45, phase: rnd()*Math.PI*2,
    driftPhase: rnd()*1000,
  };
  mat.onBeforeCompile = (sh) => { waveChunk(sh); rec.uniforms = sh.uniforms; };
  scene.add(mesh);
  actors.push(rec);
}

function mulberry32(a) {
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function wrap(v, half) {
  const span = half*2;
  let x = (v + half) % span;
  if (x < 0) x += span;
  return x - half;
}

function clearActors() {
  for (const a of actors) { scene.remove(a.mesh); a.mesh.material.dispose(); }
  actors = [];
}

function setCount(n) {
  clearActors();
  const ids = Object.keys(fishTypes);
  for (let i = 0; i < n; i++) {
    spawnActor(ids[i % ids.length], i*97 + 13);
  }
  document.querySelectorAll("#hud button[data-n]").forEach(b => b.classList.toggle("on", +b.dataset.n === n));
}

function setCurved(v) {
  useCurved = v;
  for (const a of actors) a.mesh.geometry = useCurved ? fishTypes[a.fid].geomCurved : fishTypes[a.fid].geomStraight;
  document.querySelector('[data-k="curved"]').classList.toggle("on", v);
}

function setOcclusion(v) {
  useOcclusion = v;
  if (occlMesh) occlMesh.visible = v;
  document.querySelector('[data-k="occl"]').classList.toggle("on", v);
}

function tick() {
  const t = clock.getElapsedTime();
  const dt = Math.min(0.05, clock.getDelta());
  frames++;
  if (t - lastFpsT > 0.5) { fps = Math.round(frames/(t-lastFpsT)); frames = 0; lastFpsT = t; }

  const halfW = 0.6, halfH = 0.6/pondAspect;
  for (const a of actors) {
    const dcx = a.cx + a.driftX*t, dcy = a.cy + a.driftY*t;
    const x = wrap(dcx, halfW) + Math.sin(t*a.fx*Math.PI*2 + a.ph) * a.ax;
    const y = wrap(dcy, halfH) + Math.sin(t*a.fy*Math.PI*2 + a.ph2) * a.ay;
    const dx = Math.cos(t*a.fx*Math.PI*2 + a.ph) * a.ax * a.fx*Math.PI*2 + a.driftX;
    const dy = Math.cos(t*a.fy*Math.PI*2 + a.ph2) * a.ay * a.fy*Math.PI*2 + a.driftY;
    const heading = Math.atan2(dy, dx);
    const speed = Math.min(1, Math.hypot(dx,dy) / 0.25);
    a.mesh.position.set(x, y, 0);
    a.mesh.rotation.z = heading;
    a.phase += 2*Math.PI*a.freqHz*dt*(0.4+0.8*speed);
    if (a.uniforms) { a.uniforms.uPhase.value = a.phase; a.uniforms.uEnv.value = 0.45+0.55*speed; }
  }
  renderer.render(scene, camera);
  const info = renderer.info.render;
  statsEl.textContent = `${fps} fps  ${actors.length} fish  ${info.calls} draws  ${info.triangles} tris`;
  requestAnimationFrame(tick);
}

async function main() {
  manifest = await (await fetch("./assets/manifest.json")).json();
  pondAspect = manifest.pond.w / manifest.pond.h;

  const pondTex = await new Promise((res) => new THREE.TextureLoader().load("./assets/pond.jpg", t => { t.colorSpace = THREE.SRGBColorSpace; res(t); }));
  const pond = new THREE.Mesh(new THREE.PlaneGeometry(1, 1/pondAspect), new THREE.MeshBasicMaterial({ map: pondTex }));
  pond.position.z = -0.02;
  scene.add(pond);

  for (const [fid, meta] of Object.entries(manifest.fish)) {
    const tex = await new Promise((res) => new THREE.TextureLoader().load("./assets/"+meta.file, t => { t.colorSpace = THREE.SRGBColorSpace; res(t); }));
    await loadFishType(fid, meta, tex);
  }

  const fgTex = await new Promise((res) => new THREE.TextureLoader().load("./assets/foreground.png", t => { t.colorSpace = THREE.SRGBColorSpace; res(t); }));
  occlMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1/pondAspect), new THREE.MeshBasicMaterial({ map: fgTex, transparent: true, depthTest: false, depthWrite: false }));
  occlMesh.position.z = 0.02;
  occlMesh.renderOrder = 10;
  scene.add(occlMesh);

  resize();
  setCount(30);
  tick();

  document.querySelectorAll("#hud button[data-n]").forEach(b => b.onclick = () => setCount(+b.dataset.n));
  document.querySelector('[data-k="occl"]').onclick = () => setOcclusion(!useOcclusion);
  document.querySelector('[data-k="curved"]').onclick = () => setCurved(!useCurved);
  document.querySelector('[data-k="text"]').onclick = (e) => {
    const on = e.target.classList.toggle("on");
    document.getElementById("ttl").style.display = on ? "" : "none";
    document.getElementById("sub").style.display = on ? "" : "none";
  };
}

main().catch(e => { statsEl.textContent = String(e); console.error(e); });
