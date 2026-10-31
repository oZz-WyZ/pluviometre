-- À exécuter une fois dans Supabase > SQL Editor.

-- Table des relevés : une ligne par jour
create table if not exists public.releves (
  jour date primary key,
  mm numeric(6,1) not null check (mm >= 0),
  updated_at timestamptz not null default now()
);

-- Sécurité : lecture publique, écriture réservée à un utilisateur connecté
alter table public.releves enable row level security;

drop policy if exists "lecture publique" on public.releves;
create policy "lecture publique"
  on public.releves for select
  to anon, authenticated
  using (true);

drop policy if exists "ecriture connecte" on public.releves;
create policy "ecriture connecte"
  on public.releves for all
  to authenticated
  using (true)
  with check (true);
