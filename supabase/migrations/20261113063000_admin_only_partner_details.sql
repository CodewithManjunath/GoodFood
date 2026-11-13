begin;

create table if not exists public.goodfood_partner_private_details (
  user_id uuid primary key references auth.users (id) on delete cascade,
  state text not null default '' check (char_length(state) <= 100),
  phone text not null default '' check (char_length(phone) <= 30 and phone ~ '^[+0-9() .-]{0,30}$'),
  organization_address text not null default '' check (char_length(organization_address) <= 300),
  registration_number text not null default '' check (char_length(registration_number) <= 120),
  updated_at timestamptz not null default now()
);

alter table public.goodfood_partner_private_details enable row level security;
drop policy if exists "Admins read private partner details" on public.goodfood_partner_private_details;
create policy "Admins read private partner details"
  on public.goodfood_partner_private_details for select to authenticated
  using (public.is_platform_admin());

revoke all on public.goodfood_partner_private_details from anon, authenticated;
grant select on public.goodfood_partner_private_details to authenticated;

create or replace function public.get_my_goodfood_private_details()
returns table (
  state text,
  phone text,
  organization_address text,
  registration_number text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    coalesce(details.state, ''),
    coalesce(details.phone, ''),
    coalesce(details.organization_address, ''),
    coalesce(details.registration_number, '')
  from public.profiles as profile
  left join public.goodfood_partner_private_details as details
    on details.user_id = profile.id
  where profile.id = auth.uid();
$$;

create or replace function public.save_my_goodfood_private_details(
  private_state text,
  private_phone text,
  private_organization_address text,
  private_registration_number text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  member_role text;
  safe_state text := btrim(coalesce(private_state, ''));
  safe_phone text := btrim(coalesce(private_phone, ''));
  safe_address text := btrim(coalesce(private_organization_address, ''));
  safe_registration text := btrim(coalesce(private_registration_number, ''));
begin
  if auth.uid() is null then
    raise exception 'Sign in is required.' using errcode = '42501';
  end if;

  select profile.role
    into member_role
    from public.profiles as profile
    where profile.id = auth.uid()
      and not profile.is_suspended;
  if not found or (member_role is null and not public.is_platform_admin()) then
    raise exception 'An active GoodFood account is required.' using errcode = '42501';
  end if;

  if char_length(safe_state) > 100
      or char_length(safe_phone) > 30
      or safe_phone !~ '^[+0-9() .-]{0,30}$'
      or char_length(safe_address) > 300
      or char_length(safe_registration) > 120 then
    raise exception 'One or more private profile fields are invalid.' using errcode = '22023';
  end if;
  if member_role <> 'ngo' and (safe_address <> '' or safe_registration <> '') then
    raise exception 'Organization address and registration details are for NGO accounts only.' using errcode = '22023';
  end if;

  insert into public.goodfood_partner_private_details (
    user_id,
    state,
    phone,
    organization_address,
    registration_number,
    updated_at
  )
  values (
    auth.uid(),
    safe_state,
    safe_phone,
    safe_address,
    safe_registration,
    now()
  )
  on conflict (user_id) do update
    set state = excluded.state,
        phone = excluded.phone,
        organization_address = excluded.organization_address,
        registration_number = excluded.registration_number,
        updated_at = excluded.updated_at;
end;
$$;

create or replace function public.admin_goodfood_partner_details()
returns table (
  id uuid,
  display_name text,
  role text,
  country text,
  city text,
  is_verified boolean,
  is_suspended boolean,
  created_at timestamptz,
  email text,
  state text,
  phone text,
  organization_address text,
  registration_number text
)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Platform administrator access is required.' using errcode = '42501';
  end if;

  return query
    select
      profile.id,
      profile.display_name,
      profile.role,
      profile.country,
      profile.city,
      profile.is_verified,
      profile.is_suspended,
      profile.created_at,
      coalesce(auth_user.email, ''),
      coalesce(details.state, ''),
      coalesce(details.phone, ''),
      coalesce(details.organization_address, ''),
      coalesce(details.registration_number, '')
    from public.profiles as profile
    join auth.users as auth_user on auth_user.id = profile.id
    left join public.goodfood_partner_private_details as details
      on details.user_id = profile.id
    where profile.role is not null
    order by profile.created_at desc;
end;
$$;

revoke all on function public.get_my_goodfood_private_details() from public, anon;
revoke all on function public.save_my_goodfood_private_details(text, text, text, text) from public, anon;
revoke all on function public.admin_goodfood_partner_details() from public, anon;
grant execute on function public.get_my_goodfood_private_details() to authenticated;
grant execute on function public.save_my_goodfood_private_details(text, text, text, text) to authenticated;
grant execute on function public.admin_goodfood_partner_details() to authenticated;

commit;
