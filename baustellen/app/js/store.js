// Lokale Datenhaltung: alles liegt in IndexedDB auf dem Gerät (funktioniert offline).
// Beim Start wird alles in den Speicher geladen, damit die Oberfläche schnell ist.
// Jeder Datensatz: { id, typ, updatedAt, dev, deleted?, dirty? , ...felder }
//   typ: "baustelle" | "mass" | "stunden" | "material" | "plan"

const DB_NAME = "baustellen";
let db;
const mem = new Map();
const meta = new Map();
const hoerer = new Set();

function req(r) {
  return new Promise((ok, fehler) => { r.onsuccess = () => ok(r.result); r.onerror = () => fehler(r.error); });
}

export async function init() {
  db = await new Promise((ok, fehler) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("records", { keyPath: "id" });
      r.result.createObjectStore("meta", { keyPath: "k" });
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fehler(r.error);
  });
  const tx = db.transaction(["records", "meta"]);
  for (const rec of await req(tx.objectStore("records").getAll())) mem.set(rec.id, rec);
  for (const m of await req(tx.objectStore("meta").getAll())) meta.set(m.k, m.v);
  if (!meta.get("deviceId")) await setMeta("deviceId", neueId());
  // Browser bitten, die Daten nicht automatisch zu löschen
  navigator.storage?.persist?.().catch(() => {});
}

export function neueId() {
  return (crypto.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/-/g, "");
}

export function getMeta(k, standard) { return meta.has(k) ? meta.get(k) : standard; }
export async function setMeta(k, v) {
  meta.set(k, v);
  await req(db.transaction("meta", "readwrite").objectStore("meta").put({ k, v }));
}

export function beiAenderung(fn) { hoerer.add(fn); return () => hoerer.delete(fn); }
function melden(quelle) { for (const fn of hoerer) fn(quelle); }

// ---------- Lesen ----------
export function get(id) {
  const r = mem.get(id);
  return r && !r.deleted ? r : null;
}
export function liste(typ, filter) {
  const aus = [];
  for (const r of mem.values()) if (r.typ === typ && !r.deleted && (!filter || filter(r))) aus.push(r);
  return aus;
}
export function von(typ, baustelleId) { return liste(typ, (r) => r.baustelleId === baustelleId); }

// ---------- Schreiben ----------
async function schreiben(recs) {
  const tx = db.transaction("records", "readwrite");
  const st = tx.objectStore("records");
  for (const r of recs) st.put(r);
  await new Promise((ok, fehler) => { tx.oncomplete = ok; tx.onerror = () => fehler(tx.error); });
}

export async function speichern(daten) {
  const rec = {
    ...(daten.id ? mem.get(daten.id) : {}),
    ...daten,
    id: daten.id || neueId(),
    updatedAt: Math.max(Date.now(), (mem.get(daten.id)?.updatedAt || 0) + 1),
    dev: getMeta("deviceId"),
    dirty: 1,
  };
  mem.set(rec.id, rec);
  await schreiben([rec]);
  melden("lokal");
  return rec;
}

// Löschen = als gelöscht markieren (damit es auch auf den anderen Geräten verschwindet).
// Bei einer Baustelle werden alle zugehörigen Einträge mit gelöscht.
export async function loeschen(id) {
  const rec = mem.get(id);
  if (!rec) return;
  const betroffen = [rec];
  if (rec.typ === "baustelle") for (const r of mem.values()) if (r.baustelleId === id && !r.deleted) betroffen.push(r);
  const jetzt = Date.now();
  const recs = betroffen.map((r) => ({ ...r, deleted: true, updatedAt: Math.max(jetzt, r.updatedAt + 1), dev: getMeta("deviceId"), dirty: 1 }));
  recs.forEach((r) => mem.set(r.id, r));
  await schreiben(recs);
  melden("lokal");
}

// ---------- Für den Sync ----------
export function ungesendet() {
  return [...mem.values()].filter((r) => r.dirty);
}

function istNeuer(a, b) {
  if (!b) return true;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt;
  return String(a.dev || "") > String(b.dev || "");
}

// gesendet: die Versionen, die an den Server gingen; empfangen: was der Server zurückschickt
export async function syncErgebnis(gesendet, empfangen) {
  const aendern = [];
  for (const s of gesendet) {
    const lokal = mem.get(s.id);
    // nur als "gesendet" markieren, wenn nicht inzwischen weiter bearbeitet
    if (lokal && lokal.dirty && lokal.updatedAt === s.updatedAt) {
      const r = { ...lokal };
      delete r.dirty;
      mem.set(r.id, r);
      aendern.push(r);
    }
  }
  let vonAussen = false;
  for (const e of empfangen) {
    const { _seq, ...rec } = e;
    const lokal = mem.get(rec.id);
    if (lokal && lokal.dirty && !istNeuer(rec, lokal)) continue; // lokale Änderung ist neuer
    if (lokal && lokal.updatedAt === rec.updatedAt && lokal.dev === rec.dev && !lokal.dirty) continue;
    mem.set(rec.id, rec);
    aendern.push(rec);
    vonAussen = true;
  }
  if (aendern.length) await schreiben(aendern);
  if (vonAussen) melden("sync");
}

// ---------- Sicherung ----------
export function alles() { return [...mem.values()]; }

export async function einspielen(recs) {
  const neu = [];
  for (const rec of recs) {
    if (!rec || !rec.id || !rec.typ) continue;
    const lokal = mem.get(rec.id);
    if (!lokal || istNeuer(rec, lokal)) {
      const { _seq, ...r } = rec;
      const x = { ...r, dirty: 1 };
      mem.set(x.id, x);
      neu.push(x);
    }
  }
  if (neu.length) await schreiben(neu);
  melden("lokal");
  return neu.length;
}
