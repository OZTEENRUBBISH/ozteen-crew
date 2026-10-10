-- =============================================================
-- OzTeen Crew board: database setup
-- Run this ONCE in Supabase: SQL Editor -> New query -> paste -> Run
-- =============================================================

create extension if not exists pgcrypto;

-- ---------- Tables ----------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null default '',
  role text not null default 'crew' check (role in ('owner','crew')),
  active boolean not null default true,
  must_change_password boolean not null default true,
  availability_note text not null default '',
  last_seen timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.availability (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  status text not null check (status in ('all','am','pm','off')),
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  service text not null default 'Rubbish' check (service in ('Rubbish','Gardens','Pressure')),
  start_date date not null,
  end_date date,
  start_time time,
  end_time time,
  address text not null default '',
  suburb text not null default '',
  notes text not null default '',
  crew uuid[] not null default '{}',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.job_photos (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  path text not null,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------- Helper checks ----------

create or replace function public.is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active)
$$;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active and role = 'owner')
$$;

-- ---------- Every new login account gets a crew profile ----------

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, name)
  values (new.id, new.email, split_part(new.email, '@', 1))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Crew can't promote themselves; owners can't lock themselves out ----------

create or replace function public.protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then  -- run from the Supabase dashboard / SQL editor
    return new;
  end if;
  if not public.is_owner() then
    new.role := old.role;
    new.active := old.active;
    new.email := old.email;
  end if;
  if old.id = auth.uid() then
    new.role := old.role;
    new.active := old.active;
  end if;
  return new;
end $$;

drop trigger if exists protect_profile on public.profiles;
create trigger protect_profile before update on public.profiles
  for each row execute function public.protect_profile();

-- ---------- Security rules (Row Level Security) ----------

alter table public.profiles enable row level security;
alter table public.availability enable row level security;
alter table public.jobs enable row level security;
alter table public.job_photos enable row level security;

revoke all on public.profiles, public.availability, public.jobs, public.job_photos from anon;
grant select, insert, update, delete on public.profiles, public.availability, public.jobs, public.job_photos to authenticated;

-- profiles: active crew see the team; you can edit your own name/note; owners manage everyone
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select to authenticated
  using (public.is_active() or id = auth.uid());
drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists "profiles owners update" on public.profiles;
create policy "profiles owners update" on public.profiles for update to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- availability: everyone active can see it; you only change your own
drop policy if exists "availability read" on public.availability;
create policy "availability read" on public.availability for select to authenticated
  using (public.is_active());
drop policy if exists "availability write own" on public.availability;
create policy "availability write own" on public.availability for all to authenticated
  using (user_id = auth.uid() and public.is_active())
  with check (user_id = auth.uid() and public.is_active());

-- jobs: everyone active can see them; only owners add, change or delete
drop policy if exists "jobs read" on public.jobs;
create policy "jobs read" on public.jobs for select to authenticated using (public.is_active());
drop policy if exists "jobs insert" on public.jobs;
create policy "jobs insert" on public.jobs for insert to authenticated with check (public.is_owner());
drop policy if exists "jobs update" on public.jobs;
create policy "jobs update" on public.jobs for update to authenticated using (public.is_owner()) with check (public.is_owner());
drop policy if exists "jobs delete" on public.jobs;
create policy "jobs delete" on public.jobs for delete to authenticated using (public.is_owner());

-- photos: everyone active can see and add; delete your own (owners can delete any)
drop policy if exists "photos read" on public.job_photos;
create policy "photos read" on public.job_photos for select to authenticated using (public.is_active());
drop policy if exists "photos add" on public.job_photos;
create policy "photos add" on public.job_photos for insert to authenticated
  with check (public.is_active() and uploaded_by = auth.uid());
drop policy if exists "photos delete" on public.job_photos;
create policy "photos delete" on public.job_photos for delete to authenticated
  using (uploaded_by = auth.uid() or public.is_owner());

-- ---------- Photo storage (private bucket) ----------

insert into storage.buckets (id, name, public)
values ('job-photos', 'job-photos', false)
on conflict (id) do nothing;

drop policy if exists "job photos read" on storage.objects;
create policy "job photos read" on storage.objects for select to authenticated
  using (bucket_id = 'job-photos' and public.is_active());
drop policy if exists "job photos upload" on storage.objects;
create policy "job photos upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'job-photos' and public.is_active()
              and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "job photos delete" on storage.objects;
create policy "job photos delete" on storage.objects for delete to authenticated
  using (bucket_id = 'job-photos'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_owner()));

-- ---------- Live updates ----------

do $$
begin
  begin alter publication supabase_realtime add table public.jobs; exception when others then null; end;
  begin alter publication supabase_realtime add table public.availability; exception when others then null; end;
  begin alter publication supabase_realtime add table public.job_photos; exception when others then null; end;
  begin alter publication supabase_realtime add table public.profiles; exception when others then null; end;
end $$;

-- ---------- Profiles for any accounts created before this script ----------

insert into public.profiles (id, email, name)
select id, email, split_part(email, '@', 1) from auth.users
on conflict (id) do nothing;
