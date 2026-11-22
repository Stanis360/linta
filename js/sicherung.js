// Datensicherung: alles als ZIP herunterladen (JSON + Excel-Tabellen + Fotos) und wieder einspielen.
import { db } from "./db.js";

const TABELLEN = ["kunden", "teile", "fahrzeuge", "auftraege", "auftrag_teile", "fotos", "termine"];
const LETZTE = "werkstatt_letzte_sicherung";

let jszipLaden;
function JSZip() {
  jszipLaden ||= new Promise((res, rej) => {
    if (window.JSZip) return res(window.JSZip);
    const s = document.createElement("script");
    s.src = "vendor/jszip.min.js";
    s.onload = () => res(window.JSZip);
    s.onerror = () => rej(new Error("ZIP-Bibliothek konnte nicht geladen werden"));
    document.head.append(s);
  });
  return jszipLaden;
}

export function letzteSicherung() {
  try { return localStorage.getItem(LETZTE); } catch { return null; }
}

// CSV mit ; und BOM, damit Excel Umlaute und Spalten richtig erkennt
function csv(rows) {
  if (!rows.length) return "﻿";
  const spalten = [...new Set(rows.flatMap(Object.keys))].filter((s) => s !== "user_id");
  const zelle = (v) => {
    if (v == null) return "";
    if (typeof v === "number") v = String(v).replace(".", ",");
    v = String(v);
    return /[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  return "﻿" + [spalten.join(";"), ...rows.map((r) => spalten.map((s) => zelle(r[s])).join(";"))].join("\r\n");
}

export async function sicherungErstellen({ mitFotos, fortschritt = () => {} }) {
  const Zip = await JSZip();
  const zip = new Zip();
  const tabellen = {};
  for (const t of TABELLEN) {
    fortschritt(`Lese ${t} …`);
    tabellen[t] = (await db.list(t)).map(({ user_id, ...r }) => r);
    zip.file(`tabellen/${t}.csv`, csv(tabellen[t]));
  }
  zip.file("daten.json", JSON.stringify({ app: "werkstatt", version: 1, erstellt: new Date().toISOString(), tabellen }, null, 1));

  let fehlend = 0;
  if (mitFotos) {
    const fotos = tabellen.fotos;
    for (let i = 0; i < fotos.length; i++) {
      fortschritt(`Foto ${i + 1} von ${fotos.length} …`);
      try {
        zip.file("fotos/" + fotos[i].pfad.split("/").pop(), await db.downloadPhoto(fotos[i].pfad), { binary: true });
      } catch (e) {
        console.error(e);
        fehlend++;
      }
    }
  }
  zip.file("LIESMICH.txt",
    "Datensicherung der Werkstatt-App\r\n\r\n" +
    "Wiederherstellen: In der App unter „Mehr“ → „Sicherung einspielen“ diese ZIP-Datei auswählen.\r\n" +
    "Im Ordner „tabellen“ liegen alle Daten zusätzlich als Excel-Tabellen (CSV).\r\n" +
    (mitFotos ? "Im Ordner „fotos“ liegen alle Fotos.\r\n" : "Diese Sicherung enthält KEINE Fotos.\r\n"));

  fortschritt("Erstelle ZIP-Datei …");
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
  const jetzt = new Date();
  const name = `werkstatt-sicherung-${jetzt.toISOString().slice(0, 10)}${mitFotos ? "" : "-ohne-fotos"}.zip`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60e3);
  try { localStorage.setItem(LETZTE, jetzt.toISOString()); } catch {}
  return { name, groesse: blob.size, fehlend };
}

export async function sicherungEinspielen(datei, fortschritt = () => {}) {
  const Zip = await JSZip();
  fortschritt("Lese Sicherung …");
  const zip = await Zip.loadAsync(datei);
  const json = zip.file("daten.json");
  if (!json) throw new Error("Das ist keine gültige Sicherungsdatei (daten.json fehlt).");
  const inhalt = JSON.parse(await json.async("string"));
  if (inhalt.app !== "werkstatt") throw new Error("Das ist keine Sicherung dieser App.");
  const t = inhalt.tabellen;

  // Fotos zuerst hochladen (Pfad gehört immer dem angemeldeten Benutzer)
  const fotos = [];
  let ohneDatei = 0;
  for (let i = 0; i < (t.fotos || []).length; i++) {
    const f = t.fotos[i];
    const dateiname = f.pfad.split("/").pop();
    const eintrag = zip.file("fotos/" + dateiname);
    fortschritt(`Foto ${i + 1} von ${t.fotos.length} …`);
    if (eintrag) {
      const blob = new Blob([await eintrag.async("uint8array")], { type: "image/jpeg" });
      fotos.push({ ...f, pfad: await db.uploadPhoto(blob, dateiname) });
    } else {
      // Sicherung ohne Fotos: Eintrag nur behalten, wenn das Foto noch im Speicher ist
      try { await db.downloadPhoto(f.pfad); fotos.push(f); } catch { ohneDatei++; }
    }
  }
  t.fotos = fotos;

  const anzahl = {};
  for (const name of TABELLEN) {
    const rows = (t[name] || []).map(({ user_id, ...r }) => r);
    if (!rows.length) continue;
    fortschritt(`Spiele ${name} ein …`);
    await db.upsert(name, rows);
    anzahl[name] = rows.length;
  }
  return { anzahl, ohneDatei, erstellt: inhalt.erstellt };
}
