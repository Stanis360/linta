// Datenzugriff: Supabase (Cloud + Sync) oder Demo-Modus (nur lokal im Browser)

const cfg = window.APP_CONFIG || {};
export const DEMO = !(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);

// ---------------------------------------------------------------------
//  Supabase
// ---------------------------------------------------------------------
function supabaseBackend() {
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  const urlCache = new Map(); // pfad -> { url, bis }

  const check = ({ data, error }) => {
    if (error) throw new Error(error.message);
    return data;
  };

  return {
    async session() {
      const { data } = await sb.auth.getSession();
      return data.session;
    },
    async signIn(email, password) {
      check(await sb.auth.signInWithPassword({ email, password }));
    },
    async signOut() {
      await sb.auth.signOut();
    },
    onAuth(cb) {
      sb.auth.onAuthStateChange((_e, session) => cb(session));
    },

    async list(table, { eq = {}, order = "created_at", asc = true } = {}) {
      const rows = [];
      const page = 1000;
      for (let from = 0; ; from += page) {
        let q = sb.from(table).select("*");
        for (const [k, v] of Object.entries(eq)) q = q.eq(k, v);
        q = q.order(order, { ascending: asc }).range(from, from + page - 1);
        const data = check(await q);
        rows.push(...data);
        if (data.length < page) break;
      }
      return rows;
    },
    async get(table, id) {
      return check(await sb.from(table).select("*").eq("id", id).maybeSingle());
    },
    async insert(table, obj) {
      return check(await sb.from(table).insert(obj).select().single());
    },
    async update(table, id, patch) {
      return check(await sb.from(table).update(patch).eq("id", id).select().single());
    },
    async remove(table, id) {
      check(await sb.from(table).delete().eq("id", id));
    },

    async uploadPhoto(blob) {
      const { data } = await sb.auth.getUser();
      const path = `${data.user.id}/${crypto.randomUUID()}.jpg`;
      check(await sb.storage.from("fotos").upload(path, blob, { contentType: "image/jpeg" }));
      return path;
    },
    async photoUrls(paths) {
      const now = Date.now();
      const missing = paths.filter((p) => !(urlCache.get(p)?.bis > now));
      if (missing.length) {
        const data = check(await sb.storage.from("fotos").createSignedUrls(missing, 3600));
        for (const d of data) if (d.signedUrl) urlCache.set(d.path, { url: d.signedUrl, bis: now + 3500e3 });
      }
      return Object.fromEntries(paths.map((p) => [p, urlCache.get(p)?.url]));
    },
    async removePhotos(paths) {
      if (paths.length) check(await sb.storage.from("fotos").remove(paths));
    },

    onChange(cb) {
      sb.channel("alle-aenderungen")
        .on("postgres_changes", { event: "*", schema: "public" }, () => cb())
        .subscribe();
    },
  };
}

// ---------------------------------------------------------------------
//  Demo-Modus (localStorage)
// ---------------------------------------------------------------------
function demoBackend() {
  const key = (t) => "werkstatt_demo_" + t;
  const load = (t) => JSON.parse(localStorage.getItem(key(t)) || "[]");
  const save = (t, rows) => localStorage.setItem(key(t), JSON.stringify(rows));

  // Wie "on delete cascade / set null" in der echten Datenbank
  const relations = [
    ["fahrzeuge", "kunde_id", "kunden", "cascade"],
    ["auftraege", "fahrzeug_id", "fahrzeuge", "cascade"],
    ["auftrag_teile", "auftrag_id", "auftraege", "cascade"],
    ["auftrag_teile", "teil_id", "teile", "null"],
    ["fotos", "fahrzeug_id", "fahrzeuge", "cascade"],
    ["fotos", "auftrag_id", "auftraege", "null"],
    ["termine", "kunde_id", "kunden", "null"],
    ["termine", "fahrzeug_id", "fahrzeuge", "null"],
  ];
  const defaults = {
    auftraege: { status: "offen" },
    teile: { bestand: 0, mindestbestand: 0 },
    termine: { dauer_min: 60, erledigt: false },
  };
  let listeners = [];
  const changed = () => setTimeout(() => listeners.forEach((cb) => cb()), 0);

  const removeRec = (table, id) => {
    save(table, load(table).filter((r) => r.id !== id));
    for (const [child, col, parent, mode] of relations) {
      if (parent !== table) continue;
      const rows = load(child);
      if (mode === "cascade") {
        rows.filter((r) => r[col] === id).forEach((r) => removeRec(child, r.id));
      } else {
        save(child, rows.map((r) => (r[col] === id ? { ...r, [col]: null } : r)));
      }
    }
  };

  // Damit man in der Demo sofort etwas sieht
  if (!localStorage.getItem(key("init"))) {
    localStorage.setItem(key("init"), "1");
    const k = { id: crypto.randomUUID(), name: "Max Mustermann", telefon: "0171 1234567", email: "max@example.de", adresse: "Hauptstraße 1, 12345 Musterstadt", notizen: "Stammkunde", created_at: new Date().toISOString() };
    const f = { id: crypto.randomUUID(), kunde_id: k.id, kennzeichen: "M-AB 1234", marke: "VW", modell: "Golf 7", baujahr: 2016, fin: "WVWZZZAUZGW000000", km: 142000, tuev: new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10), notizen: "", created_at: new Date().toISOString() };
    const a = { id: crypto.randomUUID(), fahrzeug_id: f.id, datum: new Date().toISOString().slice(0, 10), titel: "Inspektion + Bremsen vorne", beschreibung: "Bremsscheiben und Beläge VA erneuert, Ölwechsel 5W-30.", km: 142000, status: "in_arbeit", arbeitslohn: 180, created_at: new Date().toISOString() };
    const t1 = { id: crypto.randomUUID(), name: "Ölfilter VW 1.6 TDI", artikelnr: "OC 593/4", hersteller: "Mahle", bestand: 4, mindestbestand: 2, einkaufspreis: 6.5, verkaufspreis: 12.9, lagerort: "Regal A2", notizen: "", created_at: new Date().toISOString() };
    const t2 = { id: crypto.randomUUID(), name: "Bremsbeläge VA Golf 7", artikelnr: "0 986 494 660", hersteller: "Bosch", bestand: 1, mindestbestand: 2, einkaufspreis: 28, verkaufspreis: 49.9, lagerort: "Regal B1", notizen: "", created_at: new Date().toISOString() };
    const termin = new Date(); termin.setDate(termin.getDate() + 1); termin.setHours(9, 0, 0, 0);
    save("kunden", [k]);
    save("fahrzeuge", [f]);
    save("auftraege", [a]);
    save("teile", [t1, t2]);
    save("auftrag_teile", [{ id: crypto.randomUUID(), auftrag_id: a.id, teil_id: t2.id, bezeichnung: t2.name, menge: 1, preis: 49.9, created_at: new Date().toISOString() }]);
    save("termine", [{ id: crypto.randomUUID(), kunde_id: k.id, fahrzeug_id: f.id, beginn: termin.toISOString(), dauer_min: 90, titel: "Reifenwechsel auf Sommerreifen", notizen: "Reifen eingelagert", erledigt: false, created_at: new Date().toISOString() }]);
  }

  return {
    async session() {
      return localStorage.getItem(key("session")) ? { user: { email: "demo" } } : null;
    },
    async signIn() {
      localStorage.setItem(key("session"), "1");
    },
    async signOut() {
      localStorage.removeItem(key("session"));
      location.reload();
    },
    onAuth() {},

    async list(table, { eq = {}, order = "created_at", asc = true } = {}) {
      const rows = load(table).filter((r) => Object.entries(eq).every(([k, v]) => r[k] === v));
      return rows.sort((a, b) => {
        const x = a[order] ?? "", y = b[order] ?? "";
        return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
      });
    },
    async get(table, id) {
      return load(table).find((r) => r.id === id) || null;
    },
    async insert(table, obj) {
      const row = { ...defaults[table], ...obj, id: crypto.randomUUID(), created_at: new Date().toISOString() };
      save(table, [...load(table), row]);
      changed();
      return row;
    },
    async update(table, id, patch) {
      let out;
      save(table, load(table).map((r) => (r.id === id ? (out = { ...r, ...patch }) : r)));
      changed();
      return out;
    },
    async remove(table, id) {
      removeRec(table, id);
      changed();
    },

    async uploadPhoto(blob) {
      const path = "demo/" + crypto.randomUUID() + ".jpg";
      const dataUrl = await new Promise((res) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.readAsDataURL(blob);
      });
      try {
        localStorage.setItem(key("foto_" + path), dataUrl);
      } catch {
        throw new Error("Demo-Speicher voll – im Demo-Modus passen nur wenige Fotos.");
      }
      return path;
    },
    async photoUrls(paths) {
      return Object.fromEntries(paths.map((p) => [p, localStorage.getItem(key("foto_" + p))]));
    },
    async removePhotos(paths) {
      paths.forEach((p) => localStorage.removeItem(key("foto_" + p)));
    },

    onChange(cb) {
      listeners.push(cb);
      window.addEventListener("storage", () => cb()); // andere Tabs
    },
  };
}

export const db = DEMO ? demoBackend() : supabaseBackend();
