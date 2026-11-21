const canvas = document.createElement("canvas");   // nicht im Dokument: rechnet nur, die Kacheln zeigen
const gl = canvas.getContext("webgl", { alpha: false, antialias: false, preserveDrawingBuffer: true });
const elSuche = document.getElementById("suche");
const elZurueck = document.getElementById("zurueck-btn");

let viewMode = "list";
let activeIndex = 0;
let hitBoxes = [];
let dpr = Math.min(window.devicePixelRatio || 1, 2);
let fassung = 0;
if (SEITE) { viewMode = "article"; activeIndex = 0; }

const off = document.createElement("canvas");
const real = off.getContext("2d");
// Beim Satz wird nicht gezeichnet, sondern aufgezeichnet: jede Zeile als Auftrag mit Lage im Dokument.
// Gezeichnet wird erst beim Einbrennen einer Kachel, und nur, was in ihr liegt.
let OPS = [];
const ctx = (() => {
  let st = { tx: 0, ty: 0, rot: 0 }; const stack = [];
  let style = "#000";
  return {
    save() { stack.push({ ...st }); }, restore() { st = stack.pop() || { tx: 0, ty: 0, rot: 0 }; },
    translate(x, y) { st.tx += x; st.ty += y; }, rotate(r) { st.rot += r; },
    set font(f) { real.font = f; }, get font() { return real.font; },
    set fillStyle(c) { style = c; }, get fillStyle() { return style; },
    measureText(t) { return real.measureText(t); },
    fillText(t, x, y) { OPS.push({ tx: st.tx, ty: st.ty, rot: st.rot, font: real.font, style, text: t, ox: x, oy: y }); },
    setTransform() {}, clearRect() {}
  };
})();

const WRAP = new Map();
function wrapLines(text, maxW, font) {
  if (!text) return [];
  const k = font + "|" + maxW + "|" + text;
  const hit = WRAP.get(k); if (hit) return hit;
  ctx.font = font;
  const words = text.split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? cur + " " + w : w;
    if (ctx.measureText(test).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  WRAP.set(k, lines);
  return lines;
}

function hashVal(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h;
}

function hashN(h, shift) {
  return (((h >>> shift) & 1023) / 1024) - 0.5;
}

function dachText(t) {
  return t.form ? `${t.anzeige} · ${t.form}` : t.anzeige;
}

function humanDrift(seed, prevX) {
  const h = hashVal(seed);
  const n = (shift) => hashN(h, shift);
  const stepX = n(0) * 3.4;
  const x = Math.max(-4.0, Math.min(4.0, prevX * 0.62 + stepX));
  return {
    x,
    jd: n(4) * 1.4,
    ju: n(8) * 1.4,
    jr: n(12) * 0.004,           // +-0.11 deg
    dachGap: 24.5 + n(16) * 2.4, // 23.3 - 25.7 px
    unterGap: 2 + n(20) * 1.6,   // 1.2 - 2.8 px
    afterGap: 36 + n(2) * 10.0,  // 31 - 41 px
    inkPress: 0.92 + n(6) * 0.09 // 0.875 - 0.965
  };
}

function fontAscent(font) {
  ctx.font = font;
  const m = ctx.measureText("Hg");
  return m.fontBoundingBoxAscent || m.actualBoundingBoxAscent || 14;
}

function editDist(a, b) {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 2) return 99;
  const dp = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

function fuzzyScore(query, target) {
  if (!target) return 0;
  const t = target.toLowerCase();
  if (t.includes(query)) return 140 + 25 / (t.indexOf(query) + 1);
  const tokens = query.split(/\s+/).filter(Boolean);
  const words = t.split(/[^a-zäöüß0-9]+/).filter(Boolean);
  let total = 0;
  for (const tok of tokens) {
    if (t.includes(tok)) { total += 60; continue; }
    let best = 0;
    const maxD = tok.length >= 7 ? 2 : (tok.length >= 4 ? 1 : 0);
    if (maxD > 0) {
      for (const w of words) {
        if (Math.abs(w.length - tok.length) > maxD) continue;
        const d = editDist(tok, w);
        if (d <= maxD) best = Math.max(best, 42 - d * 14);
      }
    }
    if (!best) {
      // Ordered subsequence fallback for partial typing
      let qi = 0;
      for (let i = 0; i < t.length && qi < tok.length; i++) {
        if (t[i] === tok[qi]) qi++;
      }
      if (qi === tok.length && tok.length >= 3) best = 18;
    }
    if (!best) return 0;
    total += best;
  }
  return total;
}

function searchEntries(q) {
  const hits = [];
  for (let i = 0; i < TEXTE.length; i++) {
    const t = TEXTE[i];
    const headScore = fuzzyScore(q, (t.titel || "") + " " + (t.unter || ""));
    if (headScore > 0) {
      hits.push({ t, i, prio: 1, score: headScore });
      continue;
    }
    const bodyScore = fuzzyScore(q, t.text || "");
    if (bodyScore > 0) {
      hits.push({ t, i, prio: 2, score: bodyScore });
    }
  }
  hits.sort((a, b) => a.prio - b.prio || b.score - a.score || b.t.datum.localeCompare(a.t.datum));
  return hits;
}

const elDom = document.getElementById("dom-layer");

function layoutDocument(rebuildDom, scrollYOffset = 0) {
  const cssW = window.innerWidth;
  const colW = Math.min(540, cssW - 56);
  const startX = Math.max(24, (cssW - colW) / 2);
  let y = 140 - scrollYOffset;
  let prevX = 0;
  hitBoxes = [];

  const frag = rebuildDom ? document.createDocumentFragment() : null;

  const q = elSuche.value.trim().toLowerCase();
  const items = viewMode === "list"
    ? (q ? searchEntries(q) : TEXTE.map((t, i) => ({ t, i })))
    : [{ t: TEXTE[activeIndex], i: activeIndex }];

  const fontDach = '400 12.5px -apple-system, BlinkMacSystemFont, "Inter", sans-serif';
  const fontTitle = '700 24px "Newsreader", Georgia, serif';
  const fontArticleTitle = '700 30px "Newsreader", Georgia, serif';
  const fontUnter = 'italic 400 16px "Newsreader", Georgia, serif';
  const fontBody = '400 17px "Newsreader", Georgia, serif';
  const fontBodyItalic = 'italic 400 17px "Newsreader", Georgia, serif';

  const ascDach = fontAscent(fontDach);
  const ascTitle = fontAscent(fontTitle);
  const ascArtTitle = fontAscent(fontArticleTitle);
  const ascUnter = fontAscent(fontUnter);
  const ascBody = fontAscent(fontBody);
  const ascBodyItalic = fontAscent(fontBodyItalic);

  const addDomLine = (parent, text, x, docY, font, asc, rot) => {
    const sp = document.createElement("span");
    sp.className = "dom-line";
    sp.textContent = text;
    sp.style.left = x.toFixed(2) + "px";
    sp.style.top = (docY - asc).toFixed(2) + "px";
    sp.style.font = font;
    if (rot) {
      sp.style.transform = `rotate(${rot.toFixed(5)}rad)`;
      sp.style.transformOrigin = `0px ${asc.toFixed(2)}px`;
    }
    parent.appendChild(sp);
  };

  for (const item of items) {
    const t = item.t;
    const seedBase = t.datum + t.titel + t.text.slice(0, 24);
    const d = humanDrift(seedBase, prevX);
    prevX = d.x;
    const entryTopDoc = y + scrollYOffset;
    const press = d.inkPress;

    const entryEl = rebuildDom ? document.createElement("article") : null;
    if (entryEl) {
      entryEl.className = "dom-entry" + (viewMode === "list" && !t.inline ? " clickable" : "");
    }

    const dachStr = dachText(t);
    ctx.save();
    ctx.translate(startX + d.x, y);
    ctx.rotate(d.jr);
    ctx.fillStyle = `rgba(0,255,0,${(0.62 * press).toFixed(3)})`;
    ctx.font = fontDach;
    ctx.fillText(dachStr, d.jd, 0);
    ctx.restore();
    if (entryEl) addDomLine(entryEl, dachStr, startX + d.x + d.jd, y + scrollYOffset, fontDach, ascDach, d.jr);

    y += d.dachGap + (viewMode === "article" ? 6 : (t.inline && t.titel ? 5 : 0));

    if (t.titel) {
      const f = viewMode === "article" ? fontArticleTitle : fontTitle;
      const asc = viewMode === "article" ? ascArtTitle : ascTitle;
      const lh = viewMode === "article" ? 36 : 29;
      const lines = wrapLines(t.titel, colW - 10, f);
      for (const ln of lines) {
        ctx.save();
        ctx.translate(startX + d.x, y);
        ctx.rotate(d.jr);
        ctx.fillStyle = `rgba(255,0,0,${press.toFixed(3)})`;
        ctx.font = f;
        ctx.fillText(ln, 0, 0);
        ctx.restore();
        if (entryEl) addDomLine(entryEl, ln, startX + d.x, y + scrollYOffset, f, asc, d.jr);
        y += lh;
      }
    }

    if (t.unter) {
      y += d.unterGap + (viewMode === "article" ? -6 : -5);
      const lines = wrapLines(t.unter, colW - 10, fontUnter);
      for (const ln of lines) {
        ctx.save();
        ctx.translate(startX + d.x, y);
        ctx.rotate(d.jr);
        ctx.fillStyle = `rgba(0,255,0,${(0.68 * press).toFixed(3)})`;
        ctx.font = fontUnter;
        ctx.fillText(ln, d.ju, 0);
        ctx.restore();
        if (entryEl) addDomLine(entryEl, ln, startX + d.x + d.ju, y + scrollYOffset, fontUnter, ascUnter, d.jr);
        y += 22;
      }
    }

    const kolophon = (vermerk) => {
      if (!vermerk) return;
      y += 22;
      const font = 'italic 400 13px "Newsreader", Georgia, serif', rot = d.jr * 0.45;
      ctx.save(); ctx.translate(startX + d.x, y); ctx.rotate(rot);
      ctx.fillStyle = "rgba(0,255,0," + (0.62 * press).toFixed(3) + ")";
      ctx.font = font; ctx.fillText(vermerk, 0, 0); ctx.restore();
      if (entryEl) addDomLine(entryEl, vermerk, startX + d.x, y + scrollYOffset, font, ascDach, rot);
      y += 18;
    };

    if (viewMode === "article" && t.fassungen) {
      // 16.11.: Textseite. Gleiche Tinte, gleiche Satzregeln wie die Leseansicht; Absätze ohne Auszeichnung
      // laufen durch denselben Zeilenweg wie unten, damit das Bild pixelgleich bleibt.
      y += 9;
      const F = t.fassungen, fi = Math.min(fassung, F.length - 1), fz = F[fi];
      const FONT = { n: fontBody, i: fontBodyItalic, b: '600 17px "Newsreader", Georgia, serif',
        bi: 'italic 600 17px "Newsreader", Georgia, serif', c: '500 12.5px -apple-system, BlinkMacSystemFont, "Inter", sans-serif' };
      const fontZw = '600 19px "Newsreader", Georgia, serif';
      const tinte = (s, font, x, yy, rot, a) => { ctx.save(); ctx.translate(x, yy); ctx.rotate(rot);
        ctx.fillStyle = `rgba(0,255,0,${a.toFixed(3)})`; ctx.font = font; ctx.fillText(s, 0, 0); ctx.restore(); };
      const tuer = (x, yy, w, h, fn) => { if (!entryEl) return; const b = document.createElement("button");
        b.type = "button"; b.className = "tuer"; b.style.left = x + "px"; b.style.top = yy + "px";
        b.style.width = w + "px"; b.style.height = h + "px"; b.addEventListener("click", (ev) => { ev.stopPropagation(); fn(); }); entryEl.appendChild(b); };
      if (F.length > 1) {
        y += 8;
        ctx.font = fontDach;
        const breit = Math.max(...F.map(f => ctx.measureText(f.name).width)) + 26;
        F.forEach((f, i) => {
          const x = startX + d.x + i * (breit + 8); ctx.font = fontDach; const w = ctx.measureText(f.name).width;
          tinte(f.name, fontDach, x + (breit - w) / 2, y, d.jr, (i === fi ? 1 : 0.42) * press);
          tuer(x, y - 17, breit, 26, () => { fassung = i; renderAll(); });
        });
        y += 40;
      }
      if (fz.titel) {
        const width = colW - 8;
        const segments = fz.titel.split(/(?<=Obrigkeitsgehorsam)(?= als Persönlichkeit$)/);
        ctx.font = fontZw;
        const lines = segments.length > 1 && (cssW <= 480 || ctx.measureText(fz.titel).width > width)
          ? segments.flatMap(segment => wrapLines(segment.trim(), width, fontZw))
          : wrapLines(fz.titel, width, fontZw);
        const ascent = fontAscent(fontZw);
        for (const line of lines) {
          tinte(line, fontZw, startX + d.x, y, d.jr, press);
          if (entryEl) addDomLine(entryEl, line, startX + d.x, y + scrollYOffset, fontZw, ascent, d.jr);
          y += 23;
        }
        y += 13;
      }
      let pIdx = 0;
      for (const b of fz.bloecke) {
        if (b.t === "luecke") { y += b.h; continue; }
        const ph = hashVal(seedBase + ":p" + pIdx);
        const paraX = hashN(ph, 0) * 2.1, paraTilt = hashN(ph, 8) * 0.0012;
        const paraGap = 10 + hashN(ph, 16) * 3.2, paraPress = hashN(ph, 20) * 0.04;
        let lIdx = 0;
        const zeile = () => {
          const lh = hashVal(seedBase + ":p" + pIdx + ":l" + lIdx);
          const baseH = fz.zeilen ? 23.5 : 25.0;
          return { lineX: hashN(lh, 0) * 0.85, lineH: baseH + hashN(lh, 8) * 0.9, rot: d.jr * 0.45 + paraTilt,
            alpha: Math.max(0.88, Math.min(1, 0.96 + (press - 0.92) * 0.45 + paraPress + hashN(lh, 16) * 0.036)) };
        };
        for (const z of b.z) {
          if (z.f) {   // Formel: zentriert, kursiv
            const s = z.r.map(r => r[1]).join(""); const L = zeile();
            ctx.font = fontBodyItalic; let fF = fontBodyItalic, lw = ctx.measureText(s).width;
            if (lw > colW - 4) { fF = 'italic 400 14px "Newsreader", Georgia, serif'; ctx.font = fF; lw = ctx.measureText(s).width; }   // breite Formel kleiner
            const x = startX + Math.max(0, (colW - lw) / 2);
            tinte(s, fF, x, y, L.rot, L.alpha);
            if (entryEl) addDomLine(entryEl, s, x, y + scrollYOffset, fontBodyItalic, ascBodyItalic, L.rot);
            y += L.lineH; lIdx++; continue;
          }
          if (z.r.length === 1 && z.r[0][0] === "n") {   // ohne Auszeichnung: derselbe Weg wie die Leseansicht
            for (const ln of wrapLines(z.r[0][1].trim(), colW - 12, fontBody)) {
              const L = zeile(); const x = startX + d.x + paraX + L.lineX;
              tinte(ln, fontBody, x, y, L.rot, L.alpha);
              if (entryEl) addDomLine(entryEl, ln, x, y + scrollYOffset, fontBody, ascBody, L.rot);
              y += L.lineH; lIdx++;
            }
            continue;
          }
          ctx.font = fontBody; const sp = ctx.measureText(" ").width;
          const worte = []; let luecke = false;
          for (const [st, tx] of z.r) for (const w of tx.split(/(\s+)/)) {
            if (!w) continue;
            if (/^\s+$/.test(w)) { luecke = true; continue; }
            ctx.font = FONT[st] || fontBody;
            worte.push({ st, w, b: ctx.measureText(w).width, sp: luecke && worte.length > 0 }); luecke = false;
          }
          const zeilenListe = []; let cur = [], bw = 0;
          for (const o of worte) {
            const plus = (cur.length && o.sp ? sp : 0) + o.b;
            if (cur.length && bw + plus > colW - 12) { zeilenListe.push(cur); cur = []; bw = 0; }
            bw += (cur.length && o.sp ? sp : 0) + o.b; cur.push(o);
          }
          if (cur.length) zeilenListe.push(cur);
          for (const zl of zeilenListe) {
            const L = zeile(); const x0 = startX + d.x + paraX + L.lineX; let xo = 0;
            zl.forEach((o, k) => { if (k && o.sp) xo += sp; tinte(o.w, FONT[o.st] || fontBody, x0 + xo, y, L.rot, L.alpha); xo += o.b; });
            if (entryEl) addDomLine(entryEl, zl.map((o, k) => (k && o.sp ? " " : "") + o.w).join(""), x0, y + scrollYOffset, fontBody, ascBody, L.rot);
            y += L.lineH; lIdx++;
          }
        }
        y += paraGap; pIdx++;
      }
      kolophon(fz.vermerk);
      if (F.length > 1 && fi + 1 < F.length) {
        y += 22; const s = "weiter: " + F[fi + 1].name; ctx.font = fontDach; const w = ctx.measureText(s).width;
        tinte(s, fontDach, startX + d.x, y, d.jr, 0.62 * press);
        tuer(startX + d.x - 4, y - 16, w + 8, 24, () => { fassung = fi + 1; renderAll(); window.scrollTo(0, 0); });
        y += 14;
      }
    } else if (viewMode === "article" || t.inline) {
      y += (viewMode === "list" && t.inline && t.titel && !t.unter) ? -2 : 9;
      const paras = t.text.split(/\n\n+/);
      let pIdx = 0;
      for (const p of paras) {
        const ph = hashVal(seedBase + ":p" + pIdx);
        const paraX = hashN(ph, 0) * 2.1;        // +-1.05 px pro Absatz
        const paraTilt = hashN(ph, 8) * 0.0012;  // winzige Absatz-Neigung
        const paraGap = 10 + hashN(ph, 16) * 3.2; // 8.4 - 11.6 px
        const paraPress = hashN(ph, 20) * 0.04;
        const isLeitsatz = Boolean(t.leitsatz && pIdx === 0);
        const curFont = isLeitsatz ? fontBodyItalic : fontBody;
        const curAsc = isLeitsatz ? ascBodyItalic : ascBody;
        const subLines = t.zeilen ? p.split(/\n/) : [p];
        let lIdx = 0;
        for (const sub of subLines) {
          const lines = wrapLines(sub.trim(), colW - 12, curFont);
          for (const ln of lines) {
            const lhHash = hashVal(seedBase + ":p" + pIdx + ":l" + lIdx);
            const lineX = hashN(lhHash, 0) * 0.85;   // +-0.42 px pro Zeile
            const baseH = t.zeilen ? 23.5 : 25.0;
            const lineH = baseH + hashN(lhHash, 8) * 0.9;
            const linePress = hashN(lhHash, 16) * 0.036;
            const rot = d.jr * 0.45 + paraTilt;
            let drawX = startX + d.x + paraX + lineX;
            if (isLeitsatz) {
              ctx.font = curFont;
              const lw = ctx.measureText(ln).width;
              drawX = startX + Math.max(0, (colW - lw) / 2);
            }

            ctx.save();
            ctx.translate(drawX, y);
            ctx.rotate(rot);
            const bodyAlpha = Math.max(0.88, Math.min(1, 0.96 + (press - 0.92) * 0.45 + paraPress + linePress));
            ctx.fillStyle = `rgba(0,255,0,${bodyAlpha.toFixed(3)})`;
            ctx.font = curFont;
            ctx.fillText(ln, 0, 0);
            ctx.restore();

            if (entryEl) addDomLine(entryEl, ln, drawX, y + scrollYOffset, curFont, curAsc, rot);
            y += lineH;
            lIdx++;
          }
        }
        y += paraGap;
        pIdx++;
      }
      kolophon(t.vermerk);
    }

    const entryBottomDoc = y + scrollYOffset;
    if (entryEl) {
      entryEl.style.top = (entryTopDoc - 14) + "px";
      entryEl.style.height = Math.max(28, entryBottomDoc - entryTopDoc + 22) + "px";
      // Position inner spans relative to entryEl top
      const topOff = entryTopDoc - 14;
      for (const sp of entryEl.children) {
        sp.style.top = (parseFloat(sp.style.top) - topOff).toFixed(2) + "px";
      }
      if (viewMode === "list" && !t.inline) {
        entryEl.addEventListener("click", () => {
          const sel = window.getSelection();
          if (sel && sel.toString().trim().length > 0) return;
          if (t.link) { try { sessionStorage.setItem("worte_y", String(window.scrollY)); } catch (e) {} location.href = t.link; return; }
          lastListScrollY = window.scrollY;
          history.replaceState({ view: "list", scrollY: lastListScrollY }, "");
          activeIndex = item.i;
          viewMode = "article";
          elZurueck.style.display = "inline-block";
          elSuche.hidden = true;
          history.pushState({ view: "article", index: item.i, scrollY: 0 }, "");
          window.scrollTo(0, 0);
          renderAll();
        });
      }
      frag.appendChild(entryEl);
    }
    y += d.afterGap;
  }

  if (SEITE && viewMode === "article" && (SEITE.letztes || SEITE.naechstes)) {   // Blättern, gedruckt
    y += 40;
    const fT = 'italic 400 15px "Newsreader", Georgia, serif';
    for (const [z, lab, rechts] of [[SEITE.letztes, "letztes", false], [SEITE.naechstes, "nächstes", true]]) {
      if (!z) continue;
      ctx.font = fT; const wT = ctx.measureText(z.titel).width; ctx.font = fontDach; const wL = ctx.measureText(lab).width;
      const xT = rechts ? startX + colW - wT : startX, xL = rechts ? startX + colW - wL : startX;
      ctx.save(); ctx.translate(xT, y); ctx.fillStyle = "rgba(0,255,0,0.940)"; ctx.font = fT; ctx.fillText(z.titel, 0, 0); ctx.restore();
      ctx.save(); ctx.translate(xL, y + 18); ctx.fillStyle = "rgba(0,255,0,0.600)"; ctx.font = fontDach; ctx.fillText(lab, 0, 0); ctx.restore();
      if (rebuildDom) { const a = document.createElement("a"); a.className = "tuer"; a.href = z.href; a.textContent = z.titel;
        a.style.left = Math.min(xT, xL) + "px"; a.style.top = (y - 17 + scrollYOffset) + "px";
        a.style.width = Math.max(wT, wL) + "px"; a.style.height = "40px"; frag.appendChild(a); }
    }
    y += 30;
  }

  const totalH = Math.max(window.innerHeight, y + scrollYOffset + 90);
  if (rebuildDom) {
    elDom.innerHTML = "";
    elDom.style.height = totalH + "px";
    elDom.appendChild(frag);
  }
  return totalH;
}

// WebGL setup
const vsSrc = `
  attribute vec2 a_pos;
  varying vec2 v_uv;
  void main() {
    v_uv = a_pos * 0.5 + 0.5;
    v_uv.y = 1.0 - v_uv.y;
    gl_Position = vec4(a_pos, 0.0, 1.0);
  }
`;

const fsSrc = `
  precision mediump float;
  uniform sampler2D u_ink;
  uniform sampler2D u_paper;
  uniform vec2 u_res;
  uniform vec2 u_paperRes;
  uniform float u_sink;
  uniform float u_pore;
  uniform float u_inkStrength;
  uniform float u_titleInk;
  uniform float u_inkBase;
  uniform float u_paperContrast;
  uniform float u_scrollY;
  uniform float u_dark;
  varying vec2 v_uv;

  float luma(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
  }

  void main() {
    vec2 px = v_uv * u_res + vec2(0.0, u_scrollY);
    vec2 pUv1 = px / (u_paperRes * 0.72);
    vec2 pUv2 = vec2(px.y, -px.x) / (u_paperRes * 1.13) + vec2(0.37, 0.61);
    vec2 texel = 1.0 / u_paperRes;

    vec3 paperRaw1 = texture2D(u_paper, pUv1).rgb;
    vec3 paperRaw2 = texture2D(u_paper, pUv2).rgb;
    vec3 paperRaw = mix(paperRaw1, paperRaw2, 0.42);
    vec3 paper = clamp((paperRaw - 0.5) * u_paperContrast + 0.5, 0.0, 1.0);
    float pLum = luma(paper);

    // Paper relief gradient -> physically pulls ink edge into paper valleys
    float pR = luma(mix(texture2D(u_paper, pUv1 + vec2(texel.x * 1.5, 0.0)).rgb, texture2D(u_paper, pUv2 + vec2(0.0, -texel.y * 1.5)).rgb, 0.42));
    float pD = luma(mix(texture2D(u_paper, pUv1 + vec2(0.0, texel.y * 1.5)).rgb, texture2D(u_paper, pUv2 + vec2(texel.x * 1.5, 0.0)).rgb, 0.42));
    vec2 grad = vec2(pR - luma(paperRaw), pD - luma(paperRaw));

    vec2 inkUv = v_uv + grad * (u_sink * 14.0 / u_res);
    vec4 inkSample = texture2D(u_ink, inkUv);
    float inkA = inkSample.a;
    float titleMask = clamp(inkSample.r / max(inkSample.r + inkSample.g, 0.0001), 0.0, 1.0);
    float strength = mix(u_inkStrength, u_titleInk, titleMask);

    // Bright paper peaks break subtly through the ink (less on headings)
    float poreBreak = smoothstep(0.76, 0.90, pLum) * u_pore * mix(1.0, 0.65, titleMask);
    float finalAlpha = clamp(inkA * (1.0 - poreBreak) * min(strength, 1.0) * u_inkBase, 0.0, 1.0);   // 16.11.: Regler „Tinte (Basis)“ zurück

    // Subtle large-scale paper & ink density cloud across the page
    float cloud = sin(px.x * 0.0021 + px.y * 0.0013) * 0.5
                + sin(px.x * 0.0009 - px.y * 0.0027 + 1.7) * 0.5;
    paper = clamp(paper + cloud * 0.012, 0.0, 1.0);
    finalAlpha = clamp(finalAlpha * (1.0 + cloud * 0.04), 0.0, 1.0);

    // Ink shares paper luminance and warm graphite tone; >1.0 adds pigment depth
    float extraDark = max(0.0, strength - 1.0) * 1.4;
    vec3 inkBase = vec3(0.105, 0.095, 0.085) * (1.0 - extraDark);
    vec3 inkLit = inkBase * mix(0.84, 1.16, pLum);

    vec3 lightCol = mix(paper, inkLit, finalAlpha);
    vec3 darkPaper = vec3(0.0863, 0.0863, 0.0824) + (pLum - 0.5) * 0.032 + cloud * 0.008;
    vec3 darkInk = vec3(0.8902, 0.8824, 0.8627) * mix(0.92, 1.04, pLum);
    vec3 darkCol = mix(darkPaper, darkInk, finalAlpha);
    vec3 col = mix(lightCol, darkCol, u_dark);
    gl_FragColor = vec4(col, 1.0);
  }
`;

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

const prog = gl.createProgram();
gl.attachShader(prog, compile(gl.VERTEX_SHADER, vsSrc));
gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsSrc));
gl.linkProgram(prog);
gl.useProgram(prog);

const buf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
const locPos = gl.getAttribLocation(prog, "a_pos");
gl.enableVertexAttribArray(locPos);
gl.vertexAttribPointer(locPos, 2, gl.FLOAT, false, 0, 0);

const inkTex = gl.createTexture();
const paperTex = gl.createTexture();
let paperW = 1280, paperH = 960;

let docHeight = window.innerHeight;
const darkMode = false;   // 16.11. (B14): Dunkelmodus gestrichen, Shader bleibt unverändert

function drawShader() {
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.uniform2f(gl.getUniformLocation(prog, "u_res"), canvas.width, canvas.height);
  gl.uniform2f(gl.getUniformLocation(prog, "u_paperRes"), paperW, paperH);
  const isArt = viewMode === "article";
  // 16.11.: Leseansicht druckt wie die Liste (vorher Einsinken ×0,72, Poren ×0,68, Tinte +0,04 – seit 15.11.)
  const sinkVal = 0.45;
  const poreVal = 0.20;
  const inkVal = 0.90;
  const tinkVal = 1.04;
  gl.uniform1f(gl.getUniformLocation(prog, "u_sink"), sinkVal);
  gl.uniform1f(gl.getUniformLocation(prog, "u_pore"), poreVal);
  gl.uniform1f(gl.getUniformLocation(prog, "u_inkStrength"), inkVal);
  gl.uniform1f(gl.getUniformLocation(prog, "u_titleInk"), tinkVal);
  gl.uniform1f(gl.getUniformLocation(prog, "u_inkBase"), 0.93);   // Startwert der Regler-Fassung vom 15.11.
  gl.uniform1f(gl.getUniformLocation(prog, "u_paperContrast"), 1.0);
  gl.uniform1f(gl.getUniformLocation(prog, "u_scrollY"), shaderY);
  gl.uniform1f(gl.getUniformLocation(prog, "u_dark"), darkMode ? 1.0 : 0.0);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, inkTex);
  gl.uniform1i(gl.getUniformLocation(prog, "u_ink"), 0);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, paperTex);
  gl.uniform1i(gl.getUniformLocation(prog, "u_paper"), 1);

  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

let shaderY = 0;
const elKacheln = document.getElementById("kacheln");
const kacheln = new Map();
let kachelH = 0, kachelHDev = 0, satzBreite = 0, fertig = false;
const RAND = 16;   // Überstand je Kachel, damit Tinte und Papierrelief an den Nähten nicht abreißen

function neuSetzen() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  satzBreite = window.innerWidth;
  kachelH = Math.max(480, Math.round(window.innerHeight));
  kachelHDev = Math.round(kachelH * dpr);
  OPS = [];
  docHeight = layoutDocument(true, 0);
  OPS.sort((a, b) => a.ty - b.ty);
  elKacheln.style.height = docHeight + "px";
  kachelnLeeren();
  fertig = true;
  kachelnSichern();
}

function kachelnLeeren() { for (const c of kacheln.values()) c.remove(); kacheln.clear(); }

function ersteOp(y) {   // erster Auftrag mit ty >= y (binäre Suche)
  let lo = 0, hi = OPS.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (OPS[m].ty < y) lo = m + 1; else hi = m; }
  return lo;
}

function kachelBrennen(i) {
  const topDev = i * kachelHDev, randDev = Math.round(RAND * dpr);
  const W = Math.ceil(satzBreite * dpr), H = kachelHDev + 2 * randDev;
  const obenCss = (topDev - randDev) / dpr;
  off.width = W; off.height = H;
  real.setTransform(dpr, 0, 0, dpr, 0, -obenCss * dpr);
  const bisCss = obenCss + H / dpr;
  for (let k = ersteOp(obenCss - 80); k < OPS.length && OPS[k].ty < bisCss + 80; k++) {
    const o = OPS[k];
    real.save(); real.translate(o.tx, o.ty); real.rotate(o.rot);
    real.fillStyle = o.style; real.font = o.font; real.fillText(o.text, o.ox, o.oy);
    real.restore();
  }
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, inkTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, off);
  canvas.width = W; canvas.height = H;
  shaderY = topDev - randDev;
  drawShader();
  const c = document.createElement("canvas");
  c.width = W; c.height = kachelHDev;
  c.style.top = (topDev / dpr) + "px";
  c.style.width = satzBreite + "px";
  c.style.height = (kachelHDev / dpr) + "px";
  c.getContext("2d").drawImage(canvas, 0, randDev, W, kachelHDev, 0, 0, W, kachelHDev);
  elKacheln.appendChild(c);
  kacheln.set(i, c);
}

let nachRaf = 0;
function kachelnSichern() {
  if (!fertig) return;
  const vh = window.innerHeight, y = window.scrollY;
  const n = Math.max(1, Math.ceil(docHeight * dpr / kachelHDev));
  const sicht0 = Math.max(0, Math.floor(y * dpr / kachelHDev)), sicht1 = Math.min(n - 1, Math.floor((y + vh) * dpr / kachelHDev));
  const a = Math.max(0, sicht0 - 1), b = Math.min(n - 1, sicht1 + 1);
  for (const [i, c] of kacheln) if (i < a - 2 || i > b + 2) { c.remove(); kacheln.delete(i); }
  for (let i = sicht0; i <= sicht1; i++) if (!kacheln.has(i)) kachelBrennen(i);   // Sichtbares sofort
  for (let i = a; i <= b; i++) if (!kacheln.has(i)) {                           // Vorrat: eine je Bild
    kachelBrennen(i);
    if (!nachRaf) nachRaf = requestAnimationFrame(() => { nachRaf = 0; kachelnSichern(); });
    break;
  }
}

function renderViewport() { kachelnSichern(); }
function renderAll() { neuSetzen(); }

let scrollRaf = 0;
window.addEventListener("scroll", () => {
  if (!scrollRaf) {
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      kachelnSichern();
    });
  }
}, { passive: true });

const paperImg = new Image();
paperImg.onload = async () => {
  paperW = paperImg.naturalWidth;
  paperH = paperImg.naturalHeight;
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, paperTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, paperImg);

  await document.fonts.ready;
  renderAll();
  // Zurück aus einem Text: an die Stelle der Liste, von der aus er geöffnet wurde
  try { const y = sessionStorage.getItem("worte_y"); if (y !== null && viewMode === "list") { sessionStorage.removeItem("worte_y"); window.scrollTo(0, +y); kachelnSichern(); } } catch (e) {}
};
paperImg.src = PAPER_B64;

let lastListScrollY = 0;
if ("scrollRestoration" in history) history.scrollRestoration = "manual";
if (!history.state) history.replaceState({ view: "list", scrollY: 0 }, "");

function showListAt(y) {
  viewMode = "list";
  elZurueck.style.display = "none";
  elSuche.hidden = false;
  renderAll();
  window.scrollTo(0, y);
  renderViewport(false);
}

window.addEventListener("popstate", (ev) => {
  const st = ev.state;
  if (st && st.view === "article" && TEXTE[st.index]) {
    activeIndex = st.index;
    viewMode = "article";
    elZurueck.style.display = "inline-block";
    elSuche.hidden = true;
    window.scrollTo(0, st.scrollY || 0);
    renderAll();
  } else {
    const targetY = (st && typeof st.scrollY === "number") ? st.scrollY : lastListScrollY;
    showListAt(targetY);
  }
});

elZurueck.addEventListener("click", () => {
  if (SEITE) { location.href = SEITE.zurueck; return; }
  if (history.state && history.state.view === "article") {
    history.back();
  } else {
    showListAt(lastListScrollY);
  }
});

elSuche.addEventListener("input", renderAll);
// Nur bei geänderter Breite neu setzen; die Höhe springt am Handy mit der Adressleiste.
window.addEventListener("resize", () => { if (window.innerWidth !== satzBreite || Math.min(window.devicePixelRatio || 1, 2) !== dpr) renderAll(); else kachelnSichern(); });
if (SEITE) { elZurueck.style.display = "inline-block"; elSuche.hidden = true; }
if (/[?&]fps\b/.test(location.search)) {
  const el = document.createElement("div"); el.id = "fps"; document.body.appendChild(el);
  let n = 0, t0 = performance.now(), schlecht = 0, last = t0;
  const tick = (t) => { n++; if (t - last > 34) schlecht++; last = t;
    if (t - t0 > 1000) { el.textContent = Math.round(n * 1000 / (t - t0)) + " fps · " + schlecht + " Ruckler"; n = 0; schlecht = 0; t0 = t; }
    requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}
