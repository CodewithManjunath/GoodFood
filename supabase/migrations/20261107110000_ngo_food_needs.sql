begin;

create table if not exists public.food_needs (
  id uuid primary key default gen_random_uuid(),
  ngo_id uuid not null references public.profiles (id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 3 and 70),
  category text not null check (category in ('Produce', 'Bakery', 'Prepared meals', 'Dairy', 'Other')),
  quantity text not null check (char_length(btrim(quantity)) between 1 and 35),
  description text not null check (char_length(btrim(description)) between 1 and 300),
  needed_by timestamptz not null,
  status text not null default 'open' check (status in ('open', 'fulfilled', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists food_needs_open_feed_idx
  on public.food_needs (needed_by, created_at desc)
  where status = 'open';
create index if not exists food_needs_ngo_idx
  on public.food_needs (ngo_id, created_at desc);

alter table public.donations
  add column if not exists need_id uuid references public.food_needs (id) on delete restrict;

create index if not exists donations_need_idx
  on public.donations (need_id, created_at desc)
  where need_id is not null;

create or replace function public.create_goodfood_need(
  need_title text,
  need_category text,
  need_quantity text,
  need_description text,
  need_by timestamptz
)
returns public.food_needs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  created_need public.food_needs;
begin
  if auth.uid() is null
      or not public.has_goodfood_role('ngo')
      or not public.is_goodfood_verified() then
    raise exception 'A verified, active NGO account is required to post a food need.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(need_title, ''))) not between 3 and 70
      or need_category is null
      or need_category not in ('Produce', 'Bakery', 'Prepared meals', 'Dairy', 'Other')
      or char_length(btrim(coalesce(need_quantity, ''))) not between 1 and 35
      or char_length(btrim(coalesce(need_description, ''))) not between 1 and 300 then
    raise exception 'Enter a valid title, category, quantity, and need description.' using errcode = '22023';
  end if;
  if need_by is null or need_by <= now() or need_by > now() + interval '30 days' then
    raise exception 'Choose a need-by date within the next 30 days.' using errcode = '22023';
  end if;

  insert into public.food_needs (ngo_id, title, category, quantity, description, needed_by)
  values (
    auth.uid(),
    btrim(need_title),
    need_category,
    btrim(need_quantity),
    btrim(need_description),
    need_by
  )
  returning * into created_need;

  return created_need;
end;
$$;

create or replace function public.close_goodfood_need(target_need_id uuid)
returns public.food_needs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_need public.food_needs;
  closed_need public.food_needs;
begin
  if auth.uid() is null
      or not public.has_goodfood_role('ngo')
      or not public.is_goodfood_verified() then
    raise exception 'A verified, active NGO account is required to close a food need.' using errcode = '42501';
  end if;
  select *
  into target_need
  from public.food_needs
  where id = target_need_id
    and ngo_id = auth.uid()
    and status = 'open'
  for update;
  if not found then
    raise exception 'This food need cannot be closed.' using errcode = '42501';
  end if;
  if exists (
    select 1
    from public.donations
    join public.claims on claims.donation_id = donations.id
    where donations.need_id = target_need_id
      and claims.status in ('requested', 'confirmed')
  ) then
    raise exception 'Resolve any active pickup requests before closing this food need.' using errcode = '55000';
  end if;

  update public.food_needs
  set status = 'closed',
      updated_at = now()
  where id = target_need_id
    and ngo_id = auth.uid()
    and status = 'open'
  returning * into closed_need;

  if not found then
    raise exception 'This food need cannot be closed.' using errcode = '42501';
  end if;
  return closed_need;
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
  target_need public.food_needs;
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

  if target_donation.need_id is not null then
    select *
    into target_need
    from public.food_needs
    where id = target_donation.need_id
    for update;

    if not found
        or target_need.ngo_id <> auth.uid()
        or target_need.status <> 'open'
        or target_need.needed_by <= now() then
      raise exception 'This offer is linked to another or inactive NGO food need.' using errcode = '42501';
    end if;
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

create or replace function public.complete_goodfood_pickup(target_claim_id uuid)
returns public.claims
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_claim public.claims;
  target_need_id uuid;
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
  where id = target_claim.donation_id
  returning need_id into target_need_id;

  if target_need_id is not null then
    update public.food_needs
    set status = 'fulfilled',
        updated_at = now()
    where id = target_need_id
      and ngo_id = auth.uid()
      and status = 'open';
  end if;

  return target_claim;
end;
$$;

alter table public.food_needs enable row level security;

drop policy if exists "Members view relevant food needs" on public.food_needs;
create policy "Members view relevant food needs"
  on public.food_needs for select to authenticated
  using (
    public.is_platform_admin()
    or ngo_id = (select auth.uid())
    or (
      status = 'open'
      and needed_by > now()
      and (public.has_goodfood_role('donor') or public.has_goodfood_role('individual'))
      and public.is_goodfood_verified()
    )
  );

drop policy if exists "Members see available or related donations" on public.donations;
create policy "Members see available or related donations"
  on public.donations for select to authenticated
  using (
    (
      status = 'available'
      and pickup_ends_at > now()
      and (
        need_id is null
        or exists (
          select 1
          from public.food_needs
          where food_needs.id = donations.need_id
            and food_needs.ngo_id = (select auth.uid())
            and food_needs.status = 'open'
            and food_needs.needed_by > now()
        )
      )
    )
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
    and (
      need_id is null
      or exists (
        select 1
        from public.food_needs
        where food_needs.id = donations.need_id
          and food_needs.status = 'open'
          and food_needs.needed_by > now()
          and food_needs.ngo_id <> (select auth.uid())
      )
    )
  );

revoke all on public.food_needs from anon, authenticated;
grant select on public.food_needs to authenticated;

revoke all on function public.create_goodfood_need(text, text, text, text, timestamptz) from public, anon;
revoke all on function public.close_goodfood_need(uuid) from public, anon;
revoke all on function public.request_goodfood_donation(uuid, text) from public, anon;
revoke all on function public.complete_goodfood_pickup(uuid) from public, anon;

grant execute on function public.create_goodfood_need(text, text, text, text, timestamptz) to authenticated;
grant execute on function public.close_goodfood_need(uuid) to authenticated;
grant execute on function public.request_goodfood_donation(uuid, text) to authenticated;
grant execute on function public.complete_goodfood_pickup(uuid) to authenticated;

commit;
