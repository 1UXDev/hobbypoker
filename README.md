# Hobbypoker

Deutschsprachiges Texas Hold’em für private Runden mit Spielchips. Node.js 22 oder neuer, keine externen Abhängigkeiten.

```sh
cd /workspace/hobbypoker
npm test
npm start
```

Standardport: 3000; alternativ `PORT=8080 npm start`. Für Entwicklung: `npm run dev`.

Raum mit einem Namen eröffnen, Raumcode teilen oder als Gastgeber bis zu sechs KI-Gegner hinzufügen. Zwei bis acht Plätze, 1.000 Startchips, Blinds 10/20. Der Gastgeber startet die erste Hand; nach jedem Ergebnis folgt die nächste Hand automatisch nach zehn Sekunden, solange mindestens zwei Spieler Chips haben. Ein sichtbarer Countdown zeigt die zehn Sekunden lange Ergebnispause. Auch der Gastgeber kann sie nicht verkürzen, damit alle Spieler die Hände ansehen können. Bei weniger als zwei finanzierten Plätzen stoppt die automatische Folge ohne Rebuy. Verliert der einzige menschliche Spieler gegen die KI seinen gesamten Stack, erscheint stattdessen ein Niederlagenbildschirm. „Neue Partie starten“ setzt alle Stacks auf 1.000 und die KI-Stimmungen zurück, behält Gegner und Raum bei und teilt sofort neu aus. Check, Call, Fold, volle Raises, All-in per eigenem Button, Showdown und Side Pots werden serverseitig verarbeitet. All-ins sind auch unterhalb des Mindest-Raises möglich. Eine kurze All-in-Erhöhung öffnet das Raise-Recht für bereits handelnde Spieler erst wieder, wenn sich die Erhöhungen zu einem vollständigen Raise summieren.

## KI-Persönlichkeiten

Sechs regelbasierte Poker-Archetypen (Nit, TAG, LAG, Calling Station, Maniac und Rock) unterscheiden sich in Risikoaversion, Bluffrate, Tilt nach Verlusten, Aggressivität nach Gewinnen und Einsatzstufen (20/50/100 Chips). Die Stimmung entwickelt sich über mehrere Hände und klingt mit Faktor 0,65 ab. Die KI kennt nur ihre eigenen Karten und öffentliche Informationen; sie ist kein trainiertes Pokermodell. Zusätzlich steuern Range-Enge, Aggression, Callneigung und Position die Entscheidungen. Die Profile geben eine Richtung vor, keine festen Aktionsschwellen: Pro Hand variieren Spielbreite, Aggressivität, Bluffneigung und Einsatzgröße in begrenzten Bereichen; einzelne Entscheidungen werden gewichtet zufällig getroffen. Auch der Rock verteidigt gelegentlich günstige Hände oder blufft selektiv. Die Persönlichkeiten bleiben intern: Am Tisch werden weder Stil noch Verhaltensparameter der KI angezeigt. „Batch-betting“ bedeutet hier auf feste Chipstufen gerundete Einsätze, begrenzt durch Stack und Mindest-Raise.

## Mobile Nutzung

Ab 1.100 Pixel Breite passen Board, bis zu acht kompakte Spielerplätze und die seitlichen Aktionen in ein Desktop-Fenster (geprüft ab 1280 × 720). Auf dem Smartphone stehen Board, eine horizontal wischbare Spielerleiste und die eigene Hand mit Aktionen kompakt untereinander. Die Leiste folgt dem aktiven Spieler. Die wichtigsten Touch-Ziele sind mindestens 44 Pixel hoch, Eingabefelder nutzen 16-Pixel-Schrift. Zusätzliche Erklärungen und Ergebnisse öffnen in schließbaren Fenstern.

## Spielanzeigen und Einsatzhilfen

Der aktuelle Einsatz erscheint groß und goldfarben, der verbleibende Stack ist nachgeordnet. Dealer sowie Small Blind und Big Blind sind mit D, SB und BB markiert. Unter jedem Stack steht die Nettoänderung der letzten abgeschlossenen Hand (Auszahlung minus alle Einsätze dieser Hand); während der nächsten Hand bleibt sie zur Orientierung stehen. Daneben steht „Gesamt“: die Summe der Nettoergebnisse aller abgeschlossenen Hände dieser Partie. Aktuelle Einsätze verändern diese Bilanz erst beim Abschluss der Hand; ein Partieneustart setzt sie auf null zurück. Ein großes, schließbares Gewinnerfenster nennt Namen, Pokerhand und Auszahlung. Beim Showdown zeigt es die beiden Spielerkarten und die tatsächlichen besten fünf Karten, mit Markierungen für Hand- und Board-Karten. „Gewinnhand ansehen“ öffnet das Ergebnis erneut; beim nächsten Austeilen schließt es automatisch. Auch im Niederlagenbildschirm ist die Gewinnhand abrufbar. Gewinne ohne Showdown decken keine fremden Karten auf. Geteilte Pots und mehrere Side-Pot-Gewinner werden einzeln angezeigt. Ungecallte Einsätze werden zurückgegeben und nicht als gewonnener Pot gezählt. Handnamen werden nur für die eigenen oder beim Showdown aufgedeckten Karten angezeigt.

Unter den eigenen Karten steht eine geschätzte Gewinnchance (Showdown-Equity inklusive geteilter Pots). Ein Web Worker simuliert 400 zufällige Verteilungen anhand der eigenen Karten, des öffentlichen Boards und der Zahl aktiver Gegner. Die Schätzung kennt keine verdeckten Gegnerkarten, ignoriert zukünftige Folds und Einsätze sowie Side Pots und kann durch die Stichprobe schwanken.

Ab dem Flop zeigt ein kompakter Draw-Hinweis mögliche Verbesserungen, konkrete Kartenwerte beziehungsweise Farben und Outs. Ein Klick öffnet die Chancen auf die nächste Karte und die beste Kombination am River. Diese Werte entstehen durch exaktes Aufzählen der unbekannten Karten und Runouts, nicht durch Zugriff auf Gegnerkarten. Beispiel: 8♦ 7♥ auf 2♦ 10♣ 9♠ hat einen Straight-Draw mit 6 oder J, acht Outs, 17,0 % auf die nächste Karte und 31,5 % am River. Straight und Flush schließen Straight Flush ein; diese Kategorien dürfen sich daher überschneiden. Eine mögliche Kombination ist keine garantierte Gewinnerhand.

All-in liegt zurückhaltend unter **Weitere Einsatzoptionen**. „All-in vorbereiten“ öffnet eine separate Bestätigung mit Fokus auf **Abbrechen**; erst die ausdrückliche Bestätigung setzt den Stack und zeigt die Animation. Auch ein Call, manueller Raise oder Pot-Shortcut, der alle verbleibenden Chips verbraucht, benötigt diese Bestätigung. Ein Raise ist nur mit offenem Raise-Recht möglich; ein All-in-Call bleibt erlaubt. Die Buttons **½ Pot**, **Pot** und **2× Einsatz** setzen den angezeigten Betrag sofort. Das Feld „Erhöhen auf“ mit **Setzen** bleibt für frei gewählte Beträge verfügbar. Pot-Raises berücksichtigen zuerst den noch zu callenden Betrag: Ziel = aktueller Einsatz + Anteil × (Pot + Call). Grenzen für Stack und Mindest-Raise gelten auch für die Presets; ohne gegnerischen Einsatz ist „2× Einsatz“ deaktiviert.

KI-Spieler überlegen ungefähr zwei Sekunden. Danach bleibt jeder angenommene Spielzug eine Sekunde sichtbar, bevor der nächste Spieler oder die nächste Street folgt. Der Pot zählt bei Einsätzen animiert hoch. Neu ausgeteilte Karten fliegen verdeckt ein und drehen sich anschließend um; die drei Flop-Karten erscheinen um jeweils 180 ms versetzt. Unveränderte Karten bleiben bei Live-Updates montiert und animieren nicht erneut. Bei aktivierter Systemeinstellung für reduzierte Bewegung werden Zähl-, Karten- und Gewinneranimationen deaktiviert.

## Umfang und Grenzen

Server-Sent Events synchronisieren den Tisch. Sitzungstokens bleiben pro Browser-Tab im Session Storage; Neuladen verbindet erneut. Räume und Chips liegen nur im Arbeitsspeicher und gehen beim Serverneustart verloren. Es gibt noch keinen Zug-Timer, Kick/Verlassen, Rebuy oder automatische Freigabe alter Räume. Ein abwesender Spieler kann die Runde blockieren. Die Raumzahl ist auf 100 pro Prozess begrenzt.

Diese erste Version ist für lokale Tests und vertrauenswürdige private Runden gedacht. Vor öffentlichem Betrieb sind HTTPS, Rate Limits, dauerhafte Speicherung und Sitzungs-/Raumverwaltung zu ergänzen. Keine Echtgeldfunktion. Schriften nutzen Google Fonts mit lokalem Sans-Serif-Fallback.
