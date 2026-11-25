// Termine in den Handy-/PC-Kalender eintragen.
// iPhone, Mac, Windows: .ics-Kalenderdatei. Android: Google Kalender.
// Die Einstellungen gelten pro Gerät (z.B. Handy: ja, Werkstatt-PC: nein).

import { db, DEMO } from "./db.js";

const SCHLUESSEL = "werkstatt_kalender";
// modus: "aus" | "fragen" (nach dem Speichern anbieten) | "abo" (automatisch abgleichen)
const STANDARD = { modus: "aus", art: "auto", erinnerung: 60 };

export function kalenderEinstellungen() {
  let e;
  try { e = JSON.parse(localStorage.getItem(SCHLUESSEL) || "{}"); } catch { e = {}; }
  if (!e.modus && e.aktiv) e.modus = "fragen"; // alte Einstellung übernehmen
  return { ...STANDARD, ...e };
}

export function kalenderSpeichern(aenderung) {
  const neu = { ...kalenderEinstellungen(), ...aenderung };
  try { localStorage.setItem(SCHLUESSEL, JSON.stringify(neu)); } catch {}
  return neu;
}

export const istIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
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
const falten = (z) => {
  // max. 75 Bytes pro Zeile (Kalender-Standard), ohne Umlaute zu zerschneiden
  const enc = new TextEncoder();
  const zeilen = [];
  let akt = "", n = 0;
  for (const ch of z) {
    const b = enc.encode(ch).length;
    if (n + b > 73) { zeilen.push(akt); akt = " "; n = 1; }
    akt += ch; n += b;
  }
  zeilen.push(akt);
  return zeilen.join("\r\n");
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

// ---------------------------------------------------------------------
//  Kalender-Abo (automatischer Abgleich über die Supabase-Funktion "kalender")
// ---------------------------------------------------------------------
export const ABO_MOEGLICH = !DEMO;

export async function aboLaden() {
  return (await db.list("kalender_abos"))[0] || null;
}

export async function aboErstellen() {
  const vorhanden = await aboLaden();
  if (vorhanden) return vorhanden;
  return db.insert("kalender_abos", { name: (window.APP_CONFIG || {}).WERKSTATT_NAME || "Werkstatt", erinnerung: 60 });
}

export async function aboNeuerLink(alt) {
  const abo = (await aboLaden()) || alt; // aktuellen Stand der Einstellungen übernehmen
  await db.remove("kalender_abos", abo.id);
  return db.insert("kalender_abos", { name: abo.name, erinnerung: abo.erinnerung, erledigte_zeigen: abo.erledigte_zeigen });
}

export async function aboBeenden(abo) {
  if (abo) await db.remove("kalender_abos", abo.id);
}

export function aboLink(abo) {
  const basis = ((window.APP_CONFIG || {}).SUPABASE_URL || "").replace(/\/+$/, "");
  return `${basis}/functions/v1/kalender?token=${abo.token}`;
}

export const aboWebcal = (abo) => aboLink(abo).replace(/^https?:/, "webcal:");

// Prüft, ob die Funktion eingerichtet ist und antwortet
export async function aboTesten(abo) {
  try {
    const r = await fetch(aboLink(abo), { cache: "no-store" });
    if (!r.ok) return { ok: false, grund: r.status === 404 ? "Funktion „kalender“ nicht gefunden oder Link ungültig" : r.status === 401 ? "„Verify JWT“ ist bei der Funktion noch eingeschaltet" : `Fehler ${r.status}` };
    const text = await r.text();
    if (!text.startsWith("BEGIN:VCALENDAR")) return { ok: false, grund: "Unerwartete Antwort" };
    return { ok: true, anzahl: (text.match(/BEGIN:VEVENT/g) || []).length };
  } catch {
    return { ok: false, grund: "Funktion „kalender“ ist noch nicht eingerichtet" };
  }
}
