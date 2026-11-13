drop policy if exists "Verified donors publish safe listings" on public.donations;
create policy "Verified donors publish safe listings"
  on public.donations for insert to authenticated
  with check (
    donor_id = (select auth.uid())
    and (
      public.has_goodfood_role('donor')
      or public.has_goodfood_role('individual')
      or public.is_platform_admin()
    )
    and public.is_goodfood_verified()
    and status = 'available'
    and pickup_ends_at > now()
    and food_safety_confirmed
  );
