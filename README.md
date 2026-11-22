# Werkstatt-App

> In diesem Repository liegt außerdem die **Baustellen-App** (Baustellen, Maße, Grundriss, Stunden, Material, Sync im Heimnetz): siehe [`baustellen/README.md`](baustellen/README.md).

Eine einfache App für eine Kfz-Werkstatt. Sie läuft auf **Handy, Tablet und PC**, und alle Daten werden **automatisch zwischen den Geräten synchronisiert**.

**Funktionen**
- **Kunden**: Name, Telefon (antippen ruft an), E-Mail, Adresse (öffnet Google Maps), Notizen
- **Fahrzeuge** pro Kunde: Kennzeichen, Marke/Modell, Baujahr, km-Stand, FIN, TÜV-Termin (Warnung 30 Tage vorher)
- **Aufträge/Historie** pro Fahrzeug: Arbeiten, Status (Offen / In Arbeit / Fertig), verbaute Teile, Arbeitslohn und Gesamtsumme
- **Fotos** pro Fahrzeug und pro Auftrag, direkt mit der Handykamera. Die Fotos werden vor dem Hochladen automatisch verkleinert.
- **Termine** mit Kunde und Fahrzeug, zum Abhaken
- **Teile-Lager**: Bestand, Mindestbestand, Preise, Lagerort. Wird ein Teil in einen Auftrag eingetragen, bucht die App es automatisch aus dem Lager aus.
- **Startseite**: Termine von heute und morgen, offene Aufträge, Teile zum Nachbestellen, TÜV bald fällig
- **Suche** nach Name, Kennzeichen, Telefon oder FIN
- **Papierkorb** (30 Tage) und **Datensicherung** als ZIP-Datei inkl. Fotos

Ohne Einrichtung startet die App im **Demo-Modus**. Dann bleiben die Daten nur im Browser dieses einen Geräts, und es gibt keinen Sync.

---

## Einrichtung (einmalig, ca. 20 Minuten)

### 1. Datenbank anlegen (Supabase, kostenlos)

1. Auf **https://supabase.com** ein Konto erstellen.
2. **New project** wählen:
   - Name: z.B. `werkstatt`
   - Ein sicheres Datenbank-Passwort vergeben und notieren
   - **Region: `Central EU (Frankfurt)`**. Wegen der DSGVO sollen die Daten in der EU liegen.
3. Warten, bis das Projekt bereit ist (1–2 Minuten).
4. Links im Menü auf **SQL Editor** gehen, dann **New query**. Den kompletten Inhalt der Datei
   [`supabase/schema.sql`](supabase/schema.sql) hineinkopieren und auf **Run** klicken.
   Es sollte „Success“ erscheinen.

### 2. Login-Benutzer anlegen

1. Links auf **Authentication → Users → Add user → Create new user** gehen.
2. E-Mail und Passwort eingeben und **Auto Confirm User** anhaken.
3. Damit sich niemand sonst registrieren kann: **Authentication → Sign In / Providers**, dort
   **„Allow new users to sign up“ ausschalten**.

### 3. Zugangsdaten eintragen

1. In Supabase auf **Project Settings → API** (bzw. **Data API / API Keys**) gehen.
2. Die **Project URL** und den **anon public** Key kopieren.
3. In der Datei [`config.js`](config.js) eintragen:

```js
window.APP_CONFIG = {
  SUPABASE_URL: "https://xxxxxxxx.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOi...",
  WERKSTATT_NAME: "Kfz-Werkstatt Müller",
};
```

> Der „anon“-Schlüssel darf öffentlich sein. Die Daten sind trotzdem geschützt:
> Ohne Login kommt niemand an Kunden, Fahrzeuge oder Fotos heran (Row Level Security).
> Den **service_role**-Schlüssel dagegen **niemals** eintragen!

### 4. Online stellen (Netlify, kostenlos)

**Einfachster Weg, per Drag & Drop:**
1. **https://app.netlify.com/drop** öffnen und ein kostenloses Konto anlegen.
2. Den kompletten Projektordner (mit `index.html`, `config.js` usw.) auf die Seite ziehen.
3. Du bekommst eine Adresse wie `https://werkstatt-xyz.netlify.app`. Das ist die App.
   Unter **Site configuration → Change site name** lässt sich die Adresse ändern.

**Alternativ** kannst du Netlify oder Vercel mit diesem GitHub-Repository verbinden. Dann ist jede Änderung automatisch online.
Ein Build-Schritt ist nicht nötig, die App besteht nur aus statischen Dateien.

### 5. Auf Handy und Tablet installieren

- **iPhone/iPad (Safari):** Adresse öffnen → Teilen-Symbol → **„Zum Home-Bildschirm“**
- **Android (Chrome):** Adresse öffnen → Menü ⋮ → **„App installieren“** bzw. „Zum Startbildschirm hinzufügen“
- **PC:** Adresse im Browser öffnen. In Chrome/Edge lässt sie sich über das Symbol in der Adressleiste auch als App installieren.

Danach auf jedem Gerät mit derselben E-Mail und demselben Passwort anmelden. Fertig: Änderungen erscheinen sofort auf allen Geräten.

---

## Kosten

| Dienst | Kostenlos bis | danach |
|---|---|---|
| Supabase | 500 MB Datenbank, 1 GB Fotos | Pro-Tarif ca. 25 $/Monat |
| Netlify | weit mehr, als eine Werkstatt braucht | – |

Ein Foto braucht nach dem Verkleinern ca. 200–400 KB. 1 GB reicht also für etwa 3.000 Fotos.
**Hinweis:** Im Gratis-Tarif pausiert Supabase ein Projekt nach 7 Tagen ohne Nutzung. Es lässt sich im Dashboard per Klick wieder starten, die Daten bleiben erhalten. Bei täglicher Nutzung passiert das nicht.

## Datensicherung & Papierkorb

**Papierkorb:** Alles, was gelöscht wird (Kunden, Fahrzeuge, Aufträge, Termine, Teile, Fotos), landet zuerst im
Papierkorb, und zwar **inklusive aller zugehörigen Daten**. Ein gelöschter Kunde kommt also mit seinen Fahrzeugen, Aufträgen und Fotos zurück.
Wiederherstellen geht unter **Mehr → Papierkorb**. Nach **30 Tagen** wird ein Eintrag endgültig entfernt.

**Datensicherung:** Unter **Mehr → Datensicherung** lädt ein Klick alles als ZIP-Datei herunter:
- `daten.json`: alle Daten zum Wiederherstellen
- `tabellen/*.csv`: alle Daten zusätzlich als Tabellen, die sich in Excel öffnen lassen
- `fotos/`: alle Fotos (wenn „mit Fotos“ gewählt)

👉 **Einmal im Monat sichern** und die Datei auf einen USB-Stick oder in eine Cloud (Google Drive, OneDrive …) kopieren.
Ist die letzte Sicherung auf dem Gerät länger als 30 Tage her, erinnert die Startseite daran.

**Wiederherstellen:** **Mehr → Sicherung einspielen** und die ZIP-Datei auswählen. Das funktioniert auch mit einem
neuen Supabase-Konto, falls das alte einmal verloren gehen sollte.

Zusätzlich macht Supabase im Pro-Tarif automatisch tägliche Backups.

## Aufbau (für Entwickler)

```
index.html            Grundgerüst
config.js             Zugangsdaten (Supabase-URL + anon key)
css/style.css         Design (inkl. Dark Mode)
js/app.js             Ansichten, Formulare, Fotos, Routing
js/db.js              Datenzugriff: Supabase oder Demo (localStorage)
js/papierkorb.js      Papierkorb (30 Tage, inkl. abhängiger Daten)
js/sicherung.js       Datensicherung als ZIP (JSON + CSV + Fotos) und Einspielen
sw.js                 Service Worker (App-Dateien zwischenspeichern)
supabase/schema.sql   Tabellen, Zugriffsschutz, Realtime, Foto-Speicher
vendor/supabase.js    Supabase-Bibliothek v2.45.4 (MIT-Lizenz)
vendor/jszip.min.js   JSZip v3.10.1 (MIT-Lizenz)
```

Lokal testen: `python3 -m http.server 8080` im Projektordner, dann http://localhost:8080 öffnen.
