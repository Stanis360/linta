import { db, DEMO } from "./db.js";
import { inPapierkorb, wiederherstellen, endgueltigLoeschen, tageUebrig, aufraeumen, AUFBEWAHRUNG_TAGE } from "./papierkorb.js";
import { sicherungErstellen, sicherungEinspielen, letzteSicherung } from "./sicherung.js";

const cfg = window.APP_CONFIG || {};
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

// ---------------------------------------------------------------------
//  Hilfsfunktionen
// ---------------------------------------------------------------------
const h = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const money = (n) => (n == null || n === "" ? "" : Number(n).toLocaleString("de-DE", { style: "currency", currency: "EUR" }));
const zahl = (n) => (n == null || n === "" ? "" : Number(n).toLocaleString("de-DE", { maximumFractionDigits: 2 }));
const datum = (d) => (d ? new Date(d.length === 10 ? d + "T00:00" : d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }) : "");
const uhrzeit = (d) => new Date(d).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
const wochentag = (d) => new Date(d).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
const tagKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
const heute = () => tagKey(new Date());
const tageBis = (d) => Math.round((new Date(d + "T00:00") - new Date(heute() + "T00:00")) / 864e5);
const fzName = (f) => (f ? [f.marke, f.modell].filter(Boolean).join(" ") || "Fahrzeug" : "");
const STATUS = { offen: "Offen", in_arbeit: "In Arbeit", fertig: "Fertig" };

function toast(msg, fehler = false) {
  const t = document.createElement("div");
  t.className = "toast" + (fehler ? " fehler" : "");
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), fehler ? 5000 : 2500);
}

async function versuch(fn) {
  try {
    return await fn();
  } catch (e) {
    console.error(e);
    toast("Fehler: " + e.message, true);
  }
}

// ---------------------------------------------------------------------
//  Formular-Dialog
// ---------------------------------------------------------------------
let dialogOffen = false;
let renderWartet = false;

function formular({ titel, felder, werte = {}, speichern, loeschen, setup }) {
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.innerHTML = `
    <form class="sheet">
      <div class="sheet-kopf">
        <button type="button" class="btn-text" data-abbrechen>Abbrechen</button>
        <strong>${h(titel)}</strong>
        <button type="submit" class="btn-text stark">Speichern</button>
      </div>
      <div class="sheet-inhalt">
        ${felder.map((f) => feldHtml(f, werte[f.name])).join("")}
        ${loeschen ? `<button type="button" class="btn gefahr breit" data-loeschen>Löschen</button>` : ""}
      </div>
    </form>`;
  const form = $("form", modal);
  const schliessen = () => {
    modal.remove();
    dialogOffen = false;
    if (renderWartet) { renderWartet = false; render(); }
  };
  $("[data-abbrechen]", modal).onclick = schliessen;
  modal.addEventListener("click", (e) => e.target === modal && schliessen());
  if (loeschen) {
    $("[data-loeschen]", modal).onclick = async () => {
      if (!confirm(`In den Papierkorb verschieben?\nDu kannst es ${AUFBEWAHRUNG_TAGE} Tage lang wiederherstellen.`)) return;
      const ok = await versuch(async () => { await loeschen(); return true; });
      if (ok) toast("In den Papierkorb verschoben");
      if (ok) { schliessen(); render(); }
    };
  }
  form.onsubmit = async (e) => {
    e.preventDefault();
    const daten = {};
    for (const f of felder) {
      const el = form.elements[f.name];
      if (!el) continue;
      let v = f.typ === "checkbox" ? el.checked : el.value.trim();
      if (f.typ === "zahl") v = v === "" ? null : Number(v.replace(/\./g, "").replace(",", "."));
      else if (f.typ === "ganzzahl") v = v === "" ? null : parseInt(v.replace(/\D/g, ""), 10);
      else if (v === "") v = null;
      if (f.typ === "zahl" && v != null && isNaN(v)) return toast(`„${f.label}“ ist keine gültige Zahl`, true);
      daten[f.name] = v;
    }
    const knopf = $("[type=submit]", form);
    knopf.disabled = true;
    const ok = await versuch(async () => { await speichern(daten); return true; });
    knopf.disabled = false;
    if (ok) { schliessen(); render(); }
  };
  document.body.append(modal);
  dialogOffen = true;
  setup?.(form);
  const erstes = $("input:not([type=checkbox]),textarea", form);
  if (erstes && matchMedia("(pointer:fine)").matches) erstes.focus();
}

function feldHtml(f, wert) {
  const id = "f_" + f.name;
  const req = f.pflicht ? "required" : "";
  const ph = f.platzhalter ? `placeholder="${h(f.platzhalter)}"` : "";
  let input;
  if (f.typ === "textarea") {
    input = `<textarea id="${id}" name="${f.name}" rows="4" ${req} ${ph}>${h(wert)}</textarea>`;
  } else if (f.typ === "select") {
    input = `<select id="${id}" name="${f.name}" ${req}>${f.optionen
      .map(([v, l]) => `<option value="${h(v)}" ${String(v) === String(wert ?? "") ? "selected" : ""}>${h(l)}</option>`)
      .join("")}</select>`;
  } else if (f.typ === "checkbox") {
    return `<label class="check"><input type="checkbox" name="${f.name}" ${wert ? "checked" : ""}> ${h(f.label)}</label>`;
  } else {
    const typen = { zahl: 'type="text" inputmode="decimal"', ganzzahl: 'type="text" inputmode="numeric"', tel: 'type="tel"', email: 'type="email"', datum: 'type="date"', zeit: 'type="time"' };
    let v = wert ?? "";
    if (f.typ === "zahl" && v !== "") v = String(v).replace(".", ",");
    input = `<input id="${id}" name="${f.name}" ${typen[f.typ] || 'type="text"'} value="${h(v)}" ${req} ${ph} ${f.gross ? 'style="text-transform:uppercase"' : ""}>`;
  }
  return `<label class="feld${f.halb ? " halb" : ""}" for="${id}"><span>${h(f.label)}${f.pflicht ? " *" : ""}</span>${input}</label>`;
}

// ---------------------------------------------------------------------
//  Fotos
// ---------------------------------------------------------------------
async function bildVerkleinern(datei, max = 1600) {
  const url = URL.createObjectURL(datei);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("Bild konnte nicht gelesen werden"));
      i.src = url;
    });
    const f = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * f);
    c.height = Math.round(img.naturalHeight * f);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob(res, "image/jpeg", 0.82));
  } finally {
    URL.revokeObjectURL(url);
  }
}

function galerieHtml(fotos, { fahrzeug_id, auftrag_id = null }) {
  return `
    <div class="galerie">
      ${fotos.map((f) => `<button class="foto" data-foto="${f.id}" data-pfad="${h(f.pfad)}" title="${h(f.beschreibung)}"><img alt=""></button>`).join("")}
      <label class="foto neu">
        <input type="file" accept="image/*" multiple hidden data-upload data-fahrzeug="${fahrzeug_id}" data-auftrag="${auftrag_id || ""}">
        <span>＋<br>Foto</span>
      </label>
    </div>`;
}

async function galerieAktivieren(root, fotos) {
  const urls = fotos.length ? await db.photoUrls(fotos.map((f) => f.pfad)) : {};
  $$("[data-foto]", root).forEach((btn) => {
    const foto = fotos.find((f) => f.id === btn.dataset.foto);
    $("img", btn).src = urls[foto.pfad] || "";
    btn.onclick = () => lightbox(foto, urls[foto.pfad]);
  });
  $$("[data-upload]", root).forEach((inp) => {
    inp.onchange = async () => {
      const dateien = [...inp.files];
      if (!dateien.length) return;
      let n = 0;
      const info = document.createElement("div");
      info.className = "toast";
      document.body.append(info);
      for (const d of dateien) {
        info.textContent = `Lade Foto ${++n} von ${dateien.length} hoch …`;
        const ok = await versuch(async () => {
          const blob = await bildVerkleinern(d);
          const pfad = await db.uploadPhoto(blob);
          await db.insert("fotos", { fahrzeug_id: inp.dataset.fahrzeug, auftrag_id: inp.dataset.auftrag || null, pfad });
          return true;
        });
        if (!ok) break;
      }
      info.remove();
      render();
    };
  });
}

function lightbox(foto, url) {
  const box = document.createElement("div");
  box.className = "lightbox";
  box.innerHTML = `
    <img src="${h(url)}" alt="">
    <div class="lightbox-leiste">
      <span>${h(foto.beschreibung || datum(foto.created_at))}</span>
      <span>
        <button class="btn klein" data-text>Beschreibung</button>
        <a class="btn klein" href="${h(url)}" target="_blank" rel="noopener">Öffnen</a>
        <button class="btn klein gefahr" data-weg>Löschen</button>
        <button class="btn klein" data-zu>✕</button>
      </span>
    </div>`;
  const zu = () => box.remove();
  $("[data-zu]", box).onclick = zu;
  $("img", box).onclick = zu;
  $("[data-text]", box).onclick = async () => {
    const t = prompt("Beschreibung zum Foto:", foto.beschreibung || "");
    if (t === null) return;
    await versuch(() => db.update("fotos", foto.id, { beschreibung: t.trim() || null }));
    zu(); render();
  };
  $("[data-weg]", box).onclick = async () => {
    if (!confirm("Foto in den Papierkorb verschieben?")) return;
    if (await versuch(async () => { await inPapierkorb("foto", foto.id); return true; })) toast("In den Papierkorb verschoben");
    zu(); render();
  };
  document.body.append(box);
}

// ---------------------------------------------------------------------
//  Formulare für die einzelnen Bereiche
// ---------------------------------------------------------------------
const KUNDE_FELDER = [
  { name: "name", label: "Name", pflicht: true },
  { name: "telefon", label: "Telefon", typ: "tel" },
  { name: "email", label: "E-Mail", typ: "email" },
  { name: "adresse", label: "Adresse", typ: "textarea" },
  { name: "notizen", label: "Notizen", typ: "textarea" },
];

function kundeFormular(kunde) {
  formular({
    titel: kunde ? "Kunde bearbeiten" : "Neuer Kunde",
    felder: KUNDE_FELDER,
    werte: kunde || {},
    async speichern(d) {
      if (kunde) await db.update("kunden", kunde.id, d);
      else { const neu = await db.insert("kunden", d); location.hash = "#/kunde/" + neu.id; }
    },
    loeschen: kunde && (async () => {
      await inPapierkorb("kunde", kunde.id);
      location.hash = "#/kunden";
    }),
  });
}

function fahrzeugFormular(fahrzeug, kunde_id) {
  formular({
    titel: fahrzeug ? "Fahrzeug bearbeiten" : "Neues Fahrzeug",
    felder: [
      { name: "kennzeichen", label: "Kennzeichen", platzhalter: "M-AB 1234", gross: true },
      { name: "marke", label: "Marke", halb: true, platzhalter: "VW" },
      { name: "modell", label: "Modell", halb: true, platzhalter: "Golf 7" },
      { name: "baujahr", label: "Baujahr", typ: "ganzzahl", halb: true },
      { name: "km", label: "km-Stand", typ: "ganzzahl", halb: true },
      { name: "fin", label: "Fahrgestellnummer (FIN)", gross: true },
      { name: "tuev", label: "TÜV / HU fällig", typ: "datum" },
      { name: "notizen", label: "Notizen", typ: "textarea" },
    ],
    werte: fahrzeug || {},
    async speichern(d) {
      if (d.kennzeichen) d.kennzeichen = d.kennzeichen.toUpperCase();
      if (d.fin) d.fin = d.fin.toUpperCase();
      if (fahrzeug) await db.update("fahrzeuge", fahrzeug.id, d);
      else { const neu = await db.insert("fahrzeuge", { ...d, kunde_id }); location.hash = "#/fahrzeug/" + neu.id; }
    },
    loeschen: fahrzeug && (async () => {
      await inPapierkorb("fahrzeug", fahrzeug.id);
      location.hash = "#/kunde/" + fahrzeug.kunde_id;
    }),
  });
}

function auftragFormular(auftrag, fahrzeug) {
  formular({
    titel: auftrag ? "Auftrag bearbeiten" : "Neuer Auftrag",
    felder: [
      { name: "titel", label: "Was wird gemacht?", pflicht: true, platzhalter: "z.B. Inspektion, Bremsen hinten" },
      { name: "datum", label: "Datum", typ: "datum", halb: true },
      { name: "km", label: "km-Stand", typ: "ganzzahl", halb: true },
      { name: "status", label: "Status", typ: "select", optionen: Object.entries(STATUS) },
      { name: "beschreibung", label: "Beschreibung / Arbeiten", typ: "textarea" },
      { name: "arbeitslohn", label: "Arbeitslohn (€)", typ: "zahl" },
    ],
    werte: auftrag || { datum: heute(), status: "offen", km: fahrzeug.km },
    async speichern(d) {
      d.datum ||= heute();
      if (auftrag) await db.update("auftraege", auftrag.id, d);
      else { const neu = await db.insert("auftraege", { ...d, fahrzeug_id: fahrzeug.id }); location.hash = "#/auftrag/" + neu.id; }
      if (d.km && d.km > (fahrzeug.km || 0)) await db.update("fahrzeuge", fahrzeug.id, { km: d.km });
    },
    loeschen: auftrag && (async () => {
      await inPapierkorb("auftrag", auftrag.id);
      location.hash = "#/fahrzeug/" + fahrzeug.id;
    }),
  });
}

async function auftragTeilFormular(auftrag) {
  const teile = await db.list("teile", { order: "name" });
  formular({
    titel: "Teil hinzufügen",
    felder: [
      { name: "teil_id", label: "Aus dem Lager", typ: "select", optionen: [["", "— nicht aus dem Lager —"], ...teile.map((t) => [t.id, `${t.name}${t.artikelnr ? " · " + t.artikelnr : ""} (Bestand ${zahl(t.bestand)})`])] },
      { name: "bezeichnung", label: "Bezeichnung", pflicht: true },
      { name: "menge", label: "Menge", typ: "zahl", halb: true },
      { name: "preis", label: "Preis pro Stück (€)", typ: "zahl", halb: true },
    ],
    werte: { menge: 1 },
    setup(form) {
      form.elements.teil_id.onchange = () => {
        const t = teile.find((x) => x.id === form.elements.teil_id.value);
        if (!t) return;
        form.elements.bezeichnung.value = t.name;
        form.elements.preis.value = t.verkaufspreis != null ? String(t.verkaufspreis).replace(".", ",") : "";
      };
    },
    async speichern(d) {
      d.menge ??= 1;
      await db.insert("auftrag_teile", { ...d, auftrag_id: auftrag.id });
      const t = teile.find((x) => x.id === d.teil_id);
      if (t) await db.update("teile", t.id, { bestand: Number(t.bestand) - d.menge });
    },
  });
}

function teilFormular(teil) {
  formular({
    titel: teil ? "Teil bearbeiten" : "Neues Teil",
    felder: [
      { name: "name", label: "Bezeichnung", pflicht: true, platzhalter: "z.B. Ölfilter VW 1.6 TDI" },
      { name: "artikelnr", label: "Artikelnummer", halb: true },
      { name: "hersteller", label: "Hersteller", halb: true },
      { name: "bestand", label: "Bestand", typ: "zahl", halb: true },
      { name: "mindestbestand", label: "Mindestbestand", typ: "zahl", halb: true },
      { name: "einkaufspreis", label: "Einkaufspreis (€)", typ: "zahl", halb: true },
      { name: "verkaufspreis", label: "Verkaufspreis (€)", typ: "zahl", halb: true },
      { name: "lagerort", label: "Lagerort", platzhalter: "z.B. Regal A2" },
      { name: "notizen", label: "Notizen / Lieferant", typ: "textarea" },
    ],
    werte: teil || { bestand: 0, mindestbestand: 0 },
    async speichern(d) {
      d.bestand ??= 0;
      d.mindestbestand ??= 0;
      if (teil) await db.update("teile", teil.id, d);
      else await db.insert("teile", d);
    },
    loeschen: teil && (() => inPapierkorb("teil", teil.id)),
  });
}

async function terminFormular(termin, vorgabe = {}) {
  const [kunden, fahrzeuge] = await Promise.all([db.list("kunden", { order: "name" }), db.list("fahrzeuge")]);
  const start = termin ? new Date(termin.beginn) : null;
  const w = termin
    ? { ...termin, tag: tagKey(start), zeit: uhrzeit(start) }
    : { tag: heute(), zeit: "09:00", dauer_min: 60, ...vorgabe };
  const fzOptionen = (kid) => [["", "— kein Fahrzeug —"], ...fahrzeuge.filter((f) => !kid || f.kunde_id === kid).map((f) => [f.id, `${f.kennzeichen || "?"} · ${fzName(f)}`])];
  formular({
    titel: termin ? "Termin bearbeiten" : "Neuer Termin",
    felder: [
      { name: "titel", label: "Was?", pflicht: true, platzhalter: "z.B. Reifenwechsel" },
      { name: "tag", label: "Datum", typ: "datum", pflicht: true, halb: true },
      { name: "zeit", label: "Uhrzeit", typ: "zeit", pflicht: true, halb: true },
      { name: "dauer_min", label: "Dauer", typ: "select", optionen: [[30, "30 Min."], [60, "1 Std."], [90, "1,5 Std."], [120, "2 Std."], [180, "3 Std."], [240, "4 Std."], [480, "Ganzer Tag"]] },
      { name: "kunde_id", label: "Kunde", typ: "select", optionen: [["", "— kein Kunde —"], ...kunden.map((k) => [k.id, k.name])] },
      { name: "fahrzeug_id", label: "Fahrzeug", typ: "select", optionen: fzOptionen(w.kunde_id) },
      { name: "notizen", label: "Notizen", typ: "textarea" },
      ...(termin ? [{ name: "erledigt", label: "Erledigt", typ: "checkbox" }] : []),
    ],
    werte: w,
    setup(form) {
      form.elements.kunde_id.onchange = () => {
        const opt = fzOptionen(form.elements.kunde_id.value);
        form.elements.fahrzeug_id.innerHTML = opt.map(([v, l]) => `<option value="${h(v)}">${h(l)}</option>`).join("");
        if (form.elements.kunde_id.value && opt.length === 2) form.elements.fahrzeug_id.value = opt[1][0];
      };
    },
    async speichern(d) {
      const { tag, zeit, ...rest } = d;
      rest.beginn = new Date(`${tag}T${zeit}`).toISOString();
      rest.dauer_min = Number(rest.dauer_min);
      if (termin) await db.update("termine", termin.id, rest);
      else await db.insert("termine", { ...rest, erledigt: false });
    },
    loeschen: termin && (() => inPapierkorb("termin", termin.id)),
  });
}

// ---------------------------------------------------------------------
//  Bausteine für Listen
// ---------------------------------------------------------------------
const pfeil = `<span class="pfeil">›</span>`;

function terminZeile(t, kundenMap, fzMap, mitDatum = false) {
  const k = kundenMap[t.kunde_id], f = fzMap[t.fahrzeug_id];
  const ende = new Date(new Date(t.beginn).getTime() + t.dauer_min * 6e4);
  return `
    <div class="zeile termin${t.erledigt ? " erledigt" : ""}" data-termin="${t.id}">
      <input type="checkbox" class="haken" data-haken="${t.id}" ${t.erledigt ? "checked" : ""} aria-label="erledigt">
      <div class="zeit">${mitDatum ? `<small>${datum(t.beginn).slice(0, 6)}</small>` : ""}${uhrzeit(t.beginn)}<small>–${uhrzeit(ende)}</small></div>
      <div class="inhalt">
        <strong>${h(t.titel)}</strong>
        <small>${[k?.name, f && `${f.kennzeichen || ""} ${fzName(f)}`].filter(Boolean).map(h).join(" · ")}</small>
      </div>
      ${pfeil}
    </div>`;
}

function terminZeilenAktivieren(root, termine) {
  $$("[data-termin]", root).forEach((el) => {
    el.onclick = (e) => {
      if (e.target.matches("[data-haken]")) return;
      terminFormular(termine.find((t) => t.id === el.dataset.termin));
    };
  });
  $$("[data-haken]", root).forEach((cb) => {
    cb.onchange = () => versuch(async () => { await db.update("termine", cb.dataset.haken, { erledigt: cb.checked }); render(); });
  });
}

function auftragZeile(a, fz, kunde) {
  return `
    <a class="zeile" href="#/auftrag/${a.id}">
      <div class="inhalt">
        <strong>${h(a.titel)}</strong>
        <small>${datum(a.datum)}${fz ? " · " + h(fz.kennzeichen || fzName(fz)) : ""}${kunde ? " · " + h(kunde.name) : ""}</small>
      </div>
      <span class="status ${a.status}">${STATUS[a.status]}</span>
      ${pfeil}
    </a>`;
}

const tuevBadge = (f) => {
  if (!f.tuev) return "";
  const t = tageBis(f.tuev);
  if (t < 0) return `<span class="badge rot">TÜV abgelaufen</span>`;
  if (t <= 30) return `<span class="badge gelb">TÜV in ${t} Tagen</span>`;
  return "";
};

const leer = (text) => `<p class="leer">${h(text)}</p>`;

// ---------------------------------------------------------------------
//  Ansichten
// ---------------------------------------------------------------------
async function viewStart() {
  const [termine, auftraege, fahrzeuge, kunden, teile] = await Promise.all([
    db.list("termine", { order: "beginn" }), db.list("auftraege", { order: "datum" }),
    db.list("fahrzeuge"), db.list("kunden"), db.list("teile", { order: "name" }),
  ]);
  const km = Object.fromEntries(kunden.map((k) => [k.id, k]));
  const fm = Object.fromEntries(fahrzeuge.map((f) => [f.id, f]));
  const morgen = tagKey(Date.now() + 864e5);
  const tHeute = termine.filter((t) => tagKey(t.beginn) === heute());
  const tMorgen = termine.filter((t) => tagKey(t.beginn) === morgen);
  const offen = auftraege.filter((a) => a.status !== "fertig");
  const knapp = teile.filter((t) => Number(t.mindestbestand) > 0 && Number(t.bestand) <= Number(t.mindestbestand));
  const tuev = fahrzeuge.filter((f) => f.tuev && tageBis(f.tuev) <= 30).sort((a, b) => a.tuev.localeCompare(b.tuev));

  return {
    titel: cfg.WERKSTATT_NAME || "Werkstatt",
    html: `
      ${sicherungsErinnerung()}
      <div class="schnell">
        <button class="btn primaer" data-neu-termin>＋ Termin</button>
        <button class="btn primaer" data-neu-kunde>＋ Kunde</button>
      </div>
      <h2>Heute · ${wochentag(new Date())}</h2>
      <div class="karte liste" id="t-heute">${tHeute.map((t) => terminZeile(t, km, fm)).join("") || leer("Keine Termine heute")}</div>
      ${tMorgen.length ? `<h2>Morgen</h2><div class="karte liste" id="t-morgen">${tMorgen.map((t) => terminZeile(t, km, fm)).join("")}</div>` : ""}
      <h2>Offene Aufträge (${offen.length})</h2>
      <div class="karte liste">${offen.map((a) => auftragZeile(a, fm[a.fahrzeug_id], km[fm[a.fahrzeug_id]?.kunde_id])).join("") || leer("Keine offenen Aufträge")}</div>
      ${knapp.length ? `<h2>Teile nachbestellen</h2><div class="karte liste">${knapp.map((t) => `
        <a class="zeile" href="#/teile"><div class="inhalt"><strong>${h(t.name)}</strong><small>${h(t.artikelnr || "")}</small></div>
        <span class="badge rot">${zahl(t.bestand)} / min. ${zahl(t.mindestbestand)}</span></a>`).join("")}</div>` : ""}
      ${tuev.length ? `<h2>TÜV / HU bald fällig</h2><div class="karte liste">${tuev.map((f) => `
        <a class="zeile" href="#/fahrzeug/${f.id}"><div class="inhalt"><strong>${h(f.kennzeichen || fzName(f))}</strong>
        <small>${h(fzName(f))} · ${h(km[f.kunde_id]?.name || "")} · ${datum(f.tuev)}</small></div>${tuevBadge(f)}</a>`).join("")}</div>` : ""}
    `,
    nachher(root) {
      $("[data-neu-termin]", root).onclick = () => terminFormular();
      $("[data-neu-kunde]", root).onclick = () => kundeFormular();
      terminZeilenAktivieren(root, termine);
    },
  };
}

let suchtext = "";
async function viewKunden() {
  const [kunden, fahrzeuge] = await Promise.all([db.list("kunden", { order: "name" }), db.list("fahrzeuge")]);
  const fzVon = (id) => fahrzeuge.filter((f) => f.kunde_id === id);
  const liste = () => {
    const q = suchtext.toLowerCase().replace(/[\s-]/g, "");
    const treffer = kunden.filter((k) => {
      if (!q) return true;
      const text = [k.name, k.telefon, k.email, ...fzVon(k.id).flatMap((f) => [f.kennzeichen, f.marke, f.modell, f.fin])].join("|").toLowerCase().replace(/[\s-]/g, "");
      return text.includes(q);
    });
    return treffer.map((k) => `
      <a class="zeile" href="#/kunde/${k.id}">
        <div class="avatar">${h(k.name.trim()[0]?.toUpperCase() || "?")}</div>
        <div class="inhalt"><strong>${h(k.name)}</strong>
          <small>${fzVon(k.id).map((f) => h(f.kennzeichen || fzName(f))).join(", ") || h(k.telefon || "")}</small></div>
        ${pfeil}
      </a>`).join("") || leer(kunden.length ? "Nichts gefunden" : "Noch keine Kunden – leg den ersten an!");
  };
  return {
    titel: "Kunden",
    aktion: ["＋", () => kundeFormular()],
    html: `
      <input type="search" class="suche" placeholder="Suche: Name, Kennzeichen, Telefon, FIN …" value="${h(suchtext)}">
      <div class="karte liste" id="kliste">${liste()}</div>`,
    nachher(root) {
      const s = $(".suche", root);
      s.oninput = () => { suchtext = s.value; $("#kliste", root).innerHTML = liste(); };
    },
  };
}

async function viewKunde(id) {
  const kunde = await db.get("kunden", id);
  if (!kunde) return nichtGefunden();
  const [fahrzeuge, termine] = await Promise.all([
    db.list("fahrzeuge", { eq: { kunde_id: id } }),
    db.list("termine", { eq: { kunde_id: id }, order: "beginn", asc: false }),
  ]);
  const fm = Object.fromEntries(fahrzeuge.map((f) => [f.id, f]));
  const tel = kunde.telefon?.replace(/[^\d+]/g, "");
  return {
    titel: kunde.name,
    zurueck: "#/kunden",
    aktion: ["Bearbeiten", () => kundeFormular(kunde)],
    html: `
      <div class="karte info">
        ${kunde.telefon ? `<a class="info-zeile" href="tel:${h(tel)}"><span>Telefon</span><b>${h(kunde.telefon)}</b></a>` : ""}
        ${kunde.email ? `<a class="info-zeile" href="mailto:${h(kunde.email)}"><span>E-Mail</span><b>${h(kunde.email)}</b></a>` : ""}
        ${kunde.adresse ? `<a class="info-zeile" target="_blank" rel="noopener" href="https://maps.google.com/?q=${encodeURIComponent(kunde.adresse)}"><span>Adresse</span><b class="mehrzeilig">${h(kunde.adresse)}</b></a>` : ""}
        ${kunde.notizen ? `<div class="info-zeile"><span>Notizen</span><b class="mehrzeilig">${h(kunde.notizen)}</b></div>` : ""}
        ${!kunde.telefon && !kunde.email && !kunde.adresse && !kunde.notizen ? leer("Keine Kontaktdaten") : ""}
      </div>
      ${tel ? `<div class="schnell"><a class="btn" href="tel:${h(tel)}">📞 Anrufen</a><a class="btn" href="sms:${h(tel)}">💬 SMS</a></div>` : ""}
      <h2>Fahrzeuge <button class="btn klein" data-neu-fz>＋ Fahrzeug</button></h2>
      <div class="karte liste">${fahrzeuge.map((f) => `
        <a class="zeile" href="#/fahrzeug/${f.id}">
          <div class="kennzeichen">${h(f.kennzeichen || "—")}</div>
          <div class="inhalt"><strong>${h(fzName(f))}</strong><small>${[f.baujahr, f.km && zahl(f.km) + " km"].filter(Boolean).join(" · ")}</small></div>
          ${tuevBadge(f)}${pfeil}
        </a>`).join("") || leer("Noch kein Fahrzeug")}</div>
      <h2>Termine <button class="btn klein" data-neu-termin>＋ Termin</button></h2>
      <div class="karte liste">${termine.map((t) => terminZeile(t, { [id]: null }, fm, true)).join("") || leer("Keine Termine")}</div>
    `,
    nachher(root) {
      $("[data-neu-fz]", root).onclick = () => fahrzeugFormular(null, id);
      $("[data-neu-termin]", root).onclick = () => terminFormular(null, { kunde_id: id, fahrzeug_id: fahrzeuge.length === 1 ? fahrzeuge[0].id : "" });
      terminZeilenAktivieren(root, termine);
    },
  };
}

async function viewFahrzeug(id) {
  const f = await db.get("fahrzeuge", id);
  if (!f) return nichtGefunden();
  const [kunde, auftraege, fotos] = await Promise.all([
    db.get("kunden", f.kunde_id),
    db.list("auftraege", { eq: { fahrzeug_id: id }, order: "datum", asc: false }),
    db.list("fotos", { eq: { fahrzeug_id: id }, order: "created_at", asc: false }),
  ]);
  const zeile = (l, v) => (v ? `<div class="info-zeile"><span>${l}</span><b>${v}</b></div>` : "");
  return {
    titel: f.kennzeichen || fzName(f),
    zurueck: "#/kunde/" + f.kunde_id,
    aktion: ["Bearbeiten", () => fahrzeugFormular(f)],
    html: `
      <div class="karte info">
        <div class="fz-kopf"><div class="kennzeichen gross">${h(f.kennzeichen || "—")}</div><div><strong>${h(fzName(f))}</strong><br>${tuevBadge(f)}</div></div>
        <a class="info-zeile" href="#/kunde/${kunde?.id}"><span>Kunde</span><b>${h(kunde?.name)} ›</b></a>
        ${zeile("Baujahr", h(f.baujahr))}
        ${zeile("km-Stand", f.km ? zahl(f.km) + " km" : "")}
        ${zeile("FIN", `<span class="mono">${h(f.fin)}</span>`.replace(/<span class="mono"><\/span>/, ""))}
        ${zeile("TÜV / HU", datum(f.tuev))}
        ${f.notizen ? `<div class="info-zeile"><span>Notizen</span><b class="mehrzeilig">${h(f.notizen)}</b></div>` : ""}
      </div>
      <h2>Aufträge / Historie <button class="btn klein" data-neu-auftrag>＋ Auftrag</button></h2>
      <div class="karte liste">${auftraege.map((a) => auftragZeile(a)).join("") || leer("Noch keine Aufträge")}</div>
      <h2>Fotos (${fotos.length})</h2>
      ${galerieHtml(fotos, { fahrzeug_id: id })}
    `,
    async nachher(root) {
      $("[data-neu-auftrag]", root).onclick = () => auftragFormular(null, f);
      await galerieAktivieren(root, fotos);
    },
  };
}

async function viewAuftrag(id) {
  const a = await db.get("auftraege", id);
  if (!a) return nichtGefunden();
  const [f, teile, fotos] = await Promise.all([
    db.get("fahrzeuge", a.fahrzeug_id),
    db.list("auftrag_teile", { eq: { auftrag_id: id } }),
    db.list("fotos", { eq: { auftrag_id: id }, order: "created_at", asc: false }),
  ]);
  const kunde = f && (await db.get("kunden", f.kunde_id));
  const summeTeile = teile.reduce((s, t) => s + Number(t.menge) * Number(t.preis || 0), 0);
  const gesamt = summeTeile + Number(a.arbeitslohn || 0);
  return {
    titel: a.titel,
    zurueck: "#/fahrzeug/" + a.fahrzeug_id,
    aktion: ["Bearbeiten", () => auftragFormular(a, f)],
    html: `
      <div class="karte info">
        <a class="info-zeile" href="#/fahrzeug/${f.id}"><span>Fahrzeug</span><b>${h(f.kennzeichen || "")} ${h(fzName(f))} ›</b></a>
        <a class="info-zeile" href="#/kunde/${kunde?.id}"><span>Kunde</span><b>${h(kunde?.name)} ›</b></a>
        <div class="info-zeile"><span>Datum</span><b>${datum(a.datum)}</b></div>
        ${a.km ? `<div class="info-zeile"><span>km-Stand</span><b>${zahl(a.km)} km</b></div>` : ""}
      </div>
      <div class="segment">${Object.entries(STATUS).map(([k, l]) => `<button class="${a.status === k ? "an " + k : ""}" data-status="${k}">${l}</button>`).join("")}</div>
      <h2>Arbeiten</h2>
      <div class="karte text">${a.beschreibung ? h(a.beschreibung) : leer("Keine Beschreibung – über „Bearbeiten“ hinzufügen")}</div>
      <h2>Teile <button class="btn klein" data-neu-teil>＋ Teil</button></h2>
      <div class="karte liste">
        ${teile.map((t) => `
          <div class="zeile">
            <div class="inhalt"><strong>${zahl(t.menge)} × ${h(t.bezeichnung)}</strong><small>${t.preis != null ? money(t.preis) + " / Stk." : ""}</small></div>
            <b>${t.preis != null ? money(t.menge * t.preis) : ""}</b>
            <button class="btn klein gefahr" data-teil-weg="${t.id}" aria-label="entfernen">✕</button>
          </div>`).join("") || leer("Keine Teile eingetragen")}
      </div>
      <div class="karte summe">
        <div><span>Teile</span><b>${money(summeTeile)}</b></div>
        <div><span>Arbeitslohn</span><b>${money(a.arbeitslohn || 0)}</b></div>
        <div class="gesamt"><span>Gesamt (brutto)</span><b>${money(gesamt)}</b></div>
      </div>
      <h2>Fotos zum Auftrag (${fotos.length})</h2>
      ${galerieHtml(fotos, { fahrzeug_id: a.fahrzeug_id, auftrag_id: id })}
    `,
    async nachher(root) {
      $$("[data-status]", root).forEach((b) => (b.onclick = () => versuch(async () => { await db.update("auftraege", id, { status: b.dataset.status }); render(); })));
      $("[data-neu-teil]", root).onclick = () => auftragTeilFormular(a);
      $$("[data-teil-weg]", root).forEach((b) => (b.onclick = () => versuch(async () => {
        const t = teile.find((x) => x.id === b.dataset.teilWeg);
        if (!confirm(`„${t.bezeichnung}“ entfernen?${t.teil_id ? " (Wird wieder ins Lager gebucht.)" : ""}`)) return;
        await db.remove("auftrag_teile", t.id);
        if (t.teil_id) {
          const lager = await db.get("teile", t.teil_id);
          if (lager) await db.update("teile", lager.id, { bestand: Number(lager.bestand) + Number(t.menge) });
        }
        render();
      })));
      await galerieAktivieren(root, fotos);
    },
  };
}

let terminFilter = "kommend";
async function viewTermine() {
  const [termine, kunden, fahrzeuge] = await Promise.all([db.list("termine", { order: "beginn" }), db.list("kunden"), db.list("fahrzeuge")]);
  const km = Object.fromEntries(kunden.map((k) => [k.id, k]));
  const fm = Object.fromEntries(fahrzeuge.map((f) => [f.id, f]));
  const h0 = heute();
  let auswahl = terminFilter === "kommend" ? termine.filter((t) => tagKey(t.beginn) >= h0) : termine.filter((t) => tagKey(t.beginn) < h0).reverse();
  const tage = {};
  for (const t of auswahl) (tage[tagKey(t.beginn)] ||= []).push(t);
  return {
    titel: "Termine",
    aktion: ["＋", () => terminFormular()],
    html: `
      <div class="segment">
        <button class="${terminFilter === "kommend" ? "an" : ""}" data-filter="kommend">Kommende</button>
        <button class="${terminFilter === "vergangen" ? "an" : ""}" data-filter="vergangen">Vergangene</button>
      </div>
      ${Object.entries(tage).map(([tag, ts]) => `
        <h2>${tag === h0 ? "Heute · " : ""}${wochentag(tag + "T00:00")}</h2>
        <div class="karte liste">${ts.map((t) => terminZeile(t, km, fm)).join("")}</div>`).join("") || `<div class="karte">${leer("Keine Termine")}</div>`}
    `,
    nachher(root) {
      $$("[data-filter]", root).forEach((b) => (b.onclick = () => { terminFilter = b.dataset.filter; render(); }));
      terminZeilenAktivieren(root, termine);
    },
  };
}

let teileSuche = "";
async function viewTeile() {
  const teile = await db.list("teile", { order: "name" });
  const liste = () => {
    const q = teileSuche.toLowerCase();
    return teile
      .filter((t) => !q || [t.name, t.artikelnr, t.hersteller, t.lagerort].join("|").toLowerCase().includes(q))
      .map((t) => {
        const knapp = Number(t.mindestbestand) > 0 && Number(t.bestand) <= Number(t.mindestbestand);
        return `
          <div class="zeile" data-teil="${t.id}">
            <div class="inhalt"><strong>${h(t.name)}</strong>
              <small>${[t.artikelnr, t.hersteller, t.lagerort, t.verkaufspreis != null && money(t.verkaufspreis)].filter(Boolean).map(h).join(" · ")}</small></div>
            <div class="zaehler">
              <button class="btn klein" data-minus="${t.id}" aria-label="weniger">−</button>
              <span class="badge ${knapp ? "rot" : ""}">${zahl(t.bestand)}</span>
              <button class="btn klein" data-plus="${t.id}" aria-label="mehr">＋</button>
            </div>
          </div>`;
      }).join("") || leer(teile.length ? "Nichts gefunden" : "Noch keine Teile im Lager");
  };
  const aktivieren = (root) => {
    $$("[data-teil]", root).forEach((el) => (el.onclick = (e) => {
      if (e.target.closest("button")) return;
      teilFormular(teile.find((t) => t.id === el.dataset.teil));
    }));
    const aendern = (id, d) => versuch(async () => {
      const t = teile.find((x) => x.id === id);
      t.bestand = Math.max(0, Number(t.bestand) + d);
      await db.update("teile", id, { bestand: t.bestand });
      $("#tliste", root).innerHTML = liste();
      aktivieren(root);
    });
    $$("[data-plus]", root).forEach((b) => (b.onclick = () => aendern(b.dataset.plus, 1)));
    $$("[data-minus]", root).forEach((b) => (b.onclick = () => aendern(b.dataset.minus, -1)));
  };
  return {
    titel: "Teile-Lager",
    aktion: ["＋", () => teilFormular()],
    html: `
      <input type="search" class="suche" placeholder="Suche: Bezeichnung, Artikelnr., Lagerort …" value="${h(teileSuche)}">
      <div class="karte liste" id="tliste">${liste()}</div>`,
    nachher(root) {
      const s = $(".suche", root);
      s.oninput = () => { teileSuche = s.value; $("#tliste", root).innerHTML = liste(); aktivieren(root); };
      aktivieren(root);
    },
  };
}

function sicherungsErinnerung() {
  const l = letzteSicherung();
  const tage = l ? Math.floor((Date.now() - new Date(l)) / 864e5) : null;
  if (tage !== null && tage < 30) return "";
  return `<a class="hinweis-karte" href="#/mehr">💾 ${tage === null ? "Auf diesem Gerät wurde noch keine Datensicherung gemacht." : `Letzte Datensicherung vor ${tage} Tagen.`} <b>Jetzt sichern ›</b></a>`;
}

const PK_SYMBOL = { kunde: "👤", fahrzeug: "🚗", auftrag: "📋", teil: "🔧", termin: "📅", foto: "📷" };
const PK_NAME = { kunde: "Kunde", fahrzeug: "Fahrzeug", auftrag: "Auftrag", teil: "Teil", termin: "Termin", foto: "Foto" };

function fortschrittsAnzeige() {
  const info = document.createElement("div");
  info.className = "toast";
  document.body.append(info);
  dialogOffen = true;
  return {
    setzen: (t) => (info.textContent = t),
    fertig: () => { info.remove(); dialogOffen = false; },
  };
}

async function viewMehr() {
  const papierkorb = await db.list("papierkorb", { order: "created_at", asc: false });
  const l = letzteSicherung();
  const inhalt = (e) => {
    const z = e.daten.zeilen || {};
    const teile = [];
    if (e.typ === "kunde" && z.fahrzeuge?.length) teile.push(`${z.fahrzeuge.length} Fahrzeug(e)`);
    if (z.auftraege?.length && e.typ !== "auftrag") teile.push(`${z.auftraege.length} Auftrag/Aufträge`);
    if (z.fotos?.length && e.typ !== "foto") teile.push(`${z.fotos.length} Foto(s)`);
    return teile.length ? " · mit " + teile.join(", ") : "";
  };
  return {
    titel: "Mehr",
    html: `
      <h2>Datensicherung</h2>
      <div class="karte text-block">
        <p>Lädt <b>alle Daten</b> als ZIP-Datei herunter: Kunden, Fahrzeuge, Aufträge, Termine, Teile und auf Wunsch alle Fotos.
        Die Datei am besten auf einen USB-Stick oder in eine Cloud (z.B. Google Drive) kopieren. <b>Empfehlung: einmal im Monat.</b></p>
        <p class="leise">Letzte Sicherung auf diesem Gerät: <b>${l ? datum(l) + ", " + uhrzeit(l) + " Uhr" : "noch nie"}</b></p>
        <button class="btn primaer breit" data-sichern="1">💾 Sicherung mit Fotos herunterladen</button>
        <button class="btn breit" data-sichern="0">Nur Daten, ohne Fotos (kleine Datei)</button>
      </div>

      <h2>Sicherung einspielen</h2>
      <div class="karte text-block">
        <p>Stellt alle Daten aus einer Sicherungsdatei wieder her. Vorhandene Einträge werden dabei auf den Stand der Sicherung gesetzt,
        neuere Einträge bleiben erhalten.</p>
        <label class="btn breit">📂 Sicherungsdatei auswählen …<input type="file" accept=".zip,application/zip" hidden data-einspielen></label>
      </div>

      <h2>Papierkorb (${papierkorb.length})
        ${papierkorb.length ? `<button class="btn klein gefahr" data-leeren>Leeren</button>` : ""}</h2>
      <div class="karte liste">
        ${papierkorb.map((e) => `
          <div class="zeile pk">
            <div class="avatar">${PK_SYMBOL[e.typ] || "?"}</div>
            <div class="inhalt">
              <strong>${h(e.titel || PK_NAME[e.typ])}</strong>
              <small>${PK_NAME[e.typ]}${h(inhalt(e))} · gelöscht ${datum(e.created_at)} · noch ${tageUebrig(e)} Tage</small>
            </div>
            <button class="btn klein" data-zurueck="${e.id}">Wiederherstellen</button>
          </div>`).join("") || leer(`Leer. Gelöschtes bleibt hier ${AUFBEWAHRUNG_TAGE} Tage, danach wird es endgültig entfernt.`)}
      </div>

      <h2>Konto</h2>
      <div class="karte liste">
        <button class="zeile knopf-zeile" data-abmelden><div class="inhalt"><strong>Abmelden</strong>
          <small>${DEMO ? "Demo-Modus – Daten nur in diesem Browser" : "Angemeldet – Daten werden synchronisiert"}</small></div>${pfeil}</button>
      </div>
    `,
    nachher(root) {
      $$("[data-sichern]", root).forEach((b) => (b.onclick = async () => {
        const f = fortschrittsAnzeige();
        const r = await versuch(() => sicherungErstellen({ mitFotos: b.dataset.sichern === "1", fortschritt: f.setzen }));
        f.fertig();
        if (r) {
          toast(`Gespeichert: ${r.name} (${(r.groesse / 1048576).toLocaleString("de-DE", { maximumFractionDigits: 1 })} MB)`);
          if (r.fehlend) toast(`${r.fehlend} Foto(s) konnten nicht geladen werden`, true);
          render();
        }
      }));
      const inp = $("[data-einspielen]", root);
      inp.onchange = async () => {
        const datei = inp.files[0];
        inp.value = "";
        if (!datei || !confirm(`Sicherung „${datei.name}“ einspielen?`)) return;
        const f = fortschrittsAnzeige();
        const r = await versuch(() => sicherungEinspielen(datei, f.setzen));
        f.fertig();
        if (r) {
          const a = r.anzahl;
          alert(`Sicherung vom ${datum(r.erstellt)} eingespielt:\n\n` +
            `${a.kunden || 0} Kunden\n${a.fahrzeuge || 0} Fahrzeuge\n${a.auftraege || 0} Aufträge\n${a.termine || 0} Termine\n${a.teile || 0} Teile\n${a.fotos || 0} Fotos` +
            (r.ohneDatei ? `\n\n${r.ohneDatei} Foto(s) waren nicht in der Sicherung enthalten und wurden übersprungen.` : ""));
          render();
        }
      };
      $$("[data-zurueck]", root).forEach((b) => (b.onclick = () => versuch(async () => {
        b.disabled = true;
        const e = papierkorb.find((x) => x.id === b.dataset.zurueck);
        await wiederherstellen(e);
        toast(`„${e.titel || PK_NAME[e.typ]}“ wiederhergestellt`);
        render();
      })));
      const leeren = $("[data-leeren]", root);
      if (leeren) leeren.onclick = () => versuch(async () => {
        if (!confirm("Papierkorb endgültig leeren? Das kann nicht rückgängig gemacht werden.")) return;
        for (const e of papierkorb) await endgueltigLoeschen(e);
        render();
      });
      $("[data-abmelden]", root).onclick = () => confirm("Abmelden?") && db.signOut().then(() => location.reload());
    },
  };
}

function nichtGefunden() {
  return { titel: "Nicht gefunden", zurueck: "#/start", html: `<div class="karte">${leer("Dieser Eintrag existiert nicht (mehr).")}</div>` };
}

// ---------------------------------------------------------------------
//  Router
// ---------------------------------------------------------------------
const ROUTEN = {
  start: viewStart, kunden: viewKunden, kunde: viewKunde, fahrzeug: viewFahrzeug,
  auftrag: viewAuftrag, termine: viewTermine, teile: viewTeile, mehr: viewMehr,
};
const TAB_VON = { start: "start", kunden: "kunden", kunde: "kunden", fahrzeug: "kunden", auftrag: "kunden", termine: "termine", teile: "teile", mehr: "mehr" };

let renderNr = 0;
let letzteRoute = "";
async function render() {
  const [, name = "start", id] = location.hash.split("/");
  const view = ROUTEN[name] || viewStart;
  const nr = ++renderNr;
  const v = await versuch(() => view(id));
  if (!v || nr !== renderNr) return;

  const route = location.hash;
  const neueSeite = route !== letzteRoute;
  letzteRoute = route;
  const scroll = window.scrollY;

  document.title = `${v.titel} · ${cfg.WERKSTATT_NAME || "Werkstatt"}`;
  $("#titel").textContent = v.titel;
  const zur = $("#zurueck");
  zur.hidden = !v.zurueck;
  zur.href = v.zurueck || "#";
  const akt = $("#aktion");
  akt.hidden = !v.aktion;
  if (v.aktion) { akt.textContent = v.aktion[0]; akt.onclick = v.aktion[1]; }
  $$("nav.tabs a").forEach((a) => a.classList.toggle("aktiv", a.dataset.tab === (TAB_VON[name] || "start")));

  const main = $("#inhalt");
  main.innerHTML = v.html;
  await v.nachher?.(main);
  window.scrollTo(0, neueSeite ? 0 : scroll);
}

// ---------------------------------------------------------------------
//  Start & Login
// ---------------------------------------------------------------------
function loginZeigen() {
  document.body.classList.add("ausgeloggt");
  $("#login").hidden = false;
  $("#app").hidden = true;
  const form = $("#login form");
  if (DEMO) {
    $("#login-felder").hidden = true;
    $("#demo-hinweis").hidden = false;
  }
  form.onsubmit = async (e) => {
    e.preventDefault();
    const knopf = $("button", form);
    knopf.disabled = true;
    const ok = await versuch(async () => { await db.signIn(form.email.value.trim(), form.passwort.value); return true; });
    knopf.disabled = false;
    if (ok) appStarten();
  };
}

let gestartet = false;
function appStarten() {
  document.body.classList.remove("ausgeloggt");
  $("#login").hidden = true;
  $("#app").hidden = false;
  $("#demo-banner").hidden = !DEMO;
  if (gestartet) return render();
  gestartet = true;

  window.addEventListener("hashchange", render);
  aufraeumen().catch(console.error);

  let timer;
  db.onChange(() => {
    clearTimeout(timer);
    timer = setTimeout(() => (dialogOffen || $(".lightbox") ? (renderWartet = true) : render()), 400);
  });
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && !dialogOffen && render());
  render();
}

(async () => {
  $("#werkstatt-name").textContent = cfg.WERKSTATT_NAME || "Werkstatt";
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
  db.onAuth((session) => { if (!session && gestartet) location.reload(); });
  (await db.session()) ? appStarten() : loginZeigen();
})();
