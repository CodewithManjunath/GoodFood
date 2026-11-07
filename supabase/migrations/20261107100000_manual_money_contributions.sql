begin;

create table if not exists public.money_donations (
  id uuid primary key default gen_random_uuid(),
  donor_id uuid not null references public.profiles (id) on delete restrict,
  order_id text not null unique
    check (order_id ~ '^GF[A-F0-9]{24}$'),
  amount_paise bigint not null check (amount_paise >= 100),
  currency text not null default 'INR' check (currency = 'INR'),
  donor_reference text not null
    check (length(btrim(donor_reference)) between 3 and 120),
  verified_reference text,
  verified_amount_paise bigint,
  status text not null default 'submitted'
    check (status in ('submitted', 'paid', 'rejected')),
  reviewer_id uuid references public.profiles (id) on delete restrict,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  paid_at timestamptz,
  check (
    (status = 'submitted' and reviewer_id is null and reviewed_at is null and paid_at is null
      and verified_reference is null and verified_amount_paise is null and review_note is null)
    or (status = 'rejected' and reviewer_id is not null and reviewed_at is not null and paid_at is null
      and verified_reference is null and verified_amount_paise is null
      and length(btrim(review_note)) between 5 and 1000)
    or (status = 'paid' and reviewer_id is not null and reviewed_at is not null and paid_at is not null
      and verified_reference is not null and verified_amount_paise = amount_paise
      and length(btrim(review_note)) between 5 and 1000)
  )
);

create index if not exists money_donations_donor_created_idx
  on public.money_donations (donor_id, created_at desc);
create index if not exists money_donations_status_created_idx
  on public.money_donations (status, created_at desc);
create unique index if not exists money_donations_donor_reference_unique_idx
  on public.money_donations (
    upper(regexp_replace(btrim(donor_reference), '[[:space:]]+', ' ', 'g'))
  );

alter table public.money_donations enable row level security;

drop policy if exists "Members view their own money donations" on public.money_donations;
create policy "Members view their own money donations"
  on public.money_donations for select to authenticated
  using (
    donor_id = (select auth.uid())
    or public.is_platform_admin()
  );

revoke all on public.money_donations from anon, authenticated;
grant select on public.money_donations to authenticated;
grant all on public.money_donations to service_role;

commit;
