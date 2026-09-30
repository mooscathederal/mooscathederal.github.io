// Welt – Wald und Fische in einer Leinwand, mit einer Uhr und einem Licht (Entwurf 30.09.2026, Werkstatt).
// Ersetzt das Nebeneinander von wald.js (Wald-Shader) und koi.js (Fisch-Leinwand).
//
// Stufen (umschaltbar über ?stufe=… in der Vorschau):
//   a  ein Raum:  eine Leinwand, eine Zeitschleife, leichtere Datenbilder; Schatten wie bisher (flach, fester Versatz)
//   b  ein Licht: Fischschatten fallen auf das Relief der Kronen (Höhe aus d2), werden in Lücken länger und
//                 springen an Kronenrändern; Wolkenschatten ziehen auch über die Fische; Fische im Farbton des Waldes
//   c  Zeit:      Böen aus einem langsamen nichtlinearen Taktgeber (Lorenz-System) statt gleichmäßigem Rauschen;
//                 selten sinkt ein Fisch tief über den Wald und steigt wieder; leichte Tageslicht-Tönung nach Ortszeit
// Der Wald-Teil ist aus wald.js übernommen (Werte vom 28.09.), der Fisch-Teil aus koi.js (Lauf 5).
import { buildGrid } from "./warp.js";
import { PARAMS, SWITCHES, Koi } from "./sim.js";

export async function startWelt(canvas, opts = {}) {
  const base = opts.base || new URL(".", import.meta.url).href;
  const stufe = opts.stufe || "c";
  const B = stufe === "b" || stufe === "c", C = stufe === "c";
  const leise = !!opts.leise;                       // Unterseiten: halbe Auflösung, 30 Bilder/s
  const q = new URLSearchParams(location.search);

  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, premultipliedAlpha: true, powerPreference: "default" });
  if (!gl) throw new Error("kein WebGL 2");

  // ---------------- Wald: Werte ----------------
  const IMG = { farbe: "farbe.webp", d1: "d1_klein.png", d2: "d2.webp" };
  const W0 = 2560, H0 = 1440;
  const MAP = { a: 0.5337, b: 0.02491, c: -0.07249, d: 0.42537, e: 0.40049, f: 0.51707 };
  const HB = [0.50, 0.90];
  const P = {
    dir: 94, lean: 3, sway: 1.8, swayFreq: 1, cross: 0.4, couple: 1.4,
    gustScale: 2.2, gustSpeed: 0.045, gustContrast: 0.8,
    sheenGras: 0.15, sheenKrone: 0.08,
    cloudCov: 0.4, cloudScale: 1.3, cloudSpeed: 0.01, cloudDark: 0.78, cloudSoft: 0.22, cloudPar: 0.012,
    exposure: 1, sat: 1.15, contrast: 1.15, warm: 0.1, lift: 0,
    waldSat: 1.22, waldCon: 1.1, waldTief: 0.06,   // nur der Wald: kräftiger und etwas tiefer, damit er neben den Fischen nicht blass wirkt
    fps: leise ? 30 : 60,
    // Schatten der Fische auf dem Relief
    kronenHub: B ? 0.3 : 0,     // wie stark die Kronenhöhe den Schattenversatz verkürzt (0 = flach wie bisher)
    schattenDunkel: 0.6,
    rand: 0.25,                 // Schattentextur reicht so weit über den Bildschirm hinaus (Anteil je Seite)
  };
  Object.assign(P, opts.params || {});
  for (const k in P) if (q.has("p_" + k)) P[k] = parseFloat(q.get("p_" + k));   // Prüfhilfe: ?p_kronenHub=0 usw.

  // ---------------- Shader ----------------
  const VS = `#version 300 es
in vec2 p; out vec2 vUv; void main(){ vUv = p*.5+.5; gl_Position = vec4(p,0,1); }`;
  const NOISE = `
float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float a=.5, s=0.; for(int k=0;k<5;k++){ s+=a*vn(p); p=p*2.03+vec2(17.1,9.2); a*=.5; } return s/.97; }`;
  const GRADE = `
uniform float uExp, uSat, uCon, uWarm, uLift;
vec3 grade(vec3 c){
  c *= uExp; c = c*(1.-uLift) + uLift;
  float l = dot(c, vec3(.2126,.7152,.0722)); c = mix(vec3(l), c, uSat);
  c = (c-.5)*uCon + .5;
  c *= vec3(1.+.07*uWarm, 1.+.01*uWarm, 1.-.10*uWarm);
  return clamp(c, 0., 1.);
}`;

  const FS_FIELD = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform float uT, uAsp, uGustScale, uGustSpeed, uGustC, uCloudScale, uCloudSpeed; uniform vec2 uDir;
${NOISE}
void main(){
  vec2 q = vUv*vec2(uAsp,1.);
  float g  = fbm(q*uGustScale - uDir*uT*uGustSpeed*uGustScale);
  float gg = fbm(q*uGustScale*2.3 + 31.7 - uDir*uT*uGustSpeed*uGustScale*2.6);
  float lo = mix(.2,.45,uGustC), hi = mix(.95,.7,uGustC);
  float c  = fbm(q*uCloudScale + 71.3 - uDir*uT*uCloudSpeed*uCloudScale*4.);
  o = vec4(smoothstep(lo,hi,g), smoothstep(lo,hi,gg), c, 1.);
}`;

  // uGustAmp: Hüllkurve der Böen (Stufe c: aus dem Lorenz-Taktgeber, sonst 1)
  const FS_MOTION = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uD1, uF; uniform mat2 uInv; uniform vec2 uOff, uDir;
uniform float uT, uLean, uSway, uSwayFreq, uCross, uGustAmp;
void main(){
  vec3 d1 = texture(uD1, vUv).rgb; float rnd = d1.b;
  vec2 piv = clamp(uInv*(d1.rg - uOff), 0., 1.);
  float g = texture(uF, piv).r * uGustAmp;
  float ph = rnd*6.2831, w = uT*uSwayFreq*6.2831;
  float sw = sin(w*(.75+.5*rnd) + ph) * (.35+.9*g);
  float sx = sin(w*(.55+.4*fract(rnd*7.3)) + ph*1.7) * (.3+.6*g);
  vec2 perp = vec2(-uDir.y, uDir.x);
  vec2 m = uDir*(g*uLean + sw*uSway) + perp*sx*uSway*uCross;
  o = vec4(.5 + m/32., 0., 1.);
}`;

  const FS_BLUR = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uM; uniform vec2 uStep;
void main(){
  float w[5] = float[](.227027,.1945946,.1216216,.054054,.016216);
  vec4 s = texture(uM, vUv)*w[0];
  for (int i=1;i<5;i++){ s += texture(uM, vUv+uStep*float(i))*w[i]; s += texture(uM, vUv-uStep*float(i))*w[i]; }
  o = s;
}`;

  // Hauptdurchgang: Wald + Fischschatten auf dem Relief.
  // Schattenwerfer-Textur uS (Bildschirmraum, halbe Auflösung, weichgezeichnet): r = Deckung, g = Höhe·Deckung.
  // Ein Bodenpunkt p liegt im Schatten, wenn am Ort p − v·(Höhe_Fisch − k·Höhe_Krone(p)) ein Fisch ist.
  const FS_MAIN = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uCol, uD2, uF, uM, uS;
uniform vec2 uScale, uImg, uSun, uHB, uShV; uniform float uRand, uWaldSat, uWaldCon, uWaldTief;
uniform float uSheenG, uSheenK, uCloudCov, uCloudDark, uCloudSoft, uCloudPar, uKH, uShDark, uShOn, uDebug;
${GRADE}
vec3 cr(vec2 uv){
  vec2 sp = uv*uImg, t1 = floor(sp-.5)+.5, f = sp-t1;
  vec2 w0 = f*(-.5+f*(1.-.5*f)), w1 = 1.+f*f*(-2.5+1.5*f), w2 = f*(.5+f*(2.-1.5*f)), w3 = f*f*(-.5+.5*f);
  vec2 w12 = w1+w2, t12 = (t1 + w2/w12)/uImg, t0 = (t1-1.)/uImg, t3 = (t1+2.)/uImg;
  vec3 r = vec3(0);
  r += texture(uCol, vec2(t0.x ,t0.y )).rgb*w0.x *w0.y;  r += texture(uCol, vec2(t12.x,t0.y )).rgb*w12.x*w0.y;  r += texture(uCol, vec2(t3.x ,t0.y )).rgb*w3.x *w0.y;
  r += texture(uCol, vec2(t0.x ,t12.y)).rgb*w0.x *w12.y; r += texture(uCol, vec2(t12.x,t12.y)).rgb*w12.x*w12.y; r += texture(uCol, vec2(t3.x ,t12.y)).rgb*w3.x *w12.y;
  r += texture(uCol, vec2(t0.x ,t3.y )).rgb*w0.x *w3.y;  r += texture(uCol, vec2(t12.x,t3.y )).rgb*w12.x*w3.y;  r += texture(uCol, vec2(t3.x ,t3.y )).rgb*w3.x *w3.y;
  return max(r, 0.);
}
vec2 offs(vec2 uv){
  vec2 d2 = texture(uD2, uv).rg;
  float bush = smoothstep(.2,.8,d2.g);
  float hb = clamp((d2.r-uHB.x)/(uHB.y-uHB.x), 0., 1.); hb = hb*hb*(3.-2.*hb);
  vec2 m = (texture(uM, uv).rg - .5)*32.;
  return m * bush * (.25+.75*hb) / uImg;
}
vec4 werfer(vec2 s){ return texture(uS, (s + uRand)/(1. + 2.*uRand)); }   // Bildschirm-uv -> Schattentextur mit Rand
float schatten(vec2 s, float h){
  // Welcher Fisch wirft hierher Schatten? Der Strahl wird an sieben Höhen abgetastet; gilt nur, wo die in der
  // Schattentextur gespeicherte Fischhöhe zur getesteten Höhe passt. Danach ein genauer Blick an der gefundenen Höhe.
  // (Vorher wurde Höhe 1 geraten: Fische deutlich darüber oder darunter wurden nur halb getroffen -> harte Kanten.)
  float best = 0., bestAlt = 1.;
  for (int i = 0; i < 7; i++) {
    float c = .22 + float(i)*.19;
    vec4 a = werfer(s - uShV*max(c - uKH*(h - .15), .05));
    float alt = 2.*a.g/max(a.r, 1e-3);
    float w = a.r * exp(-pow((alt - c)/.16, 2.));
    if (w > best) { best = w; bestAlt = alt; }
  }
  float rel = max(bestAlt - uKH*(h - .15), .05);
  vec2 q = s - uShV*rel, r = uShV*.03*rel;
  float c = werfer(q).r*.4 + (werfer(q+r).r + werfer(q-r).r + werfer(q+vec2(r.y,-r.x)).r + werfer(q-vec2(r.y,-r.x)).r)*.15;
  return clamp(c, 0., 1.) * smoothstep(0., .02, best);
}
void main(){
  vec2 uv = (vUv-.5)*uScale+.5;
  vec4 f = texture(uF, uv);
  vec2 d2 = texture(uD2, uv).rg; float bush = smoothstep(.2,.8,d2.g);
  vec2 o1 = offs(uv), o2 = offs(uv-o1), o3 = offs(uv-o2);
  float hWeich = textureLod(uD2, uv-o3, 4.).r;   // weiche Höhe am bewegten Ort: der Schatten folgt der Krone, ohne an Kanten zu kleben
  vec3 c = cr(uv-o3);
  float gg = f.g - .45;
  c *= 1. + uSheenG*gg*2.*(1.-bush);
  c = mix(c, c*vec3(1.05,1.05,.9), clamp(uSheenG*f.g*2.,0.,1.)*(1.-bush));
  c *= 1. + uSheenK*f.r*bush;
  float shd = uShOn > .5 ? schatten(vUv, hWeich) : 0.;
  if (uDebug > 2.5) { vec4 w = werfer(vUv); o = vec4(w.r, w.r > .02 ? w.g/w.r : 0., hWeich, 1.); return; }
  if (uDebug > .5) { o = vec4(vec3(1.-shd)*(uDebug > 1.5 ? hWeich : 1.), 1.); return; }
  c *= 1. - uShDark*shd;
  float cl = texture(uF, uv + uSun*uCloudPar*d2.r).b;
  cl = smoothstep(1.-uCloudCov-uCloudSoft, 1.-uCloudCov+uCloudSoft, cl);
  c *= mix(vec3(1.), vec3(uCloudDark)*vec3(.94,.98,1.07), cl);
  c = grade(c);
  float l = dot(c, vec3(.2126,.7152,.0722));
  c = mix(vec3(l), c, uWaldSat);
  c = (c-.5)*uWaldCon + .5;
  c = pow(clamp(c,0.,1.), vec3(1. + uWaldTief));
  o = vec4(clamp(c,0.,1.), 1.);
}`;

  // Fische: ein Vertex-Shader, zwei Aufgaben (Schattenwerfer in die Schattentextur, Farbe auf den Bildschirm)
  const VS_FISH = `#version 300 es
in vec2 aPos; in vec2 aTex; in float aLat; uniform vec2 uCanvas, uCenter, uOffset, uTexSize; uniform float uScale, uRot; out vec2 vTex; out float vLat;
void main(){ vec2 d=(aPos-uCenter)*uScale; float c=cos(uRot), s=sin(uRot); vec2 p=uOffset+vec2(c*d.x-s*d.y, s*d.x+c*d.y);
 vec2 n=(p/uCanvas)*2.0-1.0; n.y=-n.y; gl_Position=vec4(n,0.,1.); vTex=aTex/uTexSize; vLat=aLat; }`;
  const FS_FISH = `#version 300 es
precision highp float; in vec2 vTex; in float vLat; out vec4 o;
uniform sampler2D uTex, uF; uniform int uMode; uniform float uAlt, uVol, uWaldton, uCloudCov, uCloudDark, uCloudSoft, uCloudPar;
uniform vec2 uView, uCover, uSun; uniform vec3 uTint;
${GRADE}
void main(){
  vec4 c = texture(uTex, vTex);
  if (uMode == 1) { o = vec4(c.a, c.a*uAlt*.5, 0., c.a); return; }          // Schattenwerfer: Deckung, Höhe (0..2 → 0..1)
  vec3 rgb = c.a > .001 ? c.rgb/c.a : vec3(0);
  rgb *= 1.0 - uVol*pow(abs(vLat), 1.6);                                   // Volumen zum Rand hin
  if (uWaldton > .5) {
    rgb = grade(rgb*uTint);                                               // derselbe Farbton wie der Wald
    vec2 uv = (gl_FragCoord.xy/uView - .5)*uCover + .5;
    float cl = texture(uF, uv + uSun*uCloudPar*(1.+uAlt*.6)).b;           // Wolken liegen über den Fischen
    cl = smoothstep(1.-uCloudCov-uCloudSoft, 1.-uCloudCov+uCloudSoft, cl);
    rgb *= mix(vec3(1.), vec3(uCloudDark)*vec3(.94,.98,1.07), cl*.85);
  } else rgb *= uTint;
  o = vec4(rgb*c.a, c.a);
}`;

  function sh(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(s); console.error(log); throw new Error(log); } return s; }
  function prog(vs, fs, attrs) { const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    attrs.forEach((a, i) => gl.bindAttribLocation(p, i, a)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name.replace("[0]", "")] = gl.getUniformLocation(p, a.name); } return { p, u }; }
  const PF = prog(VS, FS_FIELD, ["p"]), PMO = prog(VS, FS_MOTION, ["p"]), PB = prog(VS, FS_BLUR, ["p"]), PM = prog(VS, FS_MAIN, ["p"]);
  const PK = prog(VS_FISH, FS_FISH, ["aPos", "aTex", "aLat"]);

  // Vollbild-Dreieck (Attribut 0) in eigenem VAO; Fische in eigenem VAO
  const vaoQuad = gl.createVertexArray(); gl.bindVertexArray(vaoQuad);
  const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  function texImg(img, { flip = true, premul = false, mip = false } = {}) {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flip); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premul);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    if (mip) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      const ext = gl.getExtension("EXT_texture_filter_anisotropic"); if (ext) gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT))); }
    else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    return t; }
  function target(w, h) { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { t, f, w, h }; }
  function resizeTarget(tg, w, h) { if (tg.w === w && tg.h === h) return; gl.bindTexture(gl.TEXTURE_2D, tg.t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); tg.w = w; tg.h = h; }
  const FIELD = target(256, 144), MOT = target(640, 360), MOT2 = target(640, 360);
  const SCH = target(4, 4), SCH2 = target(4, 4);    // Schattenwerfer, Größe folgt der Leinwand

  const det = MAP.a * MAP.d - MAP.b * MAP.c;
  const INV = [MAP.d / det, -MAP.c / det, -MAP.b / det, MAP.a / det];

  // ---------------- Laden ----------------
  const load = (src) => new Promise((res, rej) => { const i = new Image(); i.decoding = "async"; i.onload = () => res(i); i.onerror = rej; i.src = new URL(src, base).href; });
  const fishMeta = await (await fetch(new URL("fish.json", base))).json();
  const FISH = {};
  for (const [n, m] of Object.entries(fishMeta)) { if (m.view === "side") continue; const k = m.texScale || 1;
    FISH[n] = { ...m, cx: m.cx * k, cy: m.cy * k, uHead: m.uHead * k, uTail: m.uTail * k, L: m.L * k, vMin: m.vMin * k, vMax: m.vMax * k, w: Math.round(m.w * k), h: Math.round(m.h * k), name: n }; }
  const NAMES = Object.keys(FISH);
  const [iF, i1, i2, ...imgs] = await Promise.all([load(IMG.farbe), load(IMG.d1), load(IMG.d2), ...NAMES.map((n) => load(FISH[n].file))]);
  const T = { col: texImg(iF), d1: texImg(i1), d2: texImg(i2, { mip: true }) };
  const TEX = {}; NAMES.forEach((n, i) => { FISH[n].w = imgs[i].width; FISH[n].h = imgs[i].height; TEX[n] = texImg(imgs[i], { flip: false, premul: true, mip: true }); });

  // Umgebungston der Fische: mittlere Waldfarbe, stark zur Mitte gezogen (Stufe b/c); vorher fester Ton wie in raum.js
  let tint = [0.86, 0.9, 0.82];
  if (B) { const c = document.createElement("canvas"); c.width = 16; c.height = 9; const x = c.getContext("2d"); x.drawImage(iF, 0, 0, 16, 9);
    const d = x.getImageData(0, 0, 16, 9).data; let r = 0, g = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4, m = Math.max(r, g, b) / n; tint = [r / n / m, g / n / m, b / n / m].map((v) => 0.8 + 0.2 * v).map((v) => v * 1.02); }

  // ---------------- Schwarm (aus koi.js) ----------------
  const SP = {}; for (const k in PARAMS) SP[k] = PARAMS[k].v; Object.assign(SP, opts.fishParams || {});
  const S = {}; for (const k in SWITCHES) S[k] = SWITCHES[k].v;
  const seed = opts.seed ?? Math.floor(Math.random() * 1e6);
  function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  let swarm = [], rng = null;
  function makeSwarm(n) {
    rng = mulberry(seed * 7919 + 13); swarm = [];
    const order = [...NAMES].sort(() => rng() - 0.5);
    for (let i = 0; i < n; i++) { const name = order[i % order.length]; const F = FISH[name]; const ch = F.character || {};
      const g = () => Math.exp((rng() + rng() + rng() - 1.5) * 1.6);
      const k = new Koi(seed * 31 + i * 97 + 1, F); k.name = name; k.F = F; k.i = i;
      k.char = { size: (F.sizeFactor || 1) * Math.exp(Math.log(g()) * SP.sizeSpread), tempo: (ch.tempo || 1) * Math.exp(Math.log(g()) * 0.18), hover: (ch.verweilen || 1) * Math.exp(Math.log(g()) * 0.4),
                 goal: (ch.absicht || 1) * Math.exp(Math.log(g()) * 0.3), height: 0.75 + 0.55 * rng(), quiet: F.view !== "top" ? 0.6 : 1 };
      k.alt = k.char.height; k.tempoMul = 1; k.placed = false; swarm.push(k); }
  }
  const fishParams = (k) => ({ ...SP, vCruise: SP.vCruise * k.char.tempo * k.char.quiet * k.tempoMul, hoverP: Math.min(1, SP.hoverP * k.char.hover), goalHold: SP.goalHold * k.char.goal,
    sJoint: k.F.sJoint || SP.sJoint, headYaw: SP.headYaw + (k.F.headYaw || 0), A: SP.A * k.char.quiet, kappaMax: SP.kappaMax * k.char.quiet });
  const desiredCount = () => Math.min(NAMES.length, Math.max(1, Math.round(SP.targetVisible / 0.55)));
  const baseLengthPx = (Wc, Hc) => SP.sizePct / 100 * Math.hypot(Wc, Hc);

  // ---- Stufe c: der seltene Fisch, der tiefer kommt ----
  // Unspektakulär: kein Signal, keine Reaktion des Raums. Erster Abstieg frühestens nach ~25 s, danach im Mittel alle ~3 min.
  const sinkTest = parseFloat(q.get("sinken"));
  let sinkNext = C ? (isFinite(sinkTest) ? sinkTest : 25 + Math.random() * 120) : Infinity, sink = null, clock = 0;
  const ease = (x) => x * x * (3 - 2 * x);
  function stepSink(dt, Wc, Hc) {
    if (!C) return;
    if (!sink && clock > sinkNext) {
      const Lb = baseLengthPx(Wc, Hc);
      const c = swarm.filter((k) => !k.away && k.x * k.Lpx > Wc * 0.2 && k.x * k.Lpx < Wc * 0.8 && k.y * k.Lpx > Hc * 0.2 && k.y * k.Lpx < Hc * 0.8);
      if (c.length) { const k = c[Math.floor(Math.random() * c.length)];
        sink = { k, t0: clock, down: 7, stay: 9 + 7 * Math.random(), up: 9, from: k.char.height, to: 0.3 }; }
      else sinkNext = clock + 3;
      void Lb;
    }
    if (sink) { const s = sink, t = clock - s.t0, k = s.k;
      let a;
      if (t < s.down) a = ease(t / s.down);
      else if (t < s.down + s.stay) a = 1;
      else if (t < s.down + s.stay + s.up) a = 1 - ease((t - s.down - s.stay) / s.up);
      else { a = 0; sink = null; sinkNext = clock + 60 + -Math.log(1 - Math.random()) * 150; }
      k.alt = s.from + (s.to - s.from) * a;
      k.tempoMul = 1 - 0.45 * a;
      if (k.away) { k.alt = k.char.height; k.tempoMul = 1; sink = null; sinkNext = clock + 30; }
    }
  }

  function stepSim(dt, Wc, Hc) {
    const want = desiredCount(); if (swarm.length !== want) makeSwarm(want);
    const Lb = baseLengthPx(Wc, Hc);
    let visible = 0;
    for (const k of swarm) { const alt = k.Lpx; k.Lpx = Lb * k.char.size * Math.pow(k.alt, 0.35);
      if (alt && k.placed && alt !== k.Lpx) { k.x *= alt / k.Lpx; k.y *= alt / k.Lpx; }
      k.bounds = { w: Wc / k.Lpx, h: Hc / k.Lpx };
      if (!k.placed) { k.x = k.bounds.w * (0.1 + 0.8 * rng()); k.y = k.bounds.h * (0.1 + 0.8 * rng()); k.heading = rng() * 6.28; k.targetHeading = k.heading; k.placed = true; k.goalUntil = 0;
        if (k.i >= SP.targetVisible) { k.away = true; k.awayUntil = 0.5 + 7 * rng(); } }
      if (!k.away && k.x > 0 && k.x < k.bounds.w && k.y > 0 && k.y < k.bounds.h) visible++; }
    if (!(dt > 0)) return;
    stepSink(dt, Wc, Hc);
    for (const k of swarm) {
      const Pk = fishParams(k);
      if (k.away && visible < SP.targetVisible) k.awayUntil = Math.min(k.awayUntil, k.t + 0.4);
      if (k.away && visible > SP.targetVisible + 1) k.awayUntil = Math.max(k.awayUntil, k.t + 1.5);
      k.step(dt, Pk, S, k.bounds, "frei"); k.trail.length = 0;
    }
    const n = swarm.length;
    for (let a = 0; a < n; a++) { const ka = swarm[a]; if (ka.away) continue;
      let px = 0, py = 0, cnt = 0, nb = null, nbD = 1e9;
      for (let b = 0; b < n; b++) { if (a === b) continue; const kb = swarm[b]; if (kb.away) continue;
        const dx = (kb.x * kb.Lpx - ka.x * ka.Lpx) / ka.Lpx, dy = (kb.y * kb.Lpx - ka.y * ka.Lpx) / ka.Lpx, d = Math.hypot(dx, dy);
        if (d < SP.sepDist && d > 1e-3) { px -= dx / d * (SP.sepDist - d); py -= dy / d * (SP.sepDist - d); cnt++; }
        if (d < nbD && d < 3) { nbD = d; nb = kb; } }
      if (cnt) { const away = Math.atan2(py, px); const e = ((away - ka.targetHeading + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
        ka.targetHeading += e * Math.min(1, dt * 2.5 * Math.min(2, Math.hypot(px, py))); }
      if (nb && S.I && ka.t >= ka.goalUntil - dt && rng() < SP.followP) { ka.targetHeading = nb.heading + (rng() - 0.5) * 0.4; ka.goalUntil = ka.t + SP.goalHold * (0.5 + rng()); }
    }
  }

  // ---- Stufe c: Böen aus dem Lorenz-System ----
  // Die z-Koordinate schwillt in Spiralen an und fällt beim Wechsel der Flügel zusammen: Phasen von Ruhe und Anschwellen,
  // unregelmäßig, aber nicht beliebig. x gibt eine leichte Drehung der Windrichtung.
  const lz = { x: 1.2, y: 1.6, z: 18 + Math.random() * 8 };
  const LZ_TEMPO = 0.075;                       // Lorenz-Zeiteinheiten je Sekunde: ein Umlauf ≈ 9–10 s
  function lorenz(dt) {
    let h = dt * LZ_TEMPO; const n = Math.max(1, Math.ceil(h / 0.005)); h /= n;
    const f = (s) => ({ x: 10 * (s.y - s.x), y: s.x * (28 - s.z) - s.y, z: s.x * s.y - 8 / 3 * s.z });
    for (let i = 0; i < n; i++) { const a = f(lz), b = f({ x: lz.x + a.x * h / 2, y: lz.y + a.y * h / 2, z: lz.z + a.z * h / 2 }),
      c = f({ x: lz.x + b.x * h / 2, y: lz.y + b.y * h / 2, z: lz.z + b.z * h / 2 }), d = f({ x: lz.x + c.x * h, y: lz.y + c.y * h, z: lz.z + c.z * h });
      lz.x += h / 6 * (a.x + 2 * b.x + 2 * c.x + d.x); lz.y += h / 6 * (a.y + 2 * b.y + 2 * c.y + d.y); lz.z += h / 6 * (a.z + 2 * b.z + 2 * c.z + d.z); }
  }
  let boe = 1, boeGlatt = 1;
  // Einschwingen, damit der Taktgeber auf dem Attraktor läuft
  if (C) for (let i = 0; i < 400; i++) lorenz(0.25);

  // ---- Stufe c: Tageslicht nach Ortszeit (nur Tönung; die Sonne ist ins Bild gemalt und wandert nicht) ----
  function tageslicht() {
    if (!C) return { exp: 1, warm: 0, sat: 1 };
    const d = new Date(); const std = isFinite(parseFloat(q.get("stunde"))) ? parseFloat(q.get("stunde")) : d.getHours() + d.getMinutes() / 60;
    const K = [[0, .94, 0, 1], [5, .95, .02, 1], [7, 1.0, .16, 1.0], [10, 1.0, .05, 1.0], [16, 1.0, .02, 1.0], [19, .98, .12, 1.0], [21.5, .95, .06, 1.0], [24, .94, 0, 1]];
    let i = 0; while (i < K.length - 2 && std >= K[i + 1][0]) i++;
    const [a, b] = [K[i], K[i + 1]], u = ease(Math.min(1, Math.max(0, (std - a[0]) / (b[0] - a[0]))));
    return { exp: a[1] + (b[1] - a[1]) * u, warm: a[2] + (b[2] - a[2]) * u, sat: a[3] + (b[3] - a[3]) * u };
  }
  let licht = tageslicht(), lichtT = 0;

  // ---------------- Fische zeichnen ----------------
  const vaoFish = gl.createVertexArray(); gl.bindVertexArray(vaoFish);
  const bufPos = gl.createBuffer(), bufTex = gl.createBuffer(), bufIdx = gl.createBuffer(), bufLat = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, bufPos); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, bufTex); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, bufLat); gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufIdx);
  const NS = leise ? 48 : 96, NV = leise ? 12 : 24;
  const latBuf = new Float32Array((NS + 1) * (NV + 1)); { let k = 0; for (let i = 0; i <= NS; i++) for (let j = 0; j <= NV; j++) latBuf[k++] = (j / NV) * 2 - 1; }
  gl.bindBuffer(gl.ARRAY_BUFFER, bufLat); gl.bufferData(gl.ARRAY_BUFFER, latBuf, gl.STATIC_DRAW);
  gl.bindVertexArray(vaoQuad);
  const e1Angle = (F) => Math.atan2(F.e1y, F.e1x);
  // Gitter je Fisch einmal pro Bild bauen und für Schatten und Farbe wiederverwenden
  function gitter(k) { const Pk = fishParams(k); const F = k.F, pad = 0.03 * F.L;
    return { g: buildGrid(F, k.pose(Pk, S, "frei"), NS, NV, -0.02, 1.02, F.vMin - pad, F.vMax + pad), rot: k.heading - e1Angle(F) + (S.C ? Pk.headYaw * Math.PI / 180 : 0) }; }
  function drawFish(k, gr, Wpx, Hpx, dpr, mode, ox = 0, oy = 0) {
    const F = k.F, u = PK.u;
    gl.bindBuffer(gl.ARRAY_BUFFER, bufPos); gl.bufferData(gl.ARRAY_BUFFER, gr.g.pos, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufTex); gl.bufferData(gl.ARRAY_BUFFER, gr.g.tex, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufIdx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, gr.g.idx, gl.DYNAMIC_DRAW);
    gl.uniform2f(u.uCanvas, Wpx, Hpx); gl.uniform2f(u.uCenter, F.cx, F.cy);
    gl.uniform2f(u.uOffset, k.x * k.Lpx * dpr + ox, k.y * k.Lpx * dpr + oy); gl.uniform1f(u.uScale, k.Lpx * dpr / F.L); gl.uniform1f(u.uRot, gr.rot);
    gl.uniform2f(u.uTexSize, F.w, F.h); gl.uniform1i(u.uMode, mode); gl.uniform1f(u.uAlt, B ? k.alt : 1);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, TEX[F.name]); gl.uniform1i(u.uTex, 0);
    gl.drawElements(gl.TRIANGLES, gr.g.idx.length, gl.UNSIGNED_INT, 0);
  }

  // ---------------- Bild ----------------
  const qual = leise ? 0.5 : 1;
  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2) * qual;
    let w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    const k = Math.min(1, W0 / w, H0 / h); w = Math.max(2, Math.round(w * k)); h = Math.max(2, Math.round(h * k));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const f = (1 + 2 * P.rand) / 2;
    resizeTarget(SCH, Math.max(2, Math.round(w * f)), Math.max(2, Math.round(h * f))); resizeTarget(SCH2, SCH.w, SCH.h);
    return w / Math.max(1, canvas.clientWidth);        // Bildpunkte je CSS-Pixel
  }
  function bindT(pr, unit, t, name) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(pr.u[name], unit); }
  function to(tg) { gl.bindFramebuffer(gl.FRAMEBUFFER, tg ? tg.f : null); gl.viewport(0, 0, tg ? tg.w : canvas.width, tg ? tg.h : canvas.height); }
  const sa = (315 - 90) * Math.PI / 180, SUN = [Math.cos(sa), Math.sin(sa)];

  function render(t, dt) {
    const pxPerCss = resize(), Wc = canvas.clientWidth, Hc = canvas.clientHeight, Wpx = canvas.width, Hpx = canvas.height;
    clock += dt;
    stepSim(dt, Wc, Hc);
    if (C && dt > 0) { lorenz(dt); const z = (lz.z - 14) / 26; boe = 0.45 + 0.55 * Math.min(1, Math.max(0, z)); /* ruhig 0,45 … höchstens so stark wie bisher (1) */ boeGlatt += (boe - boeGlatt) * Math.min(1, dt * 1.5); }
    if (C && (lichtT += dt) > 30) { licht = tageslicht(); lichtT = 0; }
    const dirDeg = P.dir + (C ? 7 * Math.tanh(lz.x / 9) : 0), a = dirDeg * Math.PI / 180, dir = [Math.cos(a), Math.sin(a)];
    const ca = Wpx / Hpx, ia = W0 / H0, sc = ca > ia ? [1, ia / ca] : [ca / ia, 1];
    gl.disable(gl.BLEND); gl.bindVertexArray(vaoQuad);

    // 1 Windfeld
    to(FIELD); gl.useProgram(PF.p);
    gl.uniform1f(PF.u.uT, t); gl.uniform1f(PF.u.uAsp, W0 / H0); gl.uniform2f(PF.u.uDir, dir[0], dir[1]);
    gl.uniform1f(PF.u.uGustScale, P.gustScale); gl.uniform1f(PF.u.uGustSpeed, P.gustSpeed); gl.uniform1f(PF.u.uGustC, P.gustContrast);
    gl.uniform1f(PF.u.uCloudScale, P.cloudScale); gl.uniform1f(PF.u.uCloudSpeed, P.cloudSpeed);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // 2 Bewegung der Büsche + Weichzeichnen
    to(MOT); gl.useProgram(PMO.p);
    gl.uniformMatrix2fv(PMO.u.uInv, false, INV); gl.uniform2f(PMO.u.uOff, MAP.e, MAP.f); gl.uniform2f(PMO.u.uDir, dir[0], dir[1]);
    gl.uniform1f(PMO.u.uT, t); gl.uniform1f(PMO.u.uLean, P.lean); gl.uniform1f(PMO.u.uSway, P.sway);
    gl.uniform1f(PMO.u.uSwayFreq, P.swayFreq * 0.25); gl.uniform1f(PMO.u.uCross, P.cross); gl.uniform1f(PMO.u.uGustAmp, C ? boeGlatt : 1);
    bindT(PMO, 0, T.d1, "uD1"); bindT(PMO, 1, FIELD.t, "uF");
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.useProgram(PB.p);
    to(MOT2); gl.uniform2f(PB.u.uStep, P.couple / 640, 0); bindT(PB, 0, MOT.t, "uM"); gl.drawArrays(gl.TRIANGLES, 0, 3);
    to(MOT); gl.uniform2f(PB.u.uStep, 0, P.couple / 360); bindT(PB, 0, MOT2.t, "uM"); gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 3 Schattenwerfer: Fische in halber Auflösung, Höhe mitgeschrieben, dann weich
    const order = swarm.filter((k) => !k.away).sort((x, y) => x.alt - y.alt);
    const gr = order.map(gitter);
    const shOn = S.D ? 1 : 0;
    if (shOn) {
      to(SCH); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(vaoFish); gl.useProgram(PK.p);
      const d = pxPerCss * 0.5;
      const mx = Wc * P.rand * d, my = Hc * P.rand * d;   // Fische knapp außerhalb des Bildes werfen weiter Schatten hinein
      order.forEach((k, i) => drawFish(k, gr[i], SCH.w, SCH.h, d, 1, mx, my));
      gl.disable(gl.BLEND); gl.bindVertexArray(vaoQuad); gl.useProgram(PB.p);
      const soft = Math.max(0.5, SP.shSoft * baseLengthPx(Wc, Hc) * d * 0.16);
      to(SCH2); gl.uniform2f(PB.u.uStep, soft / SCH.w, 0); bindT(PB, 0, SCH.t, "uM"); gl.drawArrays(gl.TRIANGLES, 0, 3);
      to(SCH); gl.uniform2f(PB.u.uStep, 0, soft / SCH.h); bindT(PB, 0, SCH2.t, "uM"); gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // 4 Wald mit Schatten
    to(null); gl.useProgram(PM.p); const u = PM.u;
    gl.uniform2f(u.uScale, sc[0], sc[1]); gl.uniform2f(u.uImg, W0, H0);
    gl.uniform2f(u.uSun, SUN[0], SUN[1]); gl.uniform2f(u.uHB, HB[0], HB[1]);
    gl.uniform1f(u.uSheenG, P.sheenGras); gl.uniform1f(u.uSheenK, P.sheenKrone);
    gl.uniform1f(u.uCloudCov, P.cloudCov); gl.uniform1f(u.uCloudDark, P.cloudDark); gl.uniform1f(u.uCloudSoft, P.cloudSoft); gl.uniform1f(u.uCloudPar, P.cloudPar);
    const gradeU = (pu) => { gl.uniform1f(pu.uExp, P.exposure * licht.exp); gl.uniform1f(pu.uSat, P.sat * licht.sat); gl.uniform1f(pu.uCon, P.contrast);
      gl.uniform1f(pu.uWarm, P.warm + licht.warm); gl.uniform1f(pu.uLift, P.lift); };
    gradeU(u);
    // Schattenversatz in Bildschirm-uv je Einheit Höhe (Richtung und Länge wie bisher: shAngle, shHeight · Körperlänge)
    const Lb = baseLengthPx(Wc, Hc), shA = SP.shAngle * Math.PI / 180, len = SP.shHeight * Lb;
    gl.uniform2f(u.uShV, Math.cos(shA) * len / Wc, -Math.sin(shA) * len / Hc);
    gl.uniform1f(u.uDebug, q.get("debug") === "schatten" ? 1 : q.get("debug") === "relief" ? 2 : q.get("debug") === "werfer" ? 3 : 0); gl.uniform1f(u.uKH, P.kronenHub); gl.uniform1f(u.uRand, P.rand); gl.uniform1f(u.uWaldSat, B ? P.waldSat : 1); gl.uniform1f(u.uWaldCon, B ? P.waldCon : 1); gl.uniform1f(u.uWaldTief, B ? P.waldTief : 0); gl.uniform1f(u.uShDark, P.schattenDunkel); gl.uniform1f(u.uShOn, shOn);
    bindT(PM, 0, T.col, "uCol"); bindT(PM, 1, T.d2, "uD2"); bindT(PM, 2, FIELD.t, "uF"); bindT(PM, 3, MOT.t, "uM"); bindT(PM, 4, SCH.t, "uS");
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 5 Fische in Farbe
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(vaoFish); gl.useProgram(PK.p); const v = PK.u;
    gl.uniform1f(v.uVol, S.V ? SP.vol : 0); gl.uniform1f(v.uWaldton, B ? 1 : 0); gl.uniform3f(v.uTint, tint[0], tint[1], tint[2]);
    gl.uniform2f(v.uView, Wpx, Hpx); gl.uniform2f(v.uCover, sc[0], sc[1]); gl.uniform2f(v.uSun, SUN[0], SUN[1]);
    gl.uniform1f(v.uCloudCov, P.cloudCov); gl.uniform1f(v.uCloudDark, P.cloudDark); gl.uniform1f(v.uCloudSoft, P.cloudSoft); gl.uniform1f(v.uCloudPar, P.cloudPar);
    gradeU(v);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, FIELD.t); gl.uniform1i(v.uF, 1);
    order.forEach((k, i) => drawFish(k, gr[i], Wpx, Hpx, pxPerCss, 0));
    gl.disable(gl.BLEND); gl.bindVertexArray(vaoQuad);
  }

  // ---------------- Ablauf ----------------
  const info = { frames: 0, stufe, seed, running: false, lost: false, ms: 0, get boe() { return boeGlatt; }, get sinkt() { return !!sink; }, get licht() { return licht; } };
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const shouldRun = () => !document.hidden && !motion.matches && !info.lost;
  let t0 = performance.now(), last = 0, lastT = null, raf = 0;
  function frame(now) {
    raf = 0; if (!shouldRun()) { info.running = false; lastT = null; return; }
    raf = requestAnimationFrame(frame);
    if (now - last < 1000 / P.fps - 2) return; last = now;
    const dt = lastT === null ? 1 / 60 : Math.min(0.05, (now - lastT) / 1000); lastT = now;
    const a = performance.now(); render((now - t0) / 1000, dt); info.ms = info.ms * 0.9 + (performance.now() - a) * 0.1; info.frames++;
  }
  function update() {
    if (shouldRun()) { if (!raf) { info.running = true; raf = requestAnimationFrame(frame); } }
    else if (!document.hidden && !info.lost) render((performance.now() - t0) / 1000, 0);   // Standbild bei reduzierter Bewegung
  }
  document.addEventListener("visibilitychange", update);
  motion.addEventListener?.("change", update);
  addEventListener("resize", () => { if (!shouldRun() && !document.hidden && !info.lost) render((performance.now() - t0) / 1000, 0); });
  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); info.lost = true; opts.onLost?.(); });
  render(0, 1 / 60); info.frames++;
  update();
  window.__welt = info;
  return info;
}
