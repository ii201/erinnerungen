# Erinnerungen

Ein schlanker Ersatz für Microsoft To Do, der **komplett im Browser** läuft (Chrome oder Edge).
Es wird nichts installiert und nichts an Windows verändert.

## Funktionen

- Erinnerungen mit Datum und Uhrzeit anlegen
- **Pop-up zur Erinnerungszeit**: als Windows-Benachrichtigung und als Fenster in der App, mit Ton
- Direkt im Pop-up: *Erledigt*, *+15 Min*, *+1 Std*, *Morgen*, *Nächste Woche* oder *Öffnen*
- **Bemerkungen & Verlauf**: Jede Aktualisierung wird mit Datum und Uhrzeit gespeichert
- Ansichten: **Heute** (inkl. Überfällige), **Geplant** (Zukunft), **Alle offenen**, **Erledigt**
- **Suche** in Titeln und Bemerkungen, offen und erledigt
- Tagesübersicht morgens (einmal am Tag)
- Wichtig-Markierung (★)
- **Import** aus Outlook (CSV), Microsoft To Do (über den Graph Explorer) oder als einfacher Text
- **Sicherung** als Datei, Export als Excel-Tabelle (CSV)

Tastatur: `/` öffnet die Suche, `n` legt eine neue Erinnerung an, `Esc` schließt Details, `Strg + Enter` speichert eine Bemerkung.

## Einrichtung auf dem Arbeitsrechner (einmalig)

1. Die Adresse der App öffnen (GitHub Pages, siehe unten) und als Lesezeichen speichern.
2. Oben auf **„Benachrichtigungen aktivieren“** klicken und im Browser **„Zulassen“** wählen.
3. Den Tab **anheften**: Rechtsklick auf den Tab → *Anheften*. Der Tab muss offen bleiben, damit Pop-ups kommen.
4. Dafür sorgen, dass der Browser den Tab nicht „schlafen legt“:
   - **Edge:** Einstellungen → *System und Leistung* → *Schlafende Registerkarten* → bei *„Diese Websites niemals in den Ruhezustand versetzen“* die Adresse hinzufügen.
   - **Chrome:** Einstellungen → *Leistung* → *Arbeitsspeicher-Sparmodus* → bei *„Diese Websites immer aktiv lassen“* die Adresse hinzufügen.
5. Unter **Einstellungen → „Test-Erinnerung in 1 Minute“** prüfen, ob das Pop-up kommt. Dabei gern in einen anderen Tab oder ein anderes Programm wechseln.
6. Optional: Bisherige Erinnerungen über **Importieren** übernehmen. Die Schritt-für-Schritt-Anleitung steht direkt im Import-Fenster.

Verpasste Erinnerungen, etwa bei geschlossenem Browser, erscheinen beim nächsten Öffnen sofort.

## Wo liegen die Daten?

Die Erinnerungen werden **nur im Browser dieses Rechners** gespeichert (localStorage). GitHub stellt nur das Programm bereit, die Daten werden **nicht** zu GitHub hochgeladen.

- Normales „Cache leeren“ löscht sie nicht. *„Cookies und andere Websitedaten löschen“* oder ein Zurücksetzen des Browsers durch die IT dagegen schon.
- Deshalb erinnert die App alle 7 Tage an eine **Sicherung**. Die Datei am besten auf OneDrive oder einem Netzlaufwerk ablegen.
- Wiederherstellen: *Importieren* → Sicherungsdatei auswählen → *Zusammenführen* oder *Alles ersetzen*.

## Veröffentlichen über GitHub Pages

1. Repository auf GitHub → *Settings* → *Pages*.
2. *Source*: **Deploy from a branch**, Branch **main**, Ordner **/ (root)** → *Save*.
3. Nach ca. 1 Minute ist die App erreichbar unter `https://<benutzername>.github.io/<repository>/`.

Änderungen am Code werden nach einem Push automatisch veröffentlicht.

## Dateien

| Datei | Zweck |
|---|---|
| `index.html` | Seitenaufbau |
| `styles.css` | Gestaltung (hell/dunkel automatisch) |
| `app.js` | Die gesamte Logik: Speichern, Ansichten, Pop-ups, Import/Export |
| `sw.js` | Service Worker für die Knöpfe direkt in der Windows-Benachrichtigung |
| `icon.svg` | Symbol |

## Später erweiterbar

Das Datenformat (siehe Sicherungsdatei) ist bewusst einfach gehalten, mit eindeutiger ID und Änderungszeitpunkt pro Eintrag.
Damit lässt sich später ohne Datenverlust umsteigen:

- **Variante B (Cloud-Speicher, z. B. Supabase oder ein privates GitHub-Repository):** Synchronisation über mehrere Geräte. Die vorhandene Sicherungsdatei wird dabei einfach importiert.
- **Variante C (fertiges Tool):** Export als CSV, das die meisten Aufgaben-Tools importieren können.
