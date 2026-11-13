begin;

alter table public.money_donations
  add column if not exists receipt_path text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'money_donations_receipt_path_check'
      and conrelid = 'public.money_donations'::regclass
  ) then
    alter table public.money_donations
      add constraint money_donations_receipt_path_check
      check (
        receipt_path is null
        or receipt_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'
      );
  end if;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'goodfood-money-receipts',
  'goodfood-money-receipts',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "Members view their contribution receipts" on storage.objects;
create policy "Members view their contribution receipts"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'goodfood-money-receipts'
    and (
      public.is_platform_admin()
      or (storage.foldername(name))[1] = (select auth.uid())::text
    )
  );

drop policy if exists "Members upload their contribution receipts" on storage.objects;
create policy "Members upload their contribution receipts"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'goodfood-money-receipts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'
    and metadata ->> 'mimetype' in ('image/jpeg', 'image/png', 'image/webp')
  );

drop policy if exists "Members remove their unlinked contribution receipts" on storage.objects;
create policy "Members remove their unlinked contribution receipts"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'goodfood-money-receipts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not exists (
      select 1
      from public.money_donations
      where money_donations.receipt_path = name
    )
  );

commit;
