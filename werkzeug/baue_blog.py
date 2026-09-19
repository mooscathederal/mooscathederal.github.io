#!/usr/bin/env python3
"""Baut aus den Beitragsdateien die Blogseiten der Website.

Quelle:  quellen/blog_beitraege/*.md   (Kopf: titel, untertitel, datum, kennung, bild)
         quellen/bilder/*         (Bilder, beliebige Groesse)
Ziel:    inhalte/blog.html                 (Auswahlseite mit waagerechtem Muehlrad)
         inhalte/blog/<kennung>.html       (je Beitrag eine eigene Seite)
         inhalte/blog/bilder/<name>.webp   (Kacheln, 900 px lange Kante)
         blog/<kennung>.html               (Weiterleitungen fuer die alten Adressen)

Aufruf (im Repo):  python3 werkzeug/baue_blog.py
Dasselbe ruft .github/workflows/bauen.yml bei jedem Push auf main auf.
Braucht nichts Zusaetzliches. Sind markdown, PyYAML und Pillow installiert, nutzt das Skript sie;
sonst greifen Bordmittel (Bilder werden dann unverkleinert uebernommen). Die Ausgabe unterscheidet
sich: Die Bordmittel kennen zum Beispiel keine nummerierten Listen. BLOG_BORDMITTEL=1 erzwingt die
Bordmittel; so baut der Workflow, damit das Ergebnis nicht davon abhaengt, was installiert ist.
"""
import os, re, shutil, sys, unicodedata, html as _html

# Fremdcode ist willkommen, aber nicht nötig: ohne markdown/PyYAML/Pillow greifen Bordmittel.
# BLOG_BORDMITTEL=1 erzwingt die Bordmittel auch dort, wo die Pakete installiert sind.
_BORD = os.environ.get("BLOG_BORDMITTEL") == "1"
try:
    if _BORD: raise ImportError
    import markdown as _md
except ImportError:
    _md = None
try:
    if _BORD: raise ImportError
    import yaml as _yaml
except ImportError:
    _yaml = None
try:
    if _BORD: raise ImportError
    from PIL import Image
except ImportError:
    Image = None

# ---------- Mathe: kleine Teilmenge von LaTeX zu HTML, ohne fremde Bibliothek ----------
ZEICHEN = {
    r"\\sum": "∑", r"\\int": "∫", r"\\infty": "∞", r"\\cdot": "·", r"\\times": "×",
    r"\\leq": "≤", r"\\geq": "≥", r"\\neq": "≠", r"\\approx": "≈", r"\\in": "∈",
    r"\\to": "→", r"\\Rightarrow": "⇒", r"\\rightarrow": "→", r"\\pm": "±",
    r"\\alpha": "α", r"\\beta": "β", r"\\gamma": "γ", r"\\delta": "δ", r"\\epsilon": "ε",
    r"\\theta": "θ", r"\\lambda": "λ", r"\\mu": "μ", r"\\sigma": "σ", r"\\phi": "φ",
    r"\\Delta": "Δ", r"\\Sigma": "Σ", r"\\partial": "∂", r"\\forall": "∀", r"\\exists": "∃",
}

def _mathe(t):
    t = re.sub(r"\\text\{([^{}]*)\}", lambda m: "<span class='wort'>" + _html.escape(m.group(1)) + "</span>", t)
    t = re.sub(r"\\(quad|qquad)", "<span class='luecke'></span>", t)
    t = re.sub(r"\\[;,!:]", "<span class='luecke klein'></span>", t)
    for k, v in ZEICHEN.items(): t = re.sub(k + r"(?![A-Za-z])", v, t)
    t = re.sub(r"_\{([^{}]*)\}", r"<sub>\1</sub>", t)
    t = re.sub(r"\^\{([^{}]*)\}", r"<sup>\1</sup>", t)
    t = re.sub(r"_([A-Za-z0-9])", r"<sub>\1</sub>", t)
    t = re.sub(r"\^([A-Za-z0-9])", r"<sup>\1</sup>", t)
    t = re.sub(r"\\left|\\right", "", t)
    t = re.sub(r"\\([A-Za-z]+)", r"\1", t)          # unbekannte Befehle: Name stehen lassen
    return t.replace("{", "").replace("}", "").strip()

def mathe_ausschneiden(text):
    """$$…$$ und $…$ herausnehmen, damit die Textauszeichnung sie nicht zerlegt."""
    depot = []
    def merke(inhalt, abgesetzt):
        depot.append((inhalt, abgesetzt))
        return f"@@MATHE{len(depot)-1}@@"
    text = re.sub(r"\$\$(.+?)\$\$", lambda m: merke(m.group(1), True), text, flags=re.S)
    text = re.sub(r"(?<!\$)\$([^$\n]+)\$(?!\$)", lambda m: merke(m.group(1), False), text)
    return text, depot

def mathe_einsetzen(html_text, depot):
    for i, (inhalt, abgesetzt) in enumerate(depot):
        gesetzt = _mathe(inhalt.strip())
        ersatz = (f'<div class="formel">{gesetzt}</div>' if abgesetzt
                  else f'<span class="formel">{gesetzt}</span>')
        html_text = html_text.replace(f"@@MATHE{i}@@", ersatz)
    # abgesetzte Formeln stehen sonst in einem Absatz
    html_text = re.sub(r"<p>\s*(<div class=\"formel\">.*?</div>)\s*</p>", r"\1", html_text, flags=re.S)
    return html_text

def _kopf_lesen(text):
    """Einfacher Ersatz für YAML: je Zeile 'schluessel: wert', Anführungszeichen optional."""
    d = {}
    for z in text.split("\n"):
        if not z.strip() or z.lstrip().startswith("#"): continue
        if ":" not in z: continue
        k, w = z.split(":", 1)
        w = w.strip()
        if len(w) >= 2 and w[0] == w[-1] and w[0] in "\"'":
            w = w[1:-1].replace('\\"', '"').replace("\\\\", "\\")
        d[k.strip()] = w
    return d

def _inline(t):
    t = _html.escape(t, quote=False)
    t = re.sub(r"!\[([^\]]*)\]\(([^)\s]+)\)", r'<img src="\2" alt="\1">', t)
    t = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", r'<a href="\2">\1</a>', t)
    t = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"(?<!\*)\*([^*\n]+)\*(?!\*)", r"<em>\1</em>", t)
    t = re.sub(r"_([^_\n]+)_", r"<em>\1</em>", t)
    t = re.sub(r"`([^`]+)`", r"<code>\1</code>", t)
    return t

def _markdown(text):
    """Kleiner Wandler für das, was in den Beiträgen vorkommt."""
    aus, liste = [], False
    absatz = []
    def absatz_schliessen():
        if absatz:
            aus.append("<p>" + _inline(" ".join(absatz).strip()) + "</p>")
            absatz.clear()
    def liste_schliessen():
        nonlocal liste
        if liste: aus.append("</ul>"); liste = False
    for z in text.split("\n"):
        s = z.rstrip()
        if not s.strip():
            absatz_schliessen(); liste_schliessen(); continue
        m = re.match(r"^(#{1,4})\s+(.*)$", s)
        if m:
            absatz_schliessen(); liste_schliessen()
            n = min(len(m.group(1)) + 1, 6)
            aus.append(f"<h{n}>{_inline(m.group(2))}</h{n}>"); continue
        if re.match(r"^\s*([-*_])\1{2,}\s*$", s):
            absatz_schliessen(); liste_schliessen(); aus.append("<hr>"); continue
        if s.lstrip().startswith("> "):
            absatz_schliessen(); liste_schliessen()
            aus.append("<blockquote><p>" + _inline(s.lstrip()[2:]) + "</p></blockquote>"); continue
        m = re.match(r"^\s*[-*+]\s+(.*)$", s)
        if m:
            absatz_schliessen()
            if not liste: aus.append("<ul>"); liste = True
            aus.append("<li>" + _inline(m.group(1)) + "</li>"); continue
        absatz.append(s.strip())
    absatz_schliessen(); liste_schliessen()
    return "\n".join(aus)

BASIS = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))   # Wurzel des Repos
QUELLE = os.path.join(BASIS, "quellen", "blog_beitraege")
BILDER_QUELLE = os.path.join(BASIS, "quellen", "bilder")
WEB = os.path.join(BASIS, "inhalte")
ZIEL = os.path.join(WEB, "blog")
BILDER_ZIEL = os.path.join(ZIEL, "bilder")
KACHEL_PX, QUALITAET = 900, 86

def kennung(text):
    text = text.lower().replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", text)).strip("-") or "beitrag"

def datum_de(d):
    if hasattr(d, "strftime"): return d.strftime("%d.%m.%Y")
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", str(d).strip())
    return f"{m.group(3)}.{m.group(2)}.{m.group(1)}" if m else str(d)

def lies_beitraege():
    beitraege = []
    for f in sorted(os.listdir(QUELLE)):
        if not f.endswith(".md"): continue
        roh = open(os.path.join(QUELLE, f), encoding="utf-8").read()
        m = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)$", roh, re.S)
        if not m:
            print("übersprungen (kein Kopf):", f); continue
        kopf = (_yaml.safe_load(m.group(1)) if _yaml else _kopf_lesen(m.group(1))) or {}
        roh_text, depot = mathe_ausschneiden(m.group(2))
        koerper = (_md.markdown(roh_text, extensions=["extra", "sane_lists"]) if _md
                   else _markdown(roh_text))
        koerper = mathe_einsetzen(koerper, depot)
        titel = str(kopf.get("titel", os.path.splitext(f)[0]))
        beitraege.append(dict(datei=f, titel=titel, untertitel=str(kopf.get("untertitel", "")),
                              datum=kopf.get("datum", ""), datum_text=datum_de(kopf.get("datum", "")),
                              bild=kopf.get("bild", ""), html=koerper,
                              kennung=str(kopf.get("kennung", "")) or kennung(titel)))
    beitraege.sort(key=lambda b: str(b["datum"]), reverse=True)
    return beitraege

def kacheln(beitraege):
    os.makedirs(BILDER_ZIEL, exist_ok=True)
    for b in beitraege:
        if not b["bild"]:
            b["kachel"] = ""; continue
        quelle = os.path.join(BILDER_QUELLE, b["bild"])
        if not os.path.exists(quelle):
            print("Bild fehlt:", b["bild"]); b["kachel"] = ""; continue
        if Image is not None:
            name = os.path.splitext(os.path.basename(b["bild"]))[0] + ".webp"
            im = Image.open(quelle).convert("RGB")
            im.thumbnail((KACHEL_PX, KACHEL_PX), Image.LANCZOS)
            im.save(os.path.join(BILDER_ZIEL, name), "WEBP", quality=QUALITAET, method=6)
        else:                                  # ohne Pillow: Bild unveraendert uebernehmen
            name = os.path.basename(b["bild"])
            shutil.copyfile(quelle, os.path.join(BILDER_ZIEL, name))
        b["kachel"] = name

def schutz(t):
    return (t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;"))

def leiste(beitraege, aktuell, pfad):
    """pfad: Weg von der Seite zum Ordner blog/ ('blog/' von inhalte/blog.html aus, '' von einer Beitragsseite aus)"""
    zeilen = []
    for i, b in enumerate(beitraege):
        aktiv = " aktiv" if b["kennung"] == aktuell else ""
        bild = (f'<img src="{pfad}bilder/{b["kachel"]}" alt="" loading="lazy">' if b["kachel"]
                else f'<span class="ohne-bild"><span>{schutz(b["titel"])}</span></span>')
        zeilen.append(
            f'<li class="kachel{aktiv}" data-i="{i}">'
            f'<a href="{pfad}{b["kennung"]}.html">{bild}'
            f'<span class="kachel-titel">{schutz(b["titel"])}</span>'
            f'<span class="kachel-datum">{b["datum_text"]}</span></a></li>')
    return "\n        ".join(zeilen)

SEITE = """<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{titel_tag}</title>
<meta name="description" content="{beschreibung}">
<meta name="theme-color" content="#ede5e0">
<meta property="og:type" content="article">
<meta property="og:site_name" content="FishdontFly">
<meta property="og:title" content="{og_titel}">
<meta property="og:description" content="{beschreibung}">
<meta property="og:url" content="https://www.fishdontfly.site/{og_pfad}">
{og_bild}<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.png" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="{tiefe}css/blog.css">
</head>
<body class="blog">

<button id="griff" class="griff" aria-expanded="false" aria-controls="leiste" title="Beiträge zeigen">
  <span></span><span></span><span></span>
</button>

<aside id="leiste" class="leiste" aria-label="Beiträge">
  <div class="stapel-fenster">
    <ul class="stapel" data-richtung="{richtung}">
        {kacheln}
    </ul>
  </div>
  <p class="stapel-name" aria-live="polite"><span class="n-titel"></span><span class="n-datum"></span></p>
  <a class="zurueck" href="{tiefe}../index.html">zur Startseite</a>
</aside>

<main class="blatt">
  <article>
    <header>
      <p class="datum">{datum}</p>
      <h1>{titel}</h1>
      {untertitel}
    </header>
    {text}
  </article>
</main>

<script src="{tiefe}blog.js"></script>
</body>
</html>
"""

def raeume_auf(beitraege):
    """Seiten und Kacheln entfernen, zu denen es keinen Beitrag mehr gibt."""
    kennungen = {b["kennung"] + ".html" for b in beitraege}
    kacheln_da = {b["kachel"] for b in beitraege if b["kachel"]}
    for f in os.listdir(ZIEL) if os.path.isdir(ZIEL) else []:
        if f.endswith(".html") and f not in kennungen:
            os.remove(os.path.join(ZIEL, f)); print("entfernt:", "blog/" + f)
    alt = os.path.join(BASIS, "blog")
    if os.path.isdir(alt):
        for f in os.listdir(alt):
            p = os.path.join(alt, f)
            if f.endswith(".html") and f not in kennungen and 'http-equiv="refresh"' in open(p, encoding="utf-8").read():
                os.remove(p); print("entfernt:", "blog/" + f)
    if os.path.isdir(BILDER_ZIEL):
        for f in os.listdir(BILDER_ZIEL):
            if f not in kacheln_da:
                os.remove(os.path.join(BILDER_ZIEL, f)); print("entfernt:", "blog/bilder/" + f)

AUSWAHL = """<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Blog — FishdontFly</title>
<meta name="description" content="Beiträge auswählen.">
<meta name="theme-color" content="#ede5e0">
<meta property="og:type" content="website">
<meta property="og:site_name" content="FishdontFly">
<meta property="og:title" content="Blog — FishdontFly">
<meta property="og:description" content="Beiträge auswählen.">
<meta property="og:url" content="https://www.fishdontfly.site/inhalte/blog.html">
<meta property="og:image" content="https://www.fishdontfly.site/vorschau.jpg">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.png" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="css/blog.css">
</head>
<body class="blog auswahl">

<main class="waehler">
  <div class="stapel-fenster quer">
    <ul class="stapel" data-richtung="quer">
        {kacheln}
    </ul>
  </div>
  <p class="stapel-name" aria-live="polite"><span class="n-titel"></span><span class="n-datum"></span></p>
  <p class="wink">Blättern mit Mausrad, Wischen oder den Pfeiltasten. Klicken öffnet den Beitrag.</p>
  <a class="zurueck" href="../index.html">zur Startseite</a>
</main>

<script src="blog.js"></script>
</body>
</html>
"""

WEITERLEITUNG = ('<!doctype html>\n<html lang="de"><meta charset="utf-8"><title>Weiterleitung</title>'
                 '<meta http-equiv="refresh" content="0;url={ziel}"><link rel="canonical" href="{kanon}">'
                 '<script>location.replace("{ziel}" + location.search + location.hash);</script>'
                 '<a href="{ziel}">Seite öffnen</a></html>\n')

def schreibe(beitraege):
    os.makedirs(ZIEL, exist_ok=True)
    for b in beitraege:
        for tiefe, pfad in (("../", os.path.join(ZIEL, b["kennung"] + ".html")),):
            html = SEITE.format(
                titel_tag=schutz(b["titel"]) + " — FishdontFly",
                beschreibung=schutz(b["untertitel"] or b["titel"]),
                og_titel=schutz(b["titel"]), og_pfad="inhalte/blog/" + b["kennung"] + ".html",
                og_bild=(f'<meta property="og:image" content="https://www.fishdontfly.site/inhalte/blog/bilder/{b["kachel"]}">\n'
                         if b["kachel"] else '<meta property="og:image" content="https://www.fishdontfly.site/vorschau.jpg">\n'),
                tiefe=tiefe, richtung="laengs", kacheln=leiste(beitraege, b["kennung"], ""),
                datum=b["datum_text"], titel=schutz(b["titel"]),
                untertitel=(f'<p class="untertitel">{schutz(b["untertitel"])}</p>' if b["untertitel"] else ""),
                text=b["html"])
            open(pfad, "w", encoding="utf-8").write(html)
    # Alte veröffentlichte URLs weiter bedienen.
    legacy = os.path.join(os.path.dirname(WEB), "blog")
    os.makedirs(legacy, exist_ok=True)
    for b in beitraege:
        k = b["kennung"]
        with open(os.path.join(legacy, k + ".html"), "w", encoding="utf-8") as f:
            f.write(WEITERLEITUNG.format(ziel="../inhalte/blog/" + k + ".html",
                                         kanon="https://www.fishdontfly.site/inhalte/blog/" + k + ".html"))
    # Einstieg: Auswahlseite mit waagerechtem Muehlrad
    html = AUSWAHL.format(kacheln=leiste(beitraege, "", "blog/"))
    open(os.path.join(WEB, "blog.html"), "w", encoding="utf-8").write(html)

if __name__ == "__main__":
    if not os.path.isdir(QUELLE): sys.exit("Ordner fehlt: " + QUELLE)
    b = lies_beitraege()
    if not b: sys.exit("Keine Beiträge gefunden in " + QUELLE)
    kacheln(b)
    schreibe(b)
    raeume_auf(b)
    print(f"{len(b)} Beiträge gebaut -> inhalte/blog.html und inhalte/blog/*.html")
    for x in b: print(f"  {x['datum_text']}  {x['titel']}  ({x['kennung']}.html)")
