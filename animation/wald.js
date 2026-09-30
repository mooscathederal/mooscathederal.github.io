// Wald-Hintergrund – Shader-Rendering für die Startseite.
// Extrahiert aus wald_shader/wald_test.html (Stand 28.09.2026); Regler/Panel entfernt,
// Werte auf den zuletzt bestätigten Stand fest verdrahtet.
export async function startWald(canvas, opts = {}) {
  const base = opts.base || new URL(".", import.meta.url).href;
  const gl = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: false });
  if (!gl) throw new Error("kein WebGL 2");

  const IMG = { farbe: "farbe.webp", d1: "d1.png", d2: "d2.png" };
  const W0 = 2560, H0 = 1440;
  const MAP = { a: 0.5337, b: 0.02491, c: -0.07249, d: 0.42537, e: 0.40049, f: 0.51707 };
  const HB = [0.50, 0.90];

  const P = {
    dir: 94, lean: 3, sway: 1.8, swayFreq: 1, cross: 0.4, couple: 1.4,
    gustScale: 2.2, gustSpeed: 0.045, gustContrast: 0.8,
    sheenGras: 0.15, sheenKrone: 0.08,
    cloudCov: 0.4, cloudScale: 1.3, cloudSpeed: 0.01, cloudDark: 0.78, cloudSoft: 0.22, cloudPar: 0.012,
    exposure: 1, sat: 1.15, contrast: 1.15, warm: 0.1, lift: 0,
    fps: 60,
  };
  Object.assign(P, opts.params || {});

  const VS = `#version 300 es
in vec2 p; out vec2 vUv; void main(){ vUv = p*.5+.5; gl_Position = vec4(p,0,1); }`;
  const NOISE = `
float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float a=.5, s=0.; for(int k=0;k<5;k++){ s+=a*vn(p); p=p*2.03+vec2(17.1,9.2); a*=.5; } return s/.97; }`;

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

  const FS_MOTION = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uD1, uF; uniform mat2 uInv; uniform vec2 uOff, uDir;
uniform float uT, uLean, uSway, uSwayFreq, uCross;
void main(){
  vec3 d1 = texture(uD1, vUv).rgb; float rnd = d1.b;
  vec2 piv = clamp(uInv*(d1.rg - uOff), 0., 1.);
  float g = texture(uF, piv).r;
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

  const FS_MAIN = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uCol, uD2, uF, uM;
uniform vec2 uScale, uImg, uSun, uHB;
uniform float uSheenG, uSheenK, uCloudCov, uCloudDark, uCloudSoft, uCloudPar;
uniform float uExp, uSat, uCon, uWarm, uLift;
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
vec3 grade(vec3 c){
  c *= uExp;
  c = c*(1.-uLift) + uLift;
  float l = dot(c, vec3(.2126,.7152,.0722));
  c = mix(vec3(l), c, uSat);
  c = (c-.5)*uCon + .5;
  c *= vec3(1.+.07*uWarm, 1.+.01*uWarm, 1.-.10*uWarm);
  return clamp(c, 0., 1.);
}
void main(){
  vec2 uv = (vUv-.5)*uScale+.5;
  vec4 f = texture(uF, uv);
  vec2 d2 = texture(uD2, uv).rg; float bush = smoothstep(.2,.8,d2.g);
  vec2 o1 = offs(uv), o2 = offs(uv-o1), o3 = offs(uv-o2);
  vec3 c = cr(uv-o3);
  float gg = f.g - .45;
  c *= 1. + uSheenG*gg*2.*(1.-bush);
  c = mix(c, c*vec3(1.05,1.05,.9), clamp(uSheenG*f.g*2.,0.,1.)*(1.-bush));
  c *= 1. + uSheenK*f.r*bush;
  float cl = texture(uF, uv + uSun*uCloudPar*d2.r).b;
  cl = smoothstep(1.-uCloudCov-uCloudSoft, 1.-uCloudCov+uCloudSoft, cl);
  c *= mix(vec3(1.), vec3(uCloudDark)*vec3(.94,.98,1.07), cl);
  o = vec4(grade(c), 1.);
}`;

  function sh(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(s); console.error(log); throw new Error(log); } return s; }
  function prog(fs) { const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, "p"); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name.replace("[0]", "")] = gl.getUniformLocation(p, a.name); } return { p, u }; }
  const PF = prog(FS_FIELD), PMO = prog(FS_MOTION), PB = prog(FS_BLUR), PM = prog(FS_MAIN);
  const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  function tex(img) { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; }
  function target(w, h) { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { t, f, w, h }; }
  const FIELD = target(256, 144), MOT = target(640, 360), MOT2 = target(640, 360);

  const det = MAP.a * MAP.d - MAP.b * MAP.c;
  const INV = [MAP.d / det, -MAP.c / det, -MAP.b / det, MAP.a / det];

  function load(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
  const T = {};
  await Promise.all([
    load(new URL(IMG.farbe, base).href),
    load(new URL(IMG.d1, base).href),
    load(new URL(IMG.d2, base).href),
  ]).then(([a, b, c]) => { T.col = tex(a); T.d1 = tex(b); T.d2 = tex(c); });

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    let w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
    const k = Math.min(1, W0 / w, H0 / h); w = Math.round(w * k); h = Math.round(h * k);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }
  function bindT(prog, unit, t, name) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(prog.u[name], unit); }
  function to(tg) { gl.bindFramebuffer(gl.FRAMEBUFFER, tg ? tg.f : null); gl.viewport(0, 0, tg ? tg.w : canvas.width, tg ? tg.h : canvas.height); }

  let last = 0, t0 = performance.now(), running = true;
  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    if (now - last < 1000 / P.fps - 2) return; last = now;
    resize();
    const t = (now - t0) / 1000;
    const a = P.dir * Math.PI / 180, dir = [Math.cos(a), Math.sin(a)];
    to(FIELD); gl.useProgram(PF.p);
    gl.uniform1f(PF.u.uT, t); gl.uniform1f(PF.u.uAsp, W0 / H0); gl.uniform2f(PF.u.uDir, dir[0], dir[1]);
    gl.uniform1f(PF.u.uGustScale, P.gustScale); gl.uniform1f(PF.u.uGustSpeed, P.gustSpeed); gl.uniform1f(PF.u.uGustC, P.gustContrast);
    gl.uniform1f(PF.u.uCloudScale, P.cloudScale); gl.uniform1f(PF.u.uCloudSpeed, P.cloudSpeed);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    to(MOT); gl.useProgram(PMO.p);
    gl.uniformMatrix2fv(PMO.u.uInv, false, INV); gl.uniform2f(PMO.u.uOff, MAP.e, MAP.f); gl.uniform2f(PMO.u.uDir, dir[0], dir[1]);
    gl.uniform1f(PMO.u.uT, t); gl.uniform1f(PMO.u.uLean, P.lean); gl.uniform1f(PMO.u.uSway, P.sway);
    gl.uniform1f(PMO.u.uSwayFreq, P.swayFreq * 0.25); gl.uniform1f(PMO.u.uCross, P.cross);
    bindT(PMO, 0, T.d1, "uD1"); bindT(PMO, 1, FIELD.t, "uF");
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.useProgram(PB.p);
    to(MOT2); gl.uniform2f(PB.u.uStep, P.couple / 640, 0); bindT(PB, 0, MOT.t, "uM"); gl.drawArrays(gl.TRIANGLES, 0, 3);
    to(MOT); gl.uniform2f(PB.u.uStep, 0, P.couple / 360); bindT(PB, 0, MOT2.t, "uM"); gl.drawArrays(gl.TRIANGLES, 0, 3);
    to(null); gl.useProgram(PM.p);
    const ca = canvas.width / canvas.height, ia = W0 / H0, sc = ca > ia ? [1, ia / ca] : [ca / ia, 1], u = PM.u;
    gl.uniform2f(u.uScale, sc[0], sc[1]); gl.uniform2f(u.uImg, W0, H0);
    const sa = (315 - 90) * Math.PI / 180; gl.uniform2f(u.uSun, Math.cos(sa), Math.sin(sa)); gl.uniform2f(u.uHB, HB[0], HB[1]);
    gl.uniform1f(u.uSheenG, P.sheenGras); gl.uniform1f(u.uSheenK, P.sheenKrone);
    gl.uniform1f(u.uCloudCov, P.cloudCov); gl.uniform1f(u.uCloudDark, P.cloudDark); gl.uniform1f(u.uCloudSoft, P.cloudSoft); gl.uniform1f(u.uCloudPar, P.cloudPar);
    gl.uniform1f(u.uExp, P.exposure); gl.uniform1f(u.uSat, P.sat); gl.uniform1f(u.uCon, P.contrast); gl.uniform1f(u.uWarm, P.warm); gl.uniform1f(u.uLift, P.lift);
    bindT(PM, 0, T.col, "uCol"); bindT(PM, 1, T.d2, "uD2"); bindT(PM, 2, FIELD.t, "uF"); bindT(PM, 3, MOT.t, "uM");
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  requestAnimationFrame(frame);
  return { stop() { running = false; } };
}
