// Kunden per WhatsApp oder SMS benachrichtigen – mit fertigen Textvorlagen.
// Die App öffnet nur WhatsApp/SMS mit vorausgefülltem Text; gesendet wird dort.
import { istIOS } from "./kalender.js";

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const werkstatt = () => (window.APP_CONFIG || {}).WERKSTATT_NAME || "Ihre Werkstatt";
const gruss = () => `\n\nViele Grüße\n${werkstatt()}`;
const fzText = (f) => (f ? [f.marke, f.modell].filter(Boolean).join(" ") || f.kennzeichen || "Ihr Fahrzeug" : "Ihr Fahrzeug");
const mitKz = (f) => (f?.kennzeichen ? `${fzText(f)} (${f.kennzeichen})` : fzText(f));
const geld = (n) => Number(n).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const monat = (d) => new Date(d + "T00:00").toLocaleDateString("de-DE", { month: "long", year: "numeric" });
const wann = (d) => new Date(d).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
const zeit = (d) => new Date(d).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

// Deutsche Nummern ins internationale Format für WhatsApp: 0171 123 → 49171123
export function telefonInternational(tel) {
  let t = String(tel || "").trim().replace(/[^\d+]/g, "");
  if (t.startsWith("+")) t = t.slice(1);
  else if (t.startsWith("00")) t = t.slice(2);
  else if (t.startsWith("0")) t = "49" + t.slice(1);
  return t;
}

export const VORLAGEN = {
  frei: ({ kunde }) => `Hallo ${kunde.name},\n\n${gruss()}`,
  fertig: ({ kunde, fahrzeug, gesamt }) =>
    `Hallo ${kunde.name},\n\n${mitKz(fahrzeug)} ist fertig und kann abgeholt werden.` +
    (gesamt > 0 ? `\nDer Betrag beläuft sich auf ${geld(gesamt)}.` : "") + gruss(),
  tuev: ({ kunde, fahrzeug }) => {
    const abgelaufen = new Date(fahrzeug.tuev + "T00:00") < new Date();
    return `Hallo ${kunde.name},\n\n` +
      (abgelaufen
        ? `die Hauptuntersuchung (TÜV) für ${mitKz(fahrzeug)} war im ${monat(fahrzeug.tuev)} fällig.`
        : `die Hauptuntersuchung (TÜV) für ${mitKz(fahrzeug)} ist im ${monat(fahrzeug.tuev)} fällig.`) +
      `\nSollen wir einen Termin vereinbaren? Wir machen das Fahrzeug gerne vorher fit.` + gruss();
  },
  termin: ({ kunde, termin, fahrzeug }) =>
    `Hallo ${kunde.name},\n\nwir möchten Sie an Ihren Termin erinnern: ${wann(termin.beginn)} um ${zeit(termin.beginn)} Uhr.` +
    `\n${termin.titel}${fahrzeug ? " – " + mitKz(fahrzeug) : ""}` +
    `\n\nFalls etwas dazwischenkommt, geben Sie uns bitte kurz Bescheid.` + gruss(),
};

const TITEL = { frei: "Nachricht an Kunden", fertig: "Fahrzeug fertig melden", tuev: "An TÜV erinnern", termin: "An Termin erinnern" };

/**
 * Öffnet das Fenster zum Senden.
 * art: "frei" | "fertig" | "tuev" | "termin"
 * werbung: true bei Erinnerungen (TÜV), die eine Zustimmung des Kunden brauchen
 * gesendet: wird aufgerufen, wenn WhatsApp oder SMS geöffnet wurde
 */
export function nachrichtSenden({ art, kunde, fahrzeug, termin, gesamt, werbung = false, gesendet }) {
  if (!kunde?.telefon) { alert("Für diesen Kunden ist keine Telefonnummer gespeichert."); return; }
  const nummer = telefonInternational(kunde.telefon);
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.innerHTML = `
    <div class="sheet">
      <div class="sheet-kopf">
        <button type="button" class="btn-text" data-zu>Abbrechen</button>
        <strong>${esc(TITEL[art])}</strong>
        <span style="width:80px"></span>
      </div>
      <div class="sheet-inhalt nachricht">
        <p class="leise">An <b>${esc(kunde.name)}</b> · ${esc(kunde.telefon)}</p>
        ${werbung && !kunde.kontakt_erlaubt ? `<p class="hinweis">⚠️ Für diesen Kunden ist keine Zustimmung zu Erinnerungen gespeichert.
          Erinnerungen ohne Zustimmung können als unerlaubte Werbung gelten.
          <br><label class="check"><input type="checkbox" data-zustimmung> Kunde hat zugestimmt (wird beim Kunden gespeichert)</label></p>` : ""}
        <label class="feld"><span>Text (kann angepasst werden)</span><textarea rows="9" data-text>${esc(VORLAGEN[art]({ kunde, fahrzeug, termin, gesamt }))}</textarea></label>
        <div class="senden">
          <a class="btn whatsapp" data-kanal="whatsapp" target="_blank" rel="noopener">WhatsApp</a>
          <a class="btn" data-kanal="sms">SMS</a>
        </div>
      </div>
    </div>`;
  const text = modal.querySelector("[data-text]");
  const zustimmung = modal.querySelector("[data-zustimmung]");
  const wa = modal.querySelector('[data-kanal="whatsapp"]');
  const sms = modal.querySelector('[data-kanal="sms"]');
  const gesperrt = () => werbung && !kunde.kontakt_erlaubt && !zustimmung?.checked;
  const links = () => {
    const t = encodeURIComponent(text.value.trim());
    wa.href = `https://wa.me/${nummer}?text=${t}`;
    // iPhone erwartet "&body=", Android "?body="
    sms.href = `sms:${kunde.telefon.replace(/[^\d+]/g, "")}${istIOS() ? "&" : "?"}body=${t}`;
    [wa, sms].forEach((a) => a.classList.toggle("aus", gesperrt()));
  };
  text.oninput = links;
  if (zustimmung) zustimmung.onchange = links;
  links();
  const zu = () => modal.remove();
  modal.querySelector("[data-zu]").onclick = zu;
  modal.addEventListener("click", (e) => e.target === modal && zu());
  [wa, sms].forEach((a) => (a.onclick = (e) => {
    if (gesperrt()) { e.preventDefault(); alert("Bitte erst bestätigen, dass der Kunde zugestimmt hat."); return; }
    // Link öffnet sich sofort (wichtig fürs iPhone), Speichern passiert danach
    setTimeout(() => { gesendet?.({ kanal: a.dataset.kanal, zustimmung: !!zustimmung?.checked }); zu(); }, 300);
  }));
  document.body.append(modal);
}
