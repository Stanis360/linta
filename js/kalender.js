// Termine in den Handy-/PC-Kalender eintragen.
// iPhone, Mac, Windows: .ics-Kalenderdatei. Android: Google Kalender.
// Die Einstellungen gelten pro Gerät (z.B. Handy: ja, Werkstatt-PC: nein).

const SCHLUESSEL = "werkstatt_kalender";
const STANDARD = { aktiv: false, art: "auto", erinnerung: 60 };

export function kalenderEinstellungen() {
  try { return { ...STANDARD, ...JSON.parse(localStorage.getItem(SCHLUESSEL) || "{}") }; }
  catch { return { ...STANDARD }; }
}

export function kalenderSpeichern(aenderung) {
  const neu = { ...kalenderEinstellungen(), ...aenderung };
  try { localStorage.setItem(SCHLUESSEL, JSON.stringify(neu)); } catch {}
  return neu;
}

const istIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const istAndroid = () => /Android/.test(navigator.userAgent);

export function kalenderArt(e = kalenderEinstellungen()) {
  if (e.art !== "auto") return e.art;
  return istAndroid() ? "google" : "ics";
}

export const ART_NAMEN = {
  auto: "Automatisch erkennen",
  google: "Google Kalender (Android)",
  ics: "Kalender-Datei (iPhone, Outlook, Samsung …)",
};

// ---------------------------------------------------------------------
const utc = (d) => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

function texte(termin, kunde, fahrzeug, werkstatt) {
  const fz = fahrzeug ? [fahrzeug.kennzeichen, fahrzeug.marke, fahrzeug.modell].filter(Boolean).join(" ") : "";
  const titel = [termin.titel, fahrzeug?.kennzeichen || kunde?.name].filter(Boolean).join(" – ");
  const details = [
    kunde && `Kunde: ${kunde.name}`,
    kunde?.telefon && `Telefon: ${kunde.telefon}`,
    fz && `Fahrzeug: ${fz}`,
    termin.notizen && `\n${termin.notizen}`,
    `\n(Eingetragen aus der App ${werkstatt})`,
  ].filter(Boolean).join("\n");
  const start = new Date(termin.beginn);
  const ende = new Date(start.getTime() + (termin.dauer_min || 60) * 6e4);
  return { titel, details, start, ende };
}

const icsText = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

// Zeilen dürfen laut Standard max. 75 Zeichen lang sein
const falten = (zeile) => {
  const teile = [];
  for (let i = 0; i < zeile.length; i += 70) teile.push((i ? " " : "") + zeile.slice(i, i + 70));
  return teile.join("\r\n");
};

export function icsErstellen(termin, kunde, fahrzeug, { erinnerung, werkstatt }) {
  const { titel, details, start, ende } = texte(termin, kunde, fahrzeug, werkstatt);
  const zeilen = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Werkstatt-App//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${termin.id}@werkstatt-app`,
    `DTSTAMP:${utc(new Date())}`,
    `DTSTART:${utc(start)}`,
    `DTEND:${utc(ende)}`,
    `SUMMARY:${icsText(titel)}`,
    `DESCRIPTION:${icsText(details)}`,
    ...(werkstatt ? [`LOCATION:${icsText(werkstatt)}`] : []),
    ...(erinnerung > 0
      ? ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsText(titel)}`, `TRIGGER:-PT${erinnerung}M`, "END:VALARM"]
      : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return zeilen.map(falten).join("\r\n") + "\r\n";
}

export function googleLink(termin, kunde, fahrzeug, { werkstatt }) {
  const { titel, details, start, ende } = texte(termin, kunde, fahrzeug, werkstatt);
  const p = new URLSearchParams({ action: "TEMPLATE", text: titel, dates: `${utc(start)}/${utc(ende)}`, details });
  if (werkstatt) p.set("location", werkstatt);
  return "https://calendar.google.com/calendar/render?" + p.toString();
}

// Muss direkt aus einem Tipp/Klick heraus aufgerufen werden (sonst blockiert der Browser)
export function inKalenderEintragen(termin, kunde, fahrzeug) {
  const e = kalenderEinstellungen();
  const werkstatt = (window.APP_CONFIG || {}).WERKSTATT_NAME || "Werkstatt";
  if (kalenderArt(e) === "google") {
    window.open(googleLink(termin, kunde, fahrzeug, { werkstatt }), "_blank", "noopener");
    return;
  }
  const ics = icsErstellen(termin, kunde, fahrzeug, { erinnerung: Number(e.erinnerung), werkstatt });
  if (istIOS()) {
    // iPhone/iPad: öffnet direkt den Dialog „Zum Kalender hinzufügen“
    location.href = "data:text/calendar;charset=utf-8," + encodeURIComponent(ics);
    return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
  a.download = `termin-${termin.beginn.slice(0, 10)}.ics`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60e3);
}
