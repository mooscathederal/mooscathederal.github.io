#!/usr/bin/env python3
"""Prueft eine gebaute Seite: Fuehren alle Verweise auf Dateien, die es gibt?

Aufruf:  python3 werkzeug/pruefe_seite.py <ordner>

Geprueft wird in allen .html-Dateien: href und src (a, link, script, img ...), meta refresh,
og:image, og:url sowie Adressen der eigenen Domain. Nicht geprueft: fremde Adressen, mailto:,
javascript:, data: und reine #-Anker. Was Skripte erst zur Laufzeit laden, sieht die Pruefung nicht.
Der Workflow ruft das vor dem Veroeffentlichen auf; bei einem Fehlbefund (Exit-Code 1) geht nichts online.
"""
import os, re, sys
from html.parser import HTMLParser
from urllib.parse import urlsplit, unquote

DOMAIN = "www.fishdontfly.site"


class Sammler(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.verweise = []

    def handle_starttag(self, tag, attrs):
        a = {k: v for k, v in attrs if v is not None}
        for k in ("href", "src"):
            if a.get(k):
                self.verweise.append(a[k])
        if tag == "meta":
            if a.get("http-equiv", "").lower() == "refresh":
                m = re.search(r"url\s*=\s*(.+)$", a.get("content", ""), re.I)
                if m:
                    self.verweise.append(m.group(1).strip().strip("'\""))
            if a.get("property") in ("og:image", "og:url") and a.get("content"):
                self.verweise.append(a["content"])


def ziel_von(seite_rel_dir, verweis):
    """Gibt den Pfad relativ zur Seitenwurzel zurueck, oder None, wenn nichts zu pruefen ist."""
    verweis = verweis.strip()
    if not verweis or verweis.startswith(("#", "mailto:", "tel:", "javascript:", "data:")):
        return None
    u = urlsplit(verweis)
    if u.scheme in ("http", "https"):
        if u.netloc.lower() != DOMAIN:
            return None
        rel = u.path.lstrip("/")
    elif u.scheme or u.netloc:
        return None
    else:
        if not u.path:
            return None
        if u.path.startswith("/"):
            rel = u.path.lstrip("/")
        else:
            rel = os.path.normpath(os.path.join(seite_rel_dir, u.path))
    return unquote(rel)


def existiert(wurzel, rel):
    if rel == ".." or rel.startswith("../"):
        return False
    voll = os.path.join(wurzel, rel)
    if os.path.isdir(voll):
        return os.path.isfile(os.path.join(voll, "index.html"))
    return os.path.isfile(voll)


def main():
    if len(sys.argv) != 2 or not os.path.isdir(sys.argv[1]):
        sys.exit(__doc__)
    wurzel = os.path.abspath(sys.argv[1])
    seiten, fehlt = 0, []
    for ordner, _, dateien in os.walk(wurzel):
        for name in sorted(dateien):
            if not name.endswith(".html"):
                continue
            seiten += 1
            pfad = os.path.join(ordner, name)
            s = Sammler()
            s.feed(open(pfad, encoding="utf-8").read())
            rel_dir = os.path.relpath(ordner, wurzel)
            for v in s.verweise:
                rel = ziel_von(rel_dir, v)
                if rel is not None and not existiert(wurzel, rel):
                    fehlt.append((os.path.relpath(pfad, wurzel), v))
    print(f"{seiten} Seiten geprueft.")
    if fehlt:
        print(f"FEHLER: {len(fehlt)} Verweise fuehren ins Leere:")
        for seite, v in fehlt[:60]:
            print(f"  {seite}  ->  {v}")
        if len(fehlt) > 60:
            print(f"  ... und {len(fehlt) - 60} weitere")
        sys.exit(1)
    print("Alle Verweise erreichen eine Datei.")


if __name__ == "__main__":
    main()
