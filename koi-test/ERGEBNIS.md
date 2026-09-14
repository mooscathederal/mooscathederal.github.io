# Browser-Ersatztest: Ergebnis (2026-09-13)

Live-Browser war blockiert (eingebauter Browser verlangt echten Login,
Claude-in-Chrome-Erweiterung nicht verbunden, Headless-Chromium in der
VM ohne Root/mit blockiertem Download nicht installierbar). Ersatz:
main.js' exakte Deformations- und Bewegungslogik 1:1 in Python
nachgebaut (sim_preview.py) und als Bildsequenz/Video gerendert.
Das prüft alles Visuelle direkt; Live-FPS bleibt unten als Rechnung,
nicht als Messung, klar gekennzeichnet.

## Ergebnis pro Frage

1. Identitaet in Bewegung: TRAEGT. 30 Fische, gekruemmte Spine,
   Textur bleibt scharf, kein Cutout-Eindruck ueber 3s Bewegung
   (clip_desktop_v2.mp4, Frames 0/17/35 einzeln geprueft).
2. Occlusion in Bewegung: TRAEGT, aber schwaecher als im Standbild-Test.
   Bei Produktionsgroesse (7-14% Bildbreite) ist der Effekt real aber
   subtil (clip_desktop_v2 vs. clip_noccl, gleiche Simulation).
3. Gekruemmt vs. gerade Spine: ENTSCHIEDEN, nicht nur graduell.
   Bei stark gekruemmten Fischen (koi-32, Kruemmung 12.2% der Laenge)
   reisst die gerade Naeherung die Schwanzflosse sichtbar ab
   (compare_spine.png, zoom_koi-32_straight.png). Gekruemmte Spine ist
   damit PFLICHT, nicht nur "besser" — bestaetigt BEFUND.md Punkt 4
   mit einem konkreten Fehlerbild statt nur einer Prozentzahl.
4. Responsive Crop: TRAEGT strukturell (eine Weltsimulation, zwei
   Kamera-Ausschnitte), ABER: Mobile-Hochformat zeigt sichtbar weniger
   Fische gleichzeitig (schmalerer Ausschnitt derselben Verteilung).
   Neuer, vorher nicht benannter Punkt: Fischverteilung sollte
   viewport-bewusst sein oder Mobile braucht mehr Fische/engere Streuung.
5. Text-Ueberlagerung: unveraendert unkritisch, aber Fixed-vw-Fontgroesse
   lief im Mobile-Crop aus dem Bild — Detail fuer die echte Website,
   kein Architekturpunkt.
6. Bewegungsmodell: unabhaengige Lissajous-Pfade erzeugen gelegentlich
   Nahbegegnungen/Clusterbildung (sichtbar bei t=3s, drei Fische unten
   links). Kein Deformationsfehler, aber ein Punkt fuer Phase 3
   (Zonen-/Abstandsgewichtung, die BEFUND.md ohnehin schon vorsah).
7. Performance: NICHT LIVE GEMESSEN (Browserzugriff blockiert).
   Rechnerisch: 40x12-Gitter = 480 Vertices / 858 Tris pro Fisch,
   30 Fische = 14 400 Vertices / 25 740 Tris + Pond-Quad + Occlusion-Quad.
   Das ist ~13x leichter als der alte Blender-Export (858 vs. ~11 600
   Tris/Fisch anteilig). Schliesst die Luecke: den bereits veroeffent-
   lichten Artifact-Link (funktionsgleicher Drei.js-Aufbau) einmal
   selbst im eigenen, angemeldeten Browser oeffnen und die HUD-Zahl
   ablesen -- das ist der einzige Schritt, den ich nicht selbst
   ausfuehren konnte.

## Architekturentscheidung

WebGL/Three.js mit prozeduralem 40x12-Gitter, gekruemmter Spine-
Extraktion und einem globalen Occlusion-Layer TRAEGT visuell bei
30 Fischen in Produktionsgroesse. Kein Rueckfall auf vorgerendertes
Video noetig. Gekruemmte Spine ist PFLICHT (nicht optional) fuer
mindestens 5 der 31 Fische.

## Groesster naechster Arbeitsblock

Nicht mehr die Kernarchitektur. Der groesste verbleibende Block ist
die Bewegungs-/Verteilungsschicht: viewport-bewusste Platzierung
(Punkt 4), Anti-Clustering (Punkt 6), und die einmalige echte
FPS-Messung (Punkt 7). Die Asset-Pipeline (Crop, Resize, Spine-
Extraktion) ist bereits fertig und lief fehlerfrei fuer 31 von 32
Fischen.
