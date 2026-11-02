# Hobbypoker

Deutschsprachiges Texas Hold’em für private Runden mit Spielchips. Node.js 22 oder neuer, keine externen Abhängigkeiten.

```sh
cd /workspace/hobbypoker
npm test
npm start
```

Standardport: 3000; alternativ `PORT=8080 npm start`. Für Entwicklung: `npm run dev`.

Raum mit einem Namen eröffnen, Raumcode teilen oder als Gastgeber bis zu sechs KI-Gegner hinzufügen. Zwei bis acht Plätze, 1.000 Startchips, Blinds 10/20. Der Gastgeber startet jede Hand. Check, Call, Fold, volle Raises, All-in beim Call, Showdown und Side Pots werden serverseitig verarbeitet. All-in-Raises unterhalb des Mindest-Raises werden in dieser ersten Version nicht angeboten.

## KI-Persönlichkeiten

Sechs regelbasierte Poker-Archetypen (Nit, TAG, LAG, Calling Station, Maniac und Rock) unterscheiden sich in Risikoaversion, Bluffrate, Tilt nach Verlusten, Aggressivität nach Gewinnen und Einsatzstufen (20/50/100 Chips). Die Stimmung entwickelt sich über mehrere Hände und klingt mit Faktor 0,65 ab. Die KI kennt nur ihre eigenen Karten und öffentliche Informationen; sie ist kein trainiertes Pokermodell. Zusätzlich steuern Range-Enge, Aggression, Callneigung und Position die Entscheidungen. Die Persönlichkeiten bleiben intern: Am Tisch werden weder Stil noch Verhaltensparameter der KI angezeigt. „Batch-betting“ bedeutet hier auf feste Chipstufen gerundete Einsätze, begrenzt durch Stack und Mindest-Raise.

## Mobile Nutzung

Für schmale Bildschirme stehen Board, eigene Hand mit Aktionen und Spielerplätze untereinander. Touch-Ziele sind mindestens 48 Pixel hoch, Eingabefelder nutzen 16-Pixel-Schrift. Desktop ergänzt eine seitliche Aktionsfläche.

## Spielanzeigen und Einsatzhilfen

Unter jedem Stack steht die Nettoänderung der letzten abgeschlossenen Hand (Auszahlung minus alle Einsätze dieser Hand); während der nächsten Hand bleibt sie zur Orientierung stehen. Ein animiertes Ergebnisfeld nennt die Gewinner, ihre Pokerhand und die Auszahlung. Geteilte Pots und mehrere Side-Pot-Gewinner werden einzeln angezeigt. Ungecallte Einsätze werden zurückgegeben und nicht als gewonnener Pot gezählt. Handnamen werden nur für die eigenen oder beim Showdown aufgedeckten Karten angezeigt.

Unter den eigenen Karten steht eine geschätzte Gewinnchance (Showdown-Equity inklusive geteilter Pots). Ein Web Worker simuliert 400 zufällige Verteilungen anhand der eigenen Karten, des öffentlichen Boards und der Zahl aktiver Gegner. Die Schätzung kennt keine verdeckten Gegnerkarten, ignoriert zukünftige Folds und Einsätze sowie Side Pots und kann durch die Stichprobe schwanken.

Die Buttons **½ Pot**, **Pot** und **2× Einsatz** wählen die Zielhöhe für das Feld „Erhöhen auf“; **Setzen** bestätigt den Einsatz. Pot-Raises berücksichtigen zuerst den noch zu callenden Betrag: Ziel = aktueller Einsatz + Anteil × (Pot + Call). Grenzen für Stack und Mindest-Raise gelten auch für die Presets; ohne gegnerischen Einsatz ist „2× Einsatz“ deaktiviert.

KI-Spieler überlegen ungefähr zwei Sekunden. Danach bleibt jeder angenommene Spielzug eine Sekunde sichtbar, bevor der nächste Spieler oder die nächste Street folgt. Der Pot zählt bei Einsätzen animiert hoch. Bei aktivierter Systemeinstellung für reduzierte Bewegung werden Zähl- und Gewinneranimationen deaktiviert.

## Umfang und Grenzen

Server-Sent Events synchronisieren den Tisch. Sitzungstokens bleiben pro Browser-Tab im Session Storage; Neuladen verbindet erneut. Räume und Chips liegen nur im Arbeitsspeicher und gehen beim Serverneustart verloren. Es gibt noch keinen Zug-Timer, Kick/Verlassen, Rebuy oder automatische Freigabe alter Räume. Ein abwesender Spieler kann die Runde blockieren. Die Raumzahl ist auf 100 pro Prozess begrenzt.

Diese erste Version ist für lokale Tests und vertrauenswürdige private Runden gedacht. Vor öffentlichem Betrieb sind HTTPS, Rate Limits, dauerhafte Speicherung und Sitzungs-/Raumverwaltung zu ergänzen. Keine Echtgeldfunktion. Schriften nutzen Google Fonts mit lokalem Sans-Serif-Fallback.
