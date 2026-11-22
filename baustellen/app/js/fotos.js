// Fotos: verkleinern, speichern, anzeigen
import * as store from "./store.js";

const GROSS = 1920;   // längste Seite der gespeicherten Fotos (Pixel)
const KLEIN = 320;    // Vorschaubild (wird mit den Daten synchronisiert)

async function bildLaden(datei) {
  // createImageBitmap dreht Handyfotos automatisch richtig herum
  try { return await createImageBitmap(datei, { imageOrientation: "from-image" }); } catch {}
  const url = URL.createObjectURL(datei);
  try {
    const img = new Image();
    await new Promise((ok, f) => { img.onload = ok; img.onerror = () => f(new Error("Bild nicht lesbar")); img.src = url; });
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function skalieren(bild, max) {
  const w0 = bild.width, h0 = bild.height;
  const f = Math.min(1, max / Math.max(w0, h0));
  const c = document.createElement("canvas");
  c.width = Math.round(w0 * f);
  c.height = Math.round(h0 * f);
  c.getContext("2d").drawImage(bild, 0, 0, c.width, c.height);
  return c;
}

// Speichert ein Foto zu einer Baustelle. Gibt den Datensatz zurück.
export async function hinzufuegen(datei, baustelleId) {
  const bild = await bildLaden(datei);
  const gross = skalieren(bild, GROSS);
  const blob = await new Promise((ok) => gross.toBlob(ok, "image/jpeg", 0.82));
  const thumb = skalieren(bild, KLEIN).toDataURL("image/jpeg", 0.6);
  bild.close?.();
  const datum = datei.lastModified ? new Date(datei.lastModified) : new Date();
  const id = store.neueId();
  await store.fotoSpeichern(id, blob, true);
  return store.speichern({
    id, typ: "foto", baustelleId, thumb,
    datum: datum.toLocaleDateString("sv-SE"), zeit: datum.toTimeString().slice(0, 5),
    w: gross.width, h: gross.height, notiz: "",
  });
}

// URL für die große Version (oder null, wenn sie noch nicht auf dem Gerät ist)
const urls = new Map();
export async function grossUrl(id) {
  if (urls.has(id)) return urls.get(id);
  const blob = await store.fotoHolen(id);
  if (!blob) return null;
  const u = URL.createObjectURL(blob);
  urls.set(id, u);
  return u;
}

export async function herunterladen(f, name) {
  const u = (await grossUrl(f.id)) || f.thumb;
  const a = document.createElement("a");
  a.href = u;
  a.download = `${(name || "foto").replace(/[^\w äöüÄÖÜß.-]/g, "_")}_${f.datum || ""}_${f.id.slice(0, 6)}.jpg`;
  a.click();
}

// ---------- Vollbild-Ansicht ----------
export function betrachter(liste, start, { name, beiNotiz, beiLoeschen, beiSchliessen }) {
  let i = start;
  const el = document.createElement("div");
  el.className = "betrachter";
  el.innerHTML = `
    <div class="bt-kopf">
      <button class="bt-knopf" data-zu aria-label="Schließen">✕</button>
      <span class="bt-info"></span>
      <button class="bt-knopf" data-laden aria-label="Herunterladen">⬇</button>
      <button class="bt-knopf" data-weg aria-label="Löschen">🗑</button>
    </div>
    <div class="bt-bild"><img alt=""><span class="bt-hinweis" hidden>Vorschau – Foto in voller Größe kommt beim nächsten Sync</span></div>
    <button class="bt-pfeil links" data-zurueck aria-label="Vorheriges">‹</button>
    <button class="bt-pfeil rechts" data-weiter aria-label="Nächstes">›</button>
    <form class="bt-notiz"><input name="notiz" placeholder="Notiz zum Foto …" autocomplete="off"><button class="btn primaer">OK</button></form>`;
  document.body.append(el);
  document.body.classList.add("kein-scroll");
  const img = el.querySelector("img");
  const form = el.querySelector("form");

  async function zeigen() {
    const f = liste[i];
    el.querySelector(".bt-info").textContent = `${i + 1} / ${liste.length} · ${new Date(f.datum + "T12:00").toLocaleDateString("de-DE")}${f.zeit ? " " + f.zeit : ""}`;
    form.notiz.value = f.notiz || "";
    img.src = f.thumb;
    const u = await grossUrl(f.id);
    if (liste[i] !== f) return;
    if (u) img.src = u;
    el.querySelector(".bt-hinweis").hidden = !!u;
    el.querySelector("[data-zurueck]").hidden = i === 0;
    el.querySelector("[data-weiter]").hidden = i === liste.length - 1;
  }
  const blaettern = (d) => { const n = i + d; if (n >= 0 && n < liste.length) { i = n; zeigen(); } };
  // still = vom Routing geschlossen, dann nicht zurückmelden
  function schliessen(still) {
    if (!el.isConnected) return;
    el.remove();
    document.body.classList.remove("kein-scroll");
    document.removeEventListener("keydown", tasten);
    if (!still) beiSchliessen?.();
  }
  const tasten = (e) => {
    if (e.target.closest("input")) return;
    if (e.key === "Escape") schliessen();
    if (e.key === "ArrowLeft") blaettern(-1);
    if (e.key === "ArrowRight") blaettern(1);
  };
  document.addEventListener("keydown", tasten);
  el.querySelector("[data-zu]").onclick = () => schliessen();
  el.querySelector("[data-zurueck]").onclick = () => blaettern(-1);
  el.querySelector("[data-weiter]").onclick = () => blaettern(1);
  el.querySelector("[data-laden]").onclick = () => herunterladen(liste[i], name);
  el.querySelector("[data-weg]").onclick = async () => {
    if (!confirm("Foto löschen?")) return;
    await beiLoeschen(liste[i]);
    liste.splice(i, 1);
    if (!liste.length) return schliessen();
    i = Math.min(i, liste.length - 1);
    zeigen();
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    liste[i] = await beiNotiz(liste[i], form.notiz.value.trim());
    form.notiz.blur();
  };
  // Wischen zum Blättern
  let sx = null;
  const bild = el.querySelector(".bt-bild");
  bild.addEventListener("pointerdown", (e) => { sx = e.clientX; });
  bild.addEventListener("pointerup", (e) => {
    if (sx == null) return;
    const d = e.clientX - sx;
    sx = null;
    if (Math.abs(d) > 50) blaettern(d < 0 ? 1 : -1);
  });
  zeigen();
  return { schliessen };
}
