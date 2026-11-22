// Einfacher Grundriss-Editor (SVG). Einheiten intern: Zentimeter.
// Elemente: { t:"w", art:"wand"|"fenster"|"tuer"|"linie", x1,y1,x2,y2 }  und  { t:"t", x,y, s:"Text" }

const NS = "http://www.w3.org/2000/svg";
const RASTER = 10; // auf 10 cm einrasten
const DICKE = { wand: 15, fenster: 8, tuer: 4, linie: 0 };

const WERKZEUGE = [
  ["wand", "▬", "Wand"],
  ["fenster", "▭", "Fenster"],
  ["tuer", "◜", "Tür"],
  ["linie", "┄", "Linie"],
  ["text", "T", "Text"],
  ["auswahl", "☝", "Auswählen"],
  ["hand", "✋", "Verschieben"],
];

function el(name, attr = {}, kinder = []) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attr)) e.setAttribute(k, v);
  for (const k of kinder) e.append(k);
  return e;
}

export function meterText(cm) {
  return (cm / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " m";
}
const laenge = (w) => Math.hypot(w.x2 - w.x1, w.y2 - w.y1);

function abstandZuStrecke(p, w) {
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p.x - w.x1) * dx + (p.y - w.y1) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (w.x1 + t * dx), p.y - (w.y1 + t * dy));
}

// Zeichnet die Elemente in eine SVG-Gruppe. s = Pixel pro cm (für gleichbleibende Schrift)
function zeichneElemente(gruppe, els, s, ausgewaehlt) {
  for (const e of els) {
    const sel = e === ausgewaehlt;
    if (e.t === "w") {
      const farbe = sel ? "#e8590c" : e.art === "fenster" ? "#1c7ed6" : e.art === "tuer" ? "#9c6b30" : "currentColor";
      if (e.art === "linie") {
        gruppe.append(el("line", { x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2, stroke: farbe, "stroke-width": 1.5 / s, "stroke-dasharray": `${6 / s} ${4 / s}` }));
      } else if (e.art === "tuer") {
        const l = laenge(e);
        const nx = -(e.y2 - e.y1) / (l || 1), ny = (e.x2 - e.x1) / (l || 1);
        const px = e.x1 + nx * l, py = e.y1 + ny * l;
        gruppe.append(el("line", { x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2, stroke: farbe, "stroke-width": DICKE.tuer, "stroke-linecap": "butt" }));
        gruppe.append(el("path", { d: `M${e.x1},${e.y1} L${px},${py} M${e.x2},${e.y2} A${l},${l} 0 0 1 ${px},${py}`, fill: "none", stroke: farbe, "stroke-width": 1.2 / s }));
      } else {
        gruppe.append(el("line", { x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2, stroke: farbe, "stroke-width": DICKE[e.art] || DICKE.wand, "stroke-linecap": e.art === "wand" ? "square" : "butt" }));
        if (e.art === "fenster") gruppe.append(el("line", { x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2, stroke: "var(--karte, #fff)", "stroke-width": 2 / s }));
      }
      // Längenangabe
      const l = laenge(e);
      if (l >= 1) {
        let winkel = (Math.atan2(e.y2 - e.y1, e.x2 - e.x1) * 180) / Math.PI;
        if (winkel > 90) winkel -= 180;
        if (winkel <= -90) winkel += 180;
        const rad = (winkel * Math.PI) / 180;
        // Fenster/Tür-Maße auf die andere Seite, damit sie nicht mit der Wandlänge kollidieren
        const seite = e.art === "fenster" || e.art === "tuer" ? -1.9 : 1;
        const versatz = ((DICKE.wand / 2) + 9 / s) * seite;
        const mx = (e.x1 + e.x2) / 2 + Math.sin(rad) * versatz;
        const my = (e.y1 + e.y2) / 2 - Math.cos(rad) * versatz;
        const t = el("text", {
          x: mx, y: my, "font-size": 12 / s, "text-anchor": "middle", fill: sel || e.art === "fenster" || e.art === "tuer" ? farbe : "currentColor",
          transform: `rotate(${winkel} ${mx} ${my})`, "font-family": "system-ui, sans-serif", opacity: 0.85,
        });
        t.textContent = meterText(l);
        gruppe.append(t);
      }
    } else if (e.t === "t") {
      const t = el("text", { x: e.x, y: e.y, "font-size": 15 / s, "text-anchor": "middle", "dominant-baseline": "middle", "font-weight": 600, fill: sel ? "#e8590c" : "currentColor", "font-family": "system-ui, sans-serif" });
      t.textContent = e.s;
      gruppe.append(t);
    }
  }
}

function grenzen(els) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const e of els) {
    const pts = e.t === "w" ? [[e.x1, e.y1], [e.x2, e.y2]] : [[e.x - 60, e.y - 20], [e.x + 60, e.y + 20]];
    for (const [x, y] of pts) { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); }
  }
  return isFinite(x1) ? { x1, y1, x2, y2 } : null;
}

// Vorschaubild: klein für Listen (ohne Beschriftung) oder groß für den Bericht (mit Längen)
export function vorschauSvg(els, { beschriftet = false, breite = 160 } = {}) {
  const g = grenzen(els || []);
  const svg = el("svg", { class: "plan-vorschau", preserveAspectRatio: "xMidYMid meet" });
  if (!g) { svg.setAttribute("viewBox", "0 0 100 100"); return svg; }
  const rand = beschriftet ? 60 : 40;
  const w = g.x2 - g.x1 + 2 * rand, h = g.y2 - g.y1 + 2 * rand;
  svg.setAttribute("viewBox", `${g.x1 - rand} ${g.y1 - rand} ${w} ${h}`);
  const gr = el("g");
  zeichneElemente(gr, beschriftet ? els : els.filter((e) => e.t === "w"), breite / Math.max(w, h), null);
  if (!beschriftet) gr.querySelectorAll("text").forEach((t) => t.remove());
  svg.append(gr);
  return svg;
}

// Als PNG herunterladen
export async function alsBild(els, name) {
  const g = grenzen(els) || { x1: 0, y1: 0, x2: 500, y2: 500 };
  const rand = 80;
  const w = g.x2 - g.x1 + 2 * rand, h = g.y2 - g.y1 + 2 * rand;
  const pxBreite = Math.min(3000, Math.max(1200, w * 2));
  const s = pxBreite / w;
  const svg = el("svg", { xmlns: NS, width: pxBreite, height: Math.round(h * s), viewBox: `${g.x1 - rand} ${g.y1 - rand} ${w} ${h}`, color: "#111", style: "--karte:#fff" });
  svg.append(el("rect", { x: g.x1 - rand, y: g.y1 - rand, width: w, height: h, fill: "#fff" }));
  const gr = el("g");
  zeichneElemente(gr, els, s, null);
  svg.append(gr);
  const titel = el("text", { x: g.x1 - rand + 20 / s, y: g.y1 - rand + 30 / s, "font-size": 20 / s, "font-family": "system-ui, sans-serif", fill: "#111", "font-weight": 700 });
  titel.textContent = name;
  svg.append(titel);
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }));
  const img = new Image();
  await new Promise((ok, f) => { img.onload = ok; img.onerror = f; img.src = url; });
  const c = document.createElement("canvas");
  c.width = svg.getAttribute("width"); c.height = svg.getAttribute("height");
  c.getContext("2d").drawImage(img, 0, 0);
  URL.revokeObjectURL(url);
  const a = document.createElement("a");
  a.href = c.toDataURL("image/png");
  a.download = (name || "grundriss").replace(/[^\w äöüÄÖÜß.-]/g, "_") + ".png";
  a.click();
}

// ---------------------------------------------------------------------
//  Editor
// ---------------------------------------------------------------------
export function editor(wurzel, startElemente, { beiSpeichern, name }) {
  let els = JSON.parse(JSON.stringify(startElemente || []));
  let werkzeug = "wand";
  let auswahl = null;
  let vorschau = null; // Wand, die gerade gezogen wird
  const rueck = [];
  const view = { x: -100, y: -100, s: 1 }; // s = Pixel pro cm

  wurzel.innerHTML = "";
  wurzel.classList.add("editor");

  const leiste = document.createElement("div");
  leiste.className = "ed-leiste";
  const knoepfe = {};
  for (const [id, sym, titel] of WERKZEUGE) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ed-wz";
    b.innerHTML = `<span>${sym}</span><small>${titel}</small>`;
    b.onclick = () => { werkzeug = id; if (id !== "auswahl") auswahl = null; aktualisieren(); };
    knoepfe[id] = b;
    leiste.append(b);
  }
  const trenner = document.createElement("span");
  trenner.className = "ed-trenner";
  leiste.append(trenner);
  const aktion = (sym, titel, fn) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ed-wz";
    b.innerHTML = `<span>${sym}</span><small>${titel}</small>`;
    b.onclick = fn;
    leiste.append(b);
    return b;
  };
  const knopfRueck = aktion("↶", "Zurück", rueckgaengig);
  aktion("⤢", "Einpassen", () => { einpassen(); zeichnen(); });
  aktion("＋", "Zoom", () => zoomUm(1.4));
  aktion("－", "Zoom", () => zoomUm(1 / 1.4));
  aktion("⬇", "Bild", () => alsBild(els, name));

  const flaeche = document.createElement("div");
  flaeche.className = "ed-flaeche";
  const svg = el("svg", { class: "ed-svg" });
  const gRaster = el("g");
  const gInhalt = el("g");
  const gGriffe = el("g");
  svg.append(gRaster, gInhalt, gGriffe);
  flaeche.append(svg);

  const hinweis = document.createElement("div");
  hinweis.className = "ed-hinweis";

  const panel = document.createElement("div");
  panel.className = "ed-panel";

  wurzel.append(leiste, flaeche, hinweis, panel);

  // ---------- Hilfen ----------
  const groesse = () => ({ w: flaeche.clientWidth || 1, h: flaeche.clientHeight || 1 });
  function welt(ev) {
    const r = svg.getBoundingClientRect();
    return { x: view.x + (ev.clientX - r.left) / view.s, y: view.y + (ev.clientY - r.top) / view.s };
  }
  const einrasten = (v) => Math.round(v / RASTER) * RASTER;

  function endpunkte(ausser) {
    const pts = [];
    for (const e of els) if (e.t === "w" && e !== ausser) pts.push({ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 });
    return pts;
  }
  function fangen(p, ausser) {
    let best = null, bestD = 14 / view.s;
    for (const q of endpunkte(ausser)) {
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bestD) { best = q; bestD = d; }
    }
    return best ? { ...best, gefangen: true } : { x: einrasten(p.x), y: einrasten(p.y) };
  }
  // Ende fangen + gerade/45° ausrichten
  function endeFangen(start, p, ausser) {
    const f = fangen(p, ausser);
    if (f.gefangen) return f;
    const dx = p.x - start.x, dy = p.y - start.y;
    const l = Math.hypot(dx, dy);
    if (l < 1) return { x: start.x, y: start.y };
    const w = Math.atan2(dy, dx);
    const stufe = Math.PI / 4;
    const gerundet = Math.round(w / stufe) * stufe;
    if (Math.abs(w - gerundet) < (8 * Math.PI) / 180) {
      const lr = einrasten(l);
      return { x: start.x + Math.cos(gerundet) * lr, y: start.y + Math.sin(gerundet) * lr };
    }
    return f;
  }

  function treffer(p) {
    const tol = 12 / view.s;
    let best = null, bestD = Infinity;
    for (const e of els) {
      let d;
      if (e.t === "w") d = abstandZuStrecke(p, e) - (DICKE[e.art] || 0) / 2;
      else {
        const breite = (e.s.length * 9) / view.s, hoehe = 18 / view.s;
        d = Math.abs(p.x - e.x) < breite / 2 + tol && Math.abs(p.y - e.y) < hoehe / 2 + tol ? 0 : Infinity;
      }
      if (d < tol && d < bestD) { best = e; bestD = d; }
    }
    return best;
  }

  function merken() {
    rueck.push(JSON.stringify(els));
    if (rueck.length > 100) rueck.shift();
  }
  function rueckgaengig() {
    if (!rueck.length) return;
    els = JSON.parse(rueck.pop());
    auswahl = null;
    geaendert();
  }

  let speicherTimer;
  function geaendert() {
    clearTimeout(speicherTimer);
    speicherTimer = setTimeout(() => beiSpeichern(els), 500);
    aktualisieren();
  }

  function einpassen() {
    const g = grenzen(els);
    const { w, h } = groesse();
    if (!g) { view.s = Math.min(w, h) / 800; view.x = -w / view.s / 2 + 300; view.y = -h / view.s / 2 + 300; return; }
    const rand = 60;
    const bw = g.x2 - g.x1 + 2 * rand, bh = g.y2 - g.y1 + 2 * rand;
    view.s = Math.min(w / bw, h / bh, 4);
    view.x = (g.x1 + g.x2) / 2 - w / view.s / 2;
    view.y = (g.y1 + g.y2) / 2 - h / view.s / 2;
  }
  function zoomUm(f, mitte) {
    const { w, h } = groesse();
    const m = mitte || { x: w / 2, y: h / 2 };
    const wx = view.x + m.x / view.s, wy = view.y + m.y / view.s;
    view.s = Math.min(20, Math.max(0.02, view.s * f));
    view.x = wx - m.x / view.s;
    view.y = wy - m.y / view.s;
    zeichnen();
  }

  // ---------- Zeichnen ----------
  function zeichnen() {
    const { w, h } = groesse();
    svg.setAttribute("viewBox", `${view.x} ${view.y} ${w / view.s} ${h / view.s}`);
    // Raster
    gRaster.replaceChildren();
    let abstand = [10, 50, 100, 500, 1000, 5000].find((a) => a * view.s >= 14) || 5000;
    const x0 = Math.floor(view.x / abstand) * abstand, y0 = Math.floor(view.y / abstand) * abstand;
    const x1 = view.x + w / view.s, y1 = view.y + h / view.s;
    // dünne Linien im Abstand "abstand", kräftige jeden Meter (bzw. alle 10 Linien)
    const stark = abstand < 100 ? 100 : abstand * 10;
    let d = "", dStark = "";
    for (let x = x0; x <= x1; x += abstand) {
      const s = `M${x},${view.y}V${y1}`;
      if (Math.round(x) % stark === 0) dStark += s; else d += s;
    }
    for (let y = y0; y <= y1; y += abstand) {
      const s = `M${view.x},${y}H${x1}`;
      if (Math.round(y) % stark === 0) dStark += s; else d += s;
    }
    gRaster.append(el("path", { d, class: "ed-raster", "stroke-width": 1 / view.s }));
    gRaster.append(el("path", { d: dStark, class: "ed-raster stark", "stroke-width": 1 / view.s }));

    gInhalt.replaceChildren();
    zeichneElemente(gInhalt, vorschau ? [...els, vorschau] : els, view.s, vorschau || auswahl);

    gGriffe.replaceChildren();
    if (auswahl && auswahl.t === "w" && !vorschau) {
      for (const [x, y] of [[auswahl.x1, auswahl.y1], [auswahl.x2, auswahl.y2]]) {
        gGriffe.append(el("circle", { cx: x, cy: y, r: 9 / view.s, class: "ed-griff", "stroke-width": 2 / view.s }));
      }
    }
  }

  function aktualisieren() {
    for (const [id, b] of Object.entries(knoepfe)) b.classList.toggle("aktiv", id === werkzeug);
    knopfRueck.disabled = !rueck.length;
    hinweis.textContent = {
      wand: "Wand ziehen: Finger aufsetzen und bis zum Ende ziehen",
      fenster: "Fenster ziehen (am besten auf eine Wand)",
      tuer: "Tür ziehen: von der Angel zum Schloss",
      linie: "Hilfslinie ziehen",
      text: "Tippen, wo der Text hin soll (z.B. Raumname)",
      auswahl: "Antippen zum Auswählen, ziehen zum Verschieben",
      hand: "Ziehen zum Verschieben, zwei Finger zum Zoomen",
    }[werkzeug];
    panelZeigen();
    zeichnen();
  }

  function panelZeigen() {
    panel.replaceChildren();
    panel.hidden = !auswahl;
    if (!auswahl) return;
    const e = auswahl;
    const form = document.createElement("form");
    form.className = "ed-form";
    if (e.t === "w") {
      const arten = { wand: "Wand", fenster: "Fenster", tuer: "Tür", linie: "Linie" };
      form.innerHTML = `
        <label>Art <select name="art">${Object.entries(arten).map(([k, v]) => `<option value="${k}" ${k === e.art ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        <label>Länge (m) <input name="l" type="number" inputmode="decimal" step="0.01" min="0.01" value="${(laenge(e) / 100).toFixed(2)}"></label>
        <button class="btn primaer" type="submit">OK</button>
        <button class="btn gefahr" type="button" data-weg>Löschen</button>`;
      form.art.onchange = () => { merken(); e.art = form.art.value; geaendert(); };
      form.onsubmit = (ev) => {
        ev.preventDefault();
        const neu = parseFloat(String(form.l.value).replace(",", ".")) * 100;
        const alt = laenge(e);
        if (!(neu > 0)) return;
        merken();
        if (alt < 0.5) { e.x2 = e.x1 + neu; e.y2 = e.y1; } else {
          e.x2 = e.x1 + ((e.x2 - e.x1) / alt) * neu;
          e.y2 = e.y1 + ((e.y2 - e.y1) / alt) * neu;
        }
        e.x2 = Math.round(e.x2 * 10) / 10; e.y2 = Math.round(e.y2 * 10) / 10;
        geaendert();
      };
    } else {
      form.innerHTML = `
        <label class="breit">Text <input name="s" value=""></label>
        <button class="btn primaer" type="submit">OK</button>
        <button class="btn gefahr" type="button" data-weg>Löschen</button>`;
      form.s.value = e.s;
      form.onsubmit = (ev) => { ev.preventDefault(); if (!form.s.value.trim()) return; merken(); e.s = form.s.value.trim(); geaendert(); };
    }
    form.querySelector("[data-weg]").onclick = () => { merken(); els = els.filter((x) => x !== e); auswahl = null; geaendert(); };
    panel.append(form);
  }

  // ---------- Bedienung (Maus, Finger, Stift) ----------
  const zeiger = new Map();
  let aktion2 = null; // { art: "zeichnen"|"schieben"|"punkt"|"pan"|"pinch", ... }

  svg.addEventListener("pointerdown", (ev) => {
    svg.setPointerCapture(ev.pointerId);
    zeiger.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (zeiger.size === 2) {
      // Zwei Finger: Zoomen + Verschieben, laufende Aktion abbrechen
      if (aktion2?.art === "schieben" || aktion2?.art === "punkt") { els = JSON.parse(rueck.pop()); auswahl = null; }
      vorschau = null;
      const [a, b] = [...zeiger.values()];
      aktion2 = { art: "pinch", d: Math.hypot(a.x - b.x, a.y - b.y), m: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, view: { ...view } };
      zeichnen();
      return;
    }
    if (zeiger.size > 2) return;
    const p = welt(ev);
    if (werkzeug === "hand" || ev.button === 1 || ev.button === 2) {
      aktion2 = { art: "pan", sx: ev.clientX, sy: ev.clientY, view: { ...view } };
    } else if (["wand", "fenster", "tuer", "linie"].includes(werkzeug)) {
      const s = fangen(p);
      vorschau = { t: "w", art: werkzeug, x1: s.x, y1: s.y, x2: s.x, y2: s.y };
      auswahl = null;
      panelZeigen();
      aktion2 = { art: "zeichnen" };
    } else if (werkzeug === "text") {
      aktion2 = { art: "text", p, sx: ev.clientX, sy: ev.clientY };
    } else if (werkzeug === "auswahl") {
      // Griff am Ende der ausgewählten Wand?
      if (auswahl?.t === "w") {
        for (const ende of [1, 2]) {
          if (Math.hypot(auswahl["x" + ende] - p.x, auswahl["y" + ende] - p.y) < 16 / view.s) {
            merken();
            aktion2 = { art: "punkt", ende, bewegt: false };
            return;
          }
        }
      }
      const t = treffer(p);
      auswahl = t;
      panelZeigen();
      if (t) { merken(); aktion2 = { art: "schieben", start: p, orig: { ...t }, bewegt: false }; }
      else aktion2 = { art: "pan", sx: ev.clientX, sy: ev.clientY, view: { ...view } };
      zeichnen();
    }
  });

  svg.addEventListener("pointermove", (ev) => {
    if (!zeiger.has(ev.pointerId)) return;
    zeiger.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (!aktion2) return;
    const p = welt(ev);
    if (aktion2.art === "pinch" && zeiger.size >= 2) {
      const [a, b] = [...zeiger.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const r = svg.getBoundingClientRect();
      const v0 = aktion2.view;
      const wx = v0.x + (aktion2.m.x - r.left) / v0.s, wy = v0.y + (aktion2.m.y - r.top) / v0.s;
      view.s = Math.min(20, Math.max(0.02, v0.s * (d / aktion2.d)));
      view.x = wx - (m.x - r.left) / view.s;
      view.y = wy - (m.y - r.top) / view.s;
      zeichnen();
    } else if (aktion2.art === "pan") {
      view.x = aktion2.view.x - (ev.clientX - aktion2.sx) / view.s;
      view.y = aktion2.view.y - (ev.clientY - aktion2.sy) / view.s;
      zeichnen();
    } else if (aktion2.art === "zeichnen" && vorschau) {
      const q = endeFangen({ x: vorschau.x1, y: vorschau.y1 }, p);
      vorschau.x2 = q.x; vorschau.y2 = q.y;
      hinweis.textContent = "Länge: " + meterText(laenge(vorschau));
      zeichnen();
    } else if (aktion2.art === "schieben") {
      const dx = einrasten(p.x - aktion2.start.x), dy = einrasten(p.y - aktion2.start.y);
      if (dx || dy) aktion2.bewegt = true;
      const o = aktion2.orig, e = auswahl;
      if (e.t === "w") { e.x1 = o.x1 + dx; e.y1 = o.y1 + dy; e.x2 = o.x2 + dx; e.y2 = o.y2 + dy; }
      else { e.x = o.x + dx; e.y = o.y + dy; }
      zeichnen();
    } else if (aktion2.art === "punkt") {
      const e = auswahl, n = aktion2.ende, m = n === 1 ? 2 : 1;
      const q = endeFangen({ x: e["x" + m], y: e["y" + m] }, p, e);
      e["x" + n] = q.x; e["y" + n] = q.y;
      aktion2.bewegt = true;
      hinweis.textContent = "Länge: " + meterText(laenge(e));
      zeichnen();
    }
  });

  function ende(ev) {
    if (!zeiger.has(ev.pointerId)) return;
    zeiger.delete(ev.pointerId);
    if (!aktion2) return;
    if (aktion2.art === "pinch") { if (zeiger.size === 0) aktion2 = null; return; }
    if (zeiger.size > 0) return;
    const a = aktion2;
    aktion2 = null;
    if (a.art === "zeichnen" && vorschau) {
      const w = vorschau;
      vorschau = null;
      if (laenge(w) >= 5 && ev.type !== "pointercancel") {
        merken();
        els.push(w);
        auswahl = w;
        geaendert();
      } else aktualisieren();
    } else if (a.art === "text") {
      if (Math.hypot(ev.clientX - a.sx, ev.clientY - a.sy) > 10) return;
      const s = prompt("Text (z.B. Raumname):", "");
      if (s && s.trim()) {
        merken();
        const t = { t: "t", x: einrasten(a.p.x), y: einrasten(a.p.y), s: s.trim() };
        els.push(t);
        geaendert();
      }
    } else if (a.art === "schieben" || a.art === "punkt") {
      if (a.bewegt) geaendert(); else { rueck.pop(); aktualisieren(); }
    }
  }
  svg.addEventListener("pointerup", ende);
  svg.addEventListener("pointercancel", ende);
  svg.addEventListener("contextmenu", (ev) => ev.preventDefault());
  svg.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const r = svg.getBoundingClientRect();
    zoomUm(Math.exp(-ev.deltaY * 0.0015), { x: ev.clientX - r.left, y: ev.clientY - r.top });
  }, { passive: false });

  const tasten = (ev) => {
    if (ev.target.closest("input, select, textarea")) return;
    if ((ev.ctrlKey || ev.metaKey) && ev.key === "z") { ev.preventDefault(); rueckgaengig(); }
    else if ((ev.key === "Delete" || ev.key === "Backspace") && auswahl) { merken(); els = els.filter((x) => x !== auswahl); auswahl = null; geaendert(); }
    else if (ev.key === "Escape") { auswahl = null; vorschau = null; aktion2 = null; aktualisieren(); }
  };
  document.addEventListener("keydown", tasten);

  const beobachter = new ResizeObserver(() => zeichnen());
  beobachter.observe(flaeche);

  requestAnimationFrame(() => { einpassen(); aktualisieren(); });

  return {
    // Beim Verlassen: sofort speichern und aufräumen
    schliessen() {
      clearTimeout(speicherTimer);
      document.removeEventListener("keydown", tasten);
      beobachter.disconnect();
      if (JSON.stringify(els) !== JSON.stringify(startElemente || [])) beiSpeichern(els);
    },
  };
}
