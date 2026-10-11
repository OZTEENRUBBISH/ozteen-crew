-- =============================================================
-- OzTeen Crew board: clients, accounts and quotes (owners only)
-- Run ONCE in Supabase: SQL Editor -> New query -> paste -> Run
-- (setup.sql must already have been run. Safe to run again.)
-- =============================================================

-- ---------- Calendar jobs: client name and quote price ----------
alter table public.jobs add column if not exists client_name text not null default '';
alter table public.jobs add column if not exists price numeric(10,2);

-- ---------- Clients & leads ----------
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'client' check (kind in ('client','lead')),
  stage text not null default 'new' check (stage in ('new','contacted','quoted','won','lost')),
  name text not null,
  phone text not null default '',
  email text not null default '',
  address text not null default '',
  suburb text not null default '',
  service text not null default '',
  source text not null default '',
  notes text not null default '',
  follow_up date,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Accounts (one row per completed job) ----------
create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  job_no integer not null,
  job_date date not null default current_date,
  client_id uuid references public.clients(id) on delete set null,
  client_name text not null default '',
  description text not null default '',
  service text not null default 'Rubbish' check (service in ('Rubbish','Gardens','Pressure','Other')),
  quote numeric(10,2) not null default 0,
  tip_fees numeric(10,2) not null default 0,
  other_costs numeric(10,2) not null default 0,
  profit numeric(10,2) generated always as (quote - tip_fees - other_costs) stored,
  cash boolean not null default false,
  notes text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists accounts_job_no_key on public.accounts (job_no);

-- ---------- Quotes ----------
create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  quote_no integer not null,
  status text not null default 'draft' check (status in ('draft','sent','accepted','declined')),
  business text not null default 'Rubbish' check (business in ('Rubbish','Gardens','Pressure')),
  quote_date date not null default current_date,
  valid_until date,
  client_id uuid references public.clients(id) on delete set null,
  client_name text not null default '',
  client_phone text not null default '',
  client_email text not null default '',
  client_address text not null default '',
  job_address text not null default '',
  items jsonb not null default '[]'::jsonb,
  gst_mode text not null default 'none' check (gst_mode in ('none','incl','add')),
  scope text not null default '',      -- "Job description" box
  comments text not null default '',   -- "Comments" box (one bullet per line)
  notes text not null default '',      -- "Notes" box (one bullet per line)
  from_details jsonb not null default '{}'::jsonb,
  total numeric(10,2) not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists quotes_quote_no_key on public.quotes (quote_no);

-- ---------- Next number = highest so far + 1 (if left blank) ----------
create or replace function public.next_job_no() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.job_no is null then
    select coalesce(max(job_no), 0) + 1 into new.job_no from accounts;
  end if;
  return new;
end $$;
drop trigger if exists accounts_job_no on public.accounts;
create trigger accounts_job_no before insert on public.accounts
  for each row execute function public.next_job_no();

create or replace function public.next_quote_no() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.quote_no is null then
    select coalesce(max(quote_no), 1000) + 1 into new.quote_no from quotes;
  end if;
  return new;
end $$;
drop trigger if exists quotes_quote_no on public.quotes;
create trigger quotes_quote_no before insert on public.quotes
  for each row execute function public.next_quote_no();

-- ---------- Security: owners only ----------
alter table public.clients enable row level security;
alter table public.accounts enable row level security;
alter table public.quotes enable row level security;

revoke all on public.clients, public.accounts, public.quotes from anon;
grant select, insert, update, delete on public.clients, public.accounts, public.quotes to authenticated;

drop policy if exists "clients owners" on public.clients;
create policy "clients owners" on public.clients for all to authenticated
  using (public.is_owner()) with check (public.is_owner());
drop policy if exists "accounts owners" on public.accounts;
create policy "accounts owners" on public.accounts for all to authenticated
  using (public.is_owner()) with check (public.is_owner());
drop policy if exists "quotes owners" on public.quotes;
create policy "quotes owners" on public.quotes for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- ---------- Live updates ----------
do $$
begin
  begin alter publication supabase_realtime add table public.clients; exception when others then null; end;
  begin alter publication supabase_realtime add table public.accounts; exception when others then null; end;
  begin alter publication supabase_realtime add table public.quotes; exception when others then null; end;
end $$;
