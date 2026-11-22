// Papierkorb: Gelöschtes wird mit allen abhängigen Daten 30 Tage aufgehoben.
import { db } from "./db.js";

export const AUFBEWAHRUNG_TAGE = 30;
// Reihenfolge beim Wiederherstellen (wegen Verknüpfungen)
const REIHENFOLGE = ["kunden", "teile", "fahrzeuge", "auftraege", "auftrag_teile", "fotos", "termine"];

const ohneUser = (r) => { const { user_id, ...rest } = r; return rest; };

async function sammeln(typ, id) {
  const zeilen = {};   // tabelle -> [zeilen], werden komplett gelöscht und wiederhergestellt
  const links = [];    // Verweise anderer Einträge, die beim Löschen geleert werden
  const add = (t, rows) => (zeilen[t] = [...(zeilen[t] || []), ...rows.map(ohneUser)]);
  const link = async (t, spalte, wert) => {
    for (const r of await db.list(t, { eq: { [spalte]: wert } })) links.push({ t, id: r.id, spalte, wert });
  };
  const auftrag = async (a, fotoLinks) => {
    add("auftraege", [a]);
    add("auftrag_teile", await db.list("auftrag_teile", { eq: { auftrag_id: a.id } }));
    if (fotoLinks) await link("fotos", "auftrag_id", a.id);
  };
  const fahrzeug = async (f) => {
    add("fahrzeuge", [f]);
    for (const a of await db.list("auftraege", { eq: { fahrzeug_id: f.id } })) await auftrag(a, false);
    add("fotos", await db.list("fotos", { eq: { fahrzeug_id: f.id } }));
    await link("termine", "fahrzeug_id", f.id);
  };

  const tabelle = { kunde: "kunden", fahrzeug: "fahrzeuge", auftrag: "auftraege", teil: "teile", termin: "termine", foto: "fotos" }[typ];
  const row = await db.get(tabelle, id);
  if (!row) throw new Error("Eintrag nicht gefunden");
  let titel;
  if (typ === "kunde") {
    titel = row.name;
    add("kunden", [row]);
    for (const f of await db.list("fahrzeuge", { eq: { kunde_id: id } })) await fahrzeug(f);
    await link("termine", "kunde_id", id);
  } else if (typ === "fahrzeug") {
    titel = [row.kennzeichen, row.marke, row.modell].filter(Boolean).join(" ") || "Fahrzeug";
    await fahrzeug(row);
  } else if (typ === "auftrag") {
    titel = row.titel;
    await auftrag(row, true);
  } else if (typ === "teil") {
    titel = row.name;
    add("teile", [row]);
    await link("auftrag_teile", "teil_id", id);
  } else if (typ === "termin") {
    titel = `${row.titel} (${new Date(row.beginn).toLocaleDateString("de-DE")})`;
    add("termine", [row]);
  } else if (typ === "foto") {
    titel = row.beschreibung || "Foto";
    add("fotos", [row]);
  }
  return { tabelle, titel, daten: { zeilen, links } };
}

export async function inPapierkorb(typ, id) {
  const { tabelle, titel, daten } = await sammeln(typ, id);
  await db.insert("papierkorb", { typ, titel, daten });
  await db.remove(tabelle, id); // Fotos-Dateien bleiben im Speicher, bis der Papierkorb geleert wird
}

export async function wiederherstellen(eintrag) {
  const { zeilen, links } = eintrag.daten;
  for (const t of REIHENFOLGE) if (zeilen[t]?.length) await db.upsert(t, zeilen[t]);
  for (const l of links) {
    if (await db.get(l.t, l.id)) await db.update(l.t, l.id, { [l.spalte]: l.wert });
  }
  await db.remove("papierkorb", eintrag.id);
}

export async function endgueltigLoeschen(eintrag) {
  const pfade = (eintrag.daten.zeilen.fotos || []).map((f) => f.pfad);
  await db.remove("papierkorb", eintrag.id);
  await db.removePhotos(pfade).catch(console.error);
}

export const tageUebrig = (eintrag) =>
  Math.max(0, AUFBEWAHRUNG_TAGE - Math.floor((Date.now() - new Date(eintrag.created_at)) / 864e5));

// Beim Start: Einträge älter als 30 Tage endgültig entfernen
export async function aufraeumen() {
  for (const e of await db.list("papierkorb")) {
    if (tageUebrig(e) <= 0) await endgueltigLoeschen(e);
  }
}
