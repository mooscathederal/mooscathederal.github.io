// Fischi – Hintergrund der Startseite. Renderer und Schwarm aus fischi-lab/schwarm (Lauf 5) ohne Regler.
// Assets und sim.js/warp.js erzeugt fischi-lab/baue_startseite.py; diese Datei wird dabei nicht überschrieben.
import { buildGrid } from "./warp.js";
import { PARAMS, SWITCHES, Koi } from "./sim.js";

export async function startKoi(canvas, opts = {}) {
  const base = opts.base || new URL(".", import.meta.url).href;
  const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, antialias: true, powerPreference: "low-power" });
  if (!gl) throw new Error("kein WebGL 2");
  const loadImage = async (src) => { const im = new Image(); im.decoding = "async"; im.src = new URL(src, base).href; await im.decode(); return im; };
  const fishMeta = await (await fetch(new URL("fish.json", base))).json();

  const FISH = {};
  for (const [n, m] of Object.entries(fishMeta)) { if (m.view === "side") continue; const k = m.texScale || 1;
    FISH[n] = { ...m, cx: m.cx * k, cy: m.cy * k, uHead: m.uHead * k, uTail: m.uTail * k, L: m.L * k, vMin: m.vMin * k, vMax: m.vMax * k, w: Math.round(m.w * k), h: Math.round(m.h * k), name: n }; }
  const NAMES = Object.keys(FISH);
  const [bgImg, ...imgs] = await Promise.all([loadImage(opts.bg || "hintergrund.webp"), ...NAMES.map((n) => loadImage(FISH[n].file))]);
  const IMGS = {}; NAMES.forEach((n, i) => { IMGS[n] = imgs[i]; FISH[n].w = imgs[i].width; FISH[n].h = imgs[i].height; });

  const P = {}; for (const k in PARAMS) P[k] = PARAMS[k].v; Object.assign(P, opts.params || {});
  const S = {}; for (const k in SWITCHES) S[k] = SWITCHES[k].v;
  const seed = opts.seed ?? Math.floor(Math.random() * 1e6);
  const MODE = "frei";

  // ---------- Schwarm ----------
  let swarm = []; let rng = null;
  function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function makeSwarm(n) {
    rng = mulberry(seed * 7919 + 13); swarm = [];
    const order = [...NAMES].sort(() => rng() - 0.5);
    for (let i = 0; i < n; i++) { const name = order[i % order.length]; const F = FISH[name]; const ch = F.character || {};
      const g = () => Math.exp((rng() + rng() + rng() - 1.5) * 1.6);
      const k = new Koi(seed * 31 + i * 97 + 1, F);
      k.name = name; k.F = F; k.i = i;
      k.char = { size: (F.sizeFactor || 1) * Math.exp(Math.log(g()) * P.sizeSpread), tempo: (ch.tempo || 1) * Math.exp(Math.log(g()) * 0.18), hover: (ch.verweilen || 1) * Math.exp(Math.log(g()) * 0.4),
                 goal: (ch.absicht || 1) * Math.exp(Math.log(g()) * 0.3), height: 0.75 + 0.55 * rng(), quiet: F.view !== "top" ? 0.6 : 1 };
      k.placed = false; swarm.push(k); }
  }
  const fishParams = (k) => ({ ...P, vCruise: P.vCruise * k.char.tempo * k.char.quiet, hoverP: Math.min(1, P.hoverP * k.char.hover), goalHold: P.goalHold * k.char.goal,
    sJoint: k.F.sJoint || P.sJoint, headYaw: P.headYaw + (k.F.headYaw || 0), A: P.A * k.char.quiet, kappaMax: P.kappaMax * k.char.quiet });
  const desiredCount = () => Math.min(NAMES.length, Math.max(1, Math.round(P.targetVisible / 0.55)));

  // ---------- WebGL ----------
  function sh(t, s) { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; }
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, `#version 300 es
in vec2 aPos; in vec2 aTex; in float aLat; uniform vec2 uCanvas, uCenter, uOffset, uTexSize; uniform float uScale, uRot; out vec2 vTex; out float vLat;
void main(){ vec2 d=(aPos-uCenter)*uScale; float c=cos(uRot), s=sin(uRot); vec2 p=uOffset+vec2(c*d.x-s*d.y, s*d.x+c*d.y);
 vec2 n=(p/uCanvas)*2.0-1.0; n.y=-n.y; gl_Position=vec4(n,0.,1.); vTex=aTex/uTexSize; vLat=aLat; }`));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, `#version 300 es
precision highp float; in vec2 vTex; in float vLat; uniform sampler2D uTex, uBg; uniform int uMode; uniform vec4 uColor; uniform vec4 uBgRect; uniform vec2 uCanvas; uniform float uShMod, uVol, uContrast, uBright; out vec4 o;
void main(){
  vec4 c=texture(uTex,vTex);
  if(uMode==3){
    vec2 uv=vec2((gl_FragCoord.x-uBgRect.x)/uBgRect.z, (uCanvas.y-gl_FragCoord.y-uBgRect.y)/uBgRect.w);
    float lum=dot(texture(uBg,uv).rgb, vec3(0.3,0.59,0.11));
    float f=mix(1.0, clamp(pow(lum,0.6)*1.8,0.0,1.4), uShMod);
    o=vec4(0.,0.,0.,c.a*uColor.a*f); return; }
  if(uMode==4){ vec3 r=(c.rgb-0.5)*uContrast+0.5+uBright; o=vec4(clamp(r,0.0,1.0),1.0); return; }
  if(uMode==5){ float d=1.0-uVol*pow(abs(vLat),1.6); o=vec4(c.rgb*d,c.a); return; }
  o=c; }`));
  gl.linkProgram(prog); gl.useProgram(prog);
  const UL = {}; const U = (n) => (n in UL ? UL[n] : (UL[n] = gl.getUniformLocation(prog, n)));
  const aPos = gl.getAttribLocation(prog, "aPos"), aTex = gl.getAttribLocation(prog, "aTex"), aLat = gl.getAttribLocation(prog, "aLat");
  function makeTex(im, premul) { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premul); gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im); gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const ext = gl.getExtension("EXT_texture_filter_anisotropic"); if (ext) gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT))); return t; }
  const TEX = {}; for (const n of NAMES) TEX[n] = makeTex(IMGS[n], true); const bgTex = makeTex(bgImg, false);
  const bufPos = gl.createBuffer(), bufTex = gl.createBuffer(), bufIdx = gl.createBuffer(), bufLat = gl.createBuffer();
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, bufPos); gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, bufTex); gl.enableVertexAttribArray(aTex); gl.vertexAttribPointer(aTex, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, bufLat); gl.enableVertexAttribArray(aLat); gl.vertexAttribPointer(aLat, 1, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufIdx);
  const NS = 96, NV = 24;
  let latBuf = null; const bgRect = [0, 0, 1, 1];
  const e1Angle = (F) => Math.atan2(F.e1y, F.e1x);
  function setCommon(W, H, cx, cy, ox, oy, scale, rot, texSize) {
    gl.uniform2f(U("uCanvas"), W, H); gl.uniform2f(U("uCenter"), cx, cy); gl.uniform2f(U("uOffset"), ox, oy);
    gl.uniform1f(U("uScale"), scale); gl.uniform1f(U("uRot"), rot); gl.uniform2f(U("uTexSize"), texSize[0], texSize[1]);
  }
  function upload(pos, tex, idx, lat) {
    const n = pos.length / 2; if (!lat) lat = new Float32Array(n);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufLat); gl.bufferData(gl.ARRAY_BUFFER, lat, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufPos); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufTex); gl.bufferData(gl.ARRAY_BUFFER, tex, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufIdx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.DYNAMIC_DRAW);
  }
  function drawFish(F, pose, W, H, ox, oy, scale, rot, shadow, heightF) {
    const pad = 0.03 * F.L;
    const g = buildGrid(F, pose, NS, NV, -0.02, 1.02, F.vMin - pad, F.vMax + pad);
    if (!latBuf) { latBuf = new Float32Array((NS + 1) * (NV + 1)); let k = 0; for (let i = 0; i <= NS; i++) for (let j = 0; j <= NV; j++) latBuf[k++] = (j / NV) * 2 - 1; }
    upload(g.pos, g.tex, g.idx, latBuf);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, TEX[F.name]); gl.uniform1i(U("uTex"), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, bgTex); gl.uniform1i(U("uBg"), 1); gl.activeTexture(gl.TEXTURE0);
    gl.uniform4f(U("uBgRect"), bgRect[0], bgRect[1], bgRect[2], bgRect[3]); gl.uniform1f(U("uShMod"), P.shMod); gl.uniform1f(U("uVol"), P.vol);
    if (shadow) {
      const Lpx = F.L * scale, n = 13, hF = P.shHeight * (heightF || 1), hx = Math.cos(P.shAngle * Math.PI / 180) * hF * Lpx, hy = Math.sin(P.shAngle * Math.PI / 180) * hF * Lpx;
      const rad = P.shSoft * Lpx * (0.5 + P.shHeight);
      gl.uniform1i(U("uMode"), 3); gl.uniform4f(U("uColor"), 0, 0, 0, P.shDark / n);
      for (let i = 0; i < n; i++) { const a = (i % 6) / 6 * 2 * Math.PI + (i > 6 ? 0.5 : 0), rr = i === 0 ? 0 : (i <= 6 ? rad : rad * 0.5);
        setCommon(W, H, F.cx, F.cy, ox + hx + Math.cos(a) * rr, oy + hy + Math.sin(a) * rr, scale, rot, [F.w, F.h]);
        gl.drawElements(gl.TRIANGLES, g.idx.length, gl.UNSIGNED_INT, 0); }
      return;
    }
    setCommon(W, H, F.cx, F.cy, ox, oy, scale, rot, [F.w, F.h]);
    gl.uniform1i(U("uMode"), S.V ? 5 : 0);
    gl.drawElements(gl.TRIANGLES, g.idx.length, gl.UNSIGNED_INT, 0);
  }
  function drawBackground(W, H) {
    const s = Math.max(W / bgImg.width, H / bgImg.height), w = bgImg.width * s, h = bgImg.height * s, x0 = (W - w) / 2, y0 = (H - h) / 2;
    bgRect[0] = x0; bgRect[1] = y0; bgRect[2] = w; bgRect[3] = h;
    upload(new Float32Array([x0, y0, x0 + w, y0, x0, y0 + h, x0 + w, y0 + h]), new Float32Array([0, 0, bgImg.width, 0, 0, bgImg.height, bgImg.width, bgImg.height]), new Uint32Array([0, 1, 2, 2, 1, 3]));
    setCommon(W, H, 0, 0, 0, 0, 1, 0, [bgImg.width, bgImg.height]);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, bgTex); gl.uniform1i(U("uTex"), 0); gl.uniform1i(U("uMode"), 4);
    gl.uniform1f(U("uContrast"), P.bgContrast); gl.uniform1f(U("uBright"), P.bgBright);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_INT, 0);
  }

  // ---------- Simulation & Bild ----------
  const baseLengthPx = (Wcss, Hcss) => P.sizePct / 100 * Math.hypot(Wcss, Hcss);
  function stepSim(dt, Wcss, Hcss) {
    const want = desiredCount(); if (swarm.length !== want) makeSwarm(want);
    const Lb = baseLengthPx(Wcss, Hcss);
    let visible = 0;
    for (const k of swarm) { k.Lpx = Lb * k.char.size * Math.pow(k.char.height, 0.35); k.bounds = { w: Wcss / k.Lpx, h: Hcss / k.Lpx };
      if (!k.placed) { k.x = k.bounds.w * (0.1 + 0.8 * rng()); k.y = k.bounds.h * (0.1 + 0.8 * rng()); k.heading = rng() * 6.28; k.targetHeading = k.heading; k.placed = true; k.goalUntil = 0;
        if (k.i >= P.targetVisible) { k.away = true; k.awayUntil = 0.5 + 7 * rng(); } }   // Start: nur die Zielzahl im Bild, der Rest tritt gestaffelt ein
      if (!k.away && k.x > 0 && k.x < k.bounds.w && k.y > 0 && k.y < k.bounds.h) visible++; }
    if (!(dt > 0)) return;   // Standbild: nicht simulieren (Schritt 0 ergibt in sim.js NaN)
    for (const k of swarm) {
      const Pk = fishParams(k);
      if (k.away && visible < P.targetVisible) k.awayUntil = Math.min(k.awayUntil, k.t + 0.4);
      if (k.away && visible > P.targetVisible + 1) k.awayUntil = Math.max(k.awayUntil, k.t + 1.5);
      k.step(dt, Pk, S, k.bounds, MODE);
      k.trail.length = 0;
    }
    const n = swarm.length;
    for (let a = 0; a < n; a++) { const ka = swarm[a]; if (ka.away) continue;
      let px = 0, py = 0, cnt = 0, nb = null, nbD = 1e9;
      for (let b = 0; b < n; b++) { if (a === b) continue; const kb = swarm[b]; if (kb.away) continue;
        const dx = (kb.x * kb.Lpx - ka.x * ka.Lpx) / ka.Lpx, dy = (kb.y * kb.Lpx - ka.y * ka.Lpx) / ka.Lpx, d = Math.hypot(dx, dy);
        if (d < P.sepDist && d > 1e-3) { px -= dx / d * (P.sepDist - d); py -= dy / d * (P.sepDist - d); cnt++; }
        if (d < nbD && d < 3) { nbD = d; nb = kb; } }
      if (cnt) { const away = Math.atan2(py, px); const e = ((away - ka.targetHeading + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
        ka.targetHeading += e * Math.min(1, dt * 2.5 * Math.min(2, Math.hypot(px, py))); }
      if (nb && S.I && ka.t >= ka.goalUntil - dt && rng() < P.followP) { ka.targetHeading = nb.heading + (rng() - 0.5) * 0.4; ka.goalUntil = ka.t + P.goalHold * (0.5 + rng()); }
    }
  }
  const maxDpr = opts.maxDpr || 2;
  function render(dt) {
    const dpr = Math.min(maxDpr, window.devicePixelRatio || 1), Wcss = canvas.clientWidth, Hcss = canvas.clientHeight;
    const W = Math.round(Wcss * dpr), H = Math.round(Hcss * dpr);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    stepSim(dt, Wcss, Hcss);
    gl.viewport(0, 0, W, H); gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    drawBackground(W, H);
    const order = swarm.filter((k) => !k.away).sort((a, b) => a.char.height - b.char.height);
    const rotOf = (k, Pk) => k.heading - e1Angle(k.F) + (S.C ? Pk.headYaw * Math.PI / 180 : 0);
    if (S.D) for (const k of order) { const Pk = fishParams(k); drawFish(k.F, k.pose(Pk, S, MODE), W, H, k.x * k.Lpx * dpr, k.y * k.Lpx * dpr, k.Lpx * dpr / k.F.L, rotOf(k, Pk), true, k.char.height); }
    for (const k of order) { const Pk = fishParams(k); drawFish(k.F, k.pose(Pk, S, MODE), W, H, k.x * k.Lpx * dpr, k.y * k.Lpx * dpr, k.Lpx * dpr / k.F.L, rotOf(k, Pk), false, k.char.height); }
  }

  // ---------- Ablauf ----------
  const info = { frames: 0, fish: 0, seed, running: false, lost: false };
  let lastT = null, raf = 0;
  const motion = opts.reducedMotion || matchMedia("(prefers-reduced-motion: reduce)");
  const shouldRun = () => !document.hidden && !motion.matches && !info.lost;
  function frame(now) {
    raf = 0; if (!shouldRun()) { info.running = false; lastT = null; return; }
    const t = now / 1000, dt = lastT === null ? 1 / 60 : Math.min(0.05, t - lastT); lastT = t;
    render(dt); info.frames++; info.fish = swarm.length; raf = requestAnimationFrame(frame);
  }
  function update() {
    if (shouldRun()) { if (!raf) { info.running = true; raf = requestAnimationFrame(frame); } }
    else if (!document.hidden && !info.lost) { render(0); info.frames++; }   // Standbild bei reduzierter Bewegung; verborgener Tab: nichts tun
  }
  document.addEventListener("visibilitychange", update);
  motion.addEventListener?.("change", update);
  window.addEventListener("resize", () => { if (!shouldRun() && !document.hidden && !info.lost) { render(0); } });
  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); info.lost = true; opts.onLost?.(); });
  render(1 / 60); info.frames++; info.fish = swarm.length;
  update();
  return info;
}
