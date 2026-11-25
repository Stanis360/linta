// =====================================================================
//  Supabase Edge Function "kalender"
//  Liefert die Termine als abonnierbaren Kalender (iPhone, Mac, Outlook, Google).
//  Aufruf: https://<projekt>.supabase.co/functions/v1/kalender?token=<geheimer Link-Schlüssel>
//
//  Einrichtung: siehe README.md, Abschnitt "Kalender-Abo".
//  WICHTIG: Bei dieser Funktion "Verify JWT" ausschalten, weil Kalender-Apps
//  sich nicht anmelden können. Geschützt ist sie über den geheimen Token im Link.
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const utc = (d) => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
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

export function kalenderText({ termine, kunden, fahrzeuge, name, erinnerung }) {
  const km = new Map(kunden.map((k) => [k.id, k]));
  const fm = new Map(fahrzeuge.map((f) => [f.id, f]));
  const jetzt = utc(new Date());
  const z = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Werkstatt-App//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(name || "Werkstatt")} – Termine`,
    "X-WR-TIMEZONE:Europe/Berlin",
    "REFRESH-INTERVAL;VALUE=DURATION:PT15M",
    "X-PUBLISHED-TTL:PT15M",
  ];
  for (const t of termine) {
    const k = km.get(t.kunde_id);
    const f = fm.get(t.fahrzeug_id);
    const fz = f ? [f.kennzeichen, f.marke, f.modell].filter(Boolean).join(" ") : "";
    const titel = (t.erledigt ? "✓ " : "") + [t.titel, f?.kennzeichen || k?.name].filter(Boolean).join(" – ");
    const details = [
      k && `Kunde: ${k.name}`,
      k?.telefon && `Telefon: ${k.telefon}`,
      fz && `Fahrzeug: ${fz}`,
      t.notizen && `\n${t.notizen}`,
    ].filter(Boolean).join("\n");
    const start = new Date(t.beginn);
    const ende = new Date(start.getTime() + (t.dauer_min || 60) * 6e4);
    z.push(
      "BEGIN:VEVENT",
      `UID:${t.id}@werkstatt-app`,
      `DTSTAMP:${jetzt}`,
      `DTSTART:${utc(start)}`,
      `DTEND:${utc(ende)}`,
      `SUMMARY:${esc(titel)}`,
      ...(details ? [`DESCRIPTION:${esc(details)}`] : []),
      ...(k?.telefon ? [`URL:tel:${k.telefon.replace(/[^\d+]/g, "")}`] : []),
    );
    if (erinnerung > 0 && !t.erledigt) {
      z.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(titel)}`, `TRIGGER:-PT${erinnerung}M`, "END:VALARM");
    }
    z.push("END:VEVENT");
  }
  z.push("END:VCALENDAR");
  return z.map(falten).join("\r\n") + "\r\n";
}

export async function handler(req, sb) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";
  const nichtGefunden = () => new Response("Kalender nicht gefunden", { status: 404, headers: CORS });
  if (!/^[a-f0-9]{48,}$/.test(token)) return nichtGefunden();

  const { data: abo } = await sb.from("kalender_abos").select("*").eq("token", token).maybeSingle();
  if (!abo) return nichtGefunden();

  const ab = new Date(Date.now() - 90 * 864e5).toISOString(); // letzte 90 Tage + alle kommenden
  let q = sb.from("termine").select("*").eq("user_id", abo.user_id).gte("beginn", ab).order("beginn").limit(3000);
  if (!abo.erledigte_zeigen) q = q.eq("erledigt", false);
  const { data: termine, error } = await q;
  if (error) return new Response("Fehler: " + error.message, { status: 500, headers: CORS });

  const kIds = [...new Set(termine.map((t) => t.kunde_id).filter(Boolean))];
  const fIds = [...new Set(termine.map((t) => t.fahrzeug_id).filter(Boolean))];
  const [{ data: kunden }, { data: fahrzeuge }] = await Promise.all([
    kIds.length ? sb.from("kunden").select("id,name,telefon").in("id", kIds) : { data: [] },
    fIds.length ? sb.from("fahrzeuge").select("id,kennzeichen,marke,modell").in("id", fIds) : { data: [] },
  ]);

  const text = kalenderText({ termine, kunden: kunden || [], fahrzeuge: fahrzeuge || [], name: abo.name, erinnerung: abo.erinnerung });
  return new Response(text, {
    headers: {
      ...CORS,
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="werkstatt-termine.ics"',
      "Cache-Control": "no-store",
      "X-Anzahl-Termine": String(termine.length),
      "Access-Control-Expose-Headers": "X-Anzahl-Termine",
    },
  });
}

// In Supabase sind SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY automatisch gesetzt.
if (typeof Deno !== "undefined") {
  const sb = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
  Deno.serve((req) => handler(req, sb));
}
