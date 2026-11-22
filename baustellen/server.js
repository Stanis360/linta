#!/usr/bin/env node
// =====================================================================
//  Baustellen-Sync-Server
//  Läuft auf dem PC zu Hause. Liefert die App aus und gleicht die Daten
//  aller Geräte ab. Benötigt nur Node.js (ab Version 18), keine Pakete.
//
//  Start:   node server.js
//  Optional (Umgebungsvariablen):
//    PORT=8080            Port des Servers
//    PASSWORT=geheim      Sync nur mit diesem Passwort erlauben
//    DATEN=./daten        Ordner für die Daten und Sicherungen
// =====================================================================
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PORT = Number(process.env.PORT) || 8080;
const PASSWORT = process.env.PASSWORT || "";
const DATEN_ORDNER = path.resolve(__dirname, process.env.DATEN || "daten");
const APP_ORDNER = path.join(__dirname, "app");
const DATEI = path.join(DATEN_ORDNER, "daten.json");
const MAX_SICHERUNGEN = 30;

fs.mkdirSync(DATEN_ORDNER, { recursive: true });

// ---------- Datenbestand ----------
// { seq: Zähler, records: { id: datensatz } }
// Jeder Datensatz hat: id, typ, updatedAt (ms), dev (Geräte-ID), deleted, _seq
let bestand = { seq: 0, records: {} };
if (fs.existsSync(DATEI)) {
  try {
    bestand = JSON.parse(fs.readFileSync(DATEI, "utf8"));
  } catch (e) {
    console.error("FEHLER: daten.json ist beschädigt. Bitte eine Sicherung aus dem Ordner 'daten' zurückkopieren.");
    process.exit(1);
  }
}

let speichernGeplant = null;
function speichern() {
  clearTimeout(speichernGeplant);
  speichernGeplant = setTimeout(() => {
    const tmp = DATEI + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(bestand));
    fs.renameSync(tmp, DATEI);
    tagesSicherung();
  }, 300);
}

// Einmal pro Tag eine Kopie in daten/sicherungen/ ablegen, die letzten 30 behalten
function tagesSicherung() {
  const ordner = path.join(DATEN_ORDNER, "sicherungen");
  fs.mkdirSync(ordner, { recursive: true });
  const ziel = path.join(ordner, `daten-${new Date().toISOString().slice(0, 10)}.json`);
  if (!fs.existsSync(ziel)) fs.copyFileSync(DATEI, ziel);
  const alle = fs.readdirSync(ordner).filter((f) => f.startsWith("daten-")).sort();
  for (const alt of alle.slice(0, Math.max(0, alle.length - MAX_SICHERUNGEN))) fs.unlinkSync(path.join(ordner, alt));
}

// Neuer gewinnt (Zeitstempel), bei Gleichstand entscheidet die Geräte-ID
function istNeuer(a, b) {
  if (!b) return true;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt;
  return String(a.dev || "") > String(b.dev || "");
}

function sync({ since = 0, changes = [] }) {
  let geaendert = false;
  for (const rec of changes) {
    if (!rec || typeof rec.id !== "string" || typeof rec.updatedAt !== "number") continue;
    if (istNeuer(rec, bestand.records[rec.id])) {
      const { dirty, ...sauber } = rec;
      bestand.records[rec.id] = { ...sauber, _seq: ++bestand.seq };
      geaendert = true;
    }
  }
  if (geaendert) speichern();
  const neu = Object.values(bestand.records).filter((r) => r._seq > since);
  return { seq: bestand.seq, records: neu };
}

// ---------- HTTP ----------
const TYPEN = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml",
  ".png": "image/png", ".ico": "image/x-icon",
};

function antwort(res, status, daten) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(daten));
}

function body(req) {
  return new Promise((ok, fehler) => {
    const teile = [];
    let groesse = 0;
    req.on("data", (c) => {
      groesse += c.length;
      if (groesse > 50 * 1024 * 1024) { fehler(new Error("zu groß")); req.destroy(); }
      teile.push(c);
    });
    req.on("end", () => ok(Buffer.concat(teile).toString("utf8")));
    req.on("error", fehler);
  });
}

const server = http.createServer(async (req, res) => {
  // Erlaubt den Sync auch, wenn die App von einer anderen Adresse geladen wurde
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Passwort");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

  const url = new URL(req.url, "http://x");

  if (url.pathname.startsWith("/api/")) {
    if (PASSWORT && req.headers["x-passwort"] !== PASSWORT) return antwort(res, 401, { fehler: "Falsches Passwort" });
    if (url.pathname === "/api/ping") return antwort(res, 200, { ok: true, seq: bestand.seq });
    if (url.pathname === "/api/sync" && req.method === "POST") {
      try {
        const daten = JSON.parse(await body(req));
        const erg = sync(daten);
        const anz = (daten.changes || []).length;
        if (anz) console.log(`${new Date().toLocaleTimeString("de-DE")}  ${anz} Änderung(en) empfangen`);
        return antwort(res, 200, erg);
      } catch (e) {
        return antwort(res, 400, { fehler: String(e.message || e) });
      }
    }
    return antwort(res, 404, { fehler: "Unbekannt" });
  }

  // Statische App-Dateien
  let datei = path.normalize(path.join(APP_ORDNER, decodeURIComponent(url.pathname)));
  if (!datei.startsWith(APP_ORDNER)) { res.writeHead(403); return res.end(); }
  if (url.pathname.endsWith("/")) datei = path.join(datei, "index.html");
  fs.readFile(datei, (err, inhalt) => {
    if (err) { res.writeHead(404); return res.end("Nicht gefunden"); }
    res.writeHead(200, { "Content-Type": TYPEN[path.extname(datei)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(inhalt);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  const adressen = Object.values(os.networkInterfaces()).flat()
    .filter((a) => a && a.family === "IPv4" && !a.internal).map((a) => a.address);
  console.log("\n  Baustellen-Server läuft.\n");
  console.log(`  Auf diesem PC:        http://localhost:${PORT}`);
  for (const a of adressen) console.log(`  Im Heimnetz (Handy):  http://${a}:${PORT}`);
  console.log(`\n  Daten liegen in:      ${DATEN_ORDNER}`);
  console.log(PASSWORT ? "  Passwortschutz:       an" : "  Passwortschutz:       aus (optional: PASSWORT=... setzen)");
  console.log("\n  Fenster offen lassen. Beenden mit Strg+C.\n");
});
