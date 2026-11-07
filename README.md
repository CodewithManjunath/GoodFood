# Goodfood

Goodfood connects surplus-food donors with local nonprofit recipients. The app uses Supabase Auth and Postgres, with row-level security controlling shared listings, requests, partner verification, and pickup status.

## Local setup

Requires Node.js 22 or newer and the Goodfood Supabase project.

1. Copy `.env.example` to `.env.local`.
2. Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_JWKS_URL`. The publishable key is intended for the browser; never expose a Supabase secret/service-role key.
3. In the Supabase SQL Editor, run `supabase/migrations/20261106230000_goodfood_production.sql` as the project owner. The app requires these tables, role checks, RPCs, and row-level security policies.
4. Configure Supabase Auth: enable email/password; configure Google OAuth if desired; set the production site's URL and allowed redirect URLs. Keep the Supabase callback URL in the Google OAuth client's authorized redirect URIs.
5. Run `npm ci`, `npm run dev`, and open the local Vite URL shown in the terminal. Run `npm test` for the Node server route smoke tests and `npm run build` for a production build.

The migration creates a private profile record for every Auth user, shared donation and request tables, and transactional functions for requesting, confirming, declining, withdrawing, and completing a pickup. The database enforces ownership and partner roles independently of the browser. Exact pickup instructions are stored with a request and are readable only by the donor, requesting NGO, and platform administrator.

## Launch on Render

The existing Node.js server serves the production Vite build and exposes `/healthz`. To deploy:

1. Import `CodewithManjunath/GoodFood` from GitHub as a Render web service.
2. Use Node as the runtime, `npm ci && npm run build` as the build command, and `npm start` as the start command. Set the health check path to `/healthz`.
3. Provide the Supabase settings in Render's environment. `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` must be available during the build; `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_JWKS_URL` are server runtime settings.
4. After Render assigns the site URL, set it as the Supabase Auth site URL and add it to the allowed redirect URLs. Test email confirmation, sign-in, Google sign-in (if enabled), and password/account flows on the deployed HTTPS origin.
5. Create the first platform administrator through Supabase's trusted user-management tools by assigning `app_metadata.role = "admin"`. Never let a user grant themselves admin access.

Choose a paid, always-on Render instance and a Supabase plan appropriate for the expected activity before accepting time-sensitive real pickup requests. Free hosting/database tiers can sleep, pause, or have service limits; they are suitable for a preview, not dependable food handoffs. A host-provided URL can be used initially; a custom domain can be connected later.

## Privacy and terms

The public [Privacy Notice](https://goodfood-font.onrender.com/privacy.html) and [Terms of Service](https://goodfood-font.onrender.com/terms.html) describe the current app behavior and can be linked from the Google OAuth consent screen. They are operational drafts, not legal advice. The platform operator must review them for the actual operating entity, support contact, applicable jurisdictions, retention schedule, incident process, and regulatory requirements before public launch. Update both the site and Google Auth Platform consent-screen links whenever the policies change.

## Roles and verification

- Signup supports NGOs/recipients, food businesses, and individual donors. Each has a separate Supabase Auth account.
- New accounts start unverified. A platform admin must review and verify an account before an NGO can request food or a donor can publish a listing.
- The frontend stores only public listing data and each signed-in user's saved-list preference. Donations, claims, account roles, verification decisions, and pickup instructions are shared through Supabase.
- Admin rights come only from the signed-in user's Supabase `app_metadata.role`. The public profile's role cannot be edited after signup or profile completion.
- A donor must confirm a request before the private pickup instructions become visible to its requesting NGO. The NGO marks a confirmed pickup collected.

## India launch checklist

- Decide and document the operator's food-safety, allergen disclosure, packaging, storage, pickup, and incident-response procedures. A donor attestation and free-text ingredient/storage disclosure in the app do not verify food safety or establish regulatory compliance.
- Review the applicable FSSAI and local requirements with an appropriate qualified adviser before enabling real-world handoffs.
- Decide how the platform will verify NGOs and donors; admin approval currently records a manual verification decision but does not collect or validate identity documents or licenses.
- Provide real support contact details and a privacy notice/data-retention process before onboarding the public.
- Use a paid, monitored deployment for time-sensitive listings and test the complete donor/NGO workflow with accounts you control before launch.

## Not yet provided

The core shared listing and request lifecycle is implemented. Email/SMS or push notifications, in-app chat, document upload, automated partner/license verification, map-distance search, multilingual content, and automated stale-listing cleanup are not implemented. The notification control explicitly reports that notifications are unavailable. Do not promise those features to users until they are added and tested.
