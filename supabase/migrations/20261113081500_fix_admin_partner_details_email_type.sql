begin;

drop function if exists public.admin_goodfood_partner_details();

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
      coalesce(auth_user.email, '')::text,
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

revoke all on function public.admin_goodfood_partner_details() from public, anon;
grant execute on function public.admin_goodfood_partner_details() to authenticated;

commit;
