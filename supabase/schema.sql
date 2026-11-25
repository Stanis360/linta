-- =====================================================================
--  Werkstatt-App – Datenbank-Schema für Supabase
--  Einmal komplett im Supabase "SQL Editor" ausführen (Run).
-- =====================================================================

-- ---------- Tabellen ----------

create table if not exists kunden (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  name        text not null,
  telefon     text,
  email       text,
  adresse     text,
  notizen     text,
  created_at  timestamptz not null default now()
);

create table if not exists fahrzeuge (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  kunde_id     uuid not null references kunden on delete cascade,
  kennzeichen  text,
  marke        text,
  modell       text,
  baujahr      int,
  fin          text,
  km           int,
  tuev         date,
  notizen      text,
  created_at   timestamptz not null default now()
);

create table if not exists auftraege (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users on delete cascade,
  fahrzeug_id   uuid not null references fahrzeuge on delete cascade,
  datum         date not null default current_date,
  titel         text not null,
  beschreibung  text,
  km            int,
  status        text not null default 'offen' check (status in ('offen','in_arbeit','fertig')),
  arbeitslohn   numeric(10,2),
  created_at    timestamptz not null default now()
);

create table if not exists teile (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users on delete cascade,
  name            text not null,
  artikelnr       text,
  hersteller      text,
  bestand         numeric(10,2) not null default 0,
  mindestbestand  numeric(10,2) not null default 0,
  einkaufspreis   numeric(10,2),
  verkaufspreis   numeric(10,2),
  lagerort        text,
  notizen         text,
  created_at      timestamptz not null default now()
);

create table if not exists auftrag_teile (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  auftrag_id   uuid not null references auftraege on delete cascade,
  teil_id      uuid references teile on delete set null,
  bezeichnung  text not null,
  menge        numeric(10,2) not null default 1,
  preis        numeric(10,2),
  created_at   timestamptz not null default now()
);

create table if not exists fotos (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users on delete cascade,
  fahrzeug_id   uuid not null references fahrzeuge on delete cascade,
  auftrag_id    uuid references auftraege on delete set null,
  pfad          text not null,
  beschreibung  text,
  created_at    timestamptz not null default now()
);

create table if not exists termine (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  kunde_id     uuid references kunden on delete set null,
  fahrzeug_id  uuid references fahrzeuge on delete set null,
  beginn       timestamptz not null,
  dauer_min    int not null default 60,
  titel        text not null,
  notizen      text,
  erledigt     boolean not null default false,
  created_at   timestamptz not null default now()
);

-- Papierkorb: gelöschte Einträge (inkl. abhängiger Daten) 30 Tage aufheben
create table if not exists papierkorb (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  typ         text not null,
  titel       text,
  daten       jsonb not null,
  created_at  timestamptz not null default now()
);

-- Kalender-Abo: geheimer Link, über den das iPhone die Termine abonniert
create table if not exists kalender_abos (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() unique references auth.users on delete cascade,
  token             text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  name              text,
  erinnerung        int not null default 60,
  erledigte_zeigen  boolean not null default false,
  created_at        timestamptz not null default now()
);

create index if not exists fahrzeuge_kunde_idx     on fahrzeuge (kunde_id);
create index if not exists auftraege_fahrzeug_idx  on auftraege (fahrzeug_id);
create index if not exists auftrag_teile_idx       on auftrag_teile (auftrag_id);
create index if not exists fotos_fahrzeug_idx      on fotos (fahrzeug_id);
create index if not exists termine_beginn_idx      on termine (beginn);

-- ---------- Zugriffsschutz: jeder sieht nur seine eigenen Daten ----------

do $$
declare t text;
begin
  foreach t in array array['kunden','fahrzeuge','auftraege','teile','auftrag_teile','fotos','termine','papierkorb','kalender_abos']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "nur eigene daten" on %I', t);
    execute format(
      'create policy "nur eigene daten" on %I for all to authenticated
         using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

-- ---------- Live-Synchronisierung zwischen Geräten ----------

do $$
declare t text;
begin
  foreach t in array array['kunden','fahrzeuge','auftraege','teile','auftrag_teile','fotos','termine','papierkorb']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;

-- ---------- Foto-Speicher (privat) ----------

insert into storage.buckets (id, name, public)
values ('fotos', 'fotos', false)
on conflict (id) do nothing;

drop policy if exists "fotos eigene lesen"     on storage.objects;
drop policy if exists "fotos eigene hochladen" on storage.objects;
drop policy if exists "fotos eigene loeschen"  on storage.objects;

create policy "fotos eigene lesen" on storage.objects for select to authenticated
  using (bucket_id = 'fotos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "fotos eigene hochladen" on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "fotos eigene loeschen" on storage.objects for delete to authenticated
  using (bucket_id = 'fotos' and (storage.foldername(name))[1] = auth.uid()::text);

-- nötig, damit beim Wiederherstellen einer Sicherung Fotos überschrieben werden dürfen
drop policy if exists "fotos eigene aendern" on storage.objects;
create policy "fotos eigene aendern" on storage.objects for update to authenticated
  using (bucket_id = 'fotos' and (storage.foldername(name))[1] = auth.uid()::text);
