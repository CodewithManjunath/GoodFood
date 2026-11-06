begin;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  role text check (role in ('ngo', 'donor', 'individual')),
  country text not null default 'India',
  city text not null default '',
  timezone text not null default 'Asia/Kolkata',
  is_verified boolean not null default false,
  is_suspended boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_length check (char_length(display_name) <= 80),
  constraint profiles_country_length check (char_length(country) between 2 and 80),
  constraint profiles_city_length check (char_length(city) <= 100),
  constraint profiles_timezone_length check (char_length(timezone) between 1 and 80)
);

create table if not exists public.donations (
  id uuid primary key default gen_random_uuid(),
  donor_id uuid not null references public.profiles (id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 3 and 70),
  category text not null check (category in ('Produce', 'Bakery', 'Prepared meals', 'Dairy', 'Other')),
  quantity text not null check (char_length(btrim(quantity)) between 1 and 35),
  description text not null check (char_length(btrim(description)) between 1 and 300),
  pickup_starts_at timestamptz not null,
  pickup_ends_at timestamptz not null,
  food_safety_confirmed boolean not null default false check (food_safety_confirmed),
  status text not null default 'available'
    check (status in ('available', 'requested', 'confirmed', 'collected', 'withdrawn')),
  created_at timestamptz not null default now(),
  constraint donations_pickup_window check (pickup_ends_at > pickup_starts_at),
  constraint donations_pickup_window_max check (pickup_ends_at <= pickup_starts_at + interval '7 days')
);

create table if not exists public.claims (
  id uuid primary key default gen_random_uuid(),
  donation_id uuid not null references public.donations (id) on delete restrict,
  donor_id uuid not null references public.profiles (id) on delete restrict,
  ngo_id uuid not null references public.profiles (id) on delete restrict,
  note text not null default '' check (char_length(note) <= 500),
  pickup_instructions text check (pickup_instructions is null or char_length(pickup_instructions) between 5 and 500),
  status text not null default 'requested'
    check (status in ('requested', 'confirmed', 'declined', 'collected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists donations_public_feed_idx
  on public.donations (pickup_ends_at, created_at desc)
  where status = 'available';
create index if not exists donations_owner_idx
  on public.donations (donor_id, created_at desc);
create index if not exists claims_donor_idx
  on public.claims (donor_id, created_at desc);
create index if not exists claims_ngo_idx
  on public.claims (ngo_id, created_at desc);
create unique index if not exists claims_one_active_request_per_donation_idx
  on public.claims (donation_id)
  where status in ('requested', 'confirmed');

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$$;

create or replace function public.has_goodfood_role(required_role text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = required_role
      and not is_suspended
  );
$$;

create or replace function public.is_goodfood_verified()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and is_verified
      and not is_suspended
  );
$$;

create or replace function public.create_goodfood_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requested_role text := new.raw_user_meta_data ->> 'role';
begin
  insert into public.profiles (
    id,
    display_name,
    role,
    country,
    city,
    timezone
  )
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name', ''), 80),
    case when requested_role in ('ngo', 'donor', 'individual') then requested_role else null end,
    left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'country'), ''), 'India'), 80),
    left(coalesce(new.raw_user_meta_data ->> 'city', ''), 100),
    left(coalesce(nullif(new.raw_user_meta_data ->> 'timezone', ''), 'Asia/Kolkata'), 80)
  );
  return new;
end;
$$;

drop trigger if exists on_goodfood_auth_user_created on auth.users;
create trigger on_goodfood_auth_user_created
  after insert on auth.users
  for each row execute function public.create_goodfood_profile();

insert into public.profiles (id, display_name, role)
select
  users.id,
  left(coalesce(users.raw_user_meta_data ->> 'display_name', users.raw_user_meta_data ->> 'full_name', ''), 80),
  case
    when users.raw_user_meta_data ->> 'role' in ('ngo', 'donor', 'individual')
      then users.raw_user_meta_data ->> 'role'
    else null
  end
from auth.users as users
on conflict (id) do nothing;

create or replace function public.complete_goodfood_profile(
  profile_display_name text,
  profile_role text,
  profile_country text,
  profile_city text,
  profile_timezone text
)
returns public.profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  updated_profile public.profiles;
begin
  if auth.uid() is null then
    raise exception 'Sign in is required.' using errcode = '42501';
  end if;
  if profile_role not in ('ngo', 'donor', 'individual') then
    raise exception 'Choose a supported account type.' using errcode = '22023';
  end if;
  if char_length(btrim(profile_display_name)) not between 2 and 80
      or char_length(btrim(profile_country)) not between 2 and 80
      or char_length(btrim(profile_city)) not between 2 and 100
      or char_length(btrim(profile_timezone)) not between 1 and 80 then
    raise exception 'Enter a valid name, country, city, and time zone.' using errcode = '22023';
  end if;

  update public.profiles
  set display_name = btrim(profile_display_name),
      role = profile_role,
      country = btrim(profile_country),
      city = btrim(profile_city),
      timezone = btrim(profile_timezone),
      updated_at = now()
  where id = auth.uid()
    and role is null
  returning * into updated_profile;

  if not found then
    raise exception 'This profile is already complete or unavailable.' using errcode = '42501';
  end if;
  return updated_profile;
end;
$$;

create or replace function public.request_goodfood_donation(
  requested_donation_id uuid,
  request_note text default ''
)
returns public.claims
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_donation public.donations;
  created_claim public.claims;
begin
  if auth.uid() is null
      or not public.has_goodfood_role('ngo')
      or not public.is_goodfood_verified() then
    raise exception 'A verified, active NGO account is required to request food.' using errcode = '42501';
  end if;
  if char_length(coalesce(request_note, '')) > 500 then
    raise exception 'The request note is too long.' using errcode = '22023';
  end if;

  select *
  into target_donation
  from public.donations
  where id = requested_donation_id
  for update;

  if not found
      or target_donation.status <> 'available'
      or target_donation.pickup_ends_at <= now() then
    raise exception 'This donation is no longer available.' using errcode = 'P0002';
  end if;
  if target_donation.donor_id = auth.uid() then
    raise exception 'You cannot request your own donation.' using errcode = '42501';
  end if;

  insert into public.claims (donation_id, donor_id, ngo_id, note)
  values (target_donation.id, target_donation.donor_id, auth.uid(), coalesce(btrim(request_note), ''))
  returning * into created_claim;

  update public.donations
  set status = 'requested'
  where id = target_donation.id;

  return created_claim;
end;
$$;

create or replace function public.respond_to_goodfood_claim(
  target_claim_id uuid,
  response_action text,
  private_pickup_instructions text default null
)
returns public.claims
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_claim public.claims;
  target_donation public.donations;
begin
  if response_action not in ('confirm', 'decline') then
    raise exception 'Choose confirm or decline.' using errcode = '22023';
  end if;
  if response_action = 'confirm'
      and char_length(btrim(coalesce(private_pickup_instructions, ''))) not between 5 and 500 then
    raise exception 'Provide pickup instructions between 5 and 500 characters.' using errcode = '22023';
  end if;

  select * into target_claim
  from public.claims
  where id = target_claim_id
  for update;
  if not found or target_claim.donor_id <> auth.uid() then
    raise exception 'This request is not available to your account.' using errcode = '42501';
  end if;
  if target_claim.status <> 'requested' then
    raise exception 'This request has already been handled.' using errcode = '40001';
  end if;

  select * into target_donation
  from public.donations
  where id = target_claim.donation_id
  for update;

  if response_action = 'confirm' then
    update public.claims
    set status = 'confirmed',
        pickup_instructions = btrim(private_pickup_instructions),
        updated_at = now()
    where id = target_claim.id
    returning * into target_claim;
    update public.donations
    set status = 'confirmed'
    where id = target_donation.id;
  else
    update public.claims
    set status = 'declined', updated_at = now()
    where id = target_claim.id
    returning * into target_claim;
    update public.donations
    set status = case when pickup_ends_at > now() then 'available' else 'withdrawn' end
    where id = target_donation.id;
  end if;

  return target_claim;
end;
$$;

create or replace function public.complete_goodfood_pickup(target_claim_id uuid)
returns public.claims
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_claim public.claims;
begin
  update public.claims
  set status = 'collected', updated_at = now()
  where id = target_claim_id
    and ngo_id = auth.uid()
    and status = 'confirmed'
  returning * into target_claim;
  if not found then
    raise exception 'Only the requesting NGO can complete a confirmed pickup.' using errcode = '42501';
  end if;

  update public.donations
  set status = 'collected'
  where id = target_claim.donation_id;
  return target_claim;
end;
$$;

create or replace function public.withdraw_goodfood_donation(target_donation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.donations
  set status = 'withdrawn'
  where id = target_donation_id
    and donor_id = auth.uid()
    and status = 'available';
  if not found then
    raise exception 'This donation cannot be withdrawn.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.moderate_goodfood_donation(target_donation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Platform administrator access is required.' using errcode = '42501';
  end if;
  update public.donations
  set status = 'withdrawn'
  where id = target_donation_id
    and status <> 'withdrawn';
  if not found then
    raise exception 'This donation is not available to moderate.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.review_goodfood_profile(
  target_profile_id uuid,
  profile_verified boolean,
  profile_suspended boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Platform administrator access is required.' using errcode = '42501';
  end if;
  update public.profiles
  set is_verified = profile_verified,
      is_suspended = profile_suspended,
      updated_at = now()
  where id = target_profile_id
    and role is not null;
  if not found then
    raise exception 'This member is not available to review.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.goodfood_impact_summary()
returns table (total_donations bigint, collected_pickups bigint, available_donations bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    (select count(*) from public.donations where status <> 'withdrawn'),
    (select count(*) from public.claims where status = 'collected'),
    (select count(*) from public.donations where status = 'available' and pickup_ends_at > now());
$$;

alter table public.profiles enable row level security;
alter table public.donations enable row level security;
alter table public.claims enable row level security;

drop policy if exists "Profiles are visible to signed-in members" on public.profiles;
create policy "Profiles are visible to signed-in members"
  on public.profiles for select to authenticated
  using (true);

drop policy if exists "Members update their own public profile" on public.profiles;
create policy "Members update their own public profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()) and role is not null)
  with check (id = (select auth.uid()) and role is not null);

drop policy if exists "Admins review profiles" on public.profiles;
create policy "Admins review profiles"
  on public.profiles for update to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

drop policy if exists "Members see available or related donations" on public.donations;
create policy "Members see available or related donations"
  on public.donations for select to authenticated
  using (
    (status = 'available' and pickup_ends_at > now())
    or donor_id = (select auth.uid())
    or public.is_platform_admin()
    or exists (
      select 1 from public.claims
      where claims.donation_id = donations.id
        and claims.ngo_id = (select auth.uid())
    )
  );

drop policy if exists "Verified donors publish safe listings" on public.donations;
create policy "Verified donors publish safe listings"
  on public.donations for insert to authenticated
  with check (
    donor_id = (select auth.uid())
    and (public.has_goodfood_role('donor') or public.has_goodfood_role('individual'))
    and public.is_goodfood_verified()
    and status = 'available'
    and pickup_ends_at > now()
    and food_safety_confirmed
  );

drop policy if exists "Members see their own requests" on public.claims;
create policy "Members see their own requests"
  on public.claims for select to authenticated
  using (
    donor_id = (select auth.uid())
    or ngo_id = (select auth.uid())
    or public.is_platform_admin()
  );

revoke all on public.profiles from anon, authenticated;
revoke all on public.donations from anon, authenticated;
revoke all on public.claims from anon, authenticated;
grant select on public.profiles, public.donations, public.claims to authenticated;
grant update (display_name, country, city, timezone)
  on public.profiles to authenticated;
grant insert (donor_id, title, category, quantity, description, pickup_starts_at, pickup_ends_at, food_safety_confirmed, status)
  on public.donations to authenticated;

revoke all on function public.create_goodfood_profile() from public, anon, authenticated;
revoke all on function public.is_platform_admin() from public, anon;
revoke all on function public.has_goodfood_role(text) from public, anon;
revoke all on function public.is_goodfood_verified() from public, anon;
revoke all on function public.complete_goodfood_profile(text, text, text, text, text) from public, anon;
revoke all on function public.request_goodfood_donation(uuid, text) from public, anon;
revoke all on function public.respond_to_goodfood_claim(uuid, text, text) from public, anon;
revoke all on function public.complete_goodfood_pickup(uuid) from public, anon;
revoke all on function public.withdraw_goodfood_donation(uuid) from public, anon;
revoke all on function public.moderate_goodfood_donation(uuid) from public, anon;
revoke all on function public.review_goodfood_profile(uuid, boolean, boolean) from public, anon;
revoke all on function public.goodfood_impact_summary() from public, anon;

grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.has_goodfood_role(text) to authenticated;
grant execute on function public.is_goodfood_verified() to authenticated;
grant execute on function public.complete_goodfood_profile(text, text, text, text, text) to authenticated;
grant execute on function public.request_goodfood_donation(uuid, text) to authenticated;
grant execute on function public.respond_to_goodfood_claim(uuid, text, text) to authenticated;
grant execute on function public.complete_goodfood_pickup(uuid) to authenticated;
grant execute on function public.withdraw_goodfood_donation(uuid) to authenticated;
grant execute on function public.moderate_goodfood_donation(uuid) to authenticated;
grant execute on function public.review_goodfood_profile(uuid, boolean, boolean) to authenticated;
grant execute on function public.goodfood_impact_summary() to authenticated;

commit;
