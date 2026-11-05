# Print Maps

Web maps normally don't print well, as their resolution is much lower than
normal print resolution, not to mention the various other unwanted text and
elements that print along with the map. Print Maps changes that by leveraging
[Mapbox GL JS](https://github.com/mapbox/mapbox-gl-js) to render print
resolution maps in the browser.

## Future updates

Due to Mapbox's new [anti-FOSS stance](https://github.com/mapbox/mapbox-gl-js/releases/tag/v2.0.0),
Mapbox GL JS will not be updated past v1.13. Please reach out to Mapbox to
express your displeasure with this stance. Maintenance on this repository will
continue as long as fixes can be made without updating Mapbox GL JS.

## Options

* Inches or millimeters
* PNG or PDF output (PDF page size matches the entered width and height)
* Choice of map styles
* Height and width settings
* Multi-page DIN A0–A4 PDF posters, with a sheet grid, orientation, adjustable 0–30 mm overlap and assembly marks
* DPI setting
* Local print scale, presets and an optional scale bar

## Druckmaßstab und Maßstabsleiste

Im Feld **Maßstab 1 :** den Nenner eingeben, zum Beispiel `25000`, oder einen
gängigen Maßstab auswählen. Freie positive Werte sind möglich. Das Feld wird
beim Laden aus der tatsächlichen Kamera initialisiert; Zoom wird nur noch als
berechneter, schreibgeschützter Wert angezeigt. Intern bleiben Maßstab und
Koordinaten ungerundet.

Beim Verschieben bleibt der gewählte Maßstab erhalten: Der Zoom folgt dem
Breitengrad. Das gilt auch für Koordinateneingaben und Geolokalisierung.
Absichtliches Zoomen per Mausrad, Touch-Geste, Tastatur oder Zoomtasten setzt
dagegen einen neuen Sollmaßstab, der beim nächsten Verschieben erhalten bleibt.
Neigung ist deaktiviert, Drehung in der Kartenebene bleibt möglich. Nicht
erreichbare Maßstäbe werden mit dem tatsächlichen Maßstab und einer Fehlermeldung
angezeigt; Leiste und Export bleiben dann deaktiviert, bis Maßstab oder Ort passen.

Mercator hat einen **lokalen Maßstab am Kartenmittelpunkt**. Er gilt nicht
gleichmäßig über große Nord-Süd-Ausdehnungen. Für die flache Ansicht mit
512-Pixel-Kacheln und den bisherigen 96 CSS-Pixeln pro Zoll gilt:

```
M = (40075016.68557849 / 512) * cos(latitude * PI / 180)
    * (96 / 0.0254) / 2^zoom
```

Bei 50,85° Nord entspricht 1:25.000 etwa Zoom 12,867. A4 quer mit 297 × 210 mm
zeigt bei diesem Maßstab lokal ungefähr 7,425 × 5,250 km. Papiergröße verändert
den Ausschnitt, DPI verändert die Pixelzahl; beide verändern nicht den Sollmaßstab.
Rasterabmessungen werden auf ganze Pixel gerundet.

**Maßstabsleiste mitdrucken** blendet dieselbe schwarz-weiße Leiste in Vorschau,
PNG und PDF ein. Die Entfernung wird in 1-/2-/5-Schritten gewählt, in m oder km
beschriftet und mit der Verhältniszahl ergänzt. Die Leiste steht oben links,
mit Abstand zu Rand, Navigation und Quellenangaben am unteren Kartenrand. Kleine
Papierformate erhalten eine kompaktere Leiste. Abstände, Schrift und Linien
skalieren mit der Druckauflösung: 500 m bei 1:25.000 sind immer 20 mm lang,
bei 150 DPI etwa 118,11 Pixel, bei 300 DPI etwa 236,22 Pixel.

**Für den angegebenen Maßstab mit 100 % / tatsächlicher Größe drucken.**
Im PDF-Druckdialog keine Anpassung an das Blatt wählen. Bei PNG zusätzlich die
eingegebene physische Papiergröße im Druckprogramm setzen; PNG-DPI-Metadaten
werden vom Browser nicht zuverlässig entsprechend der gewählten DPI geschrieben.
Quellenangaben bleiben erforderlich; die bestehenden Hinweise unter der Karte
gelten weiterhin auch für den Ausdruck.

Der Export wartet auf die fertig gerenderte Karte und kopiert sie auf einen
separaten 2D-Canvas. Erst dort wird die optionale Leiste gezeichnet. PNG und PDF
verwenden dieses gemeinsame Bild. Kartenressourcenfehler oder eine Wartezeit über
45 Sekunden brechen den Export mit einer Meldung ab und räumen temporäre Elemente
auf. Sehr große Exporte sind durch WebGL-Limits und 64 Megapixel begrenzt; auf
einem Raspberry Pi können die verfügbaren Speicherreserven zusätzlich begrenzen.

## Mehrseitiger Posterdruck

Unter **Ausgabegröße festlegen → Blattraster (mehrseitiges PDF)** die Anzahl der
**Spalten** (nebeneinander) und **Zeilen** (untereinander), das Druckformat
**DIN A0, A1, A2, A3 oder A4** sowie **Hochformat / Querformat** wählen.
Die **Überlappung (mm)** lässt sich von **0 bis 30 mm** einstellen, auch mit
Nachkommastellen. Standard sind weiterhin **15 mm**. Vorschau, Kartenfläche,
Passmarken und PDF-Montagehinweise berücksichtigen den gewählten Wert.
Zum Beispiel ergeben **3 Spalten × 2 Zeilen, DIN A4 Hochformat** ein PDF mit
genau sechs Seiten. Die bisherige Eingabe von Breite und Höhe bleibt als
separater Modus erhalten; im Rastermodus ist PDF fest eingestellt.

Jedes Blatt hat **10 mm weißen Rand**, damit Schnittmarken, Passkreuze,
Blattnummer und Nachbarn auf üblichen Druckern Platz finden. Innerhalb dieser
Ränder wiederholt sich die gewählte Überlappung auf jedem benachbarten Blatt.
Die zusammengefügte Kartenfläche beträgt deshalb
`Spalten × (Blattbreite − 20 mm) − (Spalten − 1) × Überlappung` und entsprechend für
die Höhe. Beim Beispiel mit 15 mm sind das **540 × 539 mm** ohne Außenrand. Die Vorschau
zeigt die gesamte Karte mit Blattgrenzen und gelben Überlappungsstreifen; die
Zusammenfassung nennt Seitenzahl und fertige Kartenfläche.

Die PDF-Seiten sind zeilenweise von links nach rechts geordnet und mit
**Z1-S1, Z1-S2, …** beschriftet. **Einseitig mit 100 % / tatsächlicher Größe**
drucken, ohne Anpassung an das Papier. An inneren Verbindungen den linken bzw.
oberen weißen Rand des nächsten Blatts an den Schnittmarken abschneiden, den
Kartenstreifen in der gewählten Überlappungsbreite auf den entsprechenden Streifen des Nachbarblatts legen
und gleiche Passkreuze deckungsgleich ausrichten. Zuerst die Zeilen, dann die
Zeilen untereinander zusammenkleben. Außenränder am Schluss abschneiden. Die
PDF-Ränder enthalten ebenfalls die Montageanleitung und Nachbarbezeichnungen.
Bei **0 mm** die Kartenkanten bündig aneinanderlegen und die verbleibenden
weißen Ränder als Klebelaschen unterlegen; es gibt keine doppelte Kartenfläche.

Alle Blätter verwenden dieselbe Mercator-Projektion, denselben Zoom und dieselbe
Drehung. Der Maßstab bezieht sich weiterhin auf den **Mittelpunkt der gesamten
Karte**; er wird nicht an jedem Blatt neu gesetzt, damit die Übergänge passen.
Die verkleinerte Rastervorschau berücksichtigt ihre Darstellungsgröße bei der
Maßstabssteuerung. Die optionale Maßstabsleiste erscheint einmal oben links auf
dem Poster; Quellenangaben stehen auf jedem Blatt und einmal im fertigen Bild.

Die Blätter werden nacheinander gerendert und die jeweiligen WebGL-Kontexte
anschließend freigegeben. Blattanzahl und Postergröße erfordern deshalb keinen
riesigen Gesamt-Canvas. Zulässig sind jeweils 1–10 Spalten und Zeilen, begrenzt
durch Geräteauflösung, 64 Megapixel pro Blatt und 256 Megapixel pro PDF.
Bei zu hoher DPI erscheint die für das Raster zulässige Auflösung. Große
DIN-Formate können deshalb eine niedrigere DPI erfordern; beispielsweise ist
A0 mit 150 DPI auf entsprechend leistungsfähigen Geräten möglich. Das Raster
verändert weder den gewählten Maßstab noch die eingegebenen Einzelmaße.

### Entwicklung und Tests

Weiterhin reines HTML/CSS/JavaScript: keine Build-Werkzeuge oder neuen
Laufzeitpakete. Das Verzeichnis kann unverändert über Apache auf einem Raspberry
Pi ausgeliefert werden. Der Browser benötigt WebGL und Zugang zu den bisherigen
Karten-/CDN-Diensten; deren Authentifizierungsbedingungen gelten weiterhin.

Rechen- und Zustandstests mit Node (nur zur Entwicklung erforderlich):

```
node --test tests/print-scale.test.js
node --test tests/print-tiles.test.js
node --test tests/print-export.test.js
```

`print-tiles` prüft DIN-Maße, Überlappungsgeometrie, Drehung, Datumsgrenze und
Passmarken. `print-export` prüft mit DOM-/Mapbox-/jsPDF-Testdoubles den gesamten
Exportablauf, die Seitenreihenfolge, Geräte-/Speichergrenzen und die Bereinigung
nach Fehlern. Diese Tests ersetzen keinen echten WebGL-/PDF-Browsertest.

Optionaler Browser-/Exporttest mit installiertem Playwright und Chromium:
Webserver im Projektverzeichnis starten, dann in einer zweiten Shell ausführen:

```
python3 -m http.server 8000 --bind 127.0.0.1
node tests/browser.cjs
```

`CHROMIUM` überschreibt den Browserpfad (Standard `/usr/bin/chromium`).
`PRINT_MAPS_TEST_URL` überschreibt die Serveradresse. Der Test verwendet die echte
Mapbox-GL-1.13-WebGL-Kamera, native Maus-/Touch-Eingaben und die echten
Exportbibliotheken, aber einen lokalen GeoJSON-Teststil statt externer Kartendaten.
Optional kann `PRINT_MAPS_TEST_ASSETS` auf einen lokalen Cache der unveränderten
Dateien `mapbox-gl.js`, `mapbox-gl.css`, `FileSaver.min.js` und `jspdf.min.js`
zeigen. Ohne Cache müssen die bisherigen CDN-Adressen vom Browser erreichbar
sein. Testbilder und PDFs landen in `/tmp/print-maps-browser` (überschreibbar mit
`PRINT_MAPS_TEST_OUTPUT`). Provider-Authentifizierung und echte Drucker sind damit
nicht getestet.

Die laufende Maßstabskorrektur ist gezielt an Mapbox GL **1.13.0** gebunden:
`jumpTo`/`setZoom` stoppen dort aktive Gesten. `PrintScale.Controller` verwendet
deshalb die Transform-Setter und `_update(true)` dieser Version für die aktuelle
Kameraposition, Kacheln und zoomabhängige Stile und bewahrt beim Ziehen den Punkt
unter dem Zeiger. Eigene Korrekturen erzeugen keine
neuen Kameraereignisse. Bei einem Bibliothekswechsel müssen insbesondere Gesten,
Zoom-Erkennung und dieser Adapter erneut geprüft werden.

## Building

Add your Mapbox access token to `js/script.js`, run a local webserver such as
`python3 -m http.server`, and open `index.html`.

## Attribution

Attribution of maps is required. See tile provider terms for details.

## License

Print Maps is distributed under the MIT License. For more information, read the
file `COPYING` or peruse the license
[online](https://github.com/mpetroff/print-maps/blob/master/COPYING).

## Credits

* [Matthew Petroff](http://mpetroff.net/), Original Author
* [Mapbox GL JS](https://github.com/mapbox/mapbox-gl-js)
* [FileSaver.js](https://github.com/eligrey/FileSaver.js/)
* [canvas-toBlob.js](https://github.com/eligrey/canvas-toBlob.js)
* [jsPDF](https://github.com/MrRio/jsPDF)
* [Bootstrap](http://getbootstrap.com/)
