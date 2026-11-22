// Abgleich mit dem Server zu Hause.
// Klappt nur, wenn der Server erreichbar ist (z.B. im Heimnetz). Sonst wird es
// still später erneut versucht – die Daten bleiben solange auf dem Gerät.
import * as store from "./store.js";

const status = { zustand: "nie", text: "", zuletzt: null, wartend: 0 };
const hoerer = new Set();
let laeuft = false;
let nochmal = false;
let timer;

export function beiStatus(fn) { hoerer.add(fn); fn(status); return () => hoerer.delete(fn); }
function setzen(teil) {
  Object.assign(status, teil, { wartend: store.ungesendet().length + store.getMeta("fotoUpload", []).length });
  for (const fn of hoerer) fn(status);
}

export function serverAdresse() {
  const eingestellt = store.getMeta("server", "").trim().replace(/\/+$/, "");
  if (eingestellt) return /^https?:\/\//.test(eingestellt) ? eingestellt : "http://" + eingestellt;
  // Standard: der Server, von dem die App geladen wurde
  return location.protocol.startsWith("http") ? location.origin : "";
}

async function roh(pfad, optionen = {}, ms = 60000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(serverAdresse() + pfad, {
      ...optionen,
      headers: { ...(optionen.headers || {}), "X-Passwort": store.getMeta("passwort", "") },
      signal: ctrl.signal,
      cache: "no-store",
    });
  } finally {
    clearTimeout(t);
  }
}

// Fotos: eigene hochladen, fehlende von anderen Geräten holen
async function fotosAbgleichen() {
  for (const id of store.getMeta("fotoUpload", [])) {
    const rec = store.get(id);
    const blob = rec && (await store.fotoHolen(id));
    if (blob) {
      const res = await roh("/api/foto/" + id, { method: "PUT", body: blob, headers: { "Content-Type": "image/jpeg" } });
      if (!res.ok) throw new Error("Foto-Upload fehlgeschlagen " + res.status);
    }
    await store.fotoHochgeladen(id);
    setzen({});
  }
  const da = await store.fotoVorhanden();
  const fehlend = store.liste("foto", (f) => !da.has(f.id)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 30);
  for (const f of fehlend) {
    const res = await roh("/api/foto/" + f.id);
    if (res.ok) await store.fotoSpeichern(f.id, await res.blob(), false);
  }
}

async function anfrage(pfad, daten, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(serverAdresse() + pfad, {
      method: daten ? "POST" : "GET",
      headers: { "Content-Type": "application/json", "X-Passwort": store.getMeta("passwort", "") },
      body: daten ? JSON.stringify(daten) : undefined,
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (res.status === 401) throw Object.assign(new Error("Falsches Sync-Passwort"), { passwort: true });
    if (!res.ok) throw new Error("Server-Fehler " + res.status);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export async function jetzt() {
  if (!serverAdresse()) return setzen({ zustand: "aus", text: "Kein Server eingestellt" });
  if (laeuft) { nochmal = true; return; }
  laeuft = true;
  setzen({ zustand: "laeuft", text: "Synchronisiere …" });
  try {
    do {
      nochmal = false;
      const gesendet = store.ungesendet();
      const erg = await anfrage("/api/sync", { since: store.getMeta("seq", 0), changes: gesendet });
      await store.syncErgebnis(gesendet, erg.records || []);
      await store.setMeta("seq", erg.seq);
    } while (nochmal);
    await fotosAbgleichen();
    const zuletzt = new Date();
    await store.setMeta("zuletztSync", zuletzt.toISOString());
    setzen({ zustand: "ok", text: "Synchronisiert", zuletzt });
  } catch (e) {
    setzen({
      zustand: "offline",
      text: e.passwort ? e.message : "Server nicht erreichbar – wird später synchronisiert",
    });
  } finally {
    laeuft = false;
  }
}

// Nach lokalen Änderungen kurz warten und dann senden
export function bald() {
  clearTimeout(timer);
  setzen({});
  timer = setTimeout(jetzt, 1500);
}

export function starten() {
  const z = store.getMeta("zuletztSync");
  if (z) status.zuletzt = new Date(z);
  store.beiAenderung((quelle) => { if (quelle === "lokal") bald(); });
  window.addEventListener("online", jetzt);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) jetzt(); });
  setInterval(() => { if (!document.hidden) jetzt(); }, 30000);
  jetzt();
}

export async function testen(adresse, passwort) {
  const alt = [store.getMeta("server", ""), store.getMeta("passwort", "")];
  await store.setMeta("server", adresse);
  await store.setMeta("passwort", passwort);
  try {
    await anfrage("/api/ping", null, 5000);
    return { ok: true };
  } catch (e) {
    await store.setMeta("server", alt[0]);
    await store.setMeta("passwort", alt[1]);
    return { ok: false, text: e.passwort ? e.message : "Nicht erreichbar" };
  }
}
